"use client";

import { useMemo } from "react";
import { Transaction, Category } from "@/lib/supabase";

interface Props {
  transactions: Transaction[];
  categories: Category[];
}

export default function CategoryBudget({ transactions, categories }: Props) {
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const fmt = (n: number) => "\u20B9" + n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  const categorySpend = useMemo(() => {
    const spend = new Map<string, number>();
    for (const txn of transactions) {
      if (!txn.category || !txn.amount) continue;
      const cat = categories.find((c) => c.name === txn.category);
      if (!cat) continue;

      const d = new Date(txn.sms_date);
      const inPeriod =
        cat.recurrence === "Monthly"
          ? d.getMonth() === currentMonth && d.getFullYear() === currentYear
          : d.getFullYear() === currentYear;

      if (inPeriod) {
        spend.set(txn.category, (spend.get(txn.category) || 0) + Number(txn.amount));
      }
    }
    return spend;
  }, [transactions, categories, currentMonth, currentYear]);

  const totalCap = useMemo(() => {
    return categories
      .filter((c) => c.recurrence === "Monthly")
      .reduce((sum, c) => sum + c.cap, 0);
  }, [categories]);

  const totalSpent = useMemo(() => {
    let sum = 0;
    for (const cat of categories) {
      if (cat.recurrence === "Monthly") {
        sum += categorySpend.get(cat.name) || 0;
      }
    }
    return sum;
  }, [categories, categorySpend]);

  const monthlyCategories = categories.filter((c) => c.recurrence === "Monthly");
  const yearlyCategories = categories.filter((c) => c.recurrence === "Yearly");

  const totalPct = totalCap > 0 ? Math.min((totalSpent / totalCap) * 100, 100) : 0;
  const totalRemaining = totalCap - totalSpent;

  function CategoryCard({ cat, index }: { cat: Category; index: number }) {
    const spent = categorySpend.get(cat.name) || 0;
    const remaining = cat.cap - spent;
    const pct = cat.cap > 0 ? Math.min((spent / cat.cap) * 100, 100) : 0;
    const fillClass = pct >= 90 ? "progress-fill-red" : pct >= 75 ? "progress-fill-yellow" : "progress-fill-green";
    const accentColor = pct >= 90 ? "var(--accent-red)" : pct >= 75 ? "var(--accent-orange)" : "var(--accent-green)";

    return (
      <div className="card p-4 animate-slide-up" style={{ animationDelay: `${index * 50}ms` }}>
        <div className="flex justify-between items-start mb-2.5">
          <div className="text-sm font-semibold leading-tight" style={{ color: "var(--text-primary)" }}>{cat.name}</div>
          <span className="badge badge-muted text-[10px]">{cat.recurrence === "Monthly" ? "Mo" : "Yr"}</span>
        </div>

        {/* Spend vs Cap */}
        <div className="flex justify-between items-baseline mb-2">
          <div>
            <span className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>{fmt(spent)}</span>
            <span className="text-xs ml-1" style={{ color: "var(--text-tertiary)" }}>/ {fmt(cat.cap)}</span>
          </div>
          <span className="text-xs font-semibold" style={{ color: accentColor }}>
            {remaining >= 0 ? fmt(remaining) + " left" : fmt(-remaining) + " over"}
          </span>
        </div>

        {/* Progress bar */}
        <div className="progress-track">
          <div className={`progress-fill ${fillClass}`} style={{ width: `${pct}%` }} />
        </div>
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

        {/* Overall progress */}
        <div className="progress-track" style={{ height: "8px" }}>
          <div className={`progress-fill ${totalPct >= 90 ? "progress-fill-red" : totalPct >= 75 ? "progress-fill-yellow" : "progress-fill-green"}`}
            style={{ width: `${totalPct}%`, height: "8px" }} />
        </div>
        <div className="text-[11px] mt-2 text-right font-medium" style={{ color: "var(--text-tertiary)" }}>
          {Math.round(totalPct)}% used
        </div>
      </div>

      {/* ═══ Monthly Categories ═══ */}
      <div className="section-label mb-3">Monthly</div>
      <div className="grid grid-cols-1 gap-3 mb-6">
        {monthlyCategories.map((cat, i) => (
          <CategoryCard key={cat.id} cat={cat} index={i} />
        ))}
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
