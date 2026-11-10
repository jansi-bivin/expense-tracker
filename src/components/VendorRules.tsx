"use client";

import { useMemo, useState } from "react";
import { Category } from "@/lib/supabase";
import { VendorRule, matchVendorRule } from "@/lib/vendorRules";
import { categoryNeedsNote } from "@/lib/dues";

interface Props {
  rules: VendorRule[];
  /** Categories this person can file into. */
  categories: Category[];
  /** All categories, to name a rule's category even if it's no longer usable. */
  allCategories: Category[];
  /** Vendors this person has paid before, most frequent first. */
  vendors: { vendor: string; count: number }[];
  onAdd: (vendor: string, categoryId: number) => void;
  onRemove: (key: string) => void;
}

/** Pair vendors with categories: their new debits are filed without review. */
export default function VendorRules({ rules, categories, allCategories, vendors, onAdd, onRemove }: Props) {
  const [open, setOpen] = useState(false);
  const [vendor, setVendor] = useState("");
  const [categoryId, setCategoryId] = useState("");

  const freeVendors = useMemo(() => vendors.filter((v) => !matchVendorRule(rules, v.vendor)), [vendors, rules]);
  const pickable = useMemo(
    () => categories.filter((c) => !categoryNeedsNote(c.name)).sort((a, b) => a.name.localeCompare(b.name)),
    [categories]
  );
  const sortedRules = useMemo(() => [...rules].sort((a, b) => a.vendor.localeCompare(b.vendor)), [rules]);
  const catName = (id: number) => allCategories.find((c) => c.id === id)?.name ?? "(deleted category)";

  function add() {
    const id = Number(categoryId);
    if (!vendor || !id) return;
    onAdd(vendor, id);
    setVendor("");
    setCategoryId("");
  }

  const selectStyle = { background: "rgba(255,255,255,0.06)", border: "1px solid var(--border-light)", color: "var(--text-primary)" };

  return (
    <div className="card px-3.5 py-3 mt-3">
      <button type="button" className="w-full flex items-center justify-between bg-transparent border-0 p-0 cursor-pointer"
        onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="text-[10px] font-bold tracking-wide" style={{ color: "var(--text-tertiary)" }}>
          ⚡ AUTO-FILE VENDORS{rules.length > 0 ? ` · ${rules.length}` : ""}
        </span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2.5"
          style={{ transition: "transform 0.2s", transform: open ? "rotate(180deg)" : "rotate(0)" }}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="mt-2.5 animate-fade-in">
          <div className="text-[11px] mb-2.5" style={{ color: "var(--text-tertiary)" }}>
            New payments to these vendors go straight into their category, without review.
          </div>

          {sortedRules.length > 0 && (
            <div className="space-y-1.5 mb-3">
              {sortedRules.map((r) => (
                <div key={r.key} className="flex items-center gap-2 text-sm">
                  <span className="flex-1 truncate" style={{ color: "var(--text-secondary)" }}>{r.vendor}</span>
                  <span className="truncate max-w-[45%] text-xs" style={{ color: "var(--text-primary)" }}>→ {catName(r.categoryId)}</span>
                  <button type="button" className="px-1 text-xs bg-transparent border-0 cursor-pointer"
                    style={{ color: "var(--text-tertiary)" }} onClick={() => onRemove(r.key)}
                    aria-label={`Stop auto-filing ${r.vendor}`}>✕</button>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-2">
            <select className="flex-1 min-w-0 px-2 py-2 rounded-lg text-xs" style={selectStyle}
              value={vendor} onChange={(e) => setVendor(e.target.value)} aria-label="Vendor">
              <option value="">{freeVendors.length ? "Vendor you've paid…" : "No more vendors to pair"}</option>
              {freeVendors.map((v) => (
                <option key={v.vendor} value={v.vendor}>{v.vendor} ({v.count})</option>
              ))}
            </select>
            <select className="flex-1 min-w-0 px-2 py-2 rounded-lg text-xs" style={selectStyle}
              value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="Category">
              <option value="">Category…</option>
              {pickable.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <button type="button" className="px-4 py-2 btn-primary text-xs rounded-lg disabled:opacity-35"
              disabled={!vendor || !categoryId} onClick={add}>
              Pair
            </button>
          </div>
          <div className="text-[10px] mt-2" style={{ color: "var(--text-tertiary)" }}>
            New vendor? Tick &ldquo;Auto-file&rdquo; when you file its first payment.
          </div>
        </div>
      )}
    </div>
  );
}
