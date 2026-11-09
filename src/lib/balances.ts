import { supabase } from "./supabase";
import { saveSetting } from "./budget";

/**
 * Last known balance per bank account, read from the bank SMS that state one
 * ("Avl Bal Rs. 41,277.47"). Most UPI alerts don't carry a balance, so this is
 * as fresh as the newest SMS that did — always shown with its date.
 */
export interface AccountBalance {
  key: string;
  phone: string;
  bank: string;
  /** Last digits of the account number as the bank prints them ("773", "6017"). */
  last: string;
  balance: number;
  at: number;
  /** "manual" when typed in by the user after the last SMS that stated a balance. */
  source: "sms" | "manual";
}

/**
 * Balances typed in by hand, by account key; newer than the SMS one wins.
 * One settings row per phone ("manual_balances:<phone>"), so a phone only ever
 * reads its own owner's numbers.
 */
const MANUAL_PREFIX = "manual_balances:";
type ManualBalances = Record<string, { balance: number; at: number }>;

async function fetchManualBalances(phones: string[]): Promise<ManualBalances> {
  const { data } = await supabase.from("settings").select("value").in("key", phones.map((p) => MANUAL_PREFIX + p));
  const all: ManualBalances = {};
  for (const row of data ?? []) Object.assign(all, row.value as ManualBalances);
  return all;
}

/** Account keys start with the owner's phone ("+91…|ICICI|773"). */
export async function saveManualBalance(key: string, balance: number) {
  const rowKey = MANUAL_PREFIX + key.split("|")[0];
  const { data } = await supabase.from("settings").select("value").eq("key", rowKey).limit(1).maybeSingle();
  const own = (data?.value as ManualBalances | undefined) ?? {};
  own[key] = { balance, at: Date.now() };
  await saveSetting(rowKey, own);
}

const LOOKBACK_MS = 180 * 24 * 60 * 60 * 1000;

const BALANCE_RE =
  /\b(?:avl\.?\s*bal(?:ance)?|available\s+bal(?:ance)?|bal(?:ance)?)\.?\s*(?:is\s*)?[:-]?\s*(?:Rs\.?|INR|₹)\s*([0-9,]+(?:\.\d{1,2})?)/i;
const ACCOUNT_RE = /\b(?:A\/c|Acct|Acc|Account)\.?\s*(?:No\.?\s*)?[:-]?\s*[X*]+(\d{3,6})\b/i;
const BANK_RE = /\b(ICICI|SBI|HDFC|Axis|Kotak|IDFC|IndusInd|Canara|PNB|Federal|Yes Bank|Bank of Baroda|Union Bank|Indian Bank)\b/i;
/** Balances that aren't a bank account's: FASTag wallets, card limits, PF passbooks. */
const NOT_ACCOUNT_RE = /fastag|credit card|passbook|wallet/i;

export function parseBalance(body: string): { bank: string; last: string; balance: number } | null {
  if (NOT_ACCOUNT_RE.test(body)) return null;
  const bal = body.match(BALANCE_RE);
  const acct = body.match(ACCOUNT_RE);
  if (!bal || !acct) return null;
  const balance = parseFloat(bal[1].replace(/,/g, ""));
  if (!isFinite(balance)) return null;
  const bank = body.match(BANK_RE)?.[1] ?? "Bank";
  return { bank: bank.length <= 5 ? bank.toUpperCase() : bank, last: acct[1].slice(-4), balance };
}

/** Newest stated balance for every account of these phones. */
export async function fetchBalances(phones: string[]): Promise<AccountBalance[]> {
  if (phones.length === 0) return [];
  const { data } = await supabase
    .from("transactions")
    .select("id, phone_number, sms_date, body")
    .in("phone_number", phones)
    .ilike("body", "%bal%")
    .gte("sms_date", Date.now() - LOOKBACK_MS)
    .order("sms_date", { ascending: false })
    .order("id", { ascending: false })
    .limit(1000);
  const manual = await fetchManualBalances(phones);
  const latest = new Map<string, AccountBalance>();
  for (const t of data ?? []) {
    const p = parseBalance(t.body ?? "");
    if (!p) continue;
    const key = `${t.phone_number}|${p.bank}|${p.last}`;
    if (!latest.has(key)) latest.set(key, { key, phone: t.phone_number, ...p, at: Number(t.sms_date), source: "sms" });
  }
  for (const b of latest.values()) {
    const m = manual[b.key];
    if (m && m.at > b.at) Object.assign(b, { balance: m.balance, at: m.at, source: "manual" });
  }
  return Array.from(latest.values());
}
