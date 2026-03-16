"use client";

import { useMemo, useState } from "react";
import { supabase, Transaction, Category } from "@/lib/supabase";

interface Props {
  transactions: Transaction[];
  categories: Category[];
  isPrimary: boolean;
  scaleFactor: number; // active days scaling (1.0 = full month)
  monthlyOverrides: Record<number, number>; // categoryId → cap override for this month
  onCategoriesChange: (cats: Category[]) => void;
  onShowAddCategory: () => void;
  onMonthlyOverride: (catId: number, cap: number | null) => void; // null = remove override
}

export default function CategoryBudget({ transactions, categories, isPrimary, scaleFactor, monthlyOverrides, onCategoriesChange, onShowAddCategory, onMonthlyOverride }: Props) {
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [drillDownId, setDrillDownId] = useState<number | null>(null);
  const [editCap, setEditCap] = useState("");
  const [editVisibility, setEditVisibility] = useState<"all" | "primary" | "secondary">("all");
  const [editMode, setEditMode] = useState<"general" | "month">("general");
  const [savingEdit, setSavingEdit] = useState(false);

  const fmt = (n: number) => "\u20B9" + n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const fmtDec = (n: number) => "\u20B9" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pctFmt = (n: number) => Math.round(n) + "%";
  const fmtDate = (ts: number) => new Date(ts).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });

  // Filter categories by visibility for secondary user
  const visibleCategories = useMemo(() => {
    return categories.filter((c) =>
      isPrimary || c.visible_to === "all" || c.visible_to === "secondary"
    );
  }, [categories, isPrimary]);

  // Get transactions grouped by category for the current period
  const categoryTxns = useMemo(() => {
    const map = new Map<string, Transaction[]>();
    for (const txn of transactions) {
      if (!txn.category || !txn.amount) continue;
      const cat = visibleCategories.find((c) => c.name === txn.category);
      if (!cat) continue;

      const d = new Date(txn.sms_date);
      const inPeriod =
        cat.recurrence === "Monthly"
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

  const monthlyCategories = visibleCategories.filter((c) => c.recurrence === "Monthly");
  const yearlyCategories = visibleCategories.filter((c) => c.recurrence === "Yearly");

  // Helper: get effective cap for a category (monthly override is ABSOLUTE, general cap gets scaled)
  function getEffectiveCap(cat: Category): number {
    const hasOverride = monthlyOverrides[cat.id] != null;
    if (hasOverride) return monthlyOverrides[cat.id]; // absolute — no scaling
    if (cat.cap === 0) return 0; // no-cap
    return cat.recurrence === "Monthly" ? cat.cap * scaleFactor : cat.cap;
  }

  const totalCap = useMemo(() => {
    return monthlyCategories.reduce((sum, c) => {
      const eCap = getEffectiveCap(c);
      if (eCap === 0 && c.cap === 0 && monthlyOverrides[c.id] == null) return sum; // exclude no-cap
      return sum + eCap;
    }, 0);
  }, [monthlyCategories, scaleFactor, monthlyOverrides]);

  const totalSpent = useMemo(() => {
    let sum = 0;
    for (const cat of monthlyCategories) {
      const eCap = getEffectiveCap(cat);
      if (eCap === 0 && cat.cap === 0 && monthlyOverrides[cat.id] == null) continue;
      sum += categorySpend.get(cat.name) || 0;
    }
    return sum;
  }, [monthlyCategories, categorySpend, monthlyOverrides]);

  const totalPct = totalCap > 0 ? Math.min((totalSpent / totalCap) * 100, 100) : 0;
  const totalRemainingPct = Math.max(100 - totalPct, 0);
  const totalRemaining = totalCap - totalSpent;

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
    const isDrillDown = drillDownId === cat.id;
    const txnsForCat = categoryTxns.get(cat.name) || [];

    // ── Edit Mode ──
    if (isEditing) {
      return (
        <div className="card p-4 animate-scale-in glow-accent" style={{ animationDelay: `${index * 50}ms` }}>
          <div className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>{cat.name}</div>

          {/* Scope toggle: General vs This Month */}
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

          {/* Cap input */}
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

          {/* Visibility toggle */}
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

    // ── Drill-Down Mode ──
    if (isDrillDown) {
      return (
        <div className="card p-0 overflow-hidden animate-scale-in" style={{ animationDelay: `${index * 50}ms` }}>
          {/* Header */}
          <div className="p-4 pb-3" style={{ borderBottom: "1px solid var(--border)" }}>
            <div className="flex justify-between items-start mb-2">
              <div>
                <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{cat.name}</div>
                {!isNoCap && (
                  <div className="text-xs mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                    {fmt(spent)} {effectiveCap > 0 ? `/ ${fmt(effectiveCap)}` : ""}
                    {hasMonthOverride && <span style={{ color: "var(--accent-orange)" }}> (this mo)</span>}
                  </div>
                )}
                {isNoCap && (
                  <div className="text-xs mt-0.5" style={{ color: "var(--text-tertiary)" }}>{fmt(spent)} spent</div>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                {isPrimary && (
                  <button
                    className="text-[10px] font-semibold px-2.5 py-1 rounded-lg btn-ghost"
                    onClick={(e) => { e.stopPropagation(); startEdit(cat); setDrillDownId(null); }}
                  >
                    ✎ Edit
                  </button>
                )}
                <button
                  className="text-[10px] font-semibold px-2.5 py-1 rounded-lg btn-ghost"
                  onClick={() => setDrillDownId(null)}
                >
                  ✕ Close
                </button>
              </div>
            </div>
            {!isNoCap && (
              <div className="progress-track">
                <div className={`progress-fill ${fillClass}`} style={{ width: `${pct}%` }} />
              </div>
            )}
          </div>

          {/* Expense list */}
          <div className="max-h-64 overflow-y-auto">
            {txnsForCat.length === 0 ? (
              <div className="p-4 text-center text-xs" style={{ color: "var(--text-tertiary)" }}>
                No expenses yet
              </div>
            ) : (
              txnsForCat
                .sort((a, b) => b.sms_date - a.sms_date)
                .map((txn) => (
                  <div key={txn.id} className="flex items-center justify-between px-4 py-2.5"
                    style={{ borderBottom: "1px solid var(--border)" }}>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate" style={{ color: "var(--text-secondary)" }}>
                        {txn.merchant || (txn.address === "MANUAL" ? "Manual" : txn.body.substring(0, 40))}
                      </div>
                      <div className="text-[10px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                        {fmtDate(txn.sms_date)}
                        {txn.notes && <span> · {txn.notes}</span>}
                      </div>
                    </div>
                    <span className="text-sm font-semibold ml-3 shrink-0" style={{ color: "var(--text-primary)" }}>
                      {fmtDec(Number(txn.amount))}
                    </span>
                  </div>
                ))
            )}
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
      {/* ═══ Monthly Hero Card ═══ */}
      <div className="card-gradient-purple shimmer p-5 mb-6 animate-slide-up">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-base">💰</span>
          <span className="section-label" style={{ color: "var(--accent-bright)" }}>
            {now.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}
          </span>
        </div>

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

      {/* ═══ Monthly Categories ═══ */}
      <div className="section-label mb-3">Monthly</div>
      <div className="grid grid-cols-1 gap-3 mb-6">
        {monthlyCategories.map((cat, i) => (
          <CategoryCard key={cat.id} cat={cat} index={i} />
        ))}
        {isPrimary && (
          <button
            className="card p-4 flex items-center justify-center gap-2 transition-all hover:scale-[1.01]"
            style={{ border: "1px dashed var(--border-light)" }}
            onClick={onShowAddCategory}
          >
            <span style={{ color: "var(--accent)" }}>+</span>
            <span className="text-sm font-medium" style={{ color: "var(--text-tertiary)" }}>Add Category</span>
          </button>
        )}
      </div>

      {/* ═══ Yearly Categories ═══ */}
      {yearlyCategories.length > 0 && (
        <>
          <div className="section-label mb-3">Yearly</div>
          <div className="grid grid-cols-1 gap-3 mb-6">
            {yearlyCategories.map((cat, i) => (
              <CategoryCard key={cat.id} cat={cat} index={i} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
