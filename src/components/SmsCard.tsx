"use client";

import { useState, useMemo } from "react";
import { supabase, Transaction, Category } from "@/lib/supabase";
import {
  SettleDue, SettlementPlan, planSettlement, roundOffCandidate, smallLimit,
  monthKey, monthLabel, sortOldestFirst, categoryNeedsNote,
} from "@/lib/dues";
import AddCategoryForm from "./AddCategoryForm";

const CATEGORY_GROUPS = [
  { label: "Monthly", filter: (c: Category) => c.recurrence === "Monthly" },
  { label: "Yearly", filter: (c: Category) => c.recurrence === "Yearly" },
];

interface Props {
  txn: Transaction;
  categories: Category[];
  onDone: (id: number, category?: string, notes?: string) => void;
  isPrimary?: boolean;
  unclearedDues?: SettleDue[];
  onSettle?: (txnId: number, plan: SettlementPlan) => void;
  settlementHints?: string[];
  onSnooze?: (id: number) => void;
  merchantCategoryMap?: Map<string, string>;
  categoryFrequencyMap?: Map<string, number>;
  onSaveMapping?: (merchant: string, category: string) => void;
  onCategoryCreated?: (cat: Category) => void;
}

export default function SmsCard({ txn, categories, onDone, isPrimary, unclearedDues, onSettle, settlementHints, onSnooze, merchantCategoryMap, categoryFrequencyMap, onSaveMapping, onCategoryCreated }: Props) {
  // Auto-detect category from merchant history
  const suggestedCategory = useMemo(() => {
    if (!merchantCategoryMap || !txn.merchant) return "";
    const s = merchantCategoryMap.get(txn.merchant.toLowerCase().trim()) || "";
    // Only suggest a category this user can pick (not hidden or locked)
    const usable = categories.some((c) => c.name === s && (isPrimary || c.visible_to !== "primary"));
    return usable ? s : "";
  }, [merchantCategoryMap, txn.merchant, categories, isPrimary]);

  const [category, setCategory] = useState(suggestedCategory);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [settleMode, setSettleMode] = useState(false);
  const [selectedDues, setSelectedDues] = useState<Set<number>>(new Set());
  const [manualPick, setManualPick] = useState(false);
  const [settleMonth, setSettleMonth] = useState<string | null>(null);
  const [roundOff, setRoundOff] = useState(true);
  const [mappingSaved, setMappingSaved] = useState(false);
  const [showAddCategory, setShowAddCategory] = useState(false);

  const fmtShort = (n: number) => "\u20B9" + n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const fmtDate = (ts: number) => {
    const d = new Date(ts);
    const date = d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
    const time = d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
    return `${date}, ${time}`;
  };

  const txnAmount = Number(txn.amount) || 0;
  const hasDues = unclearedDues && unclearedDues.length > 0;
  const isDebit = txn.transaction_type === "DEBIT";
  const isCredit = txn.transaction_type === "CREDIT";

  // Filter categories by visibility, sorted by usage frequency (descending)
  const visibleCategories = useMemo(() => {
    const filtered = categories.filter((c) =>
      isPrimary || c.visible_to === "all" || c.visible_to === "secondary"
    );
    if (!categoryFrequencyMap || categoryFrequencyMap.size === 0) return filtered;
    return [...filtered].sort((a, b) => {
      const freqA = categoryFrequencyMap.get(a.name) || 0;
      const freqB = categoryFrequencyMap.get(b.name) || 0;
      return freqB - freqA;
    });
  }, [categories, isPrimary, categoryFrequencyMap]);

  // Auto-detect if this looks like a settlement payment
  const isLikelySettlement = useMemo(() => {
    if (!isPrimary || !settlementHints || settlementHints.length === 0) return false;
    if (txn.transaction_type !== "DEBIT") return false;
    const body = txn.body.toLowerCase();
    return settlementHints.some((hint) => hint && body.includes(hint.toLowerCase()));
  }, [isPrimary, settlementHints, txn.body, txn.transaction_type]);

  function enterSettleMode() {
    if (!unclearedDues) return;
    setManualPick(false);
    setSettleMonth(null);
    setRoundOff(true);
    setSelectedDues(new Set());
    setSettleMode(true);
  }

  const oldestDues = useMemo(() => sortOldestFirst(unclearedDues ?? []), [unclearedDues]);
  const outstanding = useMemo(() => oldestDues.reduce((s, d) => s + Number(d.amount), 0), [oldestDues]);

  // Months that have open dues, oldest first, with totals
  const dueMonths = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of oldestDues) m.set(monthKey(d.paid_on), (m.get(monthKey(d.paid_on)) || 0) + Number(d.amount));
    return Array.from(m.entries());
  }, [oldestDues]);

  const roundOffAmt = useMemo(
    () => (manualPick ? 0 : roundOffCandidate(txnAmount, oldestDues, settleMonth)),
    [manualPick, txnAmount, oldestDues, settleMonth]
  );

  const plan = useMemo(
    () => planSettlement(txnAmount, oldestDues, {
      targetMonth: settleMonth,
      onlyIds: manualPick ? selectedDues : null,
      roundOff: roundOff && roundOffAmt > 0,
    }),
    [txnAmount, oldestDues, settleMonth, manualPick, selectedDues, roundOff, roundOffAmt]
  );

  // Human summary of which months get closed fully
  const planSummary = useMemo(() => {
    const cleared = new Set(plan.clearIds);
    const months = new Map<string, { total: number; cleared: number }>();
    for (const d of oldestDues) {
      const k = monthKey(d.paid_on);
      const e = months.get(k) || { total: 0, cleared: 0 };
      e.total++;
      if (cleared.has(d.id)) e.cleared++;
      months.set(k, e);
    }
    const full = Array.from(months.entries()).filter(([, e]) => e.cleared === e.total && e.total > 0).map(([k]) => monthLabel(k));
    const partialDue = plan.partial ? oldestDues.find((d) => d.id === plan.partial!.id) : undefined;
    return { full, partialDue };
  }, [plan, oldestDues]);

  const bigExtra = plan.extra > 0 && plan.extra > smallLimit(txnAmount);

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

  const noteRequired = categoryNeedsNote(category);

  async function handleSave() {
    if (!category) return;
    if (noteRequired && !comment.trim()) return;
    if (!visibleCategories.some((c) => c.name === category)) {
      alert(`"${category}" is locked. Pick another category.`);
      return;
    }
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
    if (!onSettle) return;
    if (manualPick && selectedDues.size === 0) return;
    setSaving(true);
    onSettle(txn.id, plan);
  }

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
            <div className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{
                background: isCredit ? "rgba(0, 212, 161, 0.1)" : "rgba(255, 90, 110, 0.1)",
                border: `1px solid ${isCredit ? "rgba(0, 212, 161, 0.2)" : "rgba(255, 90, 110, 0.2)"}`
              }}>
              {isDebit ? (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--accent-red)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 17L17 7" /><path d="M7 7h10v10" />
                </svg>
              ) : (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--accent-green)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 7L7 17" /><path d="M17 17H7V7" />
                </svg>
              )}
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
            <span>Settle Dues — {fmtShort(outstanding)} outstanding</span>
          </button>
        )}

        {settleMode ? (
          /* ── Dues Picker ── */
          <div className="card-gradient-red p-4 mb-3 rounded-2xl animate-scale-in" style={{ background: "linear-gradient(135deg, rgba(255,179,71,0.08) 0%, rgba(255,159,67,0.03) 100%)", border: "1px solid rgba(255,179,71,0.15)" }}>
            <div className="flex items-center justify-between gap-2 mb-3">
              <span className="text-sm font-bold" style={{ color: "var(--accent-orange)" }}>
                Settle {fmtShort(txnAmount)} · {fmtShort(outstanding)} owed
              </span>
              <button
                type="button"
                className="text-[11px] font-medium underline"
                style={{ color: "var(--text-tertiary)" }}
                onClick={() => { setManualPick(!manualPick); setSelectedDues(new Set()); }}
              >
                {manualPick ? "Auto (oldest first)" : "Choose manually"}
              </button>
            </div>

            {!manualPick && (
              /* Month chips: pay a specific month first; default is oldest first */
              <div className="flex gap-1.5 flex-wrap mb-3">
                <button
                  type="button"
                  className={`badge text-[11px] py-1 ${settleMonth === null ? "badge-orange" : "badge-muted"}`}
                  onClick={() => setSettleMonth(null)}
                >
                  Oldest first
                </button>
                {dueMonths.map(([k, total]) => (
                  <button
                    key={k}
                    type="button"
                    className={`badge text-[11px] py-1 ${settleMonth === k ? "badge-orange" : "badge-muted"}`}
                    onClick={() => setSettleMonth(k)}
                  >
                    {monthLabel(k)} · {fmtShort(total)}
                  </button>
                ))}
              </div>
            )}

            {manualPick && (
              <div className="space-y-1.5 max-h-48 overflow-y-auto mb-3">
                {oldestDues.map((due) => (
                  <label key={due.id} className="flex items-center gap-3 cursor-pointer p-2 rounded-xl transition-all"
                    style={{ background: selectedDues.has(due.id) ? "rgba(255,179,71,0.08)" : "transparent" }}>
                    <input
                      type="checkbox"
                      checked={selectedDues.has(due.id)}
                      onChange={() => toggleDue(due.id)}
                    />
                    <span className="text-sm flex-1" style={{ color: "var(--text-secondary)" }}>
                      {due.category}
                      <span className="text-[10px] ml-1" style={{ color: "var(--text-tertiary)" }}>
                        {new Date(due.paid_on).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                      </span>
                    </span>
                    <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{fmtShort(Number(due.amount))}</span>
                  </label>
                ))}
                <div className="text-[11px] text-center" style={{ color: "var(--text-tertiary)" }}>
                  Selected {fmtShort(selectedTotal)} of {fmtShort(txnAmount)}
                </div>
              </div>
            )}

            {/* Preview of what this payment does */}
            <div className="rounded-xl p-3 mb-3 text-xs space-y-1" style={{ background: "var(--bg-base)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
              {plan.clearIds.length > 0 && (
                <div>
                  ✓ Clears <b>{plan.clearIds.length}</b> due{plan.clearIds.length !== 1 ? "s" : ""}
                  {planSummary.full.length > 0 && <> · <b>{planSummary.full.join(", ")}</b> fully</>}
                </div>
              )}
              {plan.partial && planSummary.partialDue && (
                <div>
                  ◐ {planSummary.partialDue.category}: {fmtShort(Number(planSummary.partialDue.amount))} → <b>{fmtShort(plan.partial.newAmount)} left</b>
                </div>
              )}
              {roundOffAmt > 0 && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={roundOff} onChange={(e) => setRoundOff(e.target.checked)} />
                  <span>Round off {fmtShort(roundOffAmt)} — mark as fully settled</span>
                </label>
              )}
              {plan.extra > 0 && (
                <div style={{ color: bigExtra ? "var(--accent-orange)" : undefined }}>
                  {bigExtra ? "⚠ " : "↪ "}{fmtShort(plan.extra)} more than {manualPick ? "selected" : "all"} dues — kept as advance for future dues
                </div>
              )}
              <div className="pt-1" style={{ color: "var(--text-tertiary)" }}>
                {plan.remaining > 0 ? `${fmtShort(plan.remaining)} still owed after this` : "All dues cleared"}
              </div>
            </div>

            <div className="flex gap-2">
              <button
                className="flex-1 py-2.5 btn-orange rounded-xl text-sm disabled:opacity-35"
                disabled={(manualPick && selectedDues.size === 0) || saving}
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
            {suggestedCategory && (
              <div className="flex items-center gap-1.5 mb-1 px-1">
                <span className="text-[10px] font-medium" style={{ color: category === suggestedCategory ? "var(--accent-green)" : "var(--text-tertiary)" }}>
                  {category === suggestedCategory ? "✦ Suggested from history:" : "💡 Was suggested:"} {suggestedCategory}
                </span>
              </div>
            )}
            <div className="flex gap-2 mb-2">
              <select
                className="flex-1 px-3 py-2.5 text-sm rounded-xl"
                value={category}
                onChange={(e) => { setCategory(e.target.value); setMappingSaved(false); }}
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
              {isPrimary && onCategoryCreated && (
                <button
                  type="button"
                  className="shrink-0 px-3 py-2.5 text-xs font-semibold rounded-xl transition-all"
                  style={{ background: "rgba(123,108,246,0.1)", color: "var(--accent)", border: "1px solid rgba(123,108,246,0.2)" }}
                  onClick={() => setShowAddCategory(true)}
                >
                  + New
                </button>
              )}
            </div>

            {/* Fix mapping: show when merchant is known and user wants to pin category */}
            {txn.merchant && category && onSaveMapping && (!suggestedCategory || category !== suggestedCategory) && (
              <div className="mb-2">
                {mappingSaved ? (
                  <span className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-full font-medium"
                    style={{ background: "rgba(0,212,161,0.1)", color: "var(--accent-green)" }}>
                    ✓ Mapping saved for {txn.merchant}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-full transition-all"
                    style={{ background: "rgba(123,108,246,0.1)", color: "var(--accent)", border: "1px solid rgba(123,108,246,0.2)" }}
                    onClick={() => { onSaveMapping(txn.merchant!, category); setMappingSaved(true); }}
                  >
                    📌 Always use &ldquo;{category}&rdquo; for {txn.merchant}
                  </button>
                )}
              </div>
            )}

            <input
              type="text"
              placeholder={noteRequired ? "Comment (required for Unsorted)" : "Comment (optional)"}
              className="w-full px-3 py-2.5 mb-4 text-sm rounded-xl"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              style={noteRequired && !comment.trim() ? { borderColor: "var(--accent)", borderWidth: 1 } : undefined}
            />

            <div className="flex gap-2">
              <button
                className="flex-1 btn-primary py-2.5 text-sm disabled:opacity-35"
                disabled={!category || saving || (noteRequired && !comment.trim())}
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

      {showAddCategory && onCategoryCreated && (
        <AddCategoryForm
          onSave={(cat) => {
            onCategoryCreated(cat);
            setCategory(cat.name);
            setMappingSaved(false);
            setShowAddCategory(false);
          }}
          onClose={() => setShowAddCategory(false)}
        />
      )}
    </div>
  );
}
