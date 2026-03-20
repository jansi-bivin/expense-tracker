"use client";

import React, { useMemo, useState } from "react";
import { supabase, Transaction, Category } from "@/lib/supabase";
import BubbleBasket from "./BubbleBasket";
interface Props {
  transactions: Transaction[];
  categories: Category[];
  isPrimary: boolean;
  scaleFactor: number;
  monthlyOverrides: Record<number, number>;
  onCategoriesChange: (cats: Category[]) => void;
  onShowAddCategory: () => void;
  onMonthlyOverride: (catId: number, cap: number | null) => void;
  activeDays: number;
  daysInMonth: number;
  onActiveDaysUpdate: (days: number) => void;
  onReclassify?: (txnId: number, newCategory: string) => void;
  onDeleteTxn?: (txnId: number) => void;
  dues?: { id: number; transaction_id: number; cleared: boolean; settlement_transaction_id?: number | null }[];
}

function CategoryBudget({ transactions, categories, isPrimary, scaleFactor, monthlyOverrides, onCategoriesChange, onShowAddCategory, onMonthlyOverride, activeDays, daysInMonth, onActiveDaysUpdate, onReclassify, onDeleteTxn, dues }: Props) {
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [drillDownId, setDrillDownId] = useState<number | null>(null);
  const [editCap, setEditCap] = useState("");
  const [editVisibility, setEditVisibility] = useState<"all" | "primary" | "secondary">("all");
  const [editMode, setEditMode] = useState<"general" | "month">("general");
  const [savingEdit, setSavingEdit] = useState(false);
  const [showActiveDays, setShowActiveDays] = useState(false);
  const isScaled = activeDays !== daysInMonth;

  const fmt = (n: number) => "\u20B9" + n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const fmtDec = (n: number) => "\u20B9" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pctFmt = (n: number) => Math.round(n) + "%";
  const fmtDate = (ts: number) => new Date(ts).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });

  const visibleCategories = useMemo(() => {
    return categories.filter((c) =>
      isPrimary || c.visible_to === "all" || c.visible_to === "secondary"
    );
  }, [categories, isPrimary]);

  const categoryTxns = useMemo(() => {
    const map = new Map<string, Transaction[]>();
    for (const txn of transactions) {
      if (!txn.category || !txn.amount) continue;
      const cat = visibleCategories.find((c) => c.name === txn.category);
      if (!cat) continue;
      const d = new Date(txn.sms_date);
      const inPeriod = cat.recurrence === "Monthly"
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
    const hasOverride = monthlyOverrides[cat.id] != null;
    if (hasOverride) return monthlyOverrides[cat.id];
    if (cat.cap === 0) return 0;
    return cat.recurrence === "Monthly" ? cat.cap * scaleFactor : cat.cap;
  }

  // Sort categories: most spend first, then alphabetical for zero-spend
  function sortByActivity(cats: Category[]): Category[] {
    return [...cats].sort((a, b) => {
      const spendA = categorySpend.get(a.name) || 0;
      const spendB = categorySpend.get(b.name) || 0;
      if (spendA !== spendB) return spendB - spendA;
      return a.name.localeCompare(b.name);
    });
  }

  const monthlyCategories = sortByActivity(visibleCategories.filter((c) => c.recurrence === "Monthly"));
  const yearlyCategories = sortByActivity(visibleCategories.filter((c) => c.recurrence === "Yearly"));

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

  // Yearly totals
  const yearlyTotalCap = useMemo(() => {
    return yearlyCategories.reduce((sum, c) => c.cap > 0 ? sum + c.cap : sum, 0);
  }, [yearlyCategories]);
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
      const eCap = yearly ? c.cap : getEffectiveCap(c);
      const noCap = yearly ? c.cap === 0 : (eCap === 0 && c.cap === 0 && monthlyOverrides[c.id] == null);
      const pct = eCap > 0 ? (spent / eCap) * 100 : 0;
      const isOver = !noCap && spent > eCap;
      const norm = range > 0 ? Math.sqrt((spent - minS) / range) : (cats.length === 1 ? 1 : 0.5);
      let size = MIN + norm * (MAX - MIN);
      if (isOver) size = Math.min(size * 1.15, MAX * 1.2);
      const color = noCap ? "rgba(123,108,246,0.7)" : pct > 100 ? "#f87171" : pct > 75 ? "#fbbf24" : "#4ade80";
      const bgColor = noCap ? "rgba(123,108,246,0.1)" : pct > 100 ? "rgba(248,113,113,0.12)" : pct > 75 ? "rgba(251,191,36,0.1)" : "rgba(74,222,128,0.08)";
      const rem = eCap - spent;
      return {
        id: c.id, label: c.name, amount: fmt(spent),
        detail: noCap ? undefined : (isOver ? `${fmt(-rem)} over` : `${fmt(rem)} left`),
        isOver, color, bgColor, size: Math.round(size),
        onClick: () => setDrillDownId(c.id),
      };
    });
  }

  const monthlyBubbles = buildBubbles(monthlyActiveCats);
  const yearlyBubbles = buildBubbles(yearlyActiveCats, true);

  function startEdit(cat: Category) {
    if (!isPrimary) return;
    setEditingId(cat.id);
    const hasOverride = monthlyOverrides[cat.id] != null;
    setEditMode(hasOverride ? "month" : "general");
    setEditCap(String(hasOverride ? monthlyOverrides[cat.id] : cat.cap));
    setEditVisibility(cat.visible_to);
  }

  async function saveEdit(cat: Category) {
    const newCap = Number(editCap);
    if (newCap < 0) return;
    setSavingEdit(true);
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
    const merchant = txn.merchant || (isManual ? "Manual Entry" : "Unknown");
    const hasNotes = txn.notes && txn.notes.trim().length > 0;
    const hasRawSms = !isManual && txn.body && txn.body.length > 0;

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
          {isPrimary && onReclassify && (
            <button
              className="text-[10px] shrink-0 px-1.5 py-0.5 rounded-md"
              style={{ color: "var(--accent)", background: "rgba(123,108,246,0.08)" }}
              onClick={(e) => { e.stopPropagation(); setShowReclassify(!showReclassify); }}
            >
              ↔
            </button>
          )}
          {/* B2: Delete button for manual entries */}
          {isManual && isPrimary && onDeleteTxn && (
            <button
              className="text-[10px] shrink-0 px-1.5 py-0.5 rounded-md"
              style={{ color: "var(--accent-red)", background: "rgba(255,90,110,0.08)" }}
              onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
            >
              ×
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
                if (e.target.value) {
                  onReclassify(txn.id, e.target.value);
                  setShowReclassify(false);
                }
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
    const txnsForCat = (categoryTxns.get(cat.name) || []).sort((a, b) => b.sms_date - a.sms_date);

    return (
      <div className="fixed inset-0 z-50 flex flex-col animate-fade-in" style={{ background: "var(--bg-base)" }}>
        {/* ── Sticky Header ── */}
        <div className="shrink-0 px-5 pt-5 pb-4" style={{ background: "var(--bg-elevated)", borderBottom: "1px solid var(--border)" }}>
          {/* Top bar */}
          <div className="flex justify-between items-center mb-4">
            <button
              className="flex items-center gap-1.5 text-sm font-medium"
              style={{ color: "var(--accent)" }}
              onClick={() => setDrillDownId(null)}
            >
              <span>←</span> Back
            </button>
            {isPrimary && (
              <button
                className="text-xs font-semibold px-3 py-1.5 rounded-lg btn-ghost"
                onClick={() => { startEdit(cat); setDrillDownId(null); }}
              >
                ✎ Edit
              </button>
            )}
          </div>

          {/* Category name */}
          <div className="text-lg font-bold mb-3" style={{ color: "var(--text-primary)" }}>{cat.name}</div>

          {isNoCap ? (
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
        </div>

        {/* ── Scrollable expense list ── */}
        <div className="flex-1 overflow-y-auto">
          {txnsForCat.length === 0 ? (
            <div className="p-8 text-center text-sm" style={{ color: "var(--text-tertiary)" }}>
              No expenses yet
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

      {/* ═══ Monthly Hero Card ═══ */}
      <div className="card-gradient-purple shimmer p-5 mb-6 animate-slide-up">
        <div className="flex items-center justify-between mb-3">
          <button
            className="flex items-center gap-2"
            onClick={() => { if (isPrimary) setShowActiveDays(!showActiveDays); }}
          >
            <span className="text-base">💰</span>
            <span className="section-label" style={{ color: "var(--accent-bright)" }}>
              {now.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}
            </span>
            {isScaled && (
              <span className="text-[10px] font-bold" style={{ color: "var(--accent-orange)" }}>
                {activeDays}d
              </span>
            )}
          </button>
        </div>

        {/* Active days — hidden by default, tap month to reveal */}
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

        {isPrimary ? (
          <div className="flex justify-between items-end mb-4">
            <div>
              <div className="text-[11px] font-medium mb-1" style={{ color: "var(--text-tertiary)" }}>Total Spent</div>
              <div className="amount-large amount-debit">{fmt(totalSpent)}</div>
              <div className="text-xs mt-1" style={{ color: "var(--text-tertiary)" }}>of {fmt(totalCap)} budget</div>
            </div>
            <div className="text-right">
              <div className="text-[11px] font-medium mb-1" style={{ color: "var(--text-tertiary)" }}>Remaining</div>
              <div className="text-2xl font-extrabold" style={{ color: totalRemaining >= 0 ? "var(--accent-green)" : "var(--accent-red)" }}>
                {totalRemaining >= 0 ? fmt(totalRemaining) : "-" + fmt(-totalRemaining)}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center mb-4">
            <div className="text-[11px] font-medium mb-2" style={{ color: "var(--text-tertiary)" }}>Monthly Budget Remaining</div>
            <div className="text-4xl font-extrabold tracking-tight" style={{ color: totalRemainingPct > 25 ? "var(--accent-green)" : totalRemainingPct > 10 ? "var(--accent-orange)" : "var(--accent-red)" }}>
              {pctFmt(totalRemainingPct)}
            </div>
            <div className="text-xs mt-2" style={{ color: "var(--text-tertiary)" }}>
              {totalRemainingPct > 50 ? "Going great! Plenty of budget left 👍"
                : totalRemainingPct > 25 ? "Past halfway — spend wisely"
                : totalRemainingPct > 10 ? "Running low — be careful"
                : "⚠️ Almost out of budget"}
            </div>
          </div>
        )}

        <div className="progress-track" style={{ height: "8px" }}>
          <div className={`progress-fill ${totalPct >= 90 ? "progress-fill-red" : totalPct >= 75 ? "progress-fill-yellow" : "progress-fill-green"}`}
            style={{ width: `${totalPct}%`, height: "8px" }} />
        </div>
        <div className="text-[11px] mt-2 text-right font-medium" style={{ color: "var(--text-tertiary)" }}>
          {pctFmt(totalPct)} used
        </div>
      </div>

      {/* ═══ Bubble Overview ═══ */}
      {monthlyBubbles.length > 0 && (
        <div className="card p-3 mb-4 animate-slide-up">
          <BubbleBasket bubbles={monthlyBubbles} title={now.toLocaleDateString("en-IN", { month: "short", year: "numeric" }).toUpperCase()} />
        </div>
      )}
      {monthlyZeroCats.length > 0 && (
        <div className="card p-4 mb-6 animate-slide-up">
          <div className="text-[11px] font-medium mb-2" style={{ color: "var(--text-tertiary)" }}>No activity</div>
          <div className="flex flex-wrap gap-2">
            {monthlyZeroCats.map((c) => (
              <button key={c.id} className="text-[11px] px-2.5 py-1 rounded-lg"
                style={{ color: "var(--text-tertiary)", background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
                onClick={() => setDrillDownId(c.id)}>
                {c.name}{c.cap > 0 ? ` · ${fmt(getEffectiveCap(c))}` : ""}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ═══ Monthly Categories — edit cards (only when editing) ═══ */}
      {editingId !== null && monthlyCategories.some((c) => c.id === editingId) && (
        <div className="grid grid-cols-1 gap-3 mb-6">
          {monthlyCategories.filter((c) => c.id === editingId).map((cat, i) => (
            <CategoryCard key={cat.id} cat={cat} index={i} />
          ))}
        </div>
      )}

      {/* ═══ Yearly Categories ═══ */}
      {yearlyCategories.length > 0 && (
        <>
          {/* Yearly Hero Card */}
          <div className="card-gradient-purple shimmer p-5 mb-4 animate-slide-up" style={{ opacity: 0.9 }}>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-base">📅</span>
              <span className="section-label" style={{ color: "var(--accent-bright)" }}>
                {currentYear}
              </span>
            </div>

            {isPrimary ? (
              <div className="flex justify-between items-end mb-4">
                <div>
                  <div className="text-[11px] font-medium mb-1" style={{ color: "var(--text-tertiary)" }}>Yearly Spent</div>
                  <div className="text-xl font-extrabold" style={{ color: "var(--text-primary)" }}>{fmt(yearlyTotalSpent)}</div>
                  <div className="text-xs mt-1" style={{ color: "var(--text-tertiary)" }}>of {fmt(yearlyTotalCap)} budget</div>
                </div>
                <div className="text-right">
                  <div className="text-[11px] font-medium mb-1" style={{ color: "var(--text-tertiary)" }}>
                    By month {monthsElapsed}
                  </div>
                  <div className="text-lg font-extrabold" style={{ color: yearlyOnTrack ? "var(--accent-green)" : "var(--accent-red)" }}>
                    {yearlyOnTrack
                      ? fmt(Math.abs(yearlyProportionalRemaining)) + " under"
                      : fmt(Math.abs(yearlyProportionalRemaining)) + " over"
                    }
                  </div>
                  <div className="text-[10px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                    expected: {fmt(Math.round(yearlyExpectedSpend))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center mb-4">
                <div className="text-[11px] font-medium mb-2" style={{ color: "var(--text-tertiary)" }}>Yearly Budget</div>
                <div className="text-2xl font-extrabold" style={{ color: yearlyOnTrack ? "var(--accent-green)" : "var(--accent-red)" }}>
                  {yearlyOnTrack ? "On Track" : "Over Pace"}
                </div>
                <div className="text-xs mt-1" style={{ color: "var(--text-tertiary)" }}>
                  {pctFmt(yearlyPct)} used · expected {pctFmt(yearlyExpectedPct)} by now
                </div>
              </div>
            )}

            {/* Progress bar with expected marker */}
            <div className="relative">
              <div className="progress-track" style={{ height: "8px" }}>
                <div className={`progress-fill ${yearlyPct > yearlyExpectedPct ? "progress-fill-red" : yearlyPct > yearlyExpectedPct * 0.8 ? "progress-fill-yellow" : "progress-fill-green"}`}
                  style={{ width: `${yearlyPct}%`, height: "8px" }} />
              </div>
              {/* Expected pace marker */}
              <div className="absolute top-0 h-2 w-0.5" style={{
                left: `${yearlyExpectedPct}%`,
                background: "var(--text-tertiary)",
                opacity: 0.6,
              }} />
            </div>
            <div className="flex justify-between mt-2">
              <span className="text-[10px] font-medium" style={{ color: "var(--text-tertiary)" }}>
                {pctFmt(yearlyPct)} used
              </span>
              <span className="text-[10px]" style={{ color: "var(--text-tertiary)", opacity: 0.6 }}>
                ▏pace: {pctFmt(yearlyExpectedPct)}
              </span>
            </div>
          </div>

          {/* Yearly Bubble Overview */}
          {yearlyBubbles.length > 0 && (
            <div className="card p-4 mb-4 animate-slide-up">
              <BubbleBasket bubbles={yearlyBubbles} title={String(currentYear)} />
            </div>
          )}
          {yearlyZeroCats.length > 0 && (
            <div className="card p-4 mb-6 animate-slide-up">
              <div className="text-[11px] font-medium mb-2" style={{ color: "var(--text-tertiary)" }}>No activity</div>
              <div className="flex flex-wrap gap-2">
                {yearlyZeroCats.map((c) => (
                  <button key={c.id} className="text-[11px] px-2.5 py-1 rounded-lg"
                    style={{ color: "var(--text-tertiary)", background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
                    onClick={() => setDrillDownId(c.id)}>
                    {c.name}{c.cap > 0 ? ` · ${fmt(c.cap)}` : ""}
                  </button>
                ))}
              </div>
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

      {/* ═══ Add Category — bottom, shared ═══ */}
      {isPrimary && (
        <button
          className="card w-full p-4 flex items-center justify-center gap-2 mb-6 transition-all hover:scale-[1.01]"
          style={{ border: "1px dashed var(--border-light)" }}
          onClick={onShowAddCategory}
        >
          <span style={{ color: "var(--accent)" }}>+</span>
          <span className="text-sm font-medium" style={{ color: "var(--text-tertiary)" }}>Add Category</span>
        </button>
      )}
    </div>
  );
}

export default React.memo(CategoryBudget);
