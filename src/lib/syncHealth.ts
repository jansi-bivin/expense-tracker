import { supabase, User } from "./supabase";

/** What each phone's SMS reader reports (settings key "sync_health:<phone>"). */
export interface SyncHealth {
  phone: string;
  /** Last time the reader checked in (ms). */
  last_sync: number;
  last_upload?: number;
  pending: number;
  /** Notification access granted (needed for messages that aren't plain SMS). */
  listener: boolean;
  battery_unrestricted: boolean;
  app_version: string;
  device?: string;
  captured_7d?: Record<string, number>;
  last_error?: string;
}

const PREFIX = "sync_health:";

/** A phone that hasn't checked in for this long is treated as not syncing. */
export const STALE_AFTER_MS = 12 * 60 * 60 * 1000;

/**
 * Every phone's last check-in. Throws when the read fails, so a network blip
 * (e.g. coming back to the app from a call) keeps the last known status instead
 * of looking like no phone ever checked in ("Update your SMS reader").
 */
export async function fetchSyncHealth(): Promise<Map<string, SyncHealth>> {
  const { data, error } = await supabase.from("settings").select("key,value").like("key", `${PREFIX}%`);
  if (error || !data) throw new Error(error?.message ?? "sync health unavailable");
  const out = new Map<string, SyncHealth>();
  for (const row of data ?? []) {
    out.set(String(row.key).slice(PREFIX.length), row.value as SyncHealth);
  }
  return out;
}

export interface SyncIssue {
  id: string;
  level: "error" | "warn";
  text: string;
}

/**
 * Problems worth showing: the primary user sees every phone, the secondary user
 * sees only their own.
 */
export function syncIssues(
  users: User[],
  current: User | null,
  health: Map<string, SyncHealth>,
  now: number
): SyncIssue[] {
  // Nothing read yet (or the read failed): don't claim any phone needs the app
  if (!current || health.size === 0) return [];
  const phones = current.is_primary ? users : users.filter((u) => u.phone_number === current.phone_number);
  const issues: SyncIssue[] = [];
  for (const u of phones) {
    const mine = u.phone_number === current.phone_number;
    const who = mine ? "Your phone" : `${u.name}'s phone`;
    const h = health.get(u.phone_number);
    if (!h) {
      issues.push({
        id: `${u.phone_number}:update`,
        level: "warn",
        text: mine
          ? "Update your SMS reader: tap APK at the bottom of this page, install it, then open it once."
          : `${u.name}'s phone needs the new SMS reader (APK link at the bottom of this page).`,
      });
    } else if (now - h.last_sync > STALE_AFTER_MS) {
      issues.push({
        id: `${u.phone_number}:stale`,
        level: "error",
        text: `${who} hasn't synced since ${fmtWhen(h.last_sync)}. Bank messages won't show up until the SMS reader app is opened on it.`,
      });
    } else if (!h.listener) {
      issues.push({
        id: `${u.phone_number}:listener`,
        level: "error",
        text: `${who}: notification access is off, so some bank messages will be missed. Open the SMS reader on it to fix.`,
      });
    } else if (!h.battery_unrestricted) {
      issues.push({
        id: `${u.phone_number}:battery`,
        level: "warn",
        text: `${who}: battery restriction is on and may stop syncing. Open the SMS reader on it to fix.`,
      });
    }
  }
  return issues;
}

export function fmtWhen(ts: number): string {
  return new Date(ts).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export function fmtAgo(ts: number, now: number): string {
  const mins = Math.max(0, Math.round((now - ts) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
