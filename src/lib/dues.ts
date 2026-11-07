import { Due } from "./supabase";

/** A due enriched with the info needed for settling and month grouping. */
export interface SettleDue extends Due {
  /** Amount when the due was first created (= its transaction amount). */
  original_amount: number;
  /** When the underlying expense was paid (transaction sms_date, ms). */
  paid_on: number;
}

/** What a settlement payment does, computed before anything is written. */
export interface SettlementPlan {
  payment: number;
  /** Dues cleared in full by this payment. */
  clearIds: number[];
  /** At most one due is paid partly; its new (remaining) amount. */
  partial: { id: number; newAmount: number } | null;
  /** Payment left after every due was cleared. Becomes an advance. */
  extra: number;
  /** Outstanding dues left after this payment (all months). */
  remaining: number;
  /** Amount of a small leftover due written off (round-off), else 0. */
  roundedOff: number;
}

/** "Small" difference: up to ₹100 or 5% of the payment, whichever is lower. */
export function smallLimit(payment: number): number {
  return Math.min(100, payment * 0.05);
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Month key "YYYY-MM" (local time) for grouping. */
export function monthKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

/** Oldest first (by payment date, then id). */
export function sortOldestFirst<T extends SettleDue>(dues: T[]): T[] {
  return [...dues].sort((a, b) => a.paid_on - b.paid_on || a.id - b.id);
}

/**
 * Apply a payment to dues, oldest first. If `targetMonth` is given, that
 * month's dues are paid first and any leftover spills into the rest (oldest
 * first). If `onlyIds` is given (manual mode), only those dues are used.
 * The payment is always used in full: at most one due ends up part-paid, and
 * anything left after all dues are cleared is `extra` (kept as advance).
 */
export function planSettlement(
  payment: number,
  dues: SettleDue[],
  opts: { targetMonth?: string | null; onlyIds?: Set<number> | null; roundOff?: boolean } = {}
): SettlementPlan {
  const open = sortOldestFirst(dues.filter((d) => !d.cleared && Number(d.amount) > 0));
  let order: SettleDue[];
  if (opts.onlyIds) {
    order = open.filter((d) => opts.onlyIds!.has(d.id));
  } else if (opts.targetMonth) {
    order = [
      ...open.filter((d) => monthKey(d.paid_on) === opts.targetMonth),
      ...open.filter((d) => monthKey(d.paid_on) !== opts.targetMonth),
    ];
  } else {
    order = open;
  }

  let left = round2(payment);
  const clearIds: number[] = [];
  let partial: SettlementPlan["partial"] = null;
  for (const d of order) {
    if (left <= 0) break;
    const amt = round2(Number(d.amount));
    if (left >= amt - 0.005) {
      clearIds.push(d.id);
      left = round2(left - amt);
    } else {
      partial = { id: d.id, newAmount: round2(amt - left) };
      left = 0;
    }
  }

  const totalOpen = round2(open.reduce((s, d) => s + Number(d.amount), 0));
  let remaining = round2(Math.max(0, totalOpen - (payment - left)));
  let roundedOff = 0;

  // Round-off: a small shortfall on the LAST due in scope (the chosen month,
  // or everything) can be written off so that scope closes fully.
  if (opts.roundOff && partial && !opts.onlyIds) {
    const p = partial;
    const partialDue = order.find((d) => d.id === p.id)!;
    const scope =
      opts.targetMonth && monthKey(partialDue.paid_on) === opts.targetMonth
        ? order.filter((d) => monthKey(d.paid_on) === opts.targetMonth)
        : order;
    const isLastInScope = scope[scope.length - 1]?.id === p.id;
    if (isLastInScope && p.newAmount <= smallLimit(payment)) {
      roundedOff = partial.newAmount;
      clearIds.push(partial.id);
      remaining = round2(remaining - partial.newAmount);
      partial = null;
    }
  }

  return { payment: round2(payment), clearIds, partial, extra: round2(left), remaining, roundedOff };
}

/** Can the shortfall after this payment be rounded off? Returns the amount, or 0. */
export function roundOffCandidate(payment: number, dues: SettleDue[], targetMonth?: string | null): number {
  return planSettlement(payment, dues, { targetMonth, roundOff: true }).roundedOff;
}

/** Apply an advance balance to a new due. */
export function applyAdvance(dueAmount: number, advance: number): { dueLeft: number; advanceLeft: number; used: number } {
  const used = round2(Math.min(Math.max(advance, 0), dueAmount));
  return { dueLeft: round2(dueAmount - used), advanceLeft: round2(advance - used), used };
}

/** A comment is required for these categories. */
export function categoryNeedsNote(category: string | null | undefined): boolean {
  return !!category && /unsorted/i.test(category);
}
