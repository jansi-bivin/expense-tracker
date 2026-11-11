import { supabase, Category, Transaction } from "./supabase";
import { saveSetting } from "./budget";
import { ExpectedDebit } from "./expectedDebits";

/**
 * "Plan this month": what each category is actually expected to cost in a month
 * (separate from its limit). The app suggests it from the last 3 months; the user
 * can change it for a month. The forecast of money still to arrange uses this.
 */
export interface MonthPlan {
  /** Category id → expected amount the user set for this month. */
  expected: Record<string, number>;
  confirmed: boolean;
}
export type MonthPlans = Record<string, MonthPlan>; // "YYYY-MM" → plan

const KEY = "month_plan";

export function planKey(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

export async function fetchMonthPlans(): Promise<MonthPlans> {
  const { data } = await supabase.from("settings").select("value").eq("key", KEY).limit(1).maybeSingle();
  const months = (data?.value as { months?: MonthPlans } | undefined)?.months;
  return months && typeof months === "object" ? months : {};
}

export async function saveMonthPlans(plans: MonthPlans) {
  await saveSetting(KEY, { months: plans });
}

const round10 = (n: number) => Math.round(n / 10) * 10;

/**
 * Suggested expected amount per category id for a month:
 * a fixed monthly debit (EMI) uses its amount; otherwise the middle value of the
 * last 3 months' spend (only months since the app has data); ₹0 if none of them had any.
 */
export function suggestExpected(
  categories: Category[],
  txns: Transaction[],
  year: number,
  month: number,
  fixed?: Record<string, ExpectedDebit>,
): Record<string, number> {
  let first = Infinity;
  for (const t of txns) if (t.sms_date < first) first = t.sms_date;
  const firstD = Number.isFinite(first) ? new Date(first) : null;
  const firstIdx = firstD ? firstD.getFullYear() * 12 + firstD.getMonth() : Infinity;

  const prev: number[] = []; // month indexes (year*12+month) of the last 3 months with data
  for (let i = 1; i <= 3; i++) {
    const idx = year * 12 + month - i;
    if (idx >= firstIdx) prev.push(idx);
  }

  const spend = new Map<string, number>(); // `${name}|${idx}` → amount
  const want = new Set(prev);
  for (const t of txns) {
    if (!t.category || !t.amount) continue;
    const d = new Date(t.sms_date);
    const idx = d.getFullYear() * 12 + d.getMonth();
    if (!want.has(idx)) continue;
    const k = `${t.category}|${idx}`;
    spend.set(k, (spend.get(k) || 0) + Number(t.amount));
  }

  const out: Record<string, number> = {};
  for (const c of categories) {
    const f = fixed?.[String(c.id)];
    if (f && f.amount > 0) { out[String(c.id)] = Math.round(f.amount); continue; }
    if (prev.length === 0) { out[String(c.id)] = 0; continue; }
    const vals = prev.map((idx) => spend.get(`${c.name}|${idx}`) || 0).sort((a, b) => a - b);
    const mid = vals.length % 2 ? vals[(vals.length - 1) / 2] : (vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2;
    out[String(c.id)] = round10(mid);
  }
  return out;
}
