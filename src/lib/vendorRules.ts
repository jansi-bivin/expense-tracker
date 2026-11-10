import { supabase } from "./supabase";
import { saveSetting } from "./budget";

/**
 * Vendor → category rules: a new debit SMS from a paired vendor is filed into
 * that category without review. Each person has their own rules (settings key
 * "vendor_rules:<phone>") and they only apply to that person's own SMS.
 */
export interface VendorRule {
  /** Normalized vendor ("robinshyperma"), used for matching. */
  key: string;
  /** Vendor as the bank wrote it ("ROBINS HYPER MA"), for display. */
  vendor: string;
  /** Category id, so a renamed category keeps its rules. */
  categoryId: number;
  at: number;
}

const PREFIX = "vendor_rules:";

/** Lowercase letters and digits, without a "Mr/Ms/M/s" prefix: "Ms BALA MUTHU A" → "balamuthua". */
export function vendorKey(vendor: string): string {
  return vendor
    .toLowerCase()
    .trim()
    .replace(/^(?:m\/s|mrs|mr|ms)\.?\s+/, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * The rule for this vendor, if any. Banks cut names short ("ROBINS HYPER MA"),
 * so a long enough name that starts the other also counts.
 */
export function matchVendorRule(rules: VendorRule[], vendor: string | null | undefined): VendorRule | undefined {
  if (!vendor) return undefined;
  const k = vendorKey(vendor);
  if (k.length < 3) return undefined;
  return (
    rules.find((r) => r.key === k) ??
    rules.find((r) => {
      const [short, long] = r.key.length <= k.length ? [r.key, k] : [k, r.key];
      return short.length >= 8 && long.startsWith(short);
    })
  );
}

export async function fetchVendorRules(phone: string): Promise<VendorRule[]> {
  const { data } = await supabase.from("settings").select("value").eq("key", PREFIX + phone).limit(1).maybeSingle();
  const rules = (data?.value as { rules?: VendorRule[] } | undefined)?.rules;
  return Array.isArray(rules) ? rules : [];
}

export async function saveVendorRules(phone: string, rules: VendorRule[]) {
  await saveSetting(PREFIX + phone, { rules });
}

/** Add or replace the rule for a vendor. */
export function withRule(rules: VendorRule[], vendor: string, categoryId: number): VendorRule[] {
  const key = vendorKey(vendor);
  return [...rules.filter((r) => r.key !== key), { key, vendor: vendor.trim(), categoryId, at: Date.now() }];
}
