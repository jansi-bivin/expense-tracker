"use client";

import { useState } from "react";
import { Category } from "@/lib/supabase";

interface ManualExpense {
  amount: number;
  category: string;
  note: string;
  date: number; // epoch ms
}

interface Props {
  categories: Category[];
  isPrimary: boolean;
  onSave: (expense: ManualExpense) => void;
  onClose: () => void;
}

const CATEGORY_GROUPS = [
  { label: "General", filter: (c: Category) => !c.name.startsWith("FC :") && !c.name.startsWith("FOC :") && !c.name.startsWith("Service:") && !c.name.startsWith("Insurance:") },
  { label: "FC (From City)", filter: (c: Category) => c.name.startsWith("FC :") },
  { label: "FOC (Home Town)", filter: (c: Category) => c.name.startsWith("FOC :") },
  { label: "Services & Insurance", filter: (c: Category) => c.name.startsWith("Service:") || c.name.startsWith("Insurance:") },
];

export default function ManualExpenseForm({ categories, isPrimary, onSave, onClose }: Props) {
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [note, setNote] = useState("");
  const [dateStr, setDateStr] = useState(new Date().toISOString().split("T")[0]);
  const [saving, setSaving] = useState(false);


  // Filter categories by visibility
  const visibleCategories = categories.filter((c) =>
    isPrimary || c.visible_to === "all" || c.visible_to === "secondary"
  );

  async function handleSave() {
    const amtNum = Number(amount);
    if (!amtNum || amtNum <= 0) return;
    if (!category) return;

    setSaving(true);
    const d = new Date(dateStr);
    d.setHours(12, 0, 0, 0); // noon to avoid timezone issues

    onSave({
      amount: amtNum,
      category,
      note: note.trim(),
      date: d.getTime(),
    });
  }

  return (
    <div className="fixed inset-0 sheet-backdrop z-50 flex items-end animate-fade-in" onClick={onClose}>
      <div className="sheet w-full p-6 animate-slide-up" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />

        <div className="flex items-center gap-2 mb-5">
          <span className="text-base">✏️</span>
          <span className="text-base font-bold" style={{ color: "var(--text-primary)" }}>Add Expense</span>
        </div>

        {/* Amount */}
        <div className="relative mb-3">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: "var(--text-tertiary)" }}>₹</span>
          <input
            type="number"
            placeholder="Amount"
            className="w-full pl-7 pr-3 py-2.5 text-sm rounded-xl"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            autoFocus
          />
        </div>

        {/* Category */}
        <select
          className="w-full px-3 py-2.5 mb-3 text-sm rounded-xl"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
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

        {/* Note */}
        <input
          type="text"
          placeholder="Note (optional)"
          className="w-full px-3 py-2.5 mb-3 text-sm rounded-xl"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />

        {/* Date */}
        <div className="mb-4">
          <div className="section-label mb-1.5">Date</div>
          <input
            type="date"
            className="w-full px-3 py-2.5 text-sm rounded-xl"
            value={dateStr}
            onChange={(e) => setDateStr(e.target.value)}
          />
        </div>

        <div className="flex gap-2">
          <button
            className="flex-1 py-2.5 btn-primary text-sm rounded-xl disabled:opacity-35"
            disabled={!amount || !category || saving}
            onClick={handleSave}
          >
            {saving ? "Saving..." : "✓ Add Expense"}
          </button>
          <button className="px-5 py-2.5 btn-ghost text-sm rounded-xl" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
