import { supabase, Due, User } from "./supabase";
import { saveSetting } from "./budget";

/**
 * What the app did on its own, per person ("activity:<phone>"), and when that
 * person last had the app open ("last_seen:<phone>"). Used for the "since your
 * last visit" panel. Dues events are worked out from the dues table instead.
 */
export interface AutoFiledEvent {
  kind: "autofile";
  at: number;
  txnId: number;
  amount: number | null;
  vendor: string | null;
  category: string;
  /** Own pairing, shared pairing, or a monthly auto-debit (EMI) match. */
  why: "vendor" | "shared" | "emi";
}

const ACTIVITY = "activity:";
const LAST_SEEN = "last_seen:";
const KEEP = 200;

export async function fetchActivity(phone: string): Promise<AutoFiledEvent[]> {
  const { data, error } = await supabase.from("settings").select("value").eq("key", ACTIVITY + phone).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  const events = (data?.value as { events?: AutoFiledEvent[] } | undefined)?.events;
  return Array.isArray(events) ? events : [];
}

// Events are kept on the device until they're written, so a closed app, a reload or a
// slow database never loses one: they're retried here and on the next open.
const PENDING = "exptrack-activity-pending";
type Pending = { phone: string; event: AutoFiledEvent };
function readPending(): Pending[] {
  try { const v = JSON.parse(localStorage.getItem(PENDING) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
function writePending(list: Pending[]) {
  try { localStorage.setItem(PENDING, JSON.stringify(list)); } catch { /* storage off: retries still run */ }
}
let memPending: Pending[] = [];

// Appends from one device go one at a time, so quick auto-files don't overwrite each other
let queue: Promise<unknown> = Promise.resolve();
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let attempts = 0;

/** Write any events still waiting on this device. */
export function flushActivity(): Promise<unknown> {
  queue = queue.then(async () => {
    const pending = [...readPending(), ...memPending.filter((m) => !readPending().some((p) => p.event.txnId === m.event.txnId && p.phone === m.phone))];
    if (pending.length === 0) return;
    const phones = [...new Set(pending.map((p) => p.phone))];
    let failed = false;
    for (const phone of phones) {
      try {
        const events = await fetchActivity(phone);
        const mine = pending.filter((p) => p.phone === phone).map((p) => p.event);
        const add = mine.filter((e) => !events.some((x) => x.txnId === e.txnId));
        if (add.length) await saveSetting(ACTIVITY + phone, { events: [...events, ...add].slice(-KEEP) });
        const done = new Set(mine.map((e) => e.txnId));
        memPending = memPending.filter((p) => p.phone !== phone || !done.has(p.event.txnId));
        writePending(readPending().filter((p) => p.phone !== phone || !done.has(p.event.txnId)));
      } catch { failed = true; }
    }
    if (failed && !retryTimer && attempts < 6) {
      attempts++;
      retryTimer = setTimeout(() => { retryTimer = null; flushActivity(); }, 5000 * attempts);
    } else if (!failed) attempts = 0;
  }).catch(() => {});
  return queue;
}

export function logActivity(phone: string, event: AutoFiledEvent): Promise<unknown> {
  const p = { phone, event };
  memPending.push(p);
  writePending([...readPending(), p]);
  return flushActivity();
}

/** Viewed: drop everything logged up to `upTo` (no history is kept). */
export function clearActivity(phone: string, upTo: number): Promise<unknown> {
  queue = queue.then(async () => {
    const events = await fetchActivity(phone).catch(() => null);
    if (!events) return;
    await saveSetting(ACTIVITY + phone, { events: events.filter((e) => e.at > upTo) });
  }).catch(() => {});
  return queue;
}

export async function fetchLastSeen(phone: string): Promise<number | null> {
  const { data, error } = await supabase.from("settings").select("value").eq("key", LAST_SEEN + phone).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  const at = (data?.value as { at?: number } | undefined)?.at;
  return typeof at === "number" ? at : null;
}

export async function saveLastSeen(phone: string, at: number) {
  await saveSetting(LAST_SEEN + phone, { at });
}

export interface ActivityItem {
  id: string;
  at: number;
  kind: "autofile" | "dues_new" | "dues_cleared";
  title: string;
  detail: string;
  txnId?: number;
}

const WHY: Record<AutoFiledEvent["why"], string> = {
  vendor: "your pairing",
  shared: "shared pairing",
  emi: "monthly auto-debit",
};

/**
 * What happened after `since`, newest first: payments the app filed for this
 * person, dues the other person's spending added (primary), and dues cleared.
 */
export function activityItems(events: AutoFiledEvent[], dues: Due[], since: number, user: User, otherName: string): ActivityItem[] {
  const fmt = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
  const ts = (iso: string | null) => (iso ? Date.parse(iso) : 0);
  const items: ActivityItem[] = [];

  for (const e of events) {
    if (e.at <= since) continue;
    items.push({
      id: `autofile:${e.txnId}`, at: e.at, kind: "autofile", txnId: e.txnId,
      title: `${e.amount != null ? fmt(e.amount) + " " : ""}${e.vendor ?? "Payment"} → ${e.category}`,
      detail: `Auto-filed · ${WHY[e.why]}`,
    });
  }

  if (user.is_primary) {
    const added = dues.filter((d) => ts(d.created_at) > since);
    if (added.length > 0) {
      items.push({
        id: "dues:new", at: Math.max(...added.map((d) => ts(d.created_at))), kind: "dues_new",
        title: `${fmt(added.reduce((s, d) => s + Number(d.amount), 0))} of new dues (${added.length})`,
        detail: `From ${otherName || "the other"}'s spending · tap to see dues`,
      });
    }
  }

  const cleared = dues.filter((d) => d.cleared && ts(d.cleared_at) > since);
  if (cleared.length > 0) {
    items.push({
      id: "dues:cleared", at: Math.max(...cleared.map((d) => ts(d.cleared_at))), kind: "dues_cleared",
      title: `${fmt(cleared.reduce((s, d) => s + Number(d.amount), 0))} of dues cleared (${cleared.length})`,
      detail: user.is_primary ? `Paid to ${otherName || "the other"} · tap to see dues` : "Paid to you · tap to see dues",
    });
  }

  return items.sort((a, b) => b.at - a.at);
}
