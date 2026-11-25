"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Category, Transaction } from "@/lib/supabase";
import { categoryNeedsNote } from "@/lib/dues";

/** `personal`: her own expense, kept out of the budget and with no due. */
export interface SplitPart { category: string; amount: number; note: string; personal?: boolean }
type Draft = { category: string; amount: string; note: string; personal?: boolean };

interface Props {
  txn: Transaction;
  /** Categories this person can file into. */
  categories: Category[];
  onSave: (parts: SplitPart[]) => Promise<string | null>;
  onClose: () => void;
  /** This person's phone (lets the bill reader know who's asking). */
  phone?: string | null;
  /** A bill photo to read straight away (filing a new payment from its review card). */
  initialBill?: File | null;
  /** Filing a new payment: one part is fine (then it's simply filed), and the button says so. */
  filing?: boolean;
  /** Parts can be marked personal (no due): for the secondary person, whose expenses become dues. */
  canPersonal?: boolean;
}

interface BillItem { name: string; amount: number; category: string }
interface BillReading { store: string | null; total: number | null; items: BillItem[] }

/** Shrinks a photo to at most 1600px on the long side, as a JPEG data URL. */
async function photoToDataUrl(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Couldn't open that picture"));
      i.src = url;
    });
    const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

const fmt = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Split one payment into parts, each filed into its own category. */
export default function SplitSheet({ txn, categories, onSave, onClose, phone, initialBill, filing, canPersonal }: Props) {
  const total = Number(txn.amount) || 0;
  const [parts, setParts] = useState<Draft[]>([
    { category: txn.category ?? "", amount: "", note: txn.notes ?? "" },
    ...(filing ? [] : [{ category: "", amount: "", note: "" }]),
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [reading, setReading] = useState(false);
  const [bill, setBill] = useState<BillReading | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /** Reads a bill photo and turns its items into parts, one per category (largest first). */
  async function readBill(file: File) {
    setReading(true);
    setError(null);
    try {
      const image = await photoToDataUrl(file);
      const res = await fetch("/api/read-bill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image, categories: categories.map((c) => c.name), hint: txn.category, phone }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't read the bill");
      const reading = data as BillReading;
      const groups = new Map<string, { amount: number; names: string[] }>();
      for (const it of reading.items) {
        const g = groups.get(it.category) ?? { amount: 0, names: [] };
        g.amount += it.amount;
        g.names.push(it.name);
        groups.set(it.category, g);
      }
      const sorted = [...groups.entries()].sort((a, b) => b[1].amount - a[1].amount);
      const next = sorted.map(([category, g]) => ({ category, amount: String(round2(g.amount)), note: g.names.join(", ").slice(0, 200) }));
      if (next.length === 1 && !filing) next.push({ category: "", amount: "", note: "" });
      setParts(next);
      setBill(reading);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read the bill");
    } finally {
      setReading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  // Filing from the review card: the photo was already picked
  const started = useRef(false);
  useEffect(() => {
    if (initialBill && !started.current) { started.current = true; readBill(initialBill); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialBill]);

  const choices = useMemo(() => [...categories].sort((a, b) => a.name.localeCompare(b.name)), [categories]);

  // The first part takes whatever the others don't
  const othersSum = round2(parts.slice(1).reduce((s, p) => s + (Number(p.amount) || 0), 0));
  const firstAmount = round2(total - othersSum);
  const amounts = [firstAmount, ...parts.slice(1).map((p) => Number(p.amount) || 0)];

  const problem =
    parts.some((p) => !p.category && !p.personal) ? "Pick a category for every part"
    : amounts.some((a) => a <= 0) ? (firstAmount <= 0 ? `The parts add up to more than ${fmt(total)}` : "Every part needs an amount")
    : parts.some((p) => !p.personal && categoryNeedsNote(p.category) && !p.note.trim()) ? "Add a note where the category needs one"
    : null;

  const set = (i: number, patch: Partial<Draft>) =>
    setParts((prev) => prev.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  async function save() {
    if (problem || saving) return;
    setSaving(true);
    setError(null);
    const err = await onSave(parts.map((p, i) => ({
      category: p.category || "Personal", amount: amounts[i], note: p.note.trim(), personal: i > 0 && !!p.personal,
    })));
    setSaving(false);
    if (err) setError(err); else onClose();
  }

  const field = { background: "rgba(255,255,255,0.06)", border: "1px solid var(--border-light)", color: "var(--text-primary)" };

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-3 animate-fade-in"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(2px)" }} onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl flex flex-col animate-slide-up"
        style={{ background: "var(--bg-elevated)", border: "1px solid rgba(255,255,255,0.1)", maxHeight: "85vh" }}
        onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Split payment">
        <div className="flex items-start justify-between px-4 pt-4 pb-2">
          <div className="min-w-0">
            <div className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{filing ? "📷 File by bill" : "✂ Split"} {fmt(total)}</div>
            <div className="text-[11px] truncate" style={{ color: "var(--text-tertiary)" }}>
              {txn.merchant || "Payment"} · {new Date(txn.sms_date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
            </div>
          </div>
          <button className="text-sm px-2 py-1 bg-transparent border-0 cursor-pointer" style={{ color: "var(--text-tertiary)" }}
            onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="px-4 pb-2">
          <input ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) readBill(f); }} />
          <button type="button" className="w-full py-2 rounded-xl text-xs font-semibold btn-ghost disabled:opacity-50"
            disabled={reading} onClick={() => fileRef.current?.click()}>
            {reading ? "Reading the bill…" : bill ? "📷 Read another bill" : "📷 Read bill: split by its items"}
          </button>
          {bill && (() => {
            const billTotal = bill.total ?? round2(bill.items.reduce((s, it) => s + it.amount, 0));
            const diff = round2(total - billTotal);
            const unsure = bill.items.filter((it) => !it.category).length;
            return (
              <div className="text-[11px] mt-1.5" style={{ color: "var(--text-tertiary)" }}>
                {bill.items.length} items{bill.store ? ` · ${bill.store}` : ""} · bill {fmt(billTotal)}
                {Math.abs(diff) >= 1 && (
                  <span style={{ color: "var(--accent-red)" }}> · payment is {fmt(Math.abs(diff))} {diff > 0 ? "more" : "less"}; the first part takes the difference</span>
                )}
                {unsure > 0 && <span style={{ color: "var(--accent-red)" }}> · {unsure} item{unsure > 1 ? "s" : ""} need a category</span>}
                <div>Check the parts, then save.</div>
              </div>
            );
          })()}
        </div>

        <div className="overflow-y-auto px-4 pb-2 space-y-2.5">
          {parts.map((p, i) => (
            <div key={i} className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.04)", border: p.personal ? "1px dashed rgba(255,179,71,0.4)" : "1px solid rgba(255,255,255,0.06)" }}>
              <div className="flex gap-2">
                <select className="flex-1 min-w-0 px-2 py-2 rounded-lg text-xs" style={field}
                  value={p.category} onChange={(e) => set(i, { category: e.target.value })} aria-label={`Part ${i + 1} category`}>
                  <option value="">Category…</option>
                  {choices.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
                {i === 0 ? (
                  <div className="w-24 px-2 py-2 rounded-lg text-xs text-right font-semibold" style={{ ...field, color: firstAmount > 0 ? "var(--text-primary)" : "var(--accent-red)" }}
                    title="The rest of the payment">
                    {fmt(firstAmount)}
                  </div>
                ) : (
                  <input type="number" inputMode="decimal" min="0" step="0.01" placeholder="₹" className="w-24 px-2 py-2 rounded-lg text-xs text-right"
                    style={field} value={p.amount} onChange={(e) => set(i, { amount: e.target.value })} aria-label={`Part ${i + 1} amount`} />
                )}
                {i > 0 && (
                  <button type="button" className="px-1 text-xs bg-transparent border-0 cursor-pointer" style={{ color: "var(--text-tertiary)" }}
                    onClick={() => setParts((prev) => prev.filter((_, j) => j !== i))} aria-label={`Remove part ${i + 1}`}
                    disabled={parts.length <= (filing ? 1 : 2)}>✕</button>
                )}
              </div>
              {(categoryNeedsNote(p.category) || p.note) && (
                <input className="w-full mt-2 px-2 py-1.5 rounded-lg text-xs" style={field} placeholder={categoryNeedsNote(p.category) ? "Note (required)" : "Note"}
                  value={p.note} onChange={(e) => set(i, { note: e.target.value })} aria-label={`Part ${i + 1} note`} />
              )}
              {i === 0 && <div className="text-[10px] mt-1" style={{ color: "var(--text-tertiary)" }}>Gets whatever the other parts don&apos;t</div>}
              {i > 0 && canPersonal && (
                <button type="button" className="mt-1.5 text-[10px] px-2 py-0.5 rounded-md border-0 cursor-pointer"
                  style={p.personal
                    ? { background: "rgba(255,179,71,0.15)", color: "var(--accent-orange)" }
                    : { background: "rgba(255,255,255,0.05)", color: "var(--text-tertiary)" }}
                  onClick={() => set(i, { personal: !p.personal })}>
                  {p.personal ? "👤 Personal · no due, not in the budget (tap to undo)" : "👤 Mark personal (no due)"}
                </button>
              )}
            </div>
          ))}
          <button type="button" className="w-full py-2 rounded-xl text-xs font-semibold btn-ghost"
            onClick={() => setParts((prev) => [...prev, { category: "", amount: "", note: "" }])}>
            + Add part
          </button>
        </div>

        <div className="px-4 pb-4 pt-2">
          {(error || (problem && parts.slice(1).some((p) => p.amount || p.category))) && (
            <div className="text-[11px] mb-2" style={{ color: "var(--accent-red)" }}>{error ?? problem}</div>
          )}
          <button className="w-full py-2.5 btn-primary text-sm rounded-xl disabled:opacity-35" disabled={!!problem || saving} onClick={save}>
            {saving ? "Saving…" : reading ? "Reading the bill…" : parts.length === 1 ? `File as ${parts[0].category || "…"}` : `${filing ? "File, split" : "Split"} into ${parts.length} parts${parts.some((p) => p.personal) ? ` (${parts.filter((p) => p.personal).length} personal)` : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}
