import { supabase, Transaction, User } from "./supabase";
import { saveSetting } from "./budget";

/**
 * A payment the primary user started from the dues screen (tapped Pay). UPI apps
 * can't report back, so the bank SMS is used instead: a debit from the payer to
 * the payee — or the payee's credit from the payer — for the same amount settles
 * exactly these dues. With no SMS, the app asks. Stored in settings key
 * "pending_payment" so every device sees it.
 */
const KEY = "pending_payment";
/** SMS from slightly before the tap (clock skew) up to a day after count. */
const BEFORE_MS = 2 * 60 * 1000;
export const MATCH_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Ask "did you pay?" only after the SMS has had time to arrive. */
export const ASK_AFTER_MS = 90 * 1000;

export interface PendingPayment {
  amount: number;
  dueIds: number[];
  /** Short description, also put in the UPI QR note. */
  label: string;
  created: number;
  /** Set when the user confirmed paying without an SMS; a later SMS is only linked. */
  confirmed?: number;
}

export async function fetchPendingPayment(): Promise<PendingPayment | null> {
  const { data } = await supabase.from("settings").select("value").eq("key", KEY).limit(1).maybeSingle();
  const v = data?.value as PendingPayment | undefined;
  return v && typeof v.amount === "number" && Array.isArray(v.dueIds) ? v : null;
}

export async function savePendingPayment(p: PendingPayment | null) {
  if (p) await saveSetting(KEY, p as unknown as Record<string, unknown>);
  else await supabase.from("settings").delete().eq("key", KEY);
}

/** Lowercase letters and digits only: "janu.amu90-2" and "janu amu90 2" both → "januamu902". */
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Bits of a person's identity that show up in bank SMS (UPI handle, phone, name). */
function identityKeys(u: Pick<User, "name" | "phone_number" | "upi_id">): string[] {
  const keys: string[] = [];
  if (u.upi_id) keys.push(squash(u.upi_id.split("@")[0]));
  const digits = u.phone_number.replace(/\D/g, "").slice(-10);
  if (digits.length === 10) keys.push(digits);
  const name = squash(u.name);
  if (name.length >= 5) keys.push(name);
  return keys.filter((k) => k.length >= 5);
}

const mentions = (body: string, keys: string[]) => {
  const b = squash(body);
  return keys.some((k) => b.includes(k));
};

export interface PaymentMatch {
  /** Payer's debit SMS to the payee. */
  debit?: Transaction;
  /** Payee's credit SMS from the payer. */
  credit?: Transaction;
}

/** Fetch both people's SMS around the payment and find its debit and credit. */
export async function findPaymentSms(
  p: PendingPayment,
  payer: User,
  payee: User,
  enrich: (raw: Transaction) => Transaction,
): Promise<PaymentMatch> {
  const { data } = await supabase
    .from("transactions")
    .select("*")
    .in("phone_number", [payer.phone_number, payee.phone_number])
    .in("status", ["new", "categorized"])
    .gte("sms_date", p.created - BEFORE_MS)
    .lte("sms_date", p.created + MATCH_WINDOW_MS)
    .order("sms_date", { ascending: true });
  const txns = (data ?? []).map((t) => enrich(t as Transaction));
  const sameAmount = (t: Transaction) => t.amount != null && Math.abs(Number(t.amount) - p.amount) < 0.01;
  const payeeKeys = identityKeys(payee);
  const payerKeys = identityKeys(payer);
  return {
    debit: txns.find((t) => t.phone_number === payer.phone_number && t.transaction_type === "DEBIT"
      && sameAmount(t) && mentions(t.body, payeeKeys)),
    credit: txns.find((t) => t.phone_number === payee.phone_number && t.transaction_type === "CREDIT"
      && sameAmount(t) && mentions(t.body, payerKeys)),
  };
}

/** The 12-digit UPI reference ("UPI:667850326541"); the same in payer's and payee's SMS. */
export function upiRef(body: string): string | null {
  const m = body.match(/UPI\s*(?:Ref(?:\.|erence)?\s*(?:No\.?)?)?[:\s-]*(\d{12})/i);
  return m ? m[1] : null;
}

/** Make a UPI note safe and short (apps cut notes around 50 characters). */
export function upiNote(s: string): string {
  return s.replace(/[^A-Za-z0-9 .,\-/()]/g, "").replace(/\s+/g, " ").trim().slice(0, 50).trim() || "ExpTrack dues";
}
