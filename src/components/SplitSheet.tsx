"use client";

import { useMemo, useState } from "react";
import { Category, Transaction } from "@/lib/supabase";
import { categoryNeedsNote } from "@/lib/dues";

export interface SplitPart { category: string; amount: number; note: string }

interface Props {
  txn: Transaction;
  /** Categories this person can file into. */
  categories: Category[];
  onSave: (parts: SplitPart[]) => Promise<string | null>;
  onClose: () => void;
}

const fmt = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Split one payment into parts, each filed into its own category. */
export default function SplitSheet({ txn, categories, onSave, onClose }: Props) {
  const total = Number(txn.amount) || 0;
  const [parts, setParts] = useState<{ category: string; amount: string; note: string }[]>([
    { category: txn.category ?? "", amount: "", note: txn.notes ?? "" },
    { category: "", amount: "", note: "" },
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choices = useMemo(() => [...categories].sort((a, b) => a.name.localeCompare(b.name)), [categories]);

  // The first part takes whatever the others don't
  const othersSum = round2(parts.slice(1).reduce((s, p) => s + (Number(p.amount) || 0), 0));
  const firstAmount = round2(total - othersSum);
  const amounts = [firstAmount, ...parts.slice(1).map((p) => Number(p.amount) || 0)];

  const problem =
    parts.some((p) => !p.category) ? "Pick a category for every part"
    : amounts.some((a) => a <= 0) ? (firstAmount <= 0 ? `The parts add up to more than ${fmt(total)}` : "Every part needs an amount")
    : parts.some((p) => categoryNeedsNote(p.category) && !p.note.trim()) ? "Add a note where the category needs one"
    : null;

  const set = (i: number, patch: Partial<{ category: string; amount: string; note: string }>) =>
    setParts((prev) => prev.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  async function save() {
    if (problem || saving) return;
    setSaving(true);
    setError(null);
    const err = await onSave(parts.map((p, i) => ({ category: p.category, amount: amounts[i], note: p.note.trim() })));
    setSaving(false);
    if (err) setError(err); else onClose();
  }

  const field = { background: "rgba(255,255,255,0.06)", border: "1px solid var(--border-light)", color: "var(--text-primary)" };

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-3 animate-fade-in"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(2px)" }} onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl flex flex-col animate-slide-up"
        style={{ background: "var(--bg-elevated)", border: "1px solid rgba(255,255,255,0.1)", maxHeight: "85vh" }}
        onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Split payment">
        <div className="flex items-start justify-between px-4 pt-4 pb-2">
          <div className="min-w-0">
            <div className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>✂ Split {fmt(total)}</div>
            <div className="text-[11px] truncate" style={{ color: "var(--text-tertiary)" }}>
              {txn.merchant || "Payment"} · {new Date(txn.sms_date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
            </div>
          </div>
          <button className="text-sm px-2 py-1 bg-transparent border-0 cursor-pointer" style={{ color: "var(--text-tertiary)" }}
            onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="overflow-y-auto px-4 pb-2 space-y-2.5">
          {parts.map((p, i) => (
            <div key={i} className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <div className="flex gap-2">
                <select className="flex-1 min-w-0 px-2 py-2 rounded-lg text-xs" style={field}
                  value={p.category} onChange={(e) => set(i, { category: e.target.value })} aria-label={`Part ${i + 1} category`}>
                  <option value="">Category…</option>
                  {choices.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
                {i === 0 ? (
                  <div className="w-24 px-2 py-2 rounded-lg text-xs text-right font-semibold" style={{ ...field, color: firstAmount > 0 ? "var(--text-primary)" : "var(--accent-red)" }}
                    title="The rest of the payment">
                    {fmt(firstAmount)}
                  </div>
                ) : (
                  <input type="number" inputMode="decimal" min="0" step="0.01" placeholder="₹" className="w-24 px-2 py-2 rounded-lg text-xs text-right"
                    style={field} value={p.amount} onChange={(e) => set(i, { amount: e.target.value })} aria-label={`Part ${i + 1} amount`} />
                )}
                {i > 0 && (
                  <button type="button" className="px-1 text-xs bg-transparent border-0 cursor-pointer" style={{ color: "var(--text-tertiary)" }}
                    onClick={() => setParts((prev) => prev.filter((_, j) => j !== i))} aria-label={`Remove part ${i + 1}`}
                    disabled={parts.length <= 2}>✕</button>
                )}
              </div>
              {(categoryNeedsNote(p.category) || p.note) && (
                <input className="w-full mt-2 px-2 py-1.5 rounded-lg text-xs" style={field} placeholder={categoryNeedsNote(p.category) ? "Note (required)" : "Note"}
                  value={p.note} onChange={(e) => set(i, { note: e.target.value })} aria-label={`Part ${i + 1} note`} />
              )}
              {i === 0 && <div className="text-[10px] mt-1" style={{ color: "var(--text-tertiary)" }}>Gets whatever the other parts don&apos;t</div>}
            </div>
          ))}
          <button type="button" className="w-full py-2 rounded-xl text-xs font-semibold btn-ghost"
            onClick={() => setParts((prev) => [...prev, { category: "", amount: "", note: "" }])}>
            + Add part
          </button>
        </div>

        <div className="px-4 pb-4 pt-2">
          {(error || (problem && parts.slice(1).some((p) => p.amount || p.category))) && (
            <div className="text-[11px] mb-2" style={{ color: "var(--accent-red)" }}>{error ?? problem}</div>
          )}
          <button className="w-full py-2.5 btn-primary text-sm rounded-xl disabled:opacity-35" disabled={!!problem || saving} onClick={save}>
            {saving ? "Saving…" : `Split into ${parts.length} parts`}
          </button>
        </div>
      </div>
    </div>
  );
}
