"use client";

import { useState, useMemo } from "react";
import { supabase, Transaction, Category, Due } from "@/lib/supabase";

const CATEGORY_GROUPS = [
  { label: "General", filter: (c: Category) => !c.name.startsWith("FC :") && !c.name.startsWith("FOC :") && !c.name.startsWith("Service:") && !c.name.startsWith("Insurance:") },
  { label: "FC (From City)", filter: (c: Category) => c.name.startsWith("FC :") },
  { label: "FOC (Home Town)", filter: (c: Category) => c.name.startsWith("FOC :") },
  { label: "Services & Insurance", filter: (c: Category) => c.name.startsWith("Service:") || c.name.startsWith("Insurance:") },
];

interface Props {
  txn: Transaction;
  categories: Category[];
  onDone: (id: number, category?: string, notes?: string) => void;
  isPrimary?: boolean;
  unclearedDues?: Due[];
  onSettle?: (txnId: number, dueIds: number[]) => void;
  settlementHints?: string[];
}

export default function SmsCard({ txn, categories, onDone, isPrimary, unclearedDues, onSettle, settlementHints }: Props) {
  const [category, setCategory] = useState("");
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [settleMode, setSettleMode] = useState(false);
  const [selectedDues, setSelectedDues] = useState<Set<number>>(new Set());

  const fmt = (n: number) => "\u20B9" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtShort = (n: number) => "\u20B9" + n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const fmtDate = (ts: number) => new Date(ts).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });

  const txnAmount = Number(txn.amount) || 0;
  const hasDues = unclearedDues && unclearedDues.length > 0;

  // Auto-detect if this looks like a settlement payment
  const isLikelySettlement = useMemo(() => {
    if (!isPrimary || !settlementHints || settlementHints.length === 0) return false;
    if (txn.transaction_type !== "DEBIT") return false;
    const body = txn.body.toLowerCase();
    return settlementHints.some((hint) => hint && body.includes(hint.toLowerCase()));
  }, [isPrimary, settlementHints, txn.body, txn.transaction_type]);

  // Smart pre-selection when entering settle mode
  function enterSettleMode() {
    if (!unclearedDues) return;
    const totalAll = unclearedDues.reduce((s, d) => s + Number(d.amount), 0);
    let preSelected = new Set<number>();

    if (Math.abs(totalAll - txnAmount) < 0.01) {
      // Total matches → select all
      preSelected = new Set(unclearedDues.map((d) => d.id));
    } else {
      // Try to find a single matching due
      const match = unclearedDues.find((d) => Math.abs(Number(d.amount) - txnAmount) < 0.01);
      if (match) {
        preSelected = new Set([match.id]);
      }
    }
    setSelectedDues(preSelected);
    setSettleMode(true);
  }

  function toggleDue(id: number) {
    setSelectedDues((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });
  }

  const selectedTotal = useMemo(() => {
    if (!unclearedDues) return 0;
    return unclearedDues.filter((d) => selectedDues.has(d.id)).reduce((s, d) => s + Number(d.amount), 0);
  }, [unclearedDues, selectedDues]);

  async function handleSave() {
    if (!category) return;
    setSaving(true);
    await supabase.from("transactions").update({ category, notes: comment || null, status: "categorized" }).eq("id", txn.id);
    onDone(txn.id, category, comment || undefined);
  }

  async function handleIgnore() {
    setSaving(true);
    await supabase.from("transactions").update({ status: "ignored" }).eq("id", txn.id);
    onDone(txn.id);
  }

  async function handleConfirmSettle() {
    if (selectedDues.size === 0 || !onSettle) return;
    setSaving(true);
    onSettle(txn.id, Array.from(selectedDues));
  }

  return (
    <div className="glass rounded-xl p-4 mb-3 transition-all">
      {/* Top row: amount + date */}
      <div className="flex justify-between items-start mb-2">
        <div>
          <span className={`text-2xl font-bold ${txn.transaction_type === "CREDIT" ? "glow-green" : "glow-red"}`}
            style={{ color: txn.transaction_type === "CREDIT" ? "var(--accent-green)" : "var(--accent-red)" }}>
            {txn.transaction_type === "DEBIT" ? "-" : "+"}{fmt(txnAmount)}
          </span>
          <span className={`ml-2 px-2 py-0.5 rounded text-xs font-medium`}
            style={{
              background: txn.transaction_type === "CREDIT" ? "rgba(0, 200, 150, 0.15)" :
                txn.transaction_type === "DEBIT" ? "rgba(255, 71, 87, 0.15)" : "rgba(90, 94, 115, 0.2)",
              color: txn.transaction_type === "CREDIT" ? "var(--accent-green)" :
                txn.transaction_type === "DEBIT" ? "var(--accent-red)" : "var(--text-secondary)",
              border: `1px solid ${txn.transaction_type === "CREDIT" ? "rgba(0, 200, 150, 0.3)" :
                txn.transaction_type === "DEBIT" ? "rgba(255, 71, 87, 0.3)" : "var(--border)"}`
            }}>
            {txn.transaction_type ?? "?"}
          </span>
        </div>
        <span className="text-sm" style={{ color: "var(--text-tertiary)" }}>{fmtDate(txn.sms_date)}</span>
      </div>

      {/* Merchant + Account */}
      <div className="text-sm mb-1" style={{ color: "var(--text-secondary)" }}>{txn.merchant ?? "Unknown merchant"}</div>
      {txn.account_number && <div className="text-xs font-mono mb-2" style={{ color: "var(--text-tertiary)" }}>{txn.account_number}</div>}

      {/* Raw SMS (expandable) */}
      <div
        className="text-xs rounded p-2 mb-3 cursor-pointer transition-colors"
        style={{ background: "var(--bg-base)", color: "var(--text-tertiary)", border: "1px solid var(--border)" }}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? txn.body : txn.body.substring(0, 80) + (txn.body.length > 80 ? "..." : "")}
      </div>

      {/* Settle Dues — prominent if auto-detected */}
      {isPrimary && hasDues && !settleMode && isLikelySettlement && (
        <button
          className="w-full mb-3 py-2.5 btn-gradient-orange text-white rounded-lg text-sm font-semibold transition-all hover:shadow-lg"
          onClick={enterSettleMode}
        >
          ⚡ Settle Dues ({fmtShort(unclearedDues!.reduce((s, d) => s + Number(d.amount), 0))} outstanding)
        </button>
      )}

      {settleMode ? (
        /* ── Dues Picker (inline) ── */
        <div className="rounded-lg p-3 mb-3" style={{ background: "rgba(255, 159, 67, 0.08)", border: "1px solid rgba(255, 159, 67, 0.25)" }}>
          <div className="text-sm font-semibold mb-2" style={{ color: "var(--accent-orange)" }}>Select dues to settle</div>

          <div className="space-y-2 max-h-48 overflow-y-auto mb-3">
            {unclearedDues!.map((due) => (
              <label key={due.id} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedDues.has(due.id)}
                  onChange={() => toggleDue(due.id)}
                  className="w-4 h-4 rounded"
                />
                <span className="text-sm flex-1" style={{ color: "var(--text-secondary)" }}>{due.category}</span>
                <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{fmtShort(Number(due.amount))}</span>
              </label>
            ))}
          </div>

          {/* Running total */}
          <div className="text-xs px-2 py-1 rounded mb-3"
            style={{
              background: Math.abs(selectedTotal - txnAmount) < 0.01 ? "rgba(0, 200, 150, 0.15)" : "rgba(255, 159, 67, 0.15)",
              color: Math.abs(selectedTotal - txnAmount) < 0.01 ? "var(--accent-green)" : "var(--accent-orange)",
              border: `1px solid ${Math.abs(selectedTotal - txnAmount) < 0.01 ? "rgba(0, 200, 150, 0.3)" : "rgba(255, 159, 67, 0.3)"}`
            }}>
            Selected: {fmtShort(selectedTotal)} / Payment: {fmtShort(txnAmount)}
            {Math.abs(selectedTotal - txnAmount) >= 0.01 && selectedTotal > 0 && (
              <span> — {selectedTotal > txnAmount ? "over" : "under"} by {fmtShort(Math.abs(selectedTotal - txnAmount))}</span>
            )}
          </div>

          <div className="flex gap-2">
            <button
              className="flex-1 py-2 btn-gradient-orange text-white rounded-lg text-sm font-medium disabled:opacity-40"
              disabled={selectedDues.size === 0 || saving}
              onClick={handleConfirmSettle}
            >
              {saving ? "Settling..." : "Confirm Settlement"}
            </button>
            <button
              className="px-4 py-2 glass rounded-lg text-sm transition-all"
              style={{ color: "var(--text-secondary)" }}
              onClick={() => setSettleMode(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        /* ── Normal categorization flow ── */
        <>
          {/* Category dropdown */}
          <select
            className="w-full rounded-lg px-3 py-2 mb-2 text-sm"
            style={{ background: "var(--bg-elevated)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">Select category...</option>
            {CATEGORY_GROUPS.map((group) => {
              const items = categories.filter(group.filter);
              if (items.length === 0) return null;
              return (
                <optgroup key={group.label} label={group.label}>
                  {items.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name} ({fmt(c.cap)} {c.recurrence.toLowerCase()})
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>

          {/* Comment */}
          <input
            type="text"
            placeholder="Comment (optional)"
            className="w-full rounded-lg px-3 py-2 mb-3 text-sm"
            style={{ background: "var(--bg-elevated)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />

          {/* Action buttons */}
          <div className="flex gap-2">
            <button
              className="flex-1 btn-gradient text-white rounded-lg py-2 text-sm font-medium disabled:opacity-40"
              disabled={!category || saving}
              onClick={handleSave}
            >
              {saving ? "Saving..." : "Save"}
            </button>
            <button
              className="flex-1 glass rounded-lg py-2 text-sm font-medium disabled:opacity-40 transition-all"
              style={{ color: "var(--text-secondary)" }}
              disabled={saving}
              onClick={handleIgnore}
            >
              Ignore
            </button>
            {/* Subtle settle dues link when not auto-detected */}
            {isPrimary && hasDues && !isLikelySettlement && (
              <button
                className="px-3 rounded-lg py-2 text-xs font-medium transition-all"
                style={{ background: "rgba(255, 159, 67, 0.12)", color: "var(--accent-orange)", border: "1px solid rgba(255, 159, 67, 0.25)" }}
                onClick={enterSettleMode}
              >
                Settle
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
