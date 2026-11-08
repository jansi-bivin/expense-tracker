import { supabase, Category, Transaction } from "./supabase";
import { saveSetting } from "./budget";

/**
 * Fixed monthly auto-debits (EMIs etc.). If one hasn't shown up a couple of days
 * after its date, the app asks about it — this covers a bank that sends no message.
 * Stored in settings key "expected_debits".
 */
const KEY = "expected_debits";
const GRACE_DAYS = 2;

export interface ExpectedDebit {
  /** Day of month it's debited (1-31). */
  day: number;
  amount: number;
}

export interface ExpectedDebits {
  /** Keyed by category id. */
  items: Record<string, ExpectedDebit>;
  /** "YYYY-MM" → category ids the user said to skip that month. */
  dismissed: Record<string, number[]>;
}

export async function fetchExpectedDebits(): Promise<ExpectedDebits> {
  const { data } = await supabase.from("settings").select("value").eq("key", KEY).limit(1).maybeSingle();
  const v = (data?.value ?? {}) as Partial<ExpectedDebits>;
  return { items: v.items ?? {}, dismissed: v.dismissed ?? {} };
}

export async function saveExpectedDebits(v: ExpectedDebits) {
  await saveSetting(KEY, v as unknown as Record<string, unknown>);
}

export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export interface MissingDebit {
  category: Category;
  day: number;
  amount: number;
  /** Noon on the due day, used as the date if the user adds it. */
  dueDate: number;
}

/** Expected debits for this month that are overdue and not seen in any transaction. */
export function findMissingDebits(
  cfg: ExpectedDebits,
  categories: Category[],
  categorized: Transaction[],
  waiting: Transaction[],
  today: Date = new Date()
): MissingDebit[] {
  const y = today.getFullYear();
  const m = today.getMonth();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const skipped = new Set(cfg.dismissed[monthKey(today)] ?? []);
  const inThisMonth = (t: Transaction) => {
    const d = new Date(t.sms_date);
    return d.getFullYear() === y && d.getMonth() === m;
  };

  const out: MissingDebit[] = [];
  for (const [id, item] of Object.entries(cfg.items)) {
    const category = categories.find((c) => c.id === Number(id));
    if (!category || !item.day || !item.amount) continue;
    const day = Math.min(item.day, daysInMonth);
    if (today.getDate() < Math.min(day + GRACE_DAYS, daysInMonth)) continue;
    if (skipped.has(category.id)) continue;
    if (categorized.some((t) => t.category === category.name && inThisMonth(t))) continue;
    // Its bank message may be waiting to be categorized
    if (waiting.some((t) => inThisMonth(t) && t.amount != null && Math.abs(Number(t.amount) - item.amount) < 1)) continue;
    out.push({ category, day, amount: item.amount, dueDate: new Date(y, m, day, 12).getTime() });
  }
  return out;
}

export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${s}`;
}
