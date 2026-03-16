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

  function CategoryCard({ cat }: { cat: Category }) {
    const spent = categorySpend.get(cat.name) || 0;
    const remaining = cat.cap - spent;
    const pct = cat.cap > 0 ? Math.min((spent / cat.cap) * 100, 100) : 0;
    const barColor = pct >= 90 ? "bg-red-500" : pct >= 75 ? "bg-yellow-500" : "bg-green-500";

    return (
      <div className="bg-white rounded-xl shadow p-4">
        <div className="flex justify-between items-start mb-2">
          <div className="text-sm font-medium text-gray-800 leading-tight">{cat.name}</div>
          <div className="text-xs text-gray-400 whitespace-nowrap ml-2">{cat.recurrence}</div>
        </div>
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>{fmt(spent)} / {fmt(cat.cap)}</span>
          <span className={remaining >= 0 ? "text-green-600" : "text-red-600"}>{remaining >= 0 ? fmt(remaining) + " left" : fmt(-remaining) + " over"}</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div className={`h-2 rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Monthly summary */}
      <div className="bg-white rounded-xl shadow p-4 mb-4">
        <div className="text-sm text-gray-500 mb-1">
          {now.toLocaleDateString("en-IN", { month: "long", year: "numeric" })} — Monthly Budget
        </div>
        <div className="flex justify-between items-end">
          <div>
            <span className="text-2xl font-bold text-red-600">{fmt(totalSpent)}</span>
            <span className="text-gray-400 text-sm"> / {fmt(totalCap)}</span>
          </div>
          <div className={`text-lg font-semibold ${totalCap - totalSpent >= 0 ? "text-green-600" : "text-red-600"}`}>
            {totalCap - totalSpent >= 0 ? fmt(totalCap - totalSpent) + " left" : fmt(totalSpent - totalCap) + " over"}
          </div>
        </div>
      </div>

      {/* Monthly categories */}
      <h3 className="text-sm font-semibold text-gray-500 mb-2 uppercase tracking-wide">Monthly</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
        {monthlyCategories.map((cat) => (
          <CategoryCard key={cat.id} cat={cat} />
        ))}
      </div>

      {/* Yearly categories */}
      {yearlyCategories.length > 0 && (
        <>
          <h3 className="text-sm font-semibold text-gray-500 mb-2 uppercase tracking-wide">Yearly</h3>
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
