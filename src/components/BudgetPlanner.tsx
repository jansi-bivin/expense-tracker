"use client";

import { useState, useEffect } from "react";
import { supabase, Category, MonthlyBudget } from "@/lib/supabase";
import MonthBudgetEditor from "./MonthBudgetEditor";

interface Props {
  categories: Category[];
  onCategoriesChange: (cats: Category[]) => void;
  onClose: () => void;
}

const MONTH_NAMES = ["", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

const SHORT_MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface MonthInfo {
  month: number;
  year: number;
  isPlanned: boolean;
  totalBudget: number;
  categoryCount: number;
  isCurrent: boolean;
  isPast: boolean;
}

export default function BudgetPlanner({ categories, onCategoriesChange, onClose }: Props) {
  const [months, setMonths] = useState<MonthInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<{ month: number; year: number } | null>(null);

  const now = new Date();
  const curMonth = now.getMonth() + 1;
  const curYear = now.getFullYear();

  useEffect(() => {
    loadMonths();
  }, [categories]);

  async function loadMonths() {
    setLoading(true);

    // Fetch all monthly_budgets for this year and next
    const { data: allBudgets } = await supabase
      .from("monthly_budgets")
      .select("*")
      .gte("year", curYear)
      .lte("year", curYear + 1);

    // Group by month/year
    const budgetMap = new Map<string, MonthlyBudget[]>();
    if (allBudgets) {
      for (const mb of allBudgets) {
        const key = `${mb.year}-${mb.month}`;
        if (!budgetMap.has(key)) budgetMap.set(key, []);
        budgetMap.get(key)!.push(mb);
      }
    }

    // Generate 12 months starting from current month
    const monthList: MonthInfo[] = [];
    for (let i = 0; i < 12; i++) {
      let m = curMonth + i;
      let y = curYear;
      if (m > 12) { m -= 12; y += 1; }

      const key = `${y}-${m}`;
      const budgets = budgetMap.get(key);
      const isPlanned = !!budgets && budgets.length > 0;
      const included = budgets?.filter(b => b.is_included) ?? [];
      const totalBudget = isPlanned
        ? included.reduce((s, b) => s + Number(b.cap), 0)
        : categories.reduce((s, c) => s + c.cap, 0);
      const categoryCount = isPlanned
        ? included.length
        : categories.length;

      monthList.push({
        month: m, year: y,
        isPlanned,
        totalBudget,
        categoryCount,
        isCurrent: m === curMonth && y === curYear,
        isPast: false,
      });
    }

    setMonths(monthList);
    setLoading(false);
  }

  if (editing) {
    return (
      <div className="fixed inset-0 sheet-backdrop z-50 flex items-end animate-fade-in" onClick={onClose}>
        <div className="sheet w-full p-5 animate-slide-up" onClick={e => e.stopPropagation()}
          style={{ maxHeight: "90vh", overflowY: "auto" }}>
          <div className="sheet-handle" />
          <MonthBudgetEditor
            month={editing.month}
            year={editing.year}
            categories={categories}
            onBack={() => { setEditing(null); loadMonths(); }}
            onCategoriesChange={onCategoriesChange}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 sheet-backdrop z-50 flex items-end animate-fade-in" onClick={onClose}>
      <div className="sheet w-full p-5 animate-slide-up" onClick={e => e.stopPropagation()}
        style={{ maxHeight: "85vh", overflowY: "auto" }}>
        <div className="sheet-handle" />

        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <div className="text-base font-bold" style={{ color: "var(--text-primary)" }}>Budget Planner</div>
            <div className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
              Plan budgets for upcoming months
            </div>
          </div>
          <button className="text-xs px-3 py-1.5 rounded-lg"
            style={{ color: "var(--text-tertiary)", background: "rgba(255,255,255,0.06)" }}
            onClick={onClose}>Close</button>
        </div>

        {/* Universal defaults summary */}
        <div className="px-3 py-2.5 rounded-xl mb-4"
          style={{ background: "rgba(123,108,246,0.06)", border: "1px solid rgba(123,108,246,0.15)" }}>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold" style={{ color: "var(--accent)" }}>Universal Defaults</div>
              <div className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
                {categories.length} categories — ₹{categories.reduce((s, c) => s + c.cap, 0).toLocaleString("en-IN")}/mo
              </div>
            </div>
            <div className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
              Used when no plan exists
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <div className="w-6 h-6 rounded-full border-2 border-transparent animate-spin"
              style={{ borderTopColor: "var(--accent)", borderRightColor: "var(--accent)" }} />
          </div>
        ) : (
          <div className="space-y-2">
            {months.map(m => (
              <button key={`${m.year}-${m.month}`}
                className="w-full text-left px-4 py-3 rounded-xl transition-all"
                style={{
                  background: m.isCurrent ? "rgba(123,108,246,0.08)" : "rgba(255,255,255,0.04)",
                  border: `1px solid ${m.isCurrent ? "rgba(123,108,246,0.25)" : "var(--border)"}`,
                }}
                onClick={() => setEditing({ month: m.month, year: m.year })}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl flex flex-col items-center justify-center"
                      style={{
                        background: m.isPlanned ? "rgba(123,108,246,0.15)" : "rgba(255,255,255,0.06)",
                        color: m.isPlanned ? "var(--accent)" : "var(--text-tertiary)",
                      }}>
                      <div className="text-[9px] font-bold leading-none">{SHORT_MONTHS[m.month]}</div>
                      <div className="text-xs font-bold leading-none mt-0.5">{m.year}</div>
                    </div>
                    <div>
                      <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                        {MONTH_NAMES[m.month]} {m.year}
                        {m.isCurrent && (
                          <span className="ml-2 text-[9px] px-1.5 py-0.5 rounded-full font-bold"
                            style={{ background: "rgba(123,108,246,0.15)", color: "var(--accent)" }}>
                            NOW
                          </span>
                        )}
                      </div>
                      <div className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
                        {m.categoryCount} categories — ₹{m.totalBudget.toLocaleString("en-IN")}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold"
                      style={{
                        background: m.isPlanned ? "rgba(74,222,128,0.1)" : "rgba(255,255,255,0.06)",
                        color: m.isPlanned ? "#4ade80" : "var(--text-tertiary)",
                      }}>
                      {m.isPlanned ? "Planned" : "Default"}
                    </span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                      style={{ color: "var(--text-tertiary)" }}><path d="M9 18l6-6-6-6" /></svg>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
