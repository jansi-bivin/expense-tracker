"use client";

import React, { useMemo, useState } from "react";
import { supabase, Transaction, Category } from "@/lib/supabase";
import { categoryNeedsNote } from "@/lib/dues";
import { ExpectedDebit } from "@/lib/expectedDebits";
import { SoftLock, softCap, softLockable } from "@/lib/softLock";
import BubbleBasket from "./BubbleBasket";
interface Props {
  transactions: Transaction[];
  categories: Category[];
  isPrimary: boolean;
  scaleFactor: number;
  monthlyOverrides: Record<number, number>;
  excludedCategoryIds?: Set<number>;
  onCategoriesChange: (cats: Category[]) => void;
  onShowAddCategory: () => void;
  onMonthlyOverride: (catId: number, cap: number | null) => void;
  activeDays: number;
  daysInMonth: number;
  onActiveDaysUpdate: (days: number) => void;
  onReclassify?: (txnId: number, newCategory: string, note?: string) => void;
  onDeleteTxn?: (txnId: number) => void;
  /** Open the split window for a payment (parts in different categories). */
  onSplit?: (txnId: number) => void;
  /** This person's phone: they can split their own payments (the primary can split any). */
  myPhone?: string | null;
  dues?: { id: number; transaction_id: number; cleared: boolean; settlement_transaction_id?: number | null }[];
  viewMonth: number; // 0-indexed JS month
  viewYear: number;
  lockedNames?: Set<string>;
  /** Primary only: lock/unlock a category for new expenses. */
  onToggleLock?: (categoryName: string) => void;
  /** Fixed monthly auto-debits, keyed by category id. */
  expectedDebits?: Record<string, ExpectedDebit>;
  /** Primary only: set (or clear with null) a category's auto-debit day and amount. */
  onSaveExpectedDebit?: (categoryId: number, item: ExpectedDebit | null) => void;
  /** Soft lock for the viewed month (primary only); null when off. */
  softLock?: SoftLock | null;
  /** Turn the month's soft lock on/off (primary only). */
  onSoftLockToggle?: (on: boolean) => void;
  /** Soft-lock one category again, or open it. */
  onSoftLockCat?: (catId: number, locked: boolean) => void;
  /** Categories paid once a month (tucked away once paid). */
  oneTimeIds?: Set<number>;
  onToggleOneTime?: (catId: number) => void;
}

