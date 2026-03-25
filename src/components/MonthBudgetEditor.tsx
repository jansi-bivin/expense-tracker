"use client";

import { useState, useEffect } from "react";
import { supabase, Category, MonthlyBudget } from "@/lib/supabase";

interface BudgetRow {
  category_id: number;
  category_name: string;
  cap: number;
  is_included: boolean;
  universalCap: number; // original cap from categories table
}

interface Props {
  month: number;
  year: number;
  categories: Category[];
  onBack: () => void;
  onCategoriesChange: (cats: Category[]) => void;
}

const MONTH_NAMES = ["", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

export default function MonthBudgetEditor({ month, year, categories, onBack, onCategoriesChange }: Props) {
  const [rows, setRows] = useState<BudgetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [isPlanned, setIsPlanned] = useState(false);
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [newCatCap, setNewCatCap] = useState("");

  useEffect(() => {
    async function load() {
      setLoading(true);
      const { data: existing } = await supabase
        .from("monthly_budgets")
        .select("*")
        .eq("month", month)
        .eq("year", year);

      if (existing && existing.length > 0) {
        setIsPlanned(true);
        // Merge with categories to get universalCap
        const budgetRows: BudgetRow[] = existing.map((mb: MonthlyBudget) => {
          const cat = categories.find(c => c.id === mb.category_id);
          return {
            category_id: mb.category_id,
            category_name: mb.category_name,
            cap: mb.cap,
            is_included: mb.is_included,
            universalCap: cat?.cap ?? mb.cap,
          };
        });
        // Add any new universal categories not yet in the budget
        for (const cat of categories) {
          if (!budgetRows.find(r => r.category_id === cat.id)) {
            budgetRows.push({
              category_id: cat.id,
              category_name: cat.name,
              cap: cat.cap,
              is_included: true,
              universalCap: cat.cap,
            });
          }
        }
        setRows(budgetRows);
      } else {
        // Populate from universal categories
        setIsPlanned(false);
        setRows(categories.map(c => ({
          category_id: c.id,
          category_name: c.name,
          cap: c.cap,
          is_included: true,
          universalCap: c.cap,
        })));
      }
      setLoading(false);
    }
    load();
  }, [month, year, categories]);

  function updateRow(catId: number, field: Partial<BudgetRow>) {
    setRows(prev => prev.map(r => r.category_id === catId ? { ...r, ...field } : r));
    setSaved(false);
  }

  async function handleSave() {
    setSaving(true);
    const upsertRows = rows.map(r => ({
      month, year,
      category_id: r.category_id,
      category_name: r.category_name,
      cap: r.cap,
      is_included: r.is_included,
      updated_at: new Date().toISOString(),
    }));
    await supabase.from("monthly_budgets").upsert(upsertRows, { onConflict: "month,year,category_id" });
    setIsPlanned(true);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function handlePushToUniversal(catId: number) {
    const row = rows.find(r => r.category_id === catId);
    if (!row) return;
    await supabase.from("categories").update({ cap: row.cap }).eq("id", catId);
    // Update local categories
    onCategoriesChange(categories.map(c => c.id === catId ? { ...c, cap: row.cap } : c));
    // Update universalCap in rows
    setRows(prev => prev.map(r => r.category_id === catId ? { ...r, universalCap: row.cap } : r));
  }

  async function handleAddCategory() {
    const name = newCatName.trim();
    if (!name) return;
    const cap = Number(newCatCap) || 0;
    // Create in categories table (universal)
    const { data } = await supabase.from("categories")
      .insert({ name, cap, recurrence: "Monthly", visible_to: "all" })
      .select().single();
    if (data) {
      onCategoriesChange([...categories, data as Category]);
      setRows(prev => [...prev, {
        category_id: data.id,
        category_name: data.name,
        cap: data.cap,
        is_included: true,
        universalCap: data.cap,
      }]);
      setNewCatName("");
      setNewCatCap("");
      setShowAddCategory(false);
      setSaved(false);
    }
  }

  const totalBudget = rows.filter(r => r.is_included).reduce((s, r) => s + r.cap, 0);
  const includedCount = rows.filter(r => r.is_included).length;

  if (loading) return (
    <div className="flex items-center justify-center py-10">
      <div className="w-6 h-6 rounded-full border-2 border-transparent animate-spin"
        style={{ borderTopColor: "var(--accent)", borderRightColor: "var(--accent)" }} />
    </div>
  );

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <button className="text-sm px-2 py-1 rounded-lg" style={{ color: "var(--accent)" }}
            onClick={onBack}>← Back</button>
          <div>
            <div className="text-base font-bold" style={{ color: "var(--text-primary)" }}>
              {MONTH_NAMES[month]} {year}
            </div>
            <div className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
              {isPlanned ? "Planned" : "Using universal defaults"} — {includedCount} categories — ₹{totalBudget.toLocaleString("en-IN")}
            </div>
          </div>
        </div>
      </div>

      {/* Category rows */}
      <div className="space-y-2 mb-4" style={{ maxHeight: "50vh", overflowY: "auto" }}>
        {rows.map(row => {
          const isModified = row.cap !== row.universalCap;
          return (
            <div key={row.category_id} className="px-3 py-2.5 rounded-xl"
              style={{
                background: row.is_included ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.01)",
                border: `1px solid ${row.is_included ? "var(--border)" : "rgba(255,255,255,0.03)"}`,
                opacity: row.is_included ? 1 : 0.4,
              }}>
              <div className="flex items-center gap-2">
                {/* Include toggle */}
                <button className="text-xs w-5 h-5 rounded flex items-center justify-center"
                  style={{
                    background: row.is_included ? "var(--accent)" : "rgba(255,255,255,0.08)",
                    color: row.is_included ? "#fff" : "var(--text-tertiary)",
                  }}
                  onClick={() => updateRow(row.category_id, { is_included: !row.is_included })}>
                  {row.is_included ? "✓" : ""}
                </button>

                {/* Name */}
                <div className="flex-1 text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                  {row.category_name}
                </div>

                {/* Cap input */}
                <div className="flex items-center gap-1">
                  <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>₹</span>
                  <input
                    type="number"
                    className="w-20 text-right text-sm px-2 py-1 rounded-lg"
                    style={{
                      background: "rgba(255,255,255,0.06)",
                      color: isModified ? "var(--accent)" : "var(--text-primary)",
                      border: isModified ? "1px solid rgba(123,108,246,0.3)" : "1px solid transparent",
                    }}
                    value={row.cap || ""}
                    onChange={e => updateRow(row.category_id, { cap: Number(e.target.value) || 0 })}
                    disabled={!row.is_included}
                  />
                </div>
              </div>

              {/* Push to universal option — show only if cap differs from universal */}
              {isModified && row.is_included && (
                <div className="flex items-center gap-2 mt-1.5 pl-7">
                  <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
                    Universal: ₹{row.universalCap.toLocaleString("en-IN")}
                  </span>
                  <button className="text-[10px] px-2 py-0.5 rounded"
                    style={{ background: "rgba(123,108,246,0.1)", color: "var(--accent)" }}
                    onClick={() => handlePushToUniversal(row.category_id)}>
                    Push to universal
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add category */}
      {showAddCategory ? (
        <div className="px-3 py-3 rounded-xl mb-4"
          style={{ background: "rgba(123,108,246,0.05)", border: "1px dashed rgba(123,108,246,0.3)" }}>
          <div className="flex gap-2 mb-2">
            <input type="text" placeholder="Category name" className="flex-1 px-2 py-1.5 text-sm rounded-lg"
              value={newCatName} onChange={e => setNewCatName(e.target.value)} autoFocus />
            <div className="flex items-center gap-1">
              <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>₹</span>
              <input type="number" placeholder="Cap" className="w-20 px-2 py-1.5 text-sm rounded-lg"
                value={newCatCap} onChange={e => setNewCatCap(e.target.value)} />
            </div>
          </div>
          <div className="flex gap-2">
            <button className="text-xs px-3 py-1.5 rounded-lg font-semibold"
              style={{ background: "var(--accent)", color: "#fff" }}
              onClick={handleAddCategory}>Add</button>
            <button className="text-xs px-3 py-1.5 rounded-lg"
              style={{ color: "var(--text-tertiary)" }}
              onClick={() => setShowAddCategory(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button className="w-full py-2.5 rounded-xl text-sm font-semibold mb-4"
          style={{ background: "rgba(123,108,246,0.06)", color: "var(--accent)", border: "1px dashed rgba(123,108,246,0.2)" }}
          onClick={() => setShowAddCategory(true)}>
          + Add Category
        </button>
      )}

      {/* Save button */}
      <button
        className="w-full py-3 rounded-xl text-sm font-semibold disabled:opacity-40"
        style={{
          background: saved ? "rgba(74,222,128,0.15)" : "linear-gradient(135deg, var(--accent), var(--accent-dim))",
          color: saved ? "#4ade80" : "#fff",
          boxShadow: saved ? "none" : "0 4px 20px rgba(123, 108, 246, 0.3)",
        }}
        disabled={saving}
        onClick={handleSave}>
        {saving ? "Saving..." : saved ? "✓ Saved" : `Save ${MONTH_NAMES[month]} Budget`}
      </button>
    </div>
  );
}
