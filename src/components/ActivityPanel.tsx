"use client";

import { useState } from "react";
import { Category, Transaction } from "@/lib/supabase";
import { ActivityItem } from "@/lib/activity";
import { categoryNeedsNote } from "@/lib/dues";

interface Props {
  title: string;
  items: ActivityItem[];
  findTxn: (id: number) => Transaction | undefined;
  /** Categories this person can file into (for correcting an auto-filed payment). */
  categories: Category[];
  onReclassify: (txnId: number, category: string) => void;
  onOpenDues: () => void;
  onClose: () => void;
}

const fmtWhen = (ts: number) =>
  new Date(ts).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** "Since your last visit" overlay: what the app did while you were away. Tap a row to open it. */
export default function ActivityPanel({ title, items, findTxn, categories, onReclassify, onOpenDues, onClose }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [newCat, setNewCat] = useState("");
  const [changed, setChanged] = useState<Record<number, string>>({});

  const choices = categories.filter((c) => !categoryNeedsNote(c.name)).sort((a, b) => a.name.localeCompare(b.name));

  function tap(item: ActivityItem) {
    if (item.kind !== "autofile") { onOpenDues(); return; }
    setNewCat("");
    setOpenId(openId === item.id ? null : item.id);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3 animate-fade-in"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(2px)" }} onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl animate-slide-up flex flex-col"
        style={{ background: "var(--bg-elevated)", border: "1px solid rgba(255,255,255,0.1)", maxHeight: "80vh" }}
        onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <div>
            <div className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>🔔 {title}</div>
            <div className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
              {items.length ? `${items.length} update${items.length !== 1 ? "s" : ""} · tap one to open it` : "Nothing new"}
            </div>
          </div>
          <button className="text-sm px-2 py-1 bg-transparent border-0 cursor-pointer" style={{ color: "var(--text-tertiary)" }}
            onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="overflow-y-auto px-3 pb-3 space-y-1.5">
          {items.map((item) => {
            const txn = item.txnId != null ? findTxn(item.txnId) : undefined;
            const now = item.txnId != null ? changed[item.txnId] ?? txn?.category : undefined;
            const isOpen = openId === item.id;
            return (
              <div key={item.id} className="rounded-xl" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <button type="button" className="w-full text-left px-3 py-2.5 bg-transparent border-0 cursor-pointer flex items-start gap-2.5"
                  onClick={() => tap(item)} aria-expanded={item.kind === "autofile" ? isOpen : undefined}>
                  <span className="text-base leading-5">{item.kind === "autofile" ? "⚡" : item.kind === "dues_cleared" ? "✅" : "🧾"}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm truncate" style={{ color: "var(--text-primary)" }}>
                      {item.kind === "autofile" && now && txn && now !== txn.category ? item.title.replace(/→ .*$/, `→ ${now}`) : item.title}
                    </span>
                    <span className="block text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                      {item.detail} · {fmtWhen(item.at)}
                    </span>
                  </span>
                  <span className="text-xs leading-5" style={{ color: "var(--text-tertiary)" }}>{item.kind === "autofile" ? (isOpen ? "▴" : "▾") : "›"}</span>
                </button>

                {isOpen && item.txnId != null && (
                  <div className="px-3 pb-3">
                    {txn ? (
                      <div className="text-[11px] leading-4 mb-2.5 p-2 rounded-lg" style={{ background: "rgba(0,0,0,0.25)", color: "var(--text-secondary)" }}>
                        {txn.body}
                      </div>
                    ) : (
                      <div className="text-[11px] mb-2.5" style={{ color: "var(--text-tertiary)" }}>This payment is no longer in the list.</div>
                    )}
                    {txn && (
                      <div className="flex gap-2">
                        <select className="flex-1 min-w-0 px-2 py-2 rounded-lg text-xs"
                          style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--border-light)", color: "var(--text-primary)" }}
                          value={newCat} onChange={(e) => setNewCat(e.target.value)} aria-label="Move to category">
                          <option value="">Wrong category? Move to…</option>
                          {choices.filter((c) => c.name !== now).map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                        </select>
                        <button type="button" className="px-3 py-2 btn-primary text-xs rounded-lg disabled:opacity-35" disabled={!newCat}
                          onClick={() => { onReclassify(item.txnId!, newCat); setChanged((p) => ({ ...p, [item.txnId!]: newCat })); setNewCat(""); }}>
                          Move
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="px-4 pb-4 pt-1">
          <button className="w-full py-2.5 btn-primary text-sm rounded-xl" onClick={onClose}>Got it</button>
        </div>
      </div>
    </div>
  );
}