function CategoryBudget({ transactions, categories, isPrimary, scaleFactor, monthlyOverrides, excludedCategoryIds, onCategoriesChange, onShowAddCategory, onMonthlyOverride, activeDays, daysInMonth, onActiveDaysUpdate, onReclassify, onDeleteTxn, onSplit, myPhone, dues, viewMonth, viewYear, lockedNames, onToggleLock, expectedDebits, onSaveExpectedDebit, softLock, onSoftLockToggle, onSoftLockCat, oneTimeIds, onToggleOneTime }: Props) {
  const currentMonth = viewMonth;
  const currentYear = viewYear;
  const [editingId, setEditingId] = useState<number | null>(null);
  const [drillDownId, setDrillDownId] = useState<number | null>(null);
  const [showComparison, setShowComparison] = useState<false | "monthly" | "yearly">(false);
  const [editCap, setEditCap] = useState("");
  const [editVisibility, setEditVisibility] = useState<"all" | "primary" | "secondary">("all");
  const [editMode, setEditMode] = useState<"general" | "month">("general");
  const [savingEdit, setSavingEdit] = useState(false);
  const [editDueDay, setEditDueDay] = useState("");
  const [editDueAmount, setEditDueAmount] = useState("");
  const [showActiveDays, setShowActiveDays] = useState(false);
  const [showMonthlyList, setShowMonthlyList] = useState(false);
  const [showYearlyList, setShowYearlyList] = useState(false);
  // Payments that have parts split off them
  const splitParents = useMemo(() => new Set(
    transactions.filter((t) => t.device_id?.startsWith("split:")).map((t) => Number(t.device_id!.slice(6)))
  ), [transactions]);
  // Yearly expenses list: whole year, or only the month being viewed
  const [yearlyListMonthOnly, setYearlyListMonthOnly] = useState(false);
  // Inline per-row month-cap editor inside ComparisonOverlay (double-click the cap)
  const [editingRowCatId, setEditingRowCatId] = useState<number | null>(null);
  const [rowCapInput, setRowCapInput] = useState("");
  const isScaled = activeDays !== daysInMonth;

  const fmt = (n: number) => "\u20B9" + n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const fmtDec = (n: number) => "\u20B9" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pctFmt = (n: number) => Math.round(n) + "%";
  const fmtDate = (ts: number) => new Date(ts).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });

  const visibleCategories = useMemo(() => {
    return categories.filter((c) =>
      (isPrimary || c.visible_to === "all" || c.visible_to === "secondary") &&
      !(excludedCategoryIds?.has(c.id))
    );
  }, [categories, isPrimary, excludedCategoryIds]);

  const categoryTxns = useMemo(() => {
    const map = new Map<string, Transaction[]>();
    for (const txn of transactions) {
      if (!txn.category || !txn.amount) continue;
      const cat = visibleCategories.find((c) => c.name === txn.category);
      if (!cat) continue;
      const d = new Date(txn.sms_date);
      // Yearly categories with a monthly plan (override) are accounted for that specific month
      const monthPlanned = cat.recurrence === "Yearly" && monthlyOverrides[cat.id] != null;
      const inPeriod = (cat.recurrence === "Monthly" || monthPlanned)
        ? d.getMonth() === currentMonth && d.getFullYear() === currentYear
        : d.getFullYear() === currentYear;
      if (inPeriod) {
        if (!map.has(txn.category)) map.set(txn.category, []);
        map.get(txn.category)!.push(txn);
      }
    }
    return map;
  }, [transactions, visibleCategories, currentMonth, currentYear]);

  const categorySpend = useMemo(() => {
    const spend = new Map<string, number>();
    for (const [catName, txns] of categoryTxns) {
      spend.set(catName, txns.reduce((s, t) => s + Number(t.amount), 0));
    }
    return spend;
  }, [categoryTxns]);

  function getEffectiveCap(cat: Category): number {
    if (cat.recurrence === "Yearly") {
      // If a specific month is planned via monthly override, use that cap
      if (monthlyOverrides[cat.id] != null) return monthlyOverrides[cat.id];
      return cat.cap;
    }
    const hasOverride = monthlyOverrides[cat.id] != null;
    const normal = hasOverride ? monthlyOverrides[cat.id] : cat.cap === 0 ? 0 : cat.cap * scaleFactor;
    return isPrimary ? softCap(normal, cat, softLock) : normal;
  }
  const isSoftLocked = (cat: Category) =>
    isPrimary && !!softLock && softLockable(cat) && softLock.frozen[String(cat.id)] != null;
  const softOpenCount = softLock ? categories.filter((c) => softLockable(c) && !excludedCategoryIds?.has(c.id) && softLock.frozen[String(c.id)] == null).length : 0;
  const nowD = new Date();
  const canSoftLock = isPrimary && !!onSoftLockToggle &&
    currentYear * 12 + currentMonth >= nowD.getFullYear() * 12 + nowD.getMonth();
  const [softOffArmed, setSoftOffArmed] = useState(false);
  // Planned vs Spent: show the paid once-a-month categories (tucked away by default)
  const [showPaidOnce, setShowPaidOnce] = useState(false);

  // Sort categories: most spend first, then alphabetical for zero-spend
  function sortByActivity(cats: Category[]): Category[] {
    return [...cats].sort((a, b) => {
      const spendA = categorySpend.get(a.name) || 0;
      const spendB = categorySpend.get(b.name) || 0;
      if (spendA !== spendB) return spendB - spendA;
      return a.name.localeCompare(b.name);
    });
  }

  // F-22: Yearly categories with a monthly override (month-pinned) appear in the monthly section
  const monthlyCategories = sortByActivity(visibleCategories.filter((c) =>
    c.recurrence === "Monthly" || (c.recurrence === "Yearly" && monthlyOverrides[c.id] != null)
  ));
  const yearlyCategories = sortByActivity(visibleCategories.filter((c) =>
    c.recurrence === "Yearly" && monthlyOverrides[c.id] == null
  ));

  const totalCap = useMemo(() => {
    return monthlyCategories.reduce((sum, c) => {
      const eCap = getEffectiveCap(c);
      if (eCap === 0 && c.cap === 0 && monthlyOverrides[c.id] == null) return sum;
      return sum + eCap;
    }, 0);
  }, [monthlyCategories, scaleFactor, monthlyOverrides]);

  const totalSpent = useMemo(() => {
    let sum = 0;
    for (const cat of monthlyCategories) {
      sum += categorySpend.get(cat.name) || 0;
    }
    return sum;
  }, [monthlyCategories, categorySpend]);

  const totalPct = totalCap > 0 ? Math.min((totalSpent / totalCap) * 100, 100) : 0;
  const totalRemainingPct = Math.max(100 - totalPct, 0);
  const totalRemaining = totalCap - totalSpent;
  // Under soft lock: money still to arrange (what's left in each category, never
  // less than ₹0) and, apart from it, what's already gone over the limits.
  const softActive = isPrimary && !!softLock;
  const { toArrange, alreadyOver } = useMemo(() => {
    let toArrange = 0, alreadyOver = 0;
    for (const c of monthlyCategories) {
      const eCap = getEffectiveCap(c);
      if (eCap === 0 && c.cap === 0 && monthlyOverrides[c.id] == null) continue; // no limit
      const spent = categorySpend.get(c.name) || 0;
      toArrange += Math.max(eCap - spent, 0);
      alreadyOver += Math.max(spent - eCap, 0);
    }
    return { toArrange, alreadyOver };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthlyCategories, categorySpend, monthlyOverrides, scaleFactor, softLock]);

  // Yearly totals
  const yearlyTotalCap = useMemo(() => {
    return yearlyCategories.reduce((sum, c) => {
      const cap = monthlyOverrides[c.id] != null ? monthlyOverrides[c.id] : c.cap;
      return cap > 0 ? sum + cap : sum;
    }, 0);
  }, [yearlyCategories, monthlyOverrides]);
  const yearlyTotalSpent = useMemo(() => {
    return yearlyCategories.reduce((sum, c) => sum + (categorySpend.get(c.name) || 0), 0);
  }, [yearlyCategories, categorySpend]);
  // Proportional: by month N of 12, expected spend = cap × (N / 12)
  const monthsElapsed = currentMonth + 1; // 0-indexed → 1-indexed
  const yearlyExpectedSpend = yearlyTotalCap * (monthsElapsed / 12);
  const yearlyPct = yearlyTotalCap > 0 ? Math.min((yearlyTotalSpent / yearlyTotalCap) * 100, 100) : 0;
  const yearlyExpectedPct = (monthsElapsed / 12) * 100;
  const yearlyRemaining = yearlyTotalCap - yearlyTotalSpent;
  const yearlyProportionalRemaining = yearlyExpectedSpend - yearlyTotalSpent;
  const yearlyOnTrack = yearlyTotalSpent <= yearlyExpectedSpend;

  // ── Bubble data for basket visualization ──
  const monthlyActiveCats = monthlyCategories.filter((c) => (categorySpend.get(c.name) || 0) > 0);
  const monthlyZeroCats = monthlyCategories.filter((c) => (categorySpend.get(c.name) || 0) === 0);
  const yearlyActiveCats = yearlyCategories.filter((c) => (categorySpend.get(c.name) || 0) > 0);
  const yearlyZeroCats = yearlyCategories.filter((c) => (categorySpend.get(c.name) || 0) === 0);

  function buildBubbles(cats: Category[], yearly = false) {
    if (cats.length === 0) return [];
    const spends = cats.map((c) => categorySpend.get(c.name) || 0);
    const minS = Math.min(...spends), maxS = Math.max(...spends), range = maxS - minS;
    const MIN = 48, MAX = 100;
    return cats.map((c) => {
      const spent = categorySpend.get(c.name) || 0;
      const eCap = getEffectiveCap(c);
      const noCap = eCap === 0 && c.cap === 0 && monthlyOverrides[c.id] == null;
      const pct = eCap > 0 ? (spent / eCap) * 100 : 0;
      const isOver = !noCap && spent > eCap;
      const norm = range > 0 ? Math.sqrt((spent - minS) / range) : (cats.length === 1 ? 1 : 0.5);
      let size = MIN + norm * (MAX - MIN);
      if (isOver) size = Math.min(size * 1.15, MAX * 1.2);
      const color = noCap ? "#a78bfa" : pct > 100 ? "#f87171" : pct > 75 ? "#fbbf24" : "#34d399";
      const bgColor = `${color}14`; // ~8% opacity — nearly transparent like a real soap bubble
      const rem = eCap - spent;
      return {
        id: c.id, label: c.name,
        amount: isPrimary ? fmt(spent) : (eCap > 0 ? pctFmt(pct) : fmt(spent)),
        detail: noCap ? undefined : isPrimary
          ? (isOver ? `${fmt(-rem)} over` : `${fmt(rem)} left`)
          : (isOver ? `${pctFmt(pct - 100)} over` : `${pctFmt(100 - pct)} left`),
        isOver, color, bgColor, size: Math.round(size),
        onClick: () => setDrillDownId(c.id),
      };
    });
  }

  // Only show physics bubbles for categories with actual spend (B-18: empty month caused infinite physics loop)
  const monthlyBubbles = buildBubbles(monthlyActiveCats);
  const yearlyBubbles = buildBubbles(yearlyActiveCats, true);

  function startEdit(cat: Category) {
    if (!isPrimary) return;
    setEditingId(cat.id);
    const hasOverride = monthlyOverrides[cat.id] != null;
    setEditMode(hasOverride ? "month" : "general");
    setEditCap(String(hasOverride ? monthlyOverrides[cat.id] : cat.cap));
    setEditVisibility(cat.visible_to);
    const due = expectedDebits?.[String(cat.id)];
    setEditDueDay(due ? String(due.day) : "");
    setEditDueAmount(due ? String(due.amount) : "");
  }

  /** Save the auto-debit fields if they changed (blank day clears it). */
  function saveExpectedDebit(cat: Category) {
    if (!onSaveExpectedDebit) return;
    const current = expectedDebits?.[String(cat.id)] ?? null;
    const day = parseInt(editDueDay, 10);
    const amount = Number(editDueAmount || cat.cap);
    const next = day >= 1 && day <= 31 && amount > 0 ? { day, amount } : null;
    if (JSON.stringify(next) !== JSON.stringify(current)) onSaveExpectedDebit(cat.id, next);
  }

  async function saveEdit(cat: Category) {
    const newCap = Number(editCap);
    if (newCap < 0) return;
    setSavingEdit(true);
    saveExpectedDebit(cat);
    if (editMode === "month") {
      if (editVisibility !== cat.visible_to) {
        await supabase.from("categories").update({ visible_to: editVisibility }).eq("id", cat.id);
        onCategoriesChange(categories.map((c) => c.id === cat.id ? { ...c, visible_to: editVisibility } : c));
      }
      onMonthlyOverride(cat.id, newCap);
    } else {
      await supabase.from("categories").update({ cap: newCap, visible_to: editVisibility }).eq("id", cat.id);
      onCategoriesChange(categories.map((c) => c.id === cat.id ? { ...c, cap: newCap, visible_to: editVisibility } : c));
      if (monthlyOverrides[cat.id] != null) {
        onMonthlyOverride(cat.id, null);
      }
    }
    setEditingId(null);
    setSavingEdit(false);
  }

  // ═══════════════════════════════════
  // Expense row inside drill-down
  // ═══════════════════════════════════
  function ExpenseRow({ txn, currentCatName }: { txn: Transaction; currentCatName?: string }) {
    const [expanded, setExpanded] = useState(false);
    const [showReclassify, setShowReclassify] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const isManual = txn.address === "MANUAL";
    const isSplitPart = txn.address === "SPLIT";
    const canSplit = !!onSplit && txn.amount != null && Number(txn.amount) > 0 && (isPrimary || txn.phone_number === myPhone);
    const merchant = txn.merchant || (isManual ? "Manual Entry" : isSplitPart ? "Split part" : "Unknown");
    const hasNotes = txn.notes && txn.notes.trim().length > 0;
    const hasRawSms = !isManual && !isSplitPart && txn.body && txn.body.length > 0;

    // F2: Check if this txn has an associated due and its settlement status
    const associatedDue = dues?.find((d) => d.transaction_id === txn.id);
    const isSettled = associatedDue?.cleared;
    const hasSettlement = associatedDue?.settlement_transaction_id != null;

    return (
      <div
        className="px-5 transition-all"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        {/* Single row: Merchant | Date | Amount | Reclassify */}
        <div className="flex items-center gap-3 py-3"
          onClick={() => { if (hasRawSms) setExpanded(!expanded); }}>
          <span className="flex-1 min-w-0 text-sm truncate" style={{ color: "var(--text-primary)" }}>
            {merchant}
            {isManual && <span className="text-[9px] ml-1.5 opacity-50">manual</span>}
            {(isSplitPart || splitParents.has(txn.id)) && <span className="text-[9px] ml-1.5 opacity-60">✂ split</span>}
            {associatedDue && (
              <span className={`text-[9px] ml-1.5 font-semibold ${isSettled ? "" : ""}`}
                style={{ color: isSettled ? "var(--accent-green)" : "var(--accent-orange)" }}>
                {isSettled ? (hasSettlement ? "settled" : "cleared") : "due"}
              </span>
            )}
          </span>
          <span className="text-xs shrink-0" style={{ color: "var(--text-tertiary)" }}>
            {fmtDate(txn.sms_date)}
          </span>
          <span className="text-sm font-semibold shrink-0 min-w-[70px] text-right" style={{ color: "var(--text-primary)" }}>
            {fmtDec(Number(txn.amount))}
          </span>
          {canSplit && (
            <button
              className="text-[10px] shrink-0 px-1.5 py-0.5 rounded-md"
              style={{ color: "var(--accent)", background: "rgba(123,108,246,0.08)" }}
              title="Split into parts in different categories"
              aria-label="Split"
              onClick={(e) => { e.stopPropagation(); onSplit!(txn.id); }}
            >
              ✂
            </button>
          )}
          {isPrimary && onReclassify && (
            <button
              className="text-[10px] shrink-0 px-1.5 py-0.5 rounded-md"
              style={{ color: "var(--accent)", background: "rgba(123,108,246,0.08)" }}
              onClick={(e) => { e.stopPropagation(); setShowReclassify(!showReclassify); }}
            >
              ↔
            </button>
          )}
          {/* Delete button for any expense */}
          {isPrimary && onDeleteTxn && (
            <button
              className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg"
              style={{ color: "var(--accent-red)", background: "rgba(255,90,110,0.1)" }}
              onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
              </svg>
            </button>
          )}
          {hasRawSms && (
            <span className="text-[10px] shrink-0" style={{ color: "var(--accent)", opacity: expanded ? 0.4 : 0.7 }}>
              {expanded ? "▾" : "▸"}
            </span>
          )}
        </div>

        {/* Delete confirmation */}
        {confirmDelete && (
          <div className="pb-3 flex items-center gap-2 animate-fade-in">
            <span className="text-xs" style={{ color: "var(--accent-red)" }}>Delete this entry?</span>
            <button className="text-[10px] px-2.5 py-1 rounded-lg font-semibold"
              style={{ background: "rgba(255,90,110,0.15)", color: "var(--accent-red)" }}
              onClick={() => { onDeleteTxn!(txn.id); setConfirmDelete(false); }}>
              Yes
            </button>
            <button className="text-[10px] px-2.5 py-1 rounded-lg btn-ghost"
              onClick={() => setConfirmDelete(false)}>
              No
            </button>
          </div>
        )}

        {/* Reclassify picker */}
        {showReclassify && onReclassify && (
          <div className="pb-3 animate-fade-in" onClick={(e) => e.stopPropagation()}>
            <select
              className="w-full px-3 py-2 text-xs rounded-xl"
              defaultValue=""
              onChange={(e) => {
                const target = e.target.value;
                if (!target) return;
                let note: string | undefined;
                if (categoryNeedsNote(target) && !txn.notes?.trim()) {
                  note = window.prompt(`A comment is required for "${target}". What was this expense?`)?.trim();
                  if (!note) { e.target.value = ""; return; }
                }
                onReclassify(txn.id, target, note);
                setShowReclassify(false);
              }}
            >
              <option value="">Move to category...</option>
              {categories
                .filter((c) => c.name !== currentCatName)
                .map((c) => (
                  <option key={c.id} value={c.name}>{c.name}</option>
                ))}
            </select>
          </div>
        )}

        {/* Expandable: notes + raw SMS */}
        {(hasNotes || (expanded && hasRawSms)) && (
          <div className="pb-3 -mt-1">
            {hasNotes && (
              <div className="text-xs mb-1.5" style={{ color: "var(--text-tertiary)" }}>
                📝 {txn.notes}
              </div>
            )}
            {expanded && hasRawSms && (
              <div className="text-xs p-3 rounded-xl leading-relaxed animate-fade-in"
                style={{ background: "var(--bg-base)", color: "var(--text-tertiary)", border: "1px solid var(--border)" }}>
                {txn.body}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ═══════════════════════════════════
  // Full-screen drill-down overlay
  // ═══════════════════════════════════
  function DrillDownOverlay() {
    if (drillDownId === null) return null;
    const cat = visibleCategories.find((c) => c.id === drillDownId);
    if (!cat) return null;

    const effectiveCap = getEffectiveCap(cat);
    const hasMonthOverride = monthlyOverrides[cat.id] != null;
    const isNoCap = effectiveCap === 0 && cat.cap === 0 && !hasMonthOverride;
    const spent = categorySpend.get(cat.name) || 0;
    const remaining = effectiveCap - spent;
    const pct = effectiveCap > 0 ? Math.min((spent / effectiveCap) * 100, 100) : 0;
    const fillClass = pct >= 90 ? "progress-fill-red" : pct >= 75 ? "progress-fill-yellow" : "progress-fill-green";
    const accentColor = isNoCap ? "var(--text-secondary)" : pct >= 90 ? "var(--accent-red)" : pct >= 75 ? "var(--accent-orange)" : "var(--accent-green)";
    // Yearly categories: "This month" lists only the month being viewed
    const isYearlyCat = yearlyCategories.some((c) => c.id === cat.id);
    const monthOnly = isYearlyCat && yearlyListMonthOnly;
    const txnsForCat = (categoryTxns.get(cat.name) || [])
      .filter((t) => {
        if (!monthOnly) return true;
        const d = new Date(t.sms_date);
        return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
      })
      .sort((a, b) => b.sms_date - a.sms_date);
    const monthSpent = txnsForCat.reduce((s, t) => s + Number(t.amount), 0);
    const closeDrill = () => { setDrillDownId(null); setYearlyListMonthOnly(false); };

    return (
      <div className="fixed inset-0 z-50 flex flex-col animate-fade-in" style={{ background: "var(--bg-base)" }}>
        {/* ── Sticky Header ── */}
        <div className="shrink-0 px-5 pt-5 pb-4" style={{ background: "var(--bg-elevated)", borderBottom: "1px solid var(--border)" }}>
          {/* Top bar */}
          <div className="flex justify-between items-center mb-4">
            <button
              className="flex items-center gap-1.5 text-sm font-medium"
              style={{ color: "var(--accent)" }}
              onClick={closeDrill}
            >
              <span>←</span> Back
            </button>
            {isPrimary && (
              <button
                className="text-xs font-semibold px-3 py-1.5 rounded-lg btn-ghost"
                onClick={() => { startEdit(cat); closeDrill(); }}
              >
                ✎ Edit
              </button>
            )}
          </div>

          {/* Category name */}
          <div className="text-lg font-bold mb-3" style={{ color: "var(--text-primary)" }}>{cat.name}</div>
          {isPrimary && onToggleOneTime && !isYearlyCat && (
            <button className="badge text-[10px] mb-3 cursor-pointer"
              style={oneTimeIds?.has(cat.id)
                ? { background: "rgba(124,140,255,0.15)", color: "var(--accent)", border: "1px solid rgba(124,140,255,0.35)" }
                : { background: "rgba(255,255,255,0.05)", color: "var(--text-tertiary)", border: "1px solid var(--border-light)" }}
              onClick={() => onToggleOneTime(cat.id)}>
              {oneTimeIds?.has(cat.id) ? "✓ Paid once a month · hidden once paid" : "Paid once a month? Tap to hide it once paid"}
            </button>
          )}

          {monthOnly ? (
            <div className="flex justify-between items-baseline mb-1">
              <span className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>{fmt(monthSpent)}</span>
              <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                in {new Date(viewYear, viewMonth, 1).toLocaleDateString("en-IN", { month: "long" })} · {fmt(spent)} this year
              </span>
            </div>
          ) : isNoCap ? (
            <div className="flex justify-between items-baseline mb-1">
              <span className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>{fmt(spent)}</span>
              <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                no cap · {txnsForCat.length} txn{txnsForCat.length !== 1 ? "s" : ""}
              </span>
            </div>
          ) : (
            <>
              <div className="flex justify-between items-baseline mb-3">
                <div>
                  <span className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>{fmt(spent)}</span>
                  <span className="text-sm ml-1.5" style={{ color: "var(--text-tertiary)" }}>/ {fmt(effectiveCap)}</span>
                  {hasMonthOverride && (
                    <span className="text-xs ml-1.5" style={{ color: "var(--accent-orange)" }}>(this mo)</span>
                  )}
                </div>
                <span className="text-sm font-semibold" style={{ color: accentColor }}>
                  {remaining >= 0 ? fmt(remaining) + " left" : fmt(-remaining) + " over"}
                </span>
              </div>
              <div className="progress-track" style={{ height: "6px" }}>
                <div className={`progress-fill ${fillClass}`} style={{ width: `${pct}%`, height: "6px" }} />
              </div>
            </>
          )}

          <div className="text-xs mt-3 font-medium" style={{ color: "var(--text-tertiary)" }}>
            {txnsForCat.length} transaction{txnsForCat.length !== 1 ? "s" : ""}
          </div>
          {isYearlyCat && <PeriodChips on={yearlyListMonthOnly} onChange={setYearlyListMonthOnly} />}
        </div>

        {/* ── Scrollable expense list ── */}
        <div className="flex-1 overflow-y-auto">
          {txnsForCat.length === 0 ? (
            <div className="p-8 text-center text-sm" style={{ color: "var(--text-tertiary)" }}>
              {monthOnly ? "Nothing in this category this month" : "No expenses yet"}
            </div>
          ) : (
            txnsForCat.map((txn) => (
              <ExpenseRow key={txn.id} txn={txn} currentCatName={cat.name} />
            ))
          )}
        </div>
      </div>
    );
  }

  const monthShort = new Date(viewYear, viewMonth, 1).toLocaleDateString("en-IN", { month: "short" });
  /** "Whole year | This month (Nov)" switch used in the yearly detail views. */
  function PeriodChips({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
    return (
      <div className="flex gap-1.5 mt-3" role="radiogroup" aria-label="Period">
        {([false, true] as const).map((v) => (
          <button key={String(v)} type="button" role="radio" aria-checked={on === v}
            className="px-3 py-1 rounded-full text-[11px] font-semibold cursor-pointer"
            style={{
              background: on === v ? "rgba(123,108,246,0.18)" : "transparent",
              color: on === v ? "var(--accent)" : "var(--text-tertiary)",
              border: `1px solid ${on === v ? "rgba(123,108,246,0.35)" : "var(--border-light)"}`,
            }}
            onClick={() => onChange(v)}>
            {v ? `This month (${monthShort})` : "Whole year"}
          </button>
        ))}
      </div>
    );
  }

  // ═══════════════════════════════════
  // Planned vs Spent comparison overlay
  // ═══════════════════════════════════
  function ComparisonOverlay() {
    if (!showComparison) return null;
    const isYearlyView = showComparison === "yearly";
    const monthOnly = isYearlyView && yearlyListMonthOnly;
    const closeComparison = () => { setShowComparison(false); setYearlyListMonthOnly(false); };
    const sourceCats = isYearlyView ? yearlyCategories : monthlyCategories;
    const totalSpentForView = isYearlyView ? yearlyTotalSpent : totalSpent;
    const totalCapForView = isYearlyView ? yearlyTotalCap : totalCap;
    const totalRemForView = totalCapForView - totalSpentForView;
    const totalPctForView = totalCapForView > 0 ? Math.min((totalSpentForView / totalCapForView) * 100, 100) : 0;

    // For yearly view, hide categories with no cap AND no spend — they're
    // either month-pinned yearlies (cap stored only in monthly_budgets for a
    // specific month) or empty placeholders that just add noise.
    const filteredCats = isYearlyView
      ? sourceCats.filter((c) => getEffectiveCap(c) > 0 || (categorySpend.get(c.name) || 0) > 0)
      : sourceCats;

    const sortedCats = [...filteredCats].sort((a, b) => {
      const spentA = categorySpend.get(a.name) || 0;
      const spentB = categorySpend.get(b.name) || 0;
      const capA = getEffectiveCap(a);
      const capB = getEffectiveCap(b);
      const overA = capA > 0 && spentA > capA ? 1 : 0;
      const overB = capB > 0 && spentB > capB ? 1 : 0;
      if (overA !== overB) return overB - overA;
      const pctA = capA > 0 ? spentA / capA : 0;
      const pctB = capB > 0 ? spentB / capB : 0;
      return pctB - pctA;
    });

    return (
      <div className="fixed inset-0 z-50 flex flex-col animate-fade-in" style={{ background: "var(--bg-base)" }}>
        {/* Header */}
        <div className="shrink-0 px-5 pt-5 pb-4" style={{ background: "var(--bg-elevated)", borderBottom: "1px solid var(--border)" }}>
          <div className="flex justify-between items-center mb-4">
            <button className="flex items-center gap-1.5 text-sm font-medium" style={{ color: "var(--accent)" }}
              onClick={closeComparison}>
              <span>←</span> Back
            </button>
          </div>
          <div className="text-lg font-bold mb-1" style={{ color: "var(--text-primary)" }}>Planned vs Spent</div>
          <div className="text-xs mb-3" style={{ color: "var(--text-tertiary)" }}>
            {monthOnly
              ? new Date(viewYear, viewMonth, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" }) + " — Yearly"
              : isYearlyView
              ? String(currentYear) + " — Yearly"
              : new Date(viewYear, viewMonth, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" })}
          </div>
          {monthOnly ? (
            <div className="flex justify-between items-baseline">
              <span className="text-2xl font-bold amount-debit">{fmt(yearlyThisMonthTotal)}</span>
              <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>{yearlyThisMonth.length} transaction{yearlyThisMonth.length !== 1 ? "s" : ""}</span>
            </div>
          ) : (<>
          {/* Total row */}
          <div className="flex justify-between items-baseline mb-2">
            <span className="text-2xl font-bold amount-debit">{fmt(totalSpentForView)}</span>
            <span className="text-sm" style={{ color: "var(--text-tertiary)" }}>/ {fmt(totalCapForView)}</span>
            {softActive && !isYearlyView ? (
              <span className="text-sm font-semibold text-right" style={{ color: "var(--accent-green)" }}>
                {fmt(toArrange)} to arrange
                {alreadyOver > 0 && <span className="block text-[10px]" style={{ color: "var(--accent-red)" }}>already over {fmt(alreadyOver)}</span>}
              </span>
            ) : (
              <span className="text-sm font-semibold" style={{ color: totalRemForView >= 0 ? "var(--accent-green)" : "var(--accent-red)" }}>
                {totalRemForView >= 0 ? fmt(totalRemForView) + " left" : fmt(-totalRemForView) + " over"}
              </span>
            )}
          </div>
          <div className="progress-track" style={{ height: "6px" }}>
            <div className={`progress-fill ${totalPctForView >= 90 ? "progress-fill-red" : totalPctForView >= 75 ? "progress-fill-yellow" : "progress-fill-green"}`}
              style={{ width: `${Math.min(totalPctForView, 100)}%`, height: "6px" }} />
          </div>
          </>)}
          {isYearlyView && <PeriodChips on={yearlyListMonthOnly} onChange={setYearlyListMonthOnly} />}
        </div>

        {/* This month: one row per yearly category paid in the month being viewed.
            Same rows as Planned vs Spent; the bar is the category's share of the month
            (yearly categories have no monthly cap). */}
        {monthOnly && (() => {
          const byCat = new Map<string, { spent: number; count: number }>();
          for (const t of yearlyThisMonth) {
            const k = t.category || "";
            const e = byCat.get(k) ?? { spent: 0, count: 0 };
            e.spent += Number(t.amount); e.count += 1;
            byCat.set(k, e);
          }
          const rows = yearlyCategories
            .filter((c) => byCat.has(c.name))
            .sort((a, b) => byCat.get(b.name)!.spent - byCat.get(a.name)!.spent);
          return (
            <div className="flex-1 overflow-y-auto">
              {rows.length === 0 && (
                <div className="p-8 text-center text-sm" style={{ color: "var(--text-tertiary)" }}>No yearly expenses this month</div>
              )}
              {rows.map((cat) => {
                const { spent, count } = byCat.get(cat.name)!;
                const share = yearlyThisMonthTotal > 0 ? (spent / yearlyThisMonthTotal) * 100 : 0;
                return (
                  <div key={cat.id} className="px-5 py-3" style={{ borderBottom: "1px solid var(--border)", cursor: "pointer" }}
                    onClick={() => { setShowComparison(false); setDrillDownId(cat.id); }}>
                    <div className="flex justify-between items-baseline mb-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{cat.name}</span>
                        {isPrimary && onToggleLock ? (
                          <button
                            className={`badge text-[10px] py-0 cursor-pointer ${lockedNames?.has(cat.name) ? "badge-orange" : "badge-muted"}`}
                            title={lockedNames?.has(cat.name) ? "Locked: tap to allow new expenses" : "Lock: no new expenses"}
                            onClick={(e) => { e.stopPropagation(); onToggleLock(cat.name); }}
                          >
                            {lockedNames?.has(cat.name) ? "🔒 Unlock" : "🔓 Lock"}
                          </button>
                        ) : lockedNames?.has(cat.name) ? (
                          <span className="badge badge-orange text-[9px] py-0">🔒</span>
                        ) : null}
                      </div>
                      <span className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
                        {count} txn{count !== 1 ? "s" : ""}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex-1">
                        <div className="progress-track" style={{ height: "5px" }}>
                          <div className="progress-fill" style={{ width: `${share}%`, height: "5px", background: "var(--accent)" }} />
                        </div>
                      </div>
                      <span className="text-xs shrink-0" style={{ color: "var(--text-tertiary)" }}>
                        {fmt(spent)} · {Math.round(share)}% of month
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}

        {/* Per-category list */}
        {!monthOnly && <div className="flex-1 overflow-y-auto">
          {(() => {
          // Paid once a month and already paid: tucked into one line at the bottom
          const paidOnce = isYearlyView ? [] : sortedCats.filter((c) => oneTimeIds?.has(c.id) && (categorySpend.get(c.name) || 0) > 0);
          const paidOnceIds = new Set(paidOnce.map((c) => c.id));
          const shown = sortedCats.filter((c) => !paidOnceIds.has(c.id));
          const renderRow = (cat: Category) => {
            const eCap = getEffectiveCap(cat);
            const spent = categorySpend.get(cat.name) || 0;
            const noCap = eCap === 0 && cat.cap === 0 && monthlyOverrides[cat.id] == null;
            const pct = eCap > 0 ? Math.min((spent / eCap) * 100, 100) : 0;
            const rem = eCap - spent;
            const isOver = !noCap && spent > eCap;
            const fillClass = pct >= 90 ? "progress-fill-red" : pct >= 75 ? "progress-fill-yellow" : "progress-fill-green";
            const accentColor = noCap ? "var(--text-secondary)" : isOver ? "var(--accent-red)" : pct >= 75 ? "var(--accent-orange)" : "var(--accent-green)";
            const hasMonthOverride = monthlyOverrides[cat.id] != null;
            const isEditingRow = editingRowCatId === cat.id;
            // Month-specific editing only makes sense in the monthly view
            const canEditMonthCap = isPrimary && !isYearlyView;

            const commitRowEdit = () => {
              const newCap = Number(rowCapInput);
              if (isNaN(newCap) || newCap < 0) {
                setEditingRowCatId(null);
                setRowCapInput("");
                return;
              }
              onMonthlyOverride(cat.id, newCap);
              if (isSoftLocked(cat)) onSoftLockCat?.(cat.id, false);
              setEditingRowCatId(null);
              setRowCapInput("");
            };

            return (
              <div key={cat.id} className="px-5 py-3" style={{ borderBottom: "1px solid var(--border)", cursor: isEditingRow ? "default" : "pointer" }}
                onClick={() => { if (!isEditingRow) { closeComparison(); setDrillDownId(cat.id); } }}>
                <div className="flex justify-between items-baseline mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{cat.name}</span>
                    {hasMonthOverride && !isYearlyView && (
                      <span className="badge badge-orange text-[9px] py-0">This Mo</span>
                    )}
                    {!isYearlyView && softLock && isPrimary && onSoftLockCat && softLockable(cat) && (
                      isSoftLocked(cat) ? (
                        <button className="badge text-[10px] py-0 cursor-pointer"
                          style={{ background: "rgba(167,139,250,0.15)", color: "#a78bfa", border: "1px solid rgba(167,139,250,0.3)" }}
                          title="Soft-locked: its leftover counts as ₹0. Tap to open it for this month."
                          onClick={(e) => { e.stopPropagation(); onSoftLockCat(cat.id, false); }}>◐ Soft</button>
                      ) : (
                        <button className="badge text-[10px] py-0 cursor-pointer"
                          style={{ background: "rgba(52,211,153,0.12)", color: "var(--accent-green)", border: "1px solid rgba(52,211,153,0.3)" }}
                          title="Open this month. Tap to soft-lock it again."
                          onClick={(e) => { e.stopPropagation(); onSoftLockCat(cat.id, true); }}>Open</button>
                      )
                    )}
                    {isPrimary && onToggleLock ? (
                      <button
                        className={`badge text-[10px] py-0 cursor-pointer ${lockedNames?.has(cat.name) ? "badge-orange" : "badge-muted"}`}
                        title={lockedNames?.has(cat.name) ? "Locked: tap to allow new expenses" : "Lock: no new expenses"}
                        onClick={(e) => { e.stopPropagation(); onToggleLock(cat.name); }}
                      >
                        {lockedNames?.has(cat.name) ? "🔒 Unlock" : "🔓 Lock"}
                      </button>
                    ) : lockedNames?.has(cat.name) ? (
                      <span className="badge badge-orange text-[9px] py-0">🔒</span>
                    ) : null}
                  </div>
                  {noCap ? (
                    <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>no cap</span>
                  ) : (
                    <span className="text-xs font-semibold" style={{ color: accentColor }}>
                      {isOver ? fmt(-rem) + " over" : fmt(rem) + " left"}
                    </span>
                  )}
                </div>

                {noCap ? (
                  <span className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{fmt(spent)}</span>
                ) : (
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <div className="progress-track" style={{ height: "5px" }}>
                        <div className={`progress-fill ${fillClass}`} style={{ width: `${Math.min(pct, 100)}%`, height: "5px" }} />
                      </div>
                    </div>
                    {isEditingRow ? (
                      <input
                        type="number"
                        className="text-xs shrink-0 w-20 px-2 py-0.5 rounded-md"
                        style={{ background: "var(--bg-base)", border: "1px solid var(--accent)", color: "var(--text-primary)" }}
                        value={rowCapInput}
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setRowCapInput(e.target.value)}
                        onBlur={commitRowEdit}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { e.preventDefault(); commitRowEdit(); }
                          else if (e.key === "Escape") { setEditingRowCatId(null); setRowCapInput(""); }
                        }}
                      />
                    ) : (
                      <span
                        className="text-xs shrink-0"
                        style={{ color: "var(--text-tertiary)", textDecoration: canEditMonthCap ? "underline dotted" : "none", textUnderlineOffset: "3px" }}
                        onClick={(e) => {
                          if (!canEditMonthCap) return;
                          e.stopPropagation();
                          setEditingRowCatId(cat.id);
                          setRowCapInput(String(hasMonthOverride ? monthlyOverrides[cat.id] : cat.cap));
                        }}
                        title={canEditMonthCap ? "Tap to set this month's cap" : undefined}
                      >
                        {fmt(spent)} / {fmt(eCap)}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          };
          return (
            <>
              {shown.map(renderRow)}
              {paidOnce.length > 0 && (
                <button type="button" className="w-full flex justify-between items-center px-5 py-3 border-0 cursor-pointer"
                  style={{ background: "rgba(255,255,255,0.02)", borderBottom: "1px solid var(--border)" }}
                  onClick={() => setShowPaidOnce(!showPaidOnce)}>
                  <span className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
                    ✓ Paid once a month, done · {paidOnce.length}
                    <span className="font-normal" style={{ color: "var(--text-tertiary)" }}> ({paidOnce.map((c) => c.name).join(", ")})</span>
                  </span>
                  <span className="text-xs shrink-0 ml-2" style={{ color: "var(--text-tertiary)" }}>
                    {fmt(paidOnce.reduce((s, c) => s + (categorySpend.get(c.name) || 0), 0))} {showPaidOnce ? "▴" : "▾"}
                  </span>
                </button>
              )}
              {showPaidOnce && paidOnce.map(renderRow)}
            </>
          );
          })()}
        </div>}
      </div>
    );
  }

  // ═══════════════════════════════════
  // All-expenses list overlay (monthly or yearly)
  // ═══════════════════════════════════
  function AllExpensesOverlay({ title, txns, yearlyTxns = [], thisMonth, onClose }: {
    title: string; txns: Transaction[]; yearlyTxns?: Transaction[];
    /** Yearly list: a "This month" option that lists only the month being viewed. */
    thisMonth?: { label: string; txns: Transaction[]; on: boolean; onChange: (on: boolean) => void };
    onClose: () => void;
  }) {
    if (thisMonth?.on) txns = thisMonth.txns;
    // Yearly payments made this month are listed too, but kept out of the month's total
    const yearlyIds = new Set(yearlyTxns.map((t) => t.id));
    const sorted = [...txns, ...yearlyTxns].sort((a, b) => b.sms_date - a.sms_date);
    const total = txns.reduce((s, t) => s + Number(t.amount), 0);
    const yearlyTotal = yearlyTxns.reduce((s, t) => s + Number(t.amount), 0);
    return (
      <div className="fixed inset-0 z-50 flex flex-col animate-fade-in" style={{ background: "var(--bg-base)" }}>
        {/* Header */}
        <div className="shrink-0 px-5 pt-5 pb-4" style={{ background: "var(--bg-elevated)", borderBottom: "1px solid var(--border)" }}>
          <div className="flex justify-between items-center mb-4">
            <button className="flex items-center gap-1.5 text-sm font-medium" style={{ color: "var(--accent)" }}
              onClick={onClose}>
              <span>←</span> Back
            </button>
          </div>
          <div className="text-lg font-bold mb-1" style={{ color: "var(--text-primary)" }}>{title}</div>
          <div className="flex justify-between items-baseline mt-2">
            <span className="text-2xl font-bold amount-debit">{fmt(total)}</span>
            <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>{sorted.length} transaction{sorted.length !== 1 ? "s" : ""}</span>
          </div>
          {yearlyTxns.length > 0 && (
            <div className="text-[11px] mt-1" style={{ color: "var(--text-tertiary)" }}>
              + {fmt(yearlyTotal)} of yearly expenses paid this month (counted in the yearly budget)
            </div>
          )}
          {thisMonth && <PeriodChips on={thisMonth.on} onChange={thisMonth.onChange} />}
        </div>
        {/* Scrollable list */}
        <div className="flex-1 overflow-y-auto">
          {sorted.length === 0 ? (
            <div className="p-8 text-center text-sm" style={{ color: "var(--text-tertiary)" }}>{thisMonth?.on ? "No yearly expenses this month" : "No expenses yet"}</div>
          ) : (
            sorted.map((txn) => {
              const catName = txn.category || "";
              return (
                <div key={txn.id} style={{ borderBottom: "1px solid var(--border)" }}>
                  {catName && (
                    <div className="px-5 pt-2 text-[10px] font-semibold tracking-wider" style={{ color: "var(--text-tertiary)" }}>
                      {catName}
                      {yearlyIds.has(txn.id) && (
                        <span className="ml-1.5 px-1.5 py-px rounded-full text-[9px]"
                          style={{ background: "rgba(123,108,246,0.15)", color: "var(--accent)" }}>YEARLY</span>
                      )}
                    </div>
                  )}
                  <ExpenseRow txn={txn} currentCatName={catName} />
                </div>
              );
            })
          )}
        </div>
      </div>
    );
  }

  const allMonthlyTxns = useMemo(() =>
    monthlyCategories.flatMap((c) => categoryTxns.get(c.name) || []),
    [monthlyCategories, categoryTxns]
  );
  const allYearlyTxns = useMemo(() =>
    yearlyCategories.flatMap((c) => categoryTxns.get(c.name) || []),
    [yearlyCategories, categoryTxns]
  );
  // Yearly payments made in the month being viewed (shown with the month, not in its budget)
  const yearlyThisMonth = useMemo(() =>
    allYearlyTxns.filter((t) => {
      const d = new Date(t.sms_date);
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    }),
    [allYearlyTxns, currentMonth, currentYear]
  );
  const yearlyThisMonthTotal = yearlyThisMonth.reduce((s, t) => s + Number(t.amount), 0);

  // ═══════════════════════════════════
  // Category card (normal + edit)
  // ═══════════════════════════════════
  function CategoryCard({ cat, index }: { cat: Category; index: number }) {
    const effectiveCap = getEffectiveCap(cat);
    const hasMonthOverride = monthlyOverrides[cat.id] != null;
    const isNoCap = effectiveCap === 0 && cat.cap === 0 && !hasMonthOverride;
    const spent = categorySpend.get(cat.name) || 0;
    const remaining = effectiveCap - spent;
    const pct = effectiveCap > 0 ? Math.min((spent / effectiveCap) * 100, 100) : 0;
    const remainingPct = Math.max(100 - pct, 0);
    const fillClass = pct >= 90 ? "progress-fill-red" : pct >= 75 ? "progress-fill-yellow" : "progress-fill-green";
    const accentColor = isNoCap ? "var(--text-secondary)" : pct >= 90 ? "var(--accent-red)" : pct >= 75 ? "var(--accent-orange)" : "var(--accent-green)";
    const isEditing = editingId === cat.id;
    const txnsForCat = categoryTxns.get(cat.name) || [];

    // ── Edit Mode ──
    if (isEditing) {
      return (
        <div className="card p-4 animate-scale-in glow-accent" style={{ animationDelay: `${index * 50}ms` }}>
          <div className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>{cat.name}</div>

          {cat.recurrence === "Monthly" && (
            <>
              <div className="section-label mb-1.5">Apply to</div>
              <div className="flex gap-1.5 mb-3">
                {([
                  { value: "general" as const, label: "General" },
                  { value: "month" as const, label: "This Month" },
                ]).map((opt) => (
                  <button
                    key={opt.value}
                    className={`flex-1 py-1.5 rounded-lg text-[11px] font-semibold transition-all ${editMode === opt.value ? (opt.value === "month" ? "btn-orange" : "btn-primary") : "btn-ghost"}`}
                    onClick={() => {
                      setEditMode(opt.value);
                      if (opt.value === "general") setEditCap(String(cat.cap));
                      else setEditCap(String(monthlyOverrides[cat.id] ?? cat.cap));
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="section-label mb-1.5">
            {editMode === "month" ? "Cap for this month" : "Cap"} <span className="text-[10px] font-normal" style={{ color: "var(--text-tertiary)" }}>(0 = no cap)</span>
          </div>
          <div className="relative mb-3">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: "var(--text-tertiary)" }}>₹</span>
            <input
              type="number"
              className="w-full pl-7 pr-3 py-2 text-sm rounded-xl"
              value={editCap}
              onChange={(e) => setEditCap(e.target.value)}
              autoFocus
            />
          </div>

          <div className="section-label mb-1.5">Visible to</div>
          <div className="flex gap-1.5 mb-3">
            {([
              { value: "all" as const, label: "Both" },
              { value: "primary" as const, label: "Me" },
              { value: "secondary" as const, label: "Wife" },
            ]).map((opt) => (
              <button
                key={opt.value}
                className={`flex-1 py-1.5 rounded-lg text-[11px] font-semibold transition-all ${editVisibility === opt.value ? "btn-primary" : "btn-ghost"}`}
                onClick={() => setEditVisibility(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {isPrimary && onSaveExpectedDebit && (
            <>
              <div className="section-label mb-1.5">
                Auto-debit <span className="text-[10px] font-normal" style={{ color: "var(--text-tertiary)" }}>(its SMS is filed here by itself · warns if it doesn&apos;t show up · blank = off)</span>
              </div>
              <div className="flex gap-2 mb-3">
                <input
                  type="number"
                  min={1}
                  max={31}
                  placeholder="Day"
                  className="w-20 px-3 py-2 text-sm rounded-xl"
                  value={editDueDay}
                  onChange={(e) => setEditDueDay(e.target.value)}
                />
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: "var(--text-tertiary)" }}>₹</span>
                  <input
                    type="number"
                    placeholder={String(cat.cap)}
                    className="w-full pl-7 pr-3 py-2 text-sm rounded-xl"
                    value={editDueAmount}
                    onChange={(e) => setEditDueAmount(e.target.value)}
                  />
                </div>
              </div>
            </>
          )}

          {isPrimary && onToggleLock && (
            <>
              <div className="section-label mb-1.5">New expenses</div>
              <button
                className="w-full py-1.5 mb-3 rounded-lg text-[11px] font-semibold btn-ghost"
                style={lockedNames?.has(cat.name) ? { color: "var(--accent-orange)" } : undefined}
                onClick={() => onToggleLock(cat.name)}
              >
                {lockedNames?.has(cat.name) ? "🔒 Locked · tap to unlock" : "🔓 Open · tap to lock"}
              </button>
            </>
          )}

          <div className="flex gap-2">
            <button
              className="flex-1 py-2 btn-primary text-xs rounded-xl disabled:opacity-35"
              disabled={savingEdit}
              onClick={() => saveEdit(cat)}
            >
              {savingEdit ? "..." : "✓ Save"}
            </button>
            <button className="px-4 py-2 btn-ghost text-xs rounded-xl" onClick={() => setEditingId(null)}>
              Cancel
            </button>
          </div>
        </div>
      );
    }

    // ── Normal Card ──
    return (
      <div className="card p-4 animate-slide-up" style={{ animationDelay: `${index * 50}ms` }}
        onClick={() => setDrillDownId(cat.id)}>
        <div className="flex justify-between items-start mb-2.5">
          <div className="flex items-center gap-2">
            <div className="text-sm font-semibold leading-tight" style={{ color: "var(--text-primary)" }}>{cat.name}</div>
            {isPrimary && cat.visible_to !== "all" && (
              <span className={`badge text-[9px] py-0 ${cat.visible_to === "primary" ? "badge-purple" : "badge-green"}`}>
                {cat.visible_to === "primary" ? "Me" : "Wife"}
              </span>
            )}
            {lockedNames?.has(cat.name) && (
              <span className="badge badge-orange text-[9px] py-0">🔒</span>
            )}
          </div>
          {hasMonthOverride && <span className="badge badge-orange text-[9px] py-0">This Mo</span>}
        </div>

        {isNoCap ? (
          <div className="flex justify-between items-baseline mb-2">
            <span className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>{fmt(spent)}</span>
            <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>no cap · {txnsForCat.length} txn{txnsForCat.length !== 1 ? "s" : ""}</span>
          </div>
        ) : isPrimary ? (
          <div className="flex justify-between items-baseline mb-2">
            <div>
              <span className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>{fmt(spent)}</span>
              <span className="text-xs ml-1" style={{ color: "var(--text-tertiary)" }}>/ {fmt(effectiveCap)}</span>
              {hasMonthOverride && (
                <span className="text-[10px] ml-1" style={{ color: "var(--accent-orange)" }}>(gen: {fmt(cat.cap)})</span>
              )}
              {!hasMonthOverride && scaleFactor < 1 && cat.recurrence === "Monthly" && (
                <span className="text-[10px] ml-1" style={{ color: "var(--accent-orange)" }}>({fmt(cat.cap)})</span>
              )}
            </div>
            <span className="text-xs font-semibold" style={{ color: accentColor }}>
              {remaining >= 0 ? fmt(remaining) + " left" : fmt(-remaining) + " over"}
            </span>
          </div>
        ) : (
          <div className="flex justify-between items-baseline mb-2">
            <span className="text-lg font-bold" style={{ color: accentColor }}>
              {remainingPct > 0 ? pctFmt(remainingPct) + " left" : "Budget exceeded"}
            </span>
            <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>
              {pctFmt(pct)} used
            </span>
          </div>
        )}

        {!isNoCap && (
          <div className="progress-track">
            <div className={`progress-fill ${fillClass}`} style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      {/* Full-screen drill-down overlay */}
      <DrillDownOverlay />
      {/* Planned vs Spent comparison overlay */}
      <ComparisonOverlay />
      {/* Monthly flat list overlay */}
      {showMonthlyList && (
        <AllExpensesOverlay
          title={new Date(viewYear, viewMonth, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" }) + " Expenses"}
          txns={allMonthlyTxns}
          yearlyTxns={yearlyThisMonth}
          onClose={() => setShowMonthlyList(false)}
        />
      )}
      {/* Yearly flat list overlay */}
      {showYearlyList && (
        <AllExpensesOverlay
          title={yearlyListMonthOnly
            ? new Date(viewYear, viewMonth, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" }) + " · Yearly Expenses"
            : String(currentYear) + " Yearly Expenses"}
          txns={allYearlyTxns}
          thisMonth={{
            label: "This month (" + new Date(viewYear, viewMonth, 1).toLocaleDateString("en-IN", { month: "short" }) + ")",
            txns: yearlyThisMonth, on: yearlyListMonthOnly, onChange: setYearlyListMonthOnly,
          }}
          onClose={() => { setShowYearlyList(false); setYearlyListMonthOnly(false); }}
        />
      )}

      {/* Active days control — compact, only when needed */}
      {showActiveDays && isPrimary && (
        <div className="flex items-center justify-between px-3 py-2 mb-3 rounded-xl animate-fade-in"
          style={{ background: isScaled ? "rgba(255,179,71,0.08)" : "rgba(255,255,255,0.03)", border: `1px solid ${isScaled ? "rgba(255,179,71,0.15)" : "var(--border)"}` }}>
          <span className="text-xs font-medium" style={{ color: isScaled ? "var(--accent-orange)" : "var(--text-tertiary)" }}>
            Active Days
          </span>
          <div className="flex items-center gap-2">
            <button className="w-7 h-7 rounded-lg flex items-center justify-center text-sm font-bold btn-ghost"
              onClick={() => onActiveDaysUpdate(Math.max(1, activeDays - 1))}>−</button>
            <span className="text-sm font-bold min-w-[3ch] text-center" style={{ color: isScaled ? "var(--accent-orange)" : "var(--text-primary)" }}>
              {activeDays}
            </span>
            <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>/ {daysInMonth}</span>
            <button className="w-7 h-7 rounded-lg flex items-center justify-center text-sm font-bold btn-ghost"
              onClick={() => onActiveDaysUpdate(Math.min(daysInMonth, activeDays + 1))}>+</button>
            {isScaled && (
              <button className="text-[10px] font-semibold px-2 py-1 rounded-lg"
                style={{ color: "var(--accent-orange)", background: "rgba(255,179,71,0.1)" }}
                onClick={() => { onActiveDaysUpdate(daysInMonth); setShowActiveDays(false); }}>
                Reset
              </button>
            )}
            <button className="text-[10px] font-semibold px-2 py-1 rounded-lg btn-ghost"
              onClick={() => setShowActiveDays(false)}>
              Done
            </button>
          </div>
        </div>
      )}

      {/* ═══ Monthly Bubble Basket with integrated summary ═══ */}
      {monthlyCategories.length > 0 && (
        <div className="card p-4 mb-4 animate-slide-up">
          {/* Month label + active days toggle */}
          <div className="flex items-center justify-between mb-3 px-1">
            <button className="flex items-center gap-2"
              onClick={() => { if (isPrimary) setShowActiveDays(!showActiveDays); }}>
              <span className="text-xs font-bold tracking-wider" style={{ color: "var(--text-secondary)" }}>
                {new Date(viewYear, viewMonth, 1).toLocaleDateString("en-IN", { month: "short", year: "numeric" }).toUpperCase()}
              </span>
              {isScaled && (
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                  style={{ background: "rgba(255,179,71,0.12)", color: "var(--accent-orange)", border: "1px solid rgba(255,179,71,0.2)" }}>
                  {activeDays}d
                </span>
              )}
            </button>
            {canSoftLock && (
              softLock ? (
                <span className="flex items-center gap-1.5">
                  <button className="badge text-[10px] cursor-pointer"
                    style={{ background: "rgba(167,139,250,0.15)", color: "#a78bfa", border: "1px solid rgba(167,139,250,0.3)" }}
                    onClick={() => setShowComparison("monthly")}>
                    ◐ Soft lock on · {softOpenCount} open ›
                  </button>
                  <button className="badge text-[10px] cursor-pointer badge-muted"
                    onClick={() => {
                      if (softOffArmed) { setSoftOffArmed(false); onSoftLockToggle!(false); return; }
                      setSoftOffArmed(true); setTimeout(() => setSoftOffArmed(false), 4000);
                    }}>
                    {softOffArmed ? "Tap again to turn off" : "Off"}
                  </button>
                </span>
              ) : (
                <button className="badge text-[10px] cursor-pointer badge-muted"
                  title="Count every category's leftover as ₹0, then open the ones you'll really spend"
                  onClick={() => { onSoftLockToggle!(true); setShowComparison("monthly"); }}>
                  ◐ Soft lock
                </button>
              )
            )}
          </div>
          {/* Inline summary row */}
          <div className="flex justify-between items-center mb-3 px-1" style={{ cursor: "pointer" }} onClick={() => setShowMonthlyList(true)}>
            {isPrimary ? (
              <>
                <div>
                  <div className="section-label mb-0.5">Spent</div>
                  <div className="text-lg font-extrabold amount-debit">{fmt(totalSpent)}</div>
                </div>
                <div className="text-center flex-1 mx-4">
                  <div className="progress-track" style={{ height: "5px", borderRadius: 3 }}>
                    <div className={`progress-fill ${totalPct >= 90 ? "progress-fill-red" : totalPct >= 75 ? "progress-fill-yellow" : "progress-fill-green"}`}
                      style={{ width: `${Math.min(totalPct, 100)}%`, height: "5px", borderRadius: 3 }} />
                  </div>
                  <div className="text-[9px] mt-1 font-semibold" style={{ color: "var(--text-tertiary)" }}>
                    {pctFmt(totalPct)} of {fmt(totalCap)}
                  </div>
                </div>
                {softActive ? (
                  <div className="text-right">
                    <div className="section-label mb-0.5">To arrange</div>
                    <div className="text-lg font-extrabold" style={{ color: "var(--accent-green)" }}>{fmt(toArrange)}</div>
                    {alreadyOver > 0 && (
                      <div className="text-[10px] font-semibold" style={{ color: "var(--accent-red)" }}>already over {fmt(alreadyOver)}</div>
                    )}
                  </div>
                ) : (
                  <div className="text-right">
                    <div className="section-label mb-0.5">Left</div>
                    <div className="text-lg font-extrabold" style={{ color: totalRemaining >= 0 ? "var(--accent-green)" : "var(--accent-red)" }}>
                      {totalRemaining >= 0 ? fmt(totalRemaining) : "-" + fmt(-totalRemaining)}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                <div>
                  <div className="section-label mb-0.5">Budget Left</div>
                  <div className="text-lg font-extrabold" style={{ color: totalRemainingPct > 25 ? "var(--accent-green)" : totalRemainingPct > 10 ? "var(--accent-orange)" : "var(--accent-red)" }}>
                    {pctFmt(totalRemainingPct)}
                  </div>
                </div>
                <div className="flex-1 mx-4">
                  <div className="progress-track" style={{ height: "5px", borderRadius: 3 }}>
                    <div className={`progress-fill ${totalPct >= 90 ? "progress-fill-red" : totalPct >= 75 ? "progress-fill-yellow" : "progress-fill-green"}`}
                      style={{ width: `${Math.min(totalPct, 100)}%`, height: "5px", borderRadius: 3 }} />
                  </div>
                </div>
                <div className="text-lg" style={{ color: "var(--text-tertiary)" }}>
                  {totalRemainingPct > 50 ? "👍" : totalRemainingPct > 25 ? "🤔" : totalRemainingPct > 10 ? "😬" : "⚠️"}
                </div>
              </>
            )}
          </div>
          {yearlyThisMonth.length > 0 && (
            <button type="button" className="w-full text-left text-[11px] mb-3 px-1 bg-transparent border-0 cursor-pointer"
              style={{ color: "var(--text-tertiary)" }} onClick={() => setShowMonthlyList(true)}>
              + <span className="font-semibold" style={{ color: "var(--text-secondary)" }}>{fmt(yearlyThisMonthTotal)}</span> yearly
              expense{yearlyThisMonth.length !== 1 ? "s" : ""} paid this month
              ({[...new Set(yearlyThisMonth.map((t) => t.category))].join(", ")}) · not in this month&apos;s budget ›
            </button>
          )}
          {monthlyBubbles.length > 0 ? (
            <BubbleBasket bubbles={monthlyBubbles} onBasketClick={() => setShowComparison("monthly")} />
          ) : (
            <div className="text-center py-6 animate-fade-in">
              <div className="text-3xl mb-2">🌙</div>
              <div className="text-sm font-medium" style={{ color: "var(--text-tertiary)" }}>No expenses recorded yet this month</div>
            </div>
          )}
        </div>
      )}
      {/* F-7: Unused categories hidden from view */}

      {/* ═══ Monthly Categories — edit cards (only when editing) ═══ */}
      {editingId !== null && monthlyCategories.some((c) => c.id === editingId) && (
        <div className="grid grid-cols-1 gap-3 mb-6">
          {monthlyCategories.filter((c) => c.id === editingId).map((cat, i) => (
            <CategoryCard key={cat.id} cat={cat} index={i} />
          ))}
        </div>
      )}

      {/* ═══ Yearly Bubble Basket with integrated summary ═══ */}
      {yearlyCategories.length > 0 && (
        <>
          {yearlyBubbles.length > 0 && (
            <div className="card p-4 mb-4 animate-slide-up">
              {/* Year label */}
              <div className="flex items-center gap-1.5 mb-3 px-1">
                <span className="text-xs font-bold tracking-wider" style={{ color: "var(--text-secondary)" }}>
                  {currentYear}
                </span>
              </div>
              {/* Inline yearly summary — same layout as monthly */}
              <div className="flex justify-between items-center mb-3 px-1" style={{ cursor: "pointer" }} onClick={() => setShowYearlyList(true)}>
                {isPrimary ? (
                  <>
                    <div>
                      <div className="section-label mb-0.5">Spent</div>
                      <div className="text-lg font-extrabold amount-debit">{fmt(yearlyTotalSpent)}</div>
                    </div>
                    <div className="text-center flex-1 mx-4">
                      <div className="relative">
                        <div className="progress-track" style={{ height: "5px", borderRadius: 3 }}>
                          <div className={`progress-fill ${yearlyPct > yearlyExpectedPct ? "progress-fill-red" : yearlyPct > yearlyExpectedPct * 0.8 ? "progress-fill-yellow" : "progress-fill-green"}`}
                            style={{ width: `${yearlyPct}%`, height: "5px", borderRadius: 3 }} />
                        </div>
                        <div className="absolute top-0 h-1.5 w-0.5" style={{ left: `${yearlyExpectedPct}%`, background: "var(--text-tertiary)", opacity: 0.6 }} />
                      </div>
                      <div className="text-[9px] mt-1 font-semibold" style={{ color: "var(--text-tertiary)" }}>
                        {pctFmt(yearlyPct)} of {fmt(yearlyTotalCap)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="section-label mb-0.5">Left</div>
                      <div className="text-lg font-extrabold" style={{ color: yearlyRemaining >= 0 ? "var(--accent-green)" : "var(--accent-red)" }}>
                        {yearlyRemaining >= 0 ? fmt(yearlyRemaining) : "-" + fmt(-yearlyRemaining)}
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <div className="section-label mb-0.5">Budget Left</div>
                      <div className="text-lg font-extrabold" style={{ color: yearlyOnTrack ? "var(--accent-green)" : "var(--accent-red)" }}>
                        {pctFmt(Math.max(100 - yearlyPct, 0))}
                      </div>
                    </div>
                    <div className="flex-1 mx-4">
                      <div className="relative">
                        <div className="progress-track" style={{ height: "5px", borderRadius: 3 }}>
                          <div className={`progress-fill ${yearlyPct > yearlyExpectedPct ? "progress-fill-red" : yearlyPct > yearlyExpectedPct * 0.8 ? "progress-fill-yellow" : "progress-fill-green"}`}
                            style={{ width: `${yearlyPct}%`, height: "5px", borderRadius: 3 }} />
                        </div>
                        <div className="absolute top-0 h-1.5 w-0.5" style={{ left: `${yearlyExpectedPct}%`, background: "var(--text-tertiary)", opacity: 0.6 }} />
                      </div>
                    </div>
                    <div className="text-lg" style={{ color: "var(--text-tertiary)" }}>
                      {(100 - yearlyPct) > 50 ? "👍" : (100 - yearlyPct) > 25 ? "🤔" : (100 - yearlyPct) > 10 ? "😬" : "⚠️"}
                    </div>
                  </>
                )}
              </div>
              <BubbleBasket bubbles={yearlyBubbles} onBasketClick={() => setShowComparison("yearly")} />
            </div>
          )}

          {/* Yearly edit card (only when editing) */}
          {editingId !== null && yearlyCategories.some((c) => c.id === editingId) && (
            <div className="grid grid-cols-1 gap-3 mb-6">
              {yearlyCategories.filter((c) => c.id === editingId).map((cat, i) => (
                <CategoryCard key={cat.id} cat={cat} index={i} />
              ))}
            </div>
          )}
        </>
      )}

    </div>
  );
}

export default React.memo(CategoryBudget);
