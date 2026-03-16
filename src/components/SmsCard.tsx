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
    <div className="bg-white rounded-xl shadow p-4 mb-3">
      {/* Top row: amount + date */}
      <div className="flex justify-between items-start mb-2">
        <div>
          <span className={`text-2xl font-bold ${txn.transaction_type === "CREDIT" ? "text-green-600" : "text-red-600"}`}>
            {txn.transaction_type === "DEBIT" ? "-" : "+"}{fmt(txnAmount)}
          </span>
          <span className={`ml-2 px-2 py-0.5 rounded text-xs font-medium ${
            txn.transaction_type === "CREDIT" ? "bg-green-100 text-green-700" :
            txn.transaction_type === "DEBIT" ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-700"
          }`}>
            {txn.transaction_type ?? "?"}
          </span>
        </div>
        <span className="text-sm text-gray-400">{fmtDate(txn.sms_date)}</span>
      </div>

      {/* Merchant + Account */}
      <div className="text-sm text-gray-700 mb-1">{txn.merchant ?? "Unknown merchant"}</div>
      {txn.account_number && <div className="text-xs text-gray-400 font-mono mb-2">{txn.account_number}</div>}

      {/* Raw SMS (expandable) */}
      <div
        className="text-xs text-gray-400 bg-gray-50 rounded p-2 mb-3 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? txn.body : txn.body.substring(0, 80) + (txn.body.length > 80 ? "..." : "")}
      </div>

      {/* Settle Dues — prominent if auto-detected */}
      {isPrimary && hasDues && !settleMode && isLikelySettlement && (
        <button
          className="w-full mb-3 py-2.5 bg-orange-500 text-white rounded-lg text-sm font-semibold"
          onClick={enterSettleMode}
        >
          ⚡ Settle Dues ({fmtShort(unclearedDues!.reduce((s, d) => s + Number(d.amount), 0))} outstanding)
        </button>
      )}

      {settleMode ? (
        /* ── Dues Picker (inline) ── */
        <div className="border rounded-lg p-3 mb-3 bg-orange-50">
          <div className="text-sm font-semibold text-gray-800 mb-2">Select dues to settle</div>

          <div className="space-y-2 max-h-48 overflow-y-auto mb-3">
            {unclearedDues!.map((due) => (
              <label key={due.id} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedDues.has(due.id)}
                  onChange={() => toggleDue(due.id)}
                  className="w-4 h-4 rounded accent-orange-500"
                />
                <span className="text-sm text-gray-700 flex-1">{due.category}</span>
                <span className="text-sm font-medium">{fmtShort(Number(due.amount))}</span>
              </label>
            ))}
          </div>

          {/* Running total */}
          <div className={`text-xs px-2 py-1 rounded mb-3 ${
            Math.abs(selectedTotal - txnAmount) < 0.01
              ? "bg-green-100 text-green-700"
              : "bg-yellow-100 text-yellow-700"
          }`}>
            Selected: {fmtShort(selectedTotal)} / Payment: {fmtShort(txnAmount)}
            {Math.abs(selectedTotal - txnAmount) >= 0.01 && selectedTotal > 0 && (
              <span> — {selectedTotal > txnAmount ? "over" : "under"} by {fmtShort(Math.abs(selectedTotal - txnAmount))}</span>
            )}
          </div>

          <div className="flex gap-2">
            <button
              className="flex-1 py-2 bg-orange-500 text-white rounded-lg text-sm font-medium disabled:opacity-40"
              disabled={selectedDues.size === 0 || saving}
              onClick={handleConfirmSettle}
            >
              {saving ? "Settling..." : "Confirm Settlement"}
            </button>
            <button
              className="px-4 py-2 bg-gray-200 text-gray-600 rounded-lg text-sm"
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
            className="w-full border rounded-lg px-3 py-2 mb-2 text-sm"
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
            className="w-full border rounded-lg px-3 py-2 mb-3 text-sm"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />

          {/* Action buttons */}
          <div className="flex gap-2">
            <button
              className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm font-medium disabled:opacity-40"
              disabled={!category || saving}
              onClick={handleSave}
            >
              {saving ? "Saving..." : "Save"}
            </button>
            <button
              className="flex-1 bg-gray-200 text-gray-700 rounded-lg py-2 text-sm font-medium disabled:opacity-40"
              disabled={saving}
              onClick={handleIgnore}
            >
              Ignore
            </button>
            {/* Subtle settle dues link when not auto-detected */}
            {isPrimary && hasDues && !isLikelySettlement && (
              <button
                className="px-3 bg-orange-100 text-orange-700 rounded-lg py-2 text-xs font-medium"
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
