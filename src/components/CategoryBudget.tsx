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

  function CategoryCard({ cat }: { cat: Category }) {
    const spent = categorySpend.get(cat.name) || 0;
    const remaining = cat.cap - spent;
    const pct = cat.cap > 0 ? Math.min((spent / cat.cap) * 100, 100) : 0;
    const barGradient = pct >= 90 ? "linear-gradient(90deg, #ff4757, #e84141)" : pct >= 75 ? "linear-gradient(90deg, #ff9f43, #e67e22)" : "linear-gradient(90deg, #00c896, #00a67d)";
    const glowClass = pct >= 90 ? "progress-glow-red" : pct >= 75 ? "progress-glow-yellow" : "progress-glow-green";

    return (
      <div className="glass rounded-xl p-4 transition-all hover:scale-[1.01]">
        <div className="flex justify-between items-start mb-2">
          <div className="text-sm font-medium leading-tight" style={{ color: "var(--text-primary)" }}>{cat.name}</div>
          <div className="text-xs whitespace-nowrap ml-2" style={{ color: "var(--text-tertiary)" }}>{cat.recurrence}</div>
        </div>
        <div className="flex justify-between text-xs mb-1.5">
          <span style={{ color: "var(--text-secondary)" }}>{fmt(spent)} / {fmt(cat.cap)}</span>
          <span style={{ color: remaining >= 0 ? "var(--accent-green)" : "var(--accent-red)" }}>
            {remaining >= 0 ? fmt(remaining) + " left" : fmt(-remaining) + " over"}
          </span>
        </div>
        <div className="w-full rounded-full h-2" style={{ background: "var(--bg-base)" }}>
          <div className={`h-2 rounded-full ${glowClass} transition-all`} style={{ width: `${pct}%`, background: barGradient }} />
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Monthly summary */}
      <div className="glass-elevated rounded-xl p-4 mb-4 glow-accent">
        <div className="text-sm mb-1" style={{ color: "var(--text-secondary)" }}>
          {now.toLocaleDateString("en-IN", { month: "long", year: "numeric" })} — Monthly Budget
        </div>
        <div className="flex justify-between items-end mb-3">
          <div>
            <span className="text-2xl font-bold" style={{ color: "var(--accent-red)" }}>{fmt(totalSpent)}</span>
            <span className="text-sm" style={{ color: "var(--text-tertiary)" }}> / {fmt(totalCap)}</span>
          </div>
          <div className="text-lg font-semibold" style={{ color: totalCap - totalSpent >= 0 ? "var(--accent-green)" : "var(--accent-red)" }}>
            {totalCap - totalSpent >= 0 ? fmt(totalCap - totalSpent) + " left" : fmt(totalSpent - totalCap) + " over"}
          </div>
        </div>
        {/* Overall progress bar */}
        <div className="w-full rounded-full h-2" style={{ background: "var(--bg-base)" }}>
          <div className={`h-2 rounded-full transition-all ${totalPct >= 90 ? "progress-glow-red" : totalPct >= 75 ? "progress-glow-yellow" : "progress-glow-green"}`}
            style={{ width: `${totalPct}%`, background: totalPct >= 90 ? "linear-gradient(90deg, #ff4757, #e84141)" : totalPct >= 75 ? "linear-gradient(90deg, #ff9f43, #e67e22)" : "linear-gradient(90deg, #00c896, #00a67d)" }} />
        </div>
      </div>

      {/* Monthly categories */}
      <h3 className="text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>Monthly</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
        {monthlyCategories.map((cat) => (
          <CategoryCard key={cat.id} cat={cat} />
        ))}
      </div>

      {/* Yearly categories */}
      {yearlyCategories.length > 0 && (
        <>
          <h3 className="text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>Yearly</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {yearlyCategories.map((cat) => (
              <CategoryCard key={cat.id} cat={cat} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
