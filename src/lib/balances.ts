import { supabase } from "./supabase";

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
  const latest = new Map<string, AccountBalance>();
  for (const t of data ?? []) {
    const p = parseBalance(t.body ?? "");
    if (!p) continue;
    const key = `${t.phone_number}|${p.bank}|${p.last}`;
    if (!latest.has(key)) latest.set(key, { key, phone: t.phone_number, ...p, at: Number(t.sms_date) });
  }
  return Array.from(latest.values());
}
