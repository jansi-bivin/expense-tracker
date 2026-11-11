"use client";

import { useMemo, useState } from "react";
import { Category } from "@/lib/supabase";

interface Props {
  monthLabel: string;
  /** Categories counted in the month's budget. */
  categories: Category[];
  /** App's suggestion per category id. */
  suggested: Record<string, number>;
  /** User's own amounts for this month (category id → amount). */
  overrides: Record<string, number>;
  /** Spent so far this month per category name. */
  spent: Map<string, number>;
  onSave: (overrides: Record<string, number>) => Promise<void>;
  onClose: () => void;
}

const fmt = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

/** "Plan this month": what each category is really expected to cost. */
export default function PlanSheet({ monthLabel, categories, suggested, overrides, spent, onSave, onClose }: Props) {
  const [vals, setVals] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    for (const c of categories) {
      const k = String(c.id);
      v[k] = String(overrides[k] ?? suggested[k] ?? 0);
    }
    return v;
  });
  const [saving, setSaving] = useState(false);

  const num = (k: string) => Math.max(0, Number(vals[k]) || 0);
  // Expected ones first (biggest first), then the ₹0 ones by name
  const rows = useMemo(() => [...categories].sort((a, b) => {
    const ea = suggested[String(a.id)] ?? 0, eb = suggested[String(b.id)] ?? 0;
    const sa = overrides[String(a.id)] ?? ea, sb = overrides[String(b.id)] ?? eb;
    if ((sa > 0) !== (sb > 0)) return sb > 0 ? 1 : -1;
    if (sa !== sb) return sb - sa;
    return a.name.localeCompare(b.name);
  }), [categories, suggested, overrides]);

  const likely = categories.reduce((s, c) => s + Math.max(num(String(c.id)) - (spent.get(c.name) || 0), 0), 0);
  const planned = categories.reduce((s, c) => s + num(String(c.id)), 0);

  async function save() {
    setSaving(true);
    const out: Record<string, number> = {};
    for (const c of categories) {
      const k = String(c.id);
      const v = num(k);
      if (v !== (suggested[k] ?? 0)) out[k] = v; // keep only what differs from the app's suggestion
    }
    await onSave(out);
    setSaving(false);
    onClose();
  }

  const field = { background: "rgba(255,255,255,0.06)", border: "1px solid var(--border-light)", color: "var(--text-primary)" };

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-3 animate-fade-in"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(2px)" }} onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl flex flex-col animate-slide-up"
        style={{ background: "var(--bg-elevated)", border: "1px solid rgba(255,255,255,0.1)", maxHeight: "85vh" }}
        onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Plan this month">
        <div className="flex items-start justify-between px-4 pt-4 pb-2">
          <div>
            <div className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>Plan {monthLabel}</div>
            <div className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
              What each category will really cost. Filled in from the last 3 months; change any.
            </div>
          </div>
          <button className="text-sm px-2 py-1 bg-transparent border-0 cursor-pointer" style={{ color: "var(--text-tertiary)" }}
            onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="mx-4 mb-2 px-3 py-2 rounded-xl flex justify-between text-xs" style={{ background: "rgba(255,255,255,0.04)" }}>
          <span style={{ color: "var(--text-secondary)" }}>Planned <b style={{ color: "var(--text-primary)" }}>{fmt(planned)}</b></span>
          <span style={{ color: "var(--text-secondary)" }}>Still to arrange <b style={{ color: "var(--accent)" }}>{fmt(likely)}</b></span>
        </div>

        <div className="overflow-y-auto px-4 pb-2">
          {rows.map((c) => {
            const k = String(c.id);
            const s = spent.get(c.name) || 0;
            const sug = suggested[k] ?? 0;
            const v = num(k);
            const changed = v !== sug;
            return (
              <div key={c.id} className="flex items-center gap-2 py-2" style={{ borderBottom: "1px solid var(--border)", opacity: v === 0 && s === 0 ? 0.55 : 1 }}>
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate" style={{ color: "var(--text-primary)" }}>{c.name}</div>
                  <div className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
                    {s > 0 && <>spent {fmt(s)} · </>}
                    {changed
                      ? <button type="button" className="bg-transparent border-0 p-0 cursor-pointer underline text-[10px]" style={{ color: "var(--text-tertiary)" }}
                          onClick={() => setVals((p) => ({ ...p, [k]: String(sug) }))}>usual {fmt(sug)}</button>
                      : <>usual {fmt(sug)}</>}
                  </div>
                </div>
                <input type="number" inputMode="numeric" min="0" className="w-24 px-2 py-1.5 rounded-lg text-xs text-right"
                  style={{ ...field, color: changed ? "var(--accent-orange)" : field.color }}
                  value={vals[k]} onChange={(e) => setVals((p) => ({ ...p, [k]: e.target.value }))} aria-label={`${c.name} expected`} />
              </div>
            );
          })}
        </div>

        <div className="px-4 pb-4 pt-2">
          <button className="w-full py-2.5 btn-primary text-sm rounded-xl disabled:opacity-35" disabled={saving} onClick={save}>
            {saving ? "Saving…" : "Confirm plan"}
          </button>
        </div>
      </div>
    </div>
  );
}
