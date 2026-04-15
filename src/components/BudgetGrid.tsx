"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { supabase, Category, MonthlyBudget } from "@/lib/supabase";

interface Props {
  categories: Category[];
  onCategoriesChange: (cats: Category[]) => void;
  onClose: () => void;
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function inr(n: number): string {
  if (n === 0) return "—";
  return "₹" + n.toLocaleString("en-IN");
}

function inrPlain(n: number): string {
  return n.toLocaleString("en-IN");
}

interface MonthCol {
  month: number;
  year: number;
  key: string;
  label: string;
  isCurrent: boolean;
}

interface CellData {
  cap: number;
  isIncluded: boolean;
  isModified: boolean;
  isDirty: boolean;
}

type GridData = Map<number, Map<string, CellData>>;

export default function BudgetGrid({ categories, onCategoriesChange, onClose }: Props) {
  const [grid, setGrid] = useState<GridData>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editingCell, setEditingCell] = useState<{ catId: number; monthKey: string } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [contextMenu, setContextMenu] = useState<{ catId: number; monthKey: string; x: number; y: number } | null>(null);
  const [showAddUniversal, setShowAddUniversal] = useState(false);
  const [showAddMonthly, setShowAddMonthly] = useState<string | null>(null); // monthKey or null
  const [newCatName, setNewCatName] = useState("");
  const [newCatCap, setNewCatCap] = useState("");
  const [newCatRecurrence, setNewCatRecurrence] = useState<"Monthly" | "Yearly">("Monthly");
  const [editingCat, setEditingCat] = useState<Category | null>(null);
  const [editCatName, setEditCatName] = useState("");
  const [editCatRecurrence, setEditCatRecurrence] = useState<"Monthly" | "Yearly">("Monthly");
  const [editCatVisibility, setEditCatVisibility] = useState<"all" | "primary" | "secondary">("all");
  // Inline edit mode — all categories editable at once
  const [editMode, setEditMode] = useState(false);
  const [catEdits, setCatEdits] = useState<Map<number, { name: string; recurrence: "Monthly" | "Yearly"; visible_to: "all" | "primary" | "secondary" }>>(new Map());
  const inputRef = useRef<HTMLInputElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextReload = useRef(false);

