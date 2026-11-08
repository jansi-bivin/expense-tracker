import { supabase, Category, Transaction } from "./supabase";

/** Where a category stands against its limit for the period being viewed. */
export interface CategoryPosition {
  spent: number;
  /** Effective cap for the period; 0 when the category has no limit. */
  cap: number;
  /** "month" for monthly (or month-planned yearly) categories, else "year". */
  period: "month" | "year";
  status: "nocap" | "within" | "near" | "over";
}

/**
 * Spend vs cap per category name, using the same rules as the Expenses
 * screen (monthly overrides, active-days scaling, excluded categories).
 */
export function computePositions(
  categories: Category[],
  txns: Transaction[],
  opts: {
    month: number; // 0-indexed
    year: number;
    monthlyOverrides: Record<number, number>;
    scaleFactor: number;
    excludedCategoryIds?: Set<number>;
  }
): Map<string, CategoryPosition> {
  const { month, year, monthlyOverrides, scaleFactor, excludedCategoryIds } = opts;
  const byName = new Map<string, Category>();
  for (const c of categories) byName.set(c.name, c);

  const spent = new Map<string, number>();
  for (const t of txns) {
    if (!t.category || !t.amount) continue;
    const c = byName.get(t.category);
    if (!c) continue;
    const d = new Date(t.sms_date);
    const monthly = c.recurrence === "Monthly" || monthlyOverrides[c.id] != null;
    const inPeriod = monthly ? d.getMonth() === month && d.getFullYear() === year : d.getFullYear() === year;
    if (inPeriod) spent.set(c.name, (spent.get(c.name) || 0) + Number(t.amount));
  }

  const out = new Map<string, CategoryPosition>();
  for (const c of categories) {
    const override = monthlyOverrides[c.id];
    const monthly = c.recurrence === "Monthly" || override != null;
    let cap: number;
    if (override != null) cap = override;
    else if (c.recurrence === "Yearly") cap = c.cap;
    else cap = c.cap * scaleFactor;
    if (excludedCategoryIds?.has(c.id)) cap = 0;
    const s = spent.get(c.name) || 0;
    const pct = cap > 0 ? (s / cap) * 100 : 0;
    const status: CategoryPosition["status"] =
      cap <= 0 ? "nocap" : s > cap ? "over" : pct >= 75 ? "near" : "within";
    out.set(c.name, { spent: s, cap, period: monthly ? "month" : "year", status });
  }
  return out;
}

// ── Category locks: a locked category takes no new expenses from the
//    secondary user. Only the primary user can lock/unlock. ──
const LOCK_KEY = "locked_categories";

export async function fetchLockedCategories(): Promise<Set<number>> {
  const { data } = await supabase.from("settings").select("*").eq("key", LOCK_KEY).maybeSingle();
  const ids = (data?.value as { ids?: number[] } | undefined)?.ids;
  return new Set(Array.isArray(ids) ? ids : []);
}

export async function saveLockedCategories(ids: Set<number>) {
  await saveSetting(LOCK_KEY, { ids: Array.from(ids) });
}

/** Write a settings row by key: update it if it exists, else insert it. */
export async function saveSetting(key: string, value: Record<string, unknown>) {
  const updated_at = new Date().toISOString();
  const { data } = await supabase.from("settings").select("id").eq("key", key).limit(1);
  if (data && data.length > 0) {
    await supabase.from("settings").update({ value, updated_at }).eq("id", data[0].id);
  } else {
    await supabase.from("settings").insert({ key, value, updated_at });
  }
}
