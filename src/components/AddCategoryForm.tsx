"use client";

import { useState } from "react";
import { supabase, Category } from "@/lib/supabase";

interface Props {
  onSave: (cat: Category) => void;
  onClose: () => void;
}

export default function AddCategoryForm({ onSave, onClose }: Props) {
  const [name, setName] = useState("");
  const [cap, setCap] = useState("");
  const [recurrence, setRecurrence] = useState<"Monthly" | "Yearly">("Monthly");
  const [visibleTo, setVisibleTo] = useState<"all" | "primary" | "secondary">("all");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    const trimmedName = name.trim();
    const capNum = Number(cap);
    if (!trimmedName) { setError("Name is required"); return; }
    if (!capNum || capNum <= 0) { setError("Cap must be > 0"); return; }

    setSaving(true);
    setError("");

    const { data, error: err } = await supabase
      .from("categories")
      .insert({ name: trimmedName, cap: capNum, recurrence, visible_to: visibleTo })
      .select()
      .single();

    if (err) {
      setError(err.message);
      setSaving(false);
      return;
    }

    onSave(data as Category);
  }

  return (
    <div className="fixed inset-0 sheet-backdrop z-50 flex items-end animate-fade-in" onClick={onClose}>
      <div className="sheet w-full p-6 animate-slide-up" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />

        <div className="flex items-center gap-2 mb-5">
          <span className="text-base">➕</span>
          <span className="text-base font-bold" style={{ color: "var(--text-primary)" }}>New Category</span>
        </div>

        {/* Name */}
        <input
          type="text"
          placeholder="Category name"
          className="w-full px-3 py-2.5 mb-3 text-sm rounded-xl"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />

        {/* Cap */}
        <div className="relative mb-3">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: "var(--text-tertiary)" }}>₹</span>
          <input
            type="number"
            placeholder="Monthly/Yearly cap"
            className="w-full pl-7 pr-3 py-2.5 text-sm rounded-xl"
            value={cap}
            onChange={(e) => setCap(e.target.value)}
          />
        </div>

        {/* Recurrence toggle */}
        <div className="flex gap-2 mb-3">
          {(["Monthly", "Yearly"] as const).map((r) => (
            <button
              key={r}
              className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-all ${recurrence === r ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setRecurrence(r)}
            >
              {r}
            </button>
          ))}
        </div>

        {/* Visibility */}
        <div className="section-label mb-2">Visible to</div>
        <div className="flex gap-2 mb-4">
          {([
            { value: "all" as const, label: "Both" },
            { value: "primary" as const, label: "Me only" },
            { value: "secondary" as const, label: "Wife only" },
          ]).map((opt) => (
            <button
              key={opt.value}
              className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-all ${visibleTo === opt.value ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setVisibleTo(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="text-xs mb-3 px-2 py-1.5 rounded-lg" style={{ color: "var(--accent-red)", background: "rgba(255,90,110,0.1)" }}>
            {error}
          </div>
        )}

        <div className="flex gap-2">
          <button
            className="flex-1 py-2.5 btn-primary text-sm rounded-xl disabled:opacity-35"
            disabled={saving}
            onClick={handleSave}
          >
            {saving ? "Saving..." : "✓ Create"}
          </button>
          <button className="px-5 py-2.5 btn-ghost text-sm rounded-xl" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