  // Escape key to close
  useEffect(() => {
    function handleKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const now = new Date();
  const curMonth = now.getMonth() + 1;
  const curYear = now.getFullYear();

  const monthlyCategories = useMemo(() => categories.filter(c => c.recurrence === "Monthly"), [categories]);
  const yearlyCategories = useMemo(() => categories.filter(c => c.recurrence === "Yearly"), [categories]);

  const monthCols: MonthCol[] = useMemo(() => {
    const cols: MonthCol[] = [];
    for (let i = 0; i < 12; i++) {
      let m = curMonth + i;
      let y = curYear;
      if (m > 12) { m -= 12; y += 1; }
      const shortYear = String(y).slice(2);
      cols.push({
        month: m, year: y,
        key: `${y}-${m}`,
        label: `${SHORT_MONTHS[m - 1]}'${shortYear}`,
        isCurrent: i === 0,
      });
    }
    return cols;
  }, [curMonth, curYear]);

  useEffect(() => {
    if (skipNextReload.current) {
      skipNextReload.current = false;
      return;
    }
    async function load() {
      setLoading(true);
      const { data } = await supabase
        .from("monthly_budgets")
        .select("*")
        .gte("year", curYear)
        .lte("year", curYear + 1);

      const newGrid: GridData = new Map();
      for (const cat of categories) {
        const monthMap = new Map<string, CellData>();
        // Yearly categories default to 0 per month (planned for a specific month, not spread across all)
        const defaultCap = cat.recurrence === "Yearly" ? 0 : cat.cap;
        for (const col of monthCols) {
          monthMap.set(col.key, { cap: defaultCap, isIncluded: true, isModified: false, isDirty: false });
        }
        newGrid.set(cat.id, monthMap);
      }

      if (data) {
        for (const mb of data as MonthlyBudget[]) {
          const key = `${mb.year}-${mb.month}`;
          const catMap = newGrid.get(mb.category_id);
          if (catMap) {
            const cat = categories.find(c => c.id === mb.category_id);
            const univCap = cat?.cap ?? 0;
            // For yearly categories, a non-zero cell means a specific month is planned
            const isModified = cat?.recurrence === "Yearly"
              ? mb.cap !== 0 || !mb.is_included
              : mb.cap !== univCap || !mb.is_included;
            catMap.set(key, {
              cap: mb.cap, isIncluded: mb.is_included,
              isModified, isDirty: false,
            });
          }
        }
      }
      setGrid(newGrid);
      setLoading(false);
    }
    load();
  }, [categories, monthCols, curMonth, curYear]);

  const hasDirty = useMemo(() => {
    for (const [, months] of grid) {
      for (const [, cell] of months) { if (cell.isDirty) return true; }
    }
    return false;
  }, [grid]);

  function updateCell(catId: number, monthKey: string, cap: number) {
    const cat = categories.find(c => c.id === catId);
    const univCap = cat?.cap ?? 0;
    setGrid(prev => {
      const next = new Map(prev);
      const mm = new Map(next.get(catId) ?? new Map());
      const existing = mm.get(monthKey);
      mm.set(monthKey, { cap, isIncluded: existing?.isIncluded ?? true, isModified: cap !== univCap, isDirty: true });
      next.set(catId, mm);
      return next;
    });
    setSaved(false);
  }

  function toggleIncluded(catId: number, monthKey: string) {
    setGrid(prev => {
      const next = new Map(prev);
      const mm = new Map(next.get(catId) ?? new Map());
      const existing = mm.get(monthKey);
      if (existing) mm.set(monthKey, { ...existing, isIncluded: !existing.isIncluded, isModified: true, isDirty: true });
      next.set(catId, mm);
      return next;
    });
    setSaved(false);
  }

  async function handleSaveAll() {
    setSaving(true);
    const rows: Array<{ month: number; year: number; category_id: number; category_name: string; cap: number; is_included: boolean; updated_at: string }> = [];
    for (const [catId, months] of grid) {
      for (const [monthKey, cell] of months) {
        if (cell.isDirty) {
          const [y, m] = monthKey.split("-").map(Number);
          const cat = categories.find(c => c.id === catId);
          rows.push({ month: m, year: y, category_id: catId, category_name: cat?.name ?? "", cap: cell.cap, is_included: cell.isIncluded, updated_at: new Date().toISOString() });
        }
      }
    }
    if (rows.length > 0) await supabase.from("monthly_budgets").upsert(rows, { onConflict: "month,year,category_id" });

    setGrid(prev => {
      const next = new Map(prev);
      for (const [catId, months] of next) {
        const nm = new Map(months);
        for (const [key, cell] of nm) { if (cell.isDirty) nm.set(key, { ...cell, isDirty: false }); }
        next.set(catId, nm);
      }
      return next;
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function handlePushCellToUniversal(catId: number, monthKey: string) {
    const cell = grid.get(catId)?.get(monthKey);
    if (!cell) return;
    await supabase.from("categories").update({ cap: cell.cap }).eq("id", catId);
    onCategoriesChange(categories.map(c => c.id === catId ? { ...c, cap: cell.cap } : c));
    setContextMenu(null);
  }

  async function handlePushRowToUniversal(catId: number) {
    const monthMap = grid.get(catId);
    if (!monthMap) return;
    const capCounts = new Map<number, number>();
    for (const [, cell] of monthMap) { if (cell.isIncluded) capCounts.set(cell.cap, (capCounts.get(cell.cap) || 0) + 1); }
    let bestCap = 0, bestCount = 0;
    for (const [cap, count] of capCounts) { if (count > bestCount) { bestCap = cap; bestCount = count; } }
    await supabase.from("categories").update({ cap: bestCap }).eq("id", catId);
    onCategoriesChange(categories.map(c => c.id === catId ? { ...c, cap: bestCap } : c));
    setContextMenu(null);
  }

  function handleResetRow(catId: number) {
    const cat = categories.find(c => c.id === catId);
    if (!cat) return;
    setGrid(prev => {
      const next = new Map(prev);
      const mm = new Map<string, CellData>();
      for (const col of monthCols) mm.set(col.key, { cap: cat.cap, isIncluded: true, isModified: false, isDirty: true });
      next.set(catId, mm);
      return next;
    });
    setContextMenu(null);
    setSaved(false);
  }

  async function handleAddUniversal() {
    const name = newCatName.trim();
    if (!name) return;
    const cap = Number(newCatCap) || 0;
    const { data, error } = await supabase.from("categories")
      .insert({ name, cap, recurrence: newCatRecurrence, visible_to: "all" })
      .select().single();
    if (error) { console.error("Add category error:", error); return; }
    if (data) {
      skipNextReload.current = true;
      onCategoriesChange([...categories, data as Category]);
      // Add to local grid immediately
      const newCat = data as Category;
      setGrid(prev => {
        const next = new Map(prev);
        const mm = new Map<string, CellData>();
        // Yearly cap is a lump sum for the whole year — per-month cells stay 0
        // (spending can happen any month and counts against the yearly cap).
        // Monthly cap applies every month — fill each cell with the cap.
        const perMonthCap = newCat.recurrence === "Yearly" ? 0 : newCat.cap;
        for (const col of monthCols) {
          mm.set(col.key, { cap: perMonthCap, isIncluded: true, isModified: false, isDirty: false });
        }
        next.set(newCat.id, mm);
        return next;
      });
      setNewCatName(""); setNewCatCap(""); setShowAddUniversal(false);
    }
  }

  async function handleAddMonthSpecific() {
    if (!showAddMonthly) return;
    const name = newCatName.trim();
    if (!name) return;
    const cap = Number(newCatCap) || 0;
    // Create as Yearly — one-time yearly expense planned for a specific month.
    // Save `cap` on the category too so the yearly total is visible in any month's
    // Planned-vs-Spent view (not just the pinned month).
    const { data, error } = await supabase.from("categories")
      .insert({ name, cap, recurrence: "Yearly", visible_to: "all" })
      .select().single();
    if (error) { console.error("Add category error:", error); return; }
    if (!data) return;
    const newCat = data as Category;
    skipNextReload.current = true;
    onCategoriesChange([...categories, newCat]);

    // Set monthly budget only for the target month
    const [y, m] = showAddMonthly.split("-").map(Number);
    await supabase.from("monthly_budgets").upsert([{
      month: m, year: y,
      category_id: newCat.id, category_name: name,
      cap,
      is_included: true,
      updated_at: new Date().toISOString(),
    }], { onConflict: "month,year,category_id" });

    // Update local grid — yearly categories default to 0 for all months; target month is planned
    setGrid(prev => {
      const next = new Map(prev);
      const mm = new Map<string, CellData>();
      for (const col of monthCols) {
        mm.set(col.key, {
          cap: col.key === showAddMonthly ? cap : 0,
          isIncluded: true,
          isModified: col.key === showAddMonthly,
          isDirty: false, // already saved
        });
      }
      next.set(newCat.id, mm);
      return next;
    });

    setNewCatName(""); setNewCatCap(""); setShowAddMonthly(null);
  }

  function openEditCategory(cat: Category) {
    setEditingCat(cat);
    setEditCatName(cat.name);
    setEditCatRecurrence(cat.recurrence);
    setEditCatVisibility(cat.visible_to);
  }

  async function saveEditCategory() {
    if (!editingCat) return;
    const name = editCatName.trim();
    if (!name) return;
    const oldName = editingCat.name;
    await supabase.from("categories").update({
      name, recurrence: editCatRecurrence, visible_to: editCatVisibility,
    }).eq("id", editingCat.id);
    // If name changed, update all transactions and dues referencing the old name
    if (name !== oldName) {
      await supabase.from("transactions").update({ category: name }).eq("category", oldName);
      await supabase.from("dues").update({ category: name }).eq("category", oldName);
      await supabase.from("monthly_budgets").update({ category_name: name }).eq("category_id", editingCat.id);
    }
    onCategoriesChange(categories.map(c => c.id === editingCat.id
      ? { ...c, name, recurrence: editCatRecurrence, visible_to: editCatVisibility } : c));
    setEditingCat(null);
  }

  // --- Inline edit mode functions ---
  function enterEditMode() {
    const edits = new Map<number, { name: string; recurrence: "Monthly" | "Yearly"; visible_to: "all" | "primary" | "secondary" }>();
    categories.forEach(c => edits.set(c.id, { name: c.name, recurrence: c.recurrence, visible_to: c.visible_to }));
    setCatEdits(edits);
    setEditMode(true);
  }

  function updateCatEdit(catId: number, field: string, value: string) {
    setCatEdits(prev => {
      const next = new Map(prev);
      const cur = next.get(catId);
      if (cur) next.set(catId, { ...cur, [field]: value });
      return next;
    });
  }

  async function saveCatEdits() {
    setSaving(true);
    const updates: Promise<void>[] = [];
    for (const cat of categories) {
      const edit = catEdits.get(cat.id);
      if (!edit) continue;
      const changed = edit.name !== cat.name || edit.recurrence !== cat.recurrence || edit.visible_to !== cat.visible_to;
      if (!changed) continue;
      updates.push((async () => {
        await supabase.from("categories").update({
          name: edit.name, recurrence: edit.recurrence, visible_to: edit.visible_to,
        }).eq("id", cat.id);
        if (edit.name !== cat.name) {
          await supabase.from("transactions").update({ category: edit.name }).eq("category", cat.name);
          await supabase.from("dues").update({ category: edit.name }).eq("category", cat.name);
          await supabase.from("monthly_budgets").update({ category_name: edit.name }).eq("category_id", cat.id);
        }
      })());
    }
    await Promise.all(updates);
    onCategoriesChange(categories.map(c => {
      const edit = catEdits.get(c.id);
      return edit ? { ...c, name: edit.name, recurrence: edit.recurrence, visible_to: edit.visible_to } : c;
    }));
    setEditMode(false);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function deleteCategory(catId: number) {
    if (!confirm("Delete this category? This cannot be undone.")) return;
    await supabase.from("monthly_budgets").delete().eq("category_id", catId);
    await supabase.from("categories").delete().eq("id", catId);
    onCategoriesChange(categories.filter(c => c.id !== catId));
    setEditingCat(null);
    setGrid(prev => { const next = new Map(prev); next.delete(catId); return next; });
  }

  function startEdit(catId: number, monthKey: string) {
    const cell = grid.get(catId)?.get(monthKey);
    setEditingCell({ catId, monthKey });
    setEditValue(cell?.cap?.toString() ?? "0");
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function commitEdit() {
    if (!editingCell) return;
    if (editingCell.monthKey === "universal") {
      commitEditUniversal();
    } else {
      updateCell(editingCell.catId, editingCell.monthKey, Number(editValue) || 0);
      setEditingCell(null);
    }
  }

  function startEditUniversal(catId: number) {
    const cat = categories.find(c => c.id === catId);
    setEditingCell({ catId, monthKey: "universal" });
    setEditValue(cat?.cap?.toString() ?? "0");
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  async function commitEditUniversal() {
    if (editingCell?.monthKey === "universal") {
      const newCap = Number(editValue) || 0;
      await supabase.from("categories").update({ cap: newCap }).eq("id", editingCell.catId);
      onCategoriesChange(categories.map(c => c.id === editingCell.catId ? { ...c, cap: newCap } : c));
      setEditingCell(null);
    }
  }

  const handleLongPress = useCallback((catId: number, monthKey: string, e: React.TouchEvent | React.MouseEvent) => {
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    longPressTimer.current = setTimeout(() => {
      setContextMenu({ catId, monthKey, x: rect.left, y: rect.bottom + 4 });
    }, 500);
  }, []);

  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  }, []);

  function colTotal(monthKey: string, cats: Category[]): number {
    let sum = 0;
    for (const cat of cats) {
      const cell = grid.get(cat.id)?.get(monthKey);
      if (cell?.isIncluded) sum += cell.cap;
    }
    return sum;
  }

  function rowTotal(catId: number): number {
    const cat = categories.find(c => c.id === catId);
    const months = grid.get(catId);
    if (!months) return cat?.cap ?? 0;
    let sum = 0;
    for (const col of monthCols) {
      const cell = months.get(col.key);
      if (cell?.isIncluded) sum += cell.cap;
    }
    // Yearly lump-sum categories keep per-month cells at 0 — the yearly cap
    // is the real annual commitment. Fall back to cat.cap when the month
    // sum is smaller so the Year Total column reflects the yearly allocation.
    if (cat?.recurrence === "Yearly") {
      return Math.max(sum, cat.cap);
    }
    return sum;
  }

  // Shared cell renderer
  function renderCell(cat: Category, col: MonthCol) {
    const cell = grid.get(cat.id)?.get(col.key);
    if (!cell) return <td key={col.key} />;
    const isEditing = editingCell?.catId === cat.id && editingCell.monthKey === col.key;
    return (
      <td key={col.key}
        className="px-1 py-1.5 text-center text-[12px] cursor-pointer select-none"
        style={{
          background: cell.isDirty ? "rgba(123,108,246,0.08)"
            : cell.isModified ? "rgba(123,108,246,0.04)"
            : col.isCurrent ? "rgba(123,108,246,0.02)" : "transparent",
          color: !cell.isIncluded ? "var(--text-tertiary)"
            : cell.isModified ? "var(--accent)" : "var(--text-secondary)",
          borderBottom: "1px solid rgba(255,255,255,0.04)",
          opacity: cell.isIncluded ? 1 : 0.35,
          textDecoration: cell.isIncluded ? "none" : "line-through",
        }}
        onClick={() => !isEditing && startEdit(cat.id, col.key)}
        onTouchStart={e => handleLongPress(cat.id, col.key, e)}
        onTouchEnd={cancelLongPress}
        onMouseDown={e => handleLongPress(cat.id, col.key, e)}
        onMouseUp={cancelLongPress}
        onMouseLeave={cancelLongPress}
        onContextMenu={e => {
          e.preventDefault();
          const rect = (e.target as HTMLElement).getBoundingClientRect();
          setContextMenu({ catId: cat.id, monthKey: col.key, x: rect.left, y: rect.bottom + 4 });
        }}>
        {isEditing ? (
          <input ref={inputRef} type="number"
            className="w-full text-center text-[12px] bg-transparent outline-none"
            style={{ color: "var(--accent)" }}
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={e => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditingCell(null); }}
          />
        ) : (
          <span>{cell.isIncluded ? inrPlain(cell.cap) : "—"}</span>
        )}
      </td>
    );
  }

  // Shared section renderer
  function renderSection(title: string, cats: Category[], isYearly: boolean) {
    if (cats.length === 0) return null;
    return (
      <>
        {/* Section header */}
        <tr>
          <td colSpan={monthCols.length + 3}
            className="sticky left-0 px-3 py-2 text-[11px] font-bold uppercase tracking-wider"
            style={{ background: "var(--bg-elevated)", color: "var(--text-tertiary)", borderBottom: "1px solid var(--border)", borderTop: "1px solid var(--border)" }}>
            {title}
          </td>
        </tr>

        {/* Category rows */}
        {cats.map(cat => {
          const catEdit = editMode ? catEdits.get(cat.id) : null;
          return (
          <React.Fragment key={cat.id}>
          <tr>
            <td className="sticky left-0 z-10 px-3 py-1.5 text-[12px] font-medium"
              style={{
                background: "var(--bg-base)", color: "var(--text-primary)",
                minWidth: 160, maxWidth: 200,
                borderBottom: editMode ? "none" : "1px solid rgba(255,255,255,0.04)", borderRight: "1px solid var(--border)",
                cursor: editMode ? "default" : "pointer",
              }}
              title={editMode ? undefined : `${cat.name} — click to edit`}
              onClick={editMode ? undefined : () => openEditCategory(cat)}>
              {editMode && catEdit ? (
                <input type="text" className="w-full bg-transparent outline-none text-[12px] font-medium"
                  style={{ color: "var(--text-primary)" }}
                  value={catEdit.name}
                  onChange={e => updateCatEdit(cat.id, "name", e.target.value)} />
              ) : (
                <>
                  <span>{cat.name}</span>
                  <span className="ml-1 text-[9px]" style={{ color: "var(--text-tertiary)", opacity: 0.5 }}>✎</span>
                </>
              )}
            </td>
            <td className="sticky px-2 py-1.5 text-center text-[12px] cursor-pointer"
              style={{
                background: "var(--bg-base)", color: "var(--accent)",
                borderBottom: "1px solid rgba(255,255,255,0.04)", borderRight: "1px solid rgba(123,108,246,0.08)",
                left: 160,
              }}
              onClick={() => startEditUniversal(cat.id)}>
              {editingCell?.catId === cat.id && editingCell.monthKey === "universal" ? (
                <input ref={inputRef} type="number"
                  className="w-full text-center text-[12px] bg-transparent outline-none"
                  style={{ color: "var(--accent)" }}
                  value={editValue}
                  onChange={e => setEditValue(e.target.value)}
                  onBlur={commitEditUniversal}
                  onKeyDown={e => { if (e.key === "Enter") commitEditUniversal(); }}
                />
              ) : (
                <span>{inrPlain(cat.cap)}</span>
              )}
            </td>
            {monthCols.map(col => renderCell(cat, col))}
            <td className="px-2 py-1.5 text-center text-[11px] font-semibold"
              style={{ color: "var(--text-tertiary)", borderBottom: editMode ? "none" : "1px solid rgba(255,255,255,0.04)", borderLeft: "1px solid var(--border)" }}>
              {inr(rowTotal(cat.id))}
            </td>
          </tr>
          {/* Inline edit row — shown for every category when edit mode is on */}
          {editMode && catEdit && (
            <tr>
              <td colSpan={monthCols.length + 3}
                className="sticky left-0 px-3 py-1.5"
                style={{ background: "rgba(123,108,246,0.03)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="flex items-center gap-3 flex-wrap">
                  {/* Recurrence toggle */}
                  <div className="flex items-center gap-1">
                    <span className="text-[9px] font-semibold" style={{ color: "var(--text-tertiary)" }}>Recurrence:</span>
                    {(["Monthly", "Yearly"] as const).map(r => (
                      <button key={r} className="px-2 py-0.5 rounded text-[10px] font-semibold"
                        style={{
                          background: catEdit.recurrence === r ? "var(--accent)" : "rgba(255,255,255,0.06)",
                          color: catEdit.recurrence === r ? "#fff" : "var(--text-tertiary)",
                        }}
                        onClick={() => updateCatEdit(cat.id, "recurrence", r)}>{r}</button>
                    ))}
                  </div>
                  {/* Visibility toggle */}
                  <div className="flex items-center gap-1">
                    <span className="text-[9px] font-semibold" style={{ color: "var(--text-tertiary)" }}>Visible:</span>
                    {([
                      { value: "all" as const, label: "Both" },
                      { value: "primary" as const, label: "Me" },
                      { value: "secondary" as const, label: "Wife" },
                    ]).map(opt => (
                      <button key={opt.value} className="px-2 py-0.5 rounded text-[10px] font-semibold"
                        style={{
                          background: catEdit.visible_to === opt.value ? "var(--accent)" : "rgba(255,255,255,0.06)",
                          color: catEdit.visible_to === opt.value ? "#fff" : "var(--text-tertiary)",
                        }}
                        onClick={() => updateCatEdit(cat.id, "visible_to", opt.value)}>{opt.label}</button>
                    ))}
                  </div>
                  {/* Delete */}
                  <button className="px-2 py-0.5 rounded text-[10px] font-semibold"
                    style={{ color: "var(--accent-red)", background: "rgba(255,90,110,0.08)" }}
                    onClick={() => deleteCategory(cat.id)}>Delete</button>
                </div>
              </td>
            </tr>
          )}
          </React.Fragment>
          );
        })}

        {/* Section subtotal */}
        <tr>
          <td className="sticky left-0 z-10 px-3 py-1.5 text-[11px] font-bold"
            style={{ background: "rgba(255,255,255,0.02)", color: "var(--text-secondary)", borderBottom: "1px solid var(--border)", borderRight: "1px solid var(--border)" }}>
            Subtotal
          </td>
          <td className="sticky px-2 py-1.5 text-center text-[11px] font-bold"
            style={{ background: "var(--bg-elevated)", color: "var(--accent)", borderBottom: "1px solid var(--border)", borderRight: "1px solid rgba(123,108,246,0.08)", left: 160 }}>
            {inr(cats.reduce((s, c) => s + c.cap, 0))}
          </td>
          {monthCols.map(col => (
            <td key={col.key} className="px-1 py-1.5 text-center text-[11px] font-bold"
              style={{ background: col.isCurrent ? "rgba(123,108,246,0.04)" : "rgba(255,255,255,0.02)", color: col.isCurrent ? "var(--accent)" : "var(--text-secondary)", borderBottom: "1px solid var(--border)" }}>
              {inr(colTotal(col.key, cats))}
            </td>
          ))}
          <td className="px-2 py-1.5 text-center text-[11px] font-bold"
            style={{ color: "var(--text-secondary)", borderBottom: "1px solid var(--border)", borderLeft: "1px solid var(--border)" }}>
            {inr(cats.reduce((s, c) => s + rowTotal(c.id), 0))}
          </td>
        </tr>
      </>
    );
  }

  if (loading) return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.7)" }}>
      <div className="w-8 h-8 rounded-full border-2 border-transparent animate-spin"
        style={{ borderTopColor: "var(--accent)", borderRightColor: "var(--accent)" }} />
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: "var(--bg-base)" }}>
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3"
        style={{ background: "var(--bg-elevated)", borderBottom: "1px solid var(--border)" }}>
        <div className="flex items-center gap-3">
          <button className="text-sm px-2 py-1 rounded-lg" style={{ color: "var(--accent)" }}
            onClick={onClose}>←</button>
          <div>
          <div className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>Categories & Budget</div>
          <div className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
            {monthlyCategories.length} monthly + {yearlyCategories.length} yearly categories
            {hasDirty && <span style={{ color: "var(--accent)" }}> — unsaved changes</span>}
          </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {editMode ? (
            <>
              <button className="text-[11px] px-3 py-1.5 rounded-lg font-semibold"
                style={{ background: "var(--accent)", color: "#fff" }}
                disabled={saving}
                onClick={saveCatEdits}>
                {saving ? "Saving..." : "Save Categories"}
              </button>
              <button className="text-[11px] px-3 py-1.5 rounded-lg"
                style={{ color: "var(--text-tertiary)", background: "rgba(255,255,255,0.06)" }}
                onClick={() => setEditMode(false)}>Cancel</button>
            </>
          ) : (
            <>
              <button className="text-[11px] px-3 py-1.5 rounded-lg font-semibold"
                style={{ color: "var(--accent)", background: "rgba(123,108,246,0.1)" }}
                onClick={enterEditMode}>✎ Edit</button>
              <button className="text-[11px] px-3 py-1.5 rounded-lg font-semibold"
                style={{
                  background: saved ? "rgba(74,222,128,0.15)" : hasDirty ? "var(--accent)" : "rgba(255,255,255,0.06)",
                  color: saved ? "#4ade80" : hasDirty ? "#fff" : "var(--text-tertiary)",
                }}
                disabled={saving || !hasDirty}
                onClick={handleSaveAll}>
                {saving ? "Saving..." : saved ? "✓ Saved" : "Save All"}
              </button>
              <button className="text-[11px] px-3 py-1.5 rounded-lg"
                style={{ color: "var(--text-tertiary)", background: "rgba(255,255,255,0.06)" }}
                onClick={onClose}>Close</button>
            </>
          )}
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-auto" style={{ WebkitOverflowScrolling: "touch" }}>
        <table className="border-collapse w-full" style={{ minWidth: "max-content" }}>
          <thead>
            <tr className="sticky top-0 z-30" style={{ background: "var(--bg-elevated)" }}>
              <th className="sticky left-0 z-40 px-3 py-2 text-left text-[11px] font-bold"
                style={{ background: "var(--bg-elevated)", color: "var(--text-tertiary)", minWidth: 160, maxWidth: 200, borderBottom: "2px solid var(--border)", borderRight: "1px solid var(--border)" }}>
                Category
              </th>
              <th className="sticky z-30 px-2 py-2 text-center text-[10px] font-bold"
                style={{ background: "var(--bg-elevated)", color: "var(--accent)", minWidth: 80, borderBottom: "2px solid var(--border)", borderRight: "1px solid rgba(123,108,246,0.15)", left: 160 }}>
                <div className="flex items-center justify-center gap-1">
                  <span>Universal</span>
                  <button className="text-[10px] w-4 h-4 rounded flex items-center justify-center"
                    style={{ background: "rgba(123,108,246,0.2)", color: "var(--accent)" }}
                    onClick={() => { setShowAddUniversal(true); setShowAddMonthly(null); }}
                    title="Add universal category">+</button>
                </div>
              </th>
              {monthCols.map(col => (
                <th key={col.key} className="px-1 py-2 text-center text-[10px] font-bold"
                  style={{
                    background: col.isCurrent ? "rgba(123,108,246,0.06)" : "var(--bg-elevated)",
                    color: col.isCurrent ? "var(--accent)" : "var(--text-tertiary)",
                    minWidth: 80, width: 80, maxWidth: 80,
                    borderBottom: "2px solid var(--border)",
                    overflow: "hidden",
                  }}>
                  <div className="flex items-center justify-center gap-0.5" style={{ whiteSpace: "nowrap" }}>
                    <span>{col.label}</span>
                    <button className="text-[8px] w-3.5 h-3.5 rounded flex-shrink-0 flex items-center justify-center opacity-40 hover:opacity-100"
                      style={{ background: "rgba(255,255,255,0.1)", color: "var(--text-tertiary)" }}
                      onClick={() => { setShowAddMonthly(col.key); setShowAddUniversal(false); }}
                      title={`Add category for ${col.label} only`}>+</button>
                  </div>
                </th>
              ))}
              <th className="px-2 py-2 text-center text-[10px] font-bold"
                style={{ background: "var(--bg-elevated)", color: "var(--text-tertiary)", minWidth: 90, borderBottom: "2px solid var(--border)", borderLeft: "1px solid var(--border)" }}>
                Year Total
              </th>
            </tr>
          </thead>
          <tbody>
            {renderSection("Monthly", monthlyCategories, false)}
            {renderSection("Yearly", yearlyCategories, true)}

            {/* Grand total */}
            <tr>
              <td className="sticky left-0 z-10 px-3 py-2 text-[12px] font-bold"
                style={{ background: "var(--bg-elevated)", color: "var(--text-primary)", borderTop: "2px solid var(--border)", borderRight: "1px solid var(--border)" }}>
                GRAND TOTAL
              </td>
              <td className="sticky px-2 py-2 text-center text-[12px] font-bold"
                style={{ background: "var(--bg-elevated)", color: "var(--accent)", borderTop: "2px solid var(--border)", borderRight: "1px solid rgba(123,108,246,0.08)", left: 160 }}>
                {inr(monthlyCategories.reduce((s, c) => s + c.cap, 0) + yearlyCategories.reduce((s, c) => s + c.cap, 0))}
              </td>
              {monthCols.map(col => (
                <td key={col.key} className="px-1 py-2 text-center text-[12px] font-bold"
                  style={{
                    background: col.isCurrent ? "rgba(123,108,246,0.06)" : "var(--bg-elevated)",
                    color: col.isCurrent ? "var(--accent)" : "var(--text-primary)",
                    borderTop: "2px solid var(--border)",
                  }}>
                  {inr(colTotal(col.key, monthlyCategories) + colTotal(col.key, yearlyCategories))}
                </td>
              ))}
              <td className="px-2 py-2 text-center text-[12px] font-bold"
                style={{ background: "var(--bg-elevated)", color: "var(--text-primary)", borderTop: "2px solid var(--border)", borderLeft: "1px solid var(--border)" }}>
                {inr(
                  monthCols.reduce((s, col) => s + colTotal(col.key, monthlyCategories), 0)
                  + yearlyCategories.reduce((s, c) => s + c.cap, 0)
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Category edit modal */}
      {editingCat && (
        <>
          <div className="fixed inset-0 z-50" style={{ background: "rgba(0,0,0,0.5)" }} onClick={() => setEditingCat(null)} />
          <div className="fixed z-50 rounded-2xl p-5 shadow-xl"
            style={{
              top: "50%", left: "50%", transform: "translate(-50%, -50%)",
              background: "var(--bg-elevated)", border: "1px solid var(--border)",
              minWidth: 320, maxWidth: 400,
            }}>
            <div className="text-sm font-bold mb-4" style={{ color: "var(--text-primary)" }}>Edit Category</div>

            <div className="text-[10px] font-semibold mb-1" style={{ color: "var(--text-tertiary)" }}>Name</div>
            <input type="text" className="w-full px-3 py-2 text-sm rounded-xl mb-3"
              value={editCatName} onChange={e => setEditCatName(e.target.value)} autoFocus />

            <div className="text-[10px] font-semibold mb-1" style={{ color: "var(--text-tertiary)" }}>Recurrence</div>
            <div className="flex gap-2 mb-3">
              {(["Monthly", "Yearly"] as const).map(r => (
                <button key={r} className="flex-1 py-2 rounded-xl text-xs font-semibold"
                  style={{
                    background: editCatRecurrence === r ? "var(--accent)" : "rgba(255,255,255,0.06)",
                    color: editCatRecurrence === r ? "#fff" : "var(--text-tertiary)",
                  }}
                  onClick={() => setEditCatRecurrence(r)}>{r}</button>
              ))}
            </div>

            <div className="text-[10px] font-semibold mb-1" style={{ color: "var(--text-tertiary)" }}>Visible to</div>
            <div className="flex gap-2 mb-4">
              {([
                { value: "all" as const, label: "Both" },
                { value: "primary" as const, label: "Me only" },
                { value: "secondary" as const, label: "Wife only" },
              ]).map(opt => (
                <button key={opt.value} className="flex-1 py-2 rounded-xl text-xs font-semibold"
                  style={{
                    background: editCatVisibility === opt.value ? "var(--accent)" : "rgba(255,255,255,0.06)",
                    color: editCatVisibility === opt.value ? "#fff" : "var(--text-tertiary)",
                  }}
                  onClick={() => setEditCatVisibility(opt.value)}>{opt.label}</button>
              ))}
            </div>

            <div className="flex gap-2">
              <button className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
                style={{ background: "var(--accent)", color: "#fff" }}
                onClick={saveEditCategory}>Save</button>
              <button className="px-4 py-2.5 rounded-xl text-sm"
                style={{ color: "var(--text-tertiary)", background: "rgba(255,255,255,0.06)" }}
                onClick={() => setEditingCat(null)}>Cancel</button>
              <button className="px-4 py-2.5 rounded-xl text-sm"
                style={{ color: "var(--accent-red)", background: "rgba(255,90,110,0.08)" }}
                onClick={() => deleteCategory(editingCat.id)}>Delete</button>
            </div>
          </div>
        </>
      )}

      {/* Context menu */}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-50" onClick={() => setContextMenu(null)} />
          <div className="fixed z-50 rounded-xl p-1 shadow-lg"
            style={{
              left: Math.min(contextMenu.x, window.innerWidth - 220),
              top: Math.min(contextMenu.y, window.innerHeight - 180),
              background: "var(--bg-elevated)", border: "1px solid var(--border)", minWidth: 200,
            }}>
            <button className="w-full text-left px-3 py-2 text-xs rounded-lg hover:bg-white/5"
              style={{ color: "var(--text-primary)" }}
              onClick={() => { toggleIncluded(contextMenu.catId, contextMenu.monthKey); setContextMenu(null); }}>
              {grid.get(contextMenu.catId)?.get(contextMenu.monthKey)?.isIncluded ? "Exclude from this month" : "Include in this month"}
            </button>
            <button className="w-full text-left px-3 py-2 text-xs rounded-lg hover:bg-white/5"
              style={{ color: "var(--accent)" }}
              onClick={() => handlePushCellToUniversal(contextMenu.catId, contextMenu.monthKey)}>
              Push this cell to universal
            </button>
            <button className="w-full text-left px-3 py-2 text-xs rounded-lg hover:bg-white/5"
              style={{ color: "var(--accent)" }}
              onClick={() => handlePushRowToUniversal(contextMenu.catId)}>
              Push entire row to universal
            </button>
            <button className="w-full text-left px-3 py-2 text-xs rounded-lg hover:bg-white/5"
              style={{ color: "var(--text-tertiary)" }}
              onClick={() => handleResetRow(contextMenu.catId)}>
              Reset row to universal defaults
            </button>
          </div>
        </>
      )}

      {/* Bottom bar — add category forms */}
      {(showAddUniversal || showAddMonthly) && (
        <div className="px-4 py-3"
          style={{ background: "var(--bg-elevated)", borderTop: "1px solid var(--border)" }}>
          <div className="text-[10px] font-bold mb-2" style={{ color: showAddUniversal ? "var(--accent)" : "var(--text-secondary)" }}>
            {showAddUniversal
              ? (newCatRecurrence === "Yearly"
                  ? "Add Yearly Category (lump-sum cap for the whole year — spend any month)"
                  : "Add Monthly Category (cap applies every month)")
              : `Add Yearly One-time Expense for ${monthCols.find(c => c.key === showAddMonthly)?.label}`}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {showAddUniversal && (
              <div className="flex gap-1">
                {(["Monthly", "Yearly"] as const).map(r => (
                  <button key={r} className="text-[10px] px-2 py-1 rounded font-semibold"
                    style={{
                      background: newCatRecurrence === r ? "var(--accent)" : "rgba(255,255,255,0.06)",
                      color: newCatRecurrence === r ? "#fff" : "var(--text-tertiary)",
                    }}
                    onClick={() => setNewCatRecurrence(r)}>{r}</button>
                ))}
              </div>
            )}
            <input type="text" placeholder="Category name" className="px-2 py-1.5 text-xs rounded-lg flex-1"
              style={{ maxWidth: 180 }}
              value={newCatName} onChange={e => setNewCatName(e.target.value)} autoFocus />
            <div className="flex items-center gap-1">
              <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>₹</span>
              <input type="number"
                placeholder={showAddUniversal && newCatRecurrence === "Yearly" ? "Yearly cap" : "Cap"}
                className="px-2 py-1.5 text-xs rounded-lg"
                style={{ width: 100 }}
                value={newCatCap} onChange={e => setNewCatCap(e.target.value)} />
            </div>
            <button className="text-[11px] px-3 py-1.5 rounded-lg font-semibold"
              style={{ background: "var(--accent)", color: "#fff" }}
              onClick={showAddUniversal ? handleAddUniversal : handleAddMonthSpecific}>Add</button>
            <button className="text-[11px] px-2 py-1.5"
              style={{ color: "var(--text-tertiary)" }}
              onClick={() => { setShowAddUniversal(false); setShowAddMonthly(null); setNewCatName(""); setNewCatCap(""); }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
