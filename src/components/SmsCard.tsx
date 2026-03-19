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
  onSnooze?: (id: number) => void;
  merchantCategoryMap?: Map<string, string>;
}

export default function SmsCard({ txn, categories, onDone, isPrimary, unclearedDues, onSettle, settlementHints, onSnooze, merchantCategoryMap }: Props) {
  // Auto-detect category from merchant history
  const suggestedCategory = useMemo(() => {
    if (!merchantCategoryMap || !txn.merchant) return "";
    return merchantCategoryMap.get(txn.merchant.toLowerCase().trim()) || "";
  }, [merchantCategoryMap, txn.merchant]);

  const [category, setCategory] = useState(suggestedCategory);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [settleMode, setSettleMode] = useState(false);
  const [selectedDues, setSelectedDues] = useState<Set<number>>(new Set());

  const fmtShort = (n: number) => "\u20B9" + n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const fmtDate = (ts: number) => new Date(ts).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });

  const txnAmount = Number(txn.amount) || 0;
  const hasDues = unclearedDues && unclearedDues.length > 0;
  const isDebit = txn.transaction_type === "DEBIT";
  const isCredit = txn.transaction_type === "CREDIT";

  // Filter categories by visibility
  const visibleCategories = useMemo(() => {
    return categories.filter((c) =>
      isPrimary || c.visible_to === "all" || c.visible_to === "secondary"
    );
  }, [categories, isPrimary]);

  // Auto-detect if this looks like a settlement payment
  const isLikelySettlement = useMemo(() => {
    if (!isPrimary || !settlementHints || settlementHints.length === 0) return false;
    if (txn.transaction_type !== "DEBIT") return false;
    const body = txn.body.toLowerCase();
    return settlementHints.some((hint) => hint && body.includes(hint.toLowerCase()));
  }, [isPrimary, settlementHints, txn.body, txn.transaction_type]);

  function enterSettleMode() {
    if (!unclearedDues) return;
    const totalAll = unclearedDues.reduce((s, d) => s + Number(d.amount), 0);
    let preSelected = new Set<number>();
    if (Math.abs(totalAll - txnAmount) < 0.01) {
      preSelected = new Set(unclearedDues.map((d) => d.id));
    } else {
      const match = unclearedDues.find((d) => Math.abs(Number(d.amount) - txnAmount) < 0.01);
      if (match) preSelected = new Set([match.id]);
    }
    setSelectedDues(preSelected);
    setSettleMode(true);
  }

  function toggleDue(id: number) {
    setSelectedDues((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id); else s.add(id);
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

  const amountMatches = Math.abs(selectedTotal - txnAmount) < 0.01;

  return (
    <div className="card p-0 mb-4 overflow-hidden animate-slide-up">
      {/* Colored top accent line */}
      <div className="h-[3px]" style={{
        background: isCredit
          ? "linear-gradient(90deg, #00d4a1, #34ffc8)"
          : "linear-gradient(90deg, #ff5a6e, #ff8a98)"
      }} />

      <div className="p-4">
        {/* Top row: amount + type badge + date */}
        <div className="flex justify-between items-start mb-3">
          <div className="flex items-center gap-2.5">
            {/* Amount icon */}
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg"
              style={{
                background: isCredit ? "rgba(0, 212, 161, 0.1)" : "rgba(255, 90, 110, 0.1)",
                border: `1px solid ${isCredit ? "rgba(0, 212, 161, 0.2)" : "rgba(255, 90, 110, 0.2)"}`
              }}>
              {isDebit ? "↗" : "↙"}
            </div>
            <div>
              <div className={`amount-large ${isCredit ? "amount-credit" : "amount-debit"}`}>
                {isDebit ? "-" : "+"}{fmtShort(txnAmount)}
              </div>
              <div className="text-xs mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                {txn.merchant ?? "Unknown"} · {fmtDate(txn.sms_date)}
              </div>
            </div>
          </div>
          <span className={`badge ${isCredit ? "badge-green" : isDebit ? "badge-red" : "badge-muted"}`}>
            {txn.transaction_type ?? "?"}
          </span>
        </div>

        {/* Account number */}
        {txn.account_number && (
          <div className="text-[11px] font-mono mb-2 px-2 py-1 rounded-lg inline-block"
            style={{ background: "rgba(255,255,255,0.03)", color: "var(--text-tertiary)" }}>
            {txn.account_number}
          </div>
        )}

        {/* Raw SMS (expandable) */}
        <div
          className="text-xs rounded-xl p-3 mb-4 cursor-pointer transition-all"
          style={{
            background: "var(--bg-base)",
            color: "var(--text-tertiary)",
            border: "1px solid var(--border)",
            lineHeight: "1.5"
          }}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? txn.body : txn.body.substring(0, 90) + (txn.body.length > 90 ? "..." : "")}
          {txn.body.length > 90 && (
            <span className="ml-1 font-medium" style={{ color: "var(--accent)" }}>
              {expanded ? " ↑ less" : " ↓ more"}
            </span>
          )}
        </div>

        {/* Settle Dues — prominent if auto-detected */}
        {isPrimary && hasDues && !settleMode && isLikelySettlement && (
          <button
            className="w-full mb-4 py-3 btn-orange rounded-xl text-sm font-semibold flex items-center justify-center gap-2"
            onClick={enterSettleMode}
          >
            <span>⚡</span>
            <span>Settle Dues — {fmtShort(unclearedDues!.reduce((s, d) => s + Number(d.amount), 0))} outstanding</span>
          </button>
        )}

        {settleMode ? (
          /* ── Dues Picker ── */
          <div className="card-gradient-red p-4 mb-3 rounded-2xl animate-scale-in" style={{ background: "linear-gradient(135deg, rgba(255,179,71,0.08) 0%, rgba(255,159,67,0.03) 100%)", border: "1px solid rgba(255,179,71,0.15)" }}>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-base">📋</span>
              <span className="text-sm font-bold" style={{ color: "var(--accent-orange)" }}>Select dues to settle</span>
            </div>

            <div className="space-y-1.5 max-h-48 overflow-y-auto mb-3">
              {unclearedDues!.map((due) => (
                <label key={due.id} className="flex items-center gap-3 cursor-pointer p-2 rounded-xl transition-all"
                  style={{ background: selectedDues.has(due.id) ? "rgba(255,179,71,0.08)" : "transparent" }}>
                  <input
                    type="checkbox"
                    checked={selectedDues.has(due.id)}
                    onChange={() => toggleDue(due.id)}
                  />
                  <span className="text-sm flex-1" style={{ color: "var(--text-secondary)" }}>{due.category}</span>
                  <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{fmtShort(Number(due.amount))}</span>
                </label>
              ))}
            </div>

            {/* Running total */}
            <div className={`badge w-full justify-center py-1.5 mb-3 text-xs ${amountMatches ? "badge-green" : "badge-orange"}`}>
              Selected: {fmtShort(selectedTotal)} / Payment: {fmtShort(txnAmount)}
              {!amountMatches && selectedTotal > 0 && (
                <span className="ml-1">— {selectedTotal > txnAmount ? "over" : "under"} by {fmtShort(Math.abs(selectedTotal - txnAmount))}</span>
              )}
            </div>

            <div className="flex gap-2">
              <button
                className="flex-1 py-2.5 btn-orange rounded-xl text-sm disabled:opacity-35"
                disabled={selectedDues.size === 0 || saving}
                onClick={handleConfirmSettle}
              >
                {saving ? "Settling..." : "✓ Confirm Settlement"}
              </button>
              <button
                className="px-5 py-2.5 btn-ghost rounded-xl text-sm"
                onClick={() => setSettleMode(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          /* ── Normal categorization flow ── */
          <>
            {suggestedCategory && category === suggestedCategory && (
              <div className="text-[10px] mb-1 px-1 font-medium" style={{ color: "var(--accent-green)" }}>
                ✦ Auto-detected: {suggestedCategory}
              </div>
            )}
            <select
              className="w-full px-3 py-2.5 mb-2 text-sm rounded-xl"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              style={suggestedCategory && category === suggestedCategory ? { borderColor: "rgba(0,212,161,0.3)" } : undefined}
            >
              <option value="">Select category...</option>
              {CATEGORY_GROUPS.map((group) => {
                const items = visibleCategories.filter(group.filter);
                if (items.length === 0) return null;
                return (
                  <optgroup key={group.label} label={group.label}>
                    {items.map((c) => (
                      <option key={c.id} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>

            <input
              type="text"
              placeholder="Comment (optional)"
              className="w-full px-3 py-2.5 mb-4 text-sm rounded-xl"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />

            <div className="flex gap-2">
              <button
                className="flex-1 btn-primary py-2.5 text-sm disabled:opacity-35"
                disabled={!category || saving}
                onClick={handleSave}
              >
                {saving ? "Saving..." : "✓ Save"}
              </button>
              <button
                className="flex-1 btn-ghost py-2.5 text-sm"
                disabled={saving}
                onClick={handleIgnore}
              >
                Skip
              </button>
              {onSnooze && (
                <button
                  className="px-4 py-2.5 text-xs font-semibold rounded-xl transition-all"
                  style={{ background: "rgba(123, 108, 246, 0.1)", color: "var(--accent)", border: "1px solid rgba(123, 108, 246, 0.2)" }}
                  disabled={saving}
                  onClick={() => onSnooze(txn.id)}
                >
                  💤
                </button>
              )}
              {isPrimary && hasDues && !isLikelySettlement && (
                <button
                  className="px-4 py-2.5 text-xs font-semibold rounded-xl transition-all"
                  style={{ background: "rgba(255,179,71,0.1)", color: "var(--accent-orange)", border: "1px solid rgba(255,179,71,0.2)" }}
                  onClick={enterSettleMode}
                >
                  ⚡ Settle
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
