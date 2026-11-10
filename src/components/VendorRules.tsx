"use client";

import { useMemo, useState } from "react";
import { Category } from "@/lib/supabase";
import { VendorRule, matchVendorRule } from "@/lib/vendorRules";
import { categoryNeedsNote } from "@/lib/dues";

type VendorCount = { vendor: string; count: number };

interface Props {
  /** This person's own pairings (seen only on their profile). */
  myRules: VendorRule[];
  /** Pairings for both people. */
  sharedRules: VendorRule[];
  /** Categories this person can file into. */
  categories: Category[];
  /** All categories, to name a rule's category even if it's no longer usable. */
  allCategories: Category[];
  /** Vendors this person has paid / both people have paid, most frequent first. */
  vendorsMine: VendorCount[];
  vendorsBoth: VendorCount[];
  onAdd: (vendor: string, categoryId: number, shared: boolean) => void;
  onRemove: (key: string, shared: boolean) => void;
  onSetShared: (key: string, toShared: boolean) => void;
}

/** Pair vendors with categories: their new debits are filed without review. */
export default function VendorRules({
  myRules, sharedRules, categories, allCategories, vendorsMine, vendorsBoth, onAdd, onRemove, onSetShared,
}: Props) {
  const [open, setOpen] = useState(false);
  const [shared, setShared] = useState(false);
  const [vendor, setVendor] = useState("");
  const [categoryId, setCategoryId] = useState("");

  const isSharedCategory = (id: number) => allCategories.some((c) => c.id === id && c.visible_to === "all");
  const catName = (id: number) => allCategories.find((c) => c.id === id)?.name ?? "(deleted category)";

  const scopeRules = shared ? sharedRules : myRules;
  const freeVendors = useMemo(
    () => (shared ? vendorsBoth : vendorsMine).filter((v) => !matchVendorRule(scopeRules, v.vendor)),
    [shared, vendorsBoth, vendorsMine, scopeRules]
  );
  const pickable = useMemo(
    () => categories
      .filter((c) => !categoryNeedsNote(c.name) && (!shared || c.visible_to === "all"))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [categories, shared]
  );
  const rows = useMemo(
    () => [
      ...myRules.map((rule) => ({ rule, shared: false })),
      ...sharedRules.map((rule) => ({ rule, shared: true })),
    ].sort((a, b) => a.rule.vendor.localeCompare(b.rule.vendor)),
    [myRules, sharedRules]
  );

  function chooseScope(next: boolean) {
    setShared(next);
    // Keep the picks only if they still fit the new choice
    if (next && categoryId && !isSharedCategory(Number(categoryId))) setCategoryId("");
    if (!next && vendor && !vendorsMine.some((v) => v.vendor === vendor)) setVendor("");
  }

  function add() {
    const id = Number(categoryId);
    if (!vendor || !id) return;
    onAdd(vendor, id, shared);
    setVendor("");
    setCategoryId("");
  }

  const selectStyle = { background: "rgba(255,255,255,0.06)", border: "1px solid var(--border-light)", color: "var(--text-primary)" };
  const chip = (on: boolean) => ({
    background: on ? "rgba(123,108,246,0.18)" : "transparent",
    color: on ? "var(--accent)" : "var(--text-tertiary)",
    border: `1px solid ${on ? "rgba(123,108,246,0.35)" : "var(--border-light)"}`,
  });

  return (
    <div className="card px-3.5 py-3 mt-3">
      <button type="button" className="w-full flex items-center justify-between bg-transparent border-0 p-0 cursor-pointer"
        onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="text-[10px] font-bold tracking-wide" style={{ color: "var(--text-tertiary)" }}>
          ⚡ AUTO-FILE VENDORS{rows.length > 0 ? ` · ${rows.length}` : ""}
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
            &ldquo;Both&rdquo; pairings apply to each of your own payments.
          </div>

          {rows.length > 0 && (
            <div className="space-y-1.5 mb-3">
              {rows.map(({ rule, shared: isShared }) => {
                const canMove = isShared || isSharedCategory(rule.categoryId);
                return (
                  <div key={`${isShared ? "s" : "m"}:${rule.key}`} className="flex items-center gap-2 text-sm">
                    <span className="flex-1 min-w-0 truncate" style={{ color: "var(--text-secondary)" }}>{rule.vendor}</span>
                    <span className="truncate max-w-[38%] text-xs" style={{ color: "var(--text-primary)" }}>→ {catName(rule.categoryId)}</span>
                    <button type="button" disabled={!canMove}
                      className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                      style={chip(isShared)}
                      title={!canMove ? `"${catName(rule.categoryId)}" is only on your profile, so this can't apply to both`
                        : isShared ? "Applies to both of you · tap to keep it just for you" : "Only for you · tap to apply it to both of you"}
                      onClick={() => onSetShared(rule.key, !isShared)}>
                      {isShared ? "Both" : "Only me"}
                    </button>
                    <button type="button" className="shrink-0 px-1 text-xs bg-transparent border-0 cursor-pointer"
                      style={{ color: "var(--text-tertiary)" }} onClick={() => onRemove(rule.key, isShared)}
                      aria-label={`Stop auto-filing ${rule.vendor}`}>✕</button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex gap-1.5 mb-2" role="radiogroup" aria-label="Who this pairing is for">
            <button type="button" role="radio" aria-checked={!shared} className="px-3 py-1 rounded-full text-[11px] font-semibold cursor-pointer"
              style={chip(!shared)} onClick={() => chooseScope(false)}>Only me</button>
            <button type="button" role="radio" aria-checked={shared} className="px-3 py-1 rounded-full text-[11px] font-semibold cursor-pointer"
              style={chip(shared)} onClick={() => chooseScope(true)}>Both of us</button>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <select className="flex-1 min-w-0 px-2 py-2 rounded-lg text-xs" style={selectStyle}
              value={vendor} onChange={(e) => setVendor(e.target.value)} aria-label="Vendor">
              <option value="">{freeVendors.length ? (shared ? "Vendor either of you paid…" : "Vendor you've paid…") : "No more vendors to pair"}</option>
              {freeVendors.map((v) => (
                <option key={v.vendor} value={v.vendor}>{v.vendor} ({v.count})</option>
              ))}
            </select>
            <select className="flex-1 min-w-0 px-2 py-2 rounded-lg text-xs" style={selectStyle}
              value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="Category">
              <option value="">{shared ? "Category you both have…" : "Category…"}</option>
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
