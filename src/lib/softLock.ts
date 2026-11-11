import { supabase, Category } from "./supabase";
import { saveSetting } from "./budget";

/**
 * Soft lock for a month: every monthly category's leftover counts as ₹0 (its limit for
 * the month becomes what was spent when it was soft-locked), so "Left" is a realistic
 * forecast. Expenses can still be filed; anything more shows as over. Categories that
 * will really be spent are opened again one by one (and their month cap set).
 */
export interface SoftLock {
  /** Category id → amount spent when it was soft-locked (its limit while locked). */
  frozen: Record<string, number>;
}
export type SoftLocks = Record<string, SoftLock>; // "YYYY-MM" → soft lock

const KEY = "soft_lock";

export function softKey(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

export async function fetchSoftLocks(): Promise<SoftLocks> {
  const { data } = await supabase.from("settings").select("value").eq("key", KEY).limit(1).maybeSingle();
  const months = (data?.value as { months?: SoftLocks } | undefined)?.months;
  return months && typeof months === "object" ? months : {};
}

export async function saveSoftLocks(locks: SoftLocks) {
  await saveSetting(KEY, { months: locks });
}

/** Categories a soft lock applies to (monthly ones). */
export function softLockable(c: Category): boolean {
  return c.recurrence === "Monthly";
}

/** A category's limit for the month under soft lock (unchanged if it isn't soft-locked). */
export function softCap(normalCap: number, cat: Category, lock: SoftLock | null | undefined): number {
  if (!lock || !softLockable(cat)) return normalCap;
  const f = lock.frozen[String(cat.id)];
  return f == null ? normalCap : Math.min(normalCap, f);
}
