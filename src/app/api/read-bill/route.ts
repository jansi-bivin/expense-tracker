import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

/**
 * Reads a photo of a shop bill and files each item into one of the given categories.
 * Uses a vision model through OpenRouter (OPENROUTER_API_KEY; OPENROUTER_MODEL to change model).
 */

export const maxDuration = 60;

const DEFAULT_MODEL = "anthropic/claude-sonnet-5.5";
const MAX_IMAGE_CHARS = 4_000_000; // data URL, ~3 MB image

export interface BillItem { name: string; amount: number; category: string }
export interface BillReading { store: string | null; total: number | null; items: BillItem[] }

export async function POST(req: Request) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return NextResponse.json({ error: "Bill reading isn't set up yet (OPENROUTER_API_KEY missing in Vercel)" }, { status: 503 });

  let body: { image?: string; categories?: string[]; hint?: string | null; phone?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }
  const { image, categories, hint, phone } = body;

  if (!image || !/^data:image\/(jpeg|png|webp);base64,/.test(image) || image.length > MAX_IMAGE_CHARS)
    return NextResponse.json({ error: "Send a JPEG/PNG photo under 3 MB" }, { status: 400 });
  if (!Array.isArray(categories) || categories.length === 0 || categories.length > 400)
    return NextResponse.json({ error: "No categories" }, { status: 400 });

  // Only people using the app (each paid model call costs money)
  if (!phone) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { data: user } = await supabase.from("users").select("id").eq("phone_number", phone).limit(1).maybeSingle();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const names = categories.map((c) => String(c).slice(0, 80));
  const prompt = `This is a photo of a shop bill (usually an Indian supermarket receipt).
Read every purchased item and file it into exactly one of these categories:
${names.map((n) => `- ${n}`).join("\n")}

Rules:
- "amount" is the final amount charged for that line (after any discount), as printed in the Amt column. Not the rate or MRP.
- "category" must be copied exactly from the list above. Prefixes like "SD :" and "FC :" mean different households: ${hint ? `this payment was filed under "${hint}", so prefer categories with the same prefix.` : "keep all items in one household's categories unless the bill clearly says otherwise."}
- Pick the most specific fitting category (fruits, vegetables, curd/milk, groceries for staples, spices, cleaning items…). Use "" if nothing fits.
- "name" is a short readable item name (e.g. "Carrot", "Aashirvaad atta 1kg").
- "total" is the final bill total that was paid (after rounding). "store" is the shop name if printed, else null.
- Skip tax summary rows, savings, points and totals — only purchased items.

Reply with JSON only: {"store": string|null, "total": number|null, "items": [{"name": string, "amount": number, "category": string}]}`;

  let res: Response;
  try {
    res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "ExpTrack" },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
        temperature: 0,
        max_tokens: 4000,
        messages: [{ role: "user", content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: image } },
        ] }],
      }),
    });
  } catch {
    return NextResponse.json({ error: "Couldn't reach the bill reader. Try again." }, { status: 502 });
  }
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200);
    console.error("read-bill: OpenRouter", res.status, detail);
    return NextResponse.json({ error: `Bill reader error (${res.status})` }, { status: 502 });
  }

  const data = await res.json();
  const text: string = data?.choices?.[0]?.message?.content ?? "";
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  let parsed: { store?: unknown; total?: unknown; items?: unknown };
  try { parsed = JSON.parse(json); } catch {
    return NextResponse.json({ error: "Couldn't read that bill. Try a clearer, straight photo." }, { status: 422 });
  }

  const valid = new Set(names);
  const items: BillItem[] = (Array.isArray(parsed.items) ? parsed.items : [])
    .map((it: { name?: unknown; amount?: unknown; category?: unknown }) => ({
      name: String(it?.name ?? "").trim().slice(0, 60),
      amount: Math.round(Number(it?.amount) * 100) / 100,
      category: valid.has(String(it?.category)) ? String(it?.category) : "",
    }))
    .filter((it) => it.name && Number.isFinite(it.amount) && it.amount > 0);
  if (items.length === 0) return NextResponse.json({ error: "No items found on that bill. Try a clearer photo." }, { status: 422 });

  const total = Number(parsed.total);
  const reading: BillReading = {
    store: typeof parsed.store === "string" && parsed.store.trim() ? parsed.store.trim().slice(0, 60) : null,
    total: Number.isFinite(total) && total > 0 ? Math.round(total * 100) / 100 : null,
    items,
  };
  return NextResponse.json(reading);
}
