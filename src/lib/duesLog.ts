import { supabase } from "./supabase";
import { saveSetting } from "./budget";

/**
 * Every change to a due's cleared state, with who did it, how, and on which device
 * ("dues_log"). Shown on cleared dues so "how did this get cleared?" always has an answer.
 */
export interface DuesLogEntry {
  id: string;
  at: number;
  action: "cleared" | "reduced" | "reopened" | "deleted";
  /** The exact way it happened, in words (which button / which payment). */
  how: string;
  dueIds: number[];
  amount: number;
  byName: string;
  byPhone: string;
  device: string;
  /** The bank SMS that paid it, if any. */
  txnId?: number | null;
}

const KEY = "dues_log";
const KEEP = 1000;
const PENDING = "exptrack-dues-log-pending";

let actor = { name: "", phone: "" };
/** Who is using the app on this device (set once the profile is known). */
export function setDuesActor(name: string, phone: string) {
  actor = { name, phone };
}

/** "phone app", or the browser and kind of device. */
export function deviceLabel(): string {
  if (typeof window === "undefined") return "unknown";
  if ((window as unknown as Record<string, unknown>).AndroidUpi) return "ExpTrack phone app";
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "browser";
  const kind = /Android/.test(ua) ? "Android phone" : /iPhone|iPad/.test(ua) ? "iPhone" : /Windows/.test(ua) ? "Windows PC" : /Mac OS/.test(ua) ? "Mac" : "computer";
  return `${browser} on ${kind}`;
}

export async function fetchDuesLog(): Promise<DuesLogEntry[]> {
  const { data, error } = await supabase.from("settings").select("value").eq("key", KEY).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  const entries = (data?.value as { entries?: DuesLogEntry[] } | undefined)?.entries;
  return Array.isArray(entries) ? entries : [];
}

function readPending(): DuesLogEntry[] {
  try { const v = JSON.parse(localStorage.getItem(PENDING) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
function writePending(list: DuesLogEntry[]) {
  try { localStorage.setItem(PENDING, JSON.stringify(list)); } catch { /* storage off: retries still run */ }
}
let memPending: DuesLogEntry[] = [];
let queue: Promise<unknown> = Promise.resolve();
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let attempts = 0;

/** Write entries still waiting on this device (kept until saved, retried). */
export function flushDuesLog(): Promise<unknown> {
  queue = queue.then(async () => {
    const stored = readPending();
    const pending = [...stored, ...memPending.filter((m) => !stored.some((p) => p.id === m.id))];
    if (pending.length === 0) return;
    try {
      const entries = await fetchDuesLog();
      const add = pending.filter((e) => !entries.some((x) => x.id === e.id));
      if (add.length) await saveSetting(KEY, { entries: [...entries, ...add].sort((a, b) => a.at - b.at).slice(-KEEP) });
      const done = new Set(pending.map((e) => e.id));
      memPending = memPending.filter((e) => !done.has(e.id));
      writePending(readPending().filter((e) => !done.has(e.id)));
      attempts = 0;
    } catch {
      if (!retryTimer && attempts < 6) {
        attempts++;
        retryTimer = setTimeout(() => { retryTimer = null; flushDuesLog(); }, 5000 * attempts);
      }
    }
  }).catch(() => {});
  return queue;
}

export function logDues(e: Omit<DuesLogEntry, "id" | "at" | "byName" | "byPhone" | "device">): Promise<unknown> {
  if (e.dueIds.length === 0) return Promise.resolve();
  const entry: DuesLogEntry = {
    ...e,
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    at: Date.now(),
    byName: actor.name,
    byPhone: actor.phone,
    device: deviceLabel(),
  };
  memPending.push(entry);
  writePending([...readPending(), entry]);
  return flushDuesLog();
}

/** The latest entry about this due, if any. */
export function lastEntryFor(log: DuesLogEntry[], dueId: number): DuesLogEntry | undefined {
  for (let i = log.length - 1; i >= 0; i--) if (log[i].dueIds.includes(dueId)) return log[i];
  return undefined;
}
