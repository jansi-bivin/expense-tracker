"use client";

import { useState, useMemo } from "react";
import { supabase, Transaction, Category, Due } from "@/lib/supabase";

interface Props {
  dues: Due[];
  transactions: Transaction[];
  categories: Category[];
  onDuesChange: (dues: Due[]) => void;
  payeeUpi: string | null;
  payeeName: string;
  isPrimary: boolean;
  primaryName: string;
}

export default function DuesView({ dues, transactions, categories, onDuesChange, payeeUpi, payeeName, isPrimary, primaryName }: Props) {
  const [expandedCat, setExpandedCat] = useState<string | null>(null);
  const [showCleared, setShowCleared] = useState(false);
  const [clearing, setClearing] = useState<Set<number>>(new Set());

  const fmt = (n: number) => "\u20B9" + n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const fmtDate = (ts: number) => new Date(ts).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });

  const unclearedDues = useMemo(() => dues.filter((d) => !d.cleared), [dues]);
  const clearedDues = useMemo(() => dues.filter((d) => d.cleared), [dues]);

  const totalOutstanding = useMemo(
    () => unclearedDues.reduce((sum, d) => sum + Number(d.amount), 0),
    [unclearedDues]
  );

  // Group uncleared dues by category
  const byCategory = useMemo(() => {
    const map = new Map<string, Due[]>();
    for (const d of unclearedDues) {
      const arr = map.get(d.category) || [];
      arr.push(d);
      map.set(d.category, arr);
    }
    return Array.from(map.entries()).sort((a, b) => {
      const totalA = a[1].reduce((s, d) => s + Number(d.amount), 0);
      const totalB = b[1].reduce((s, d) => s + Number(d.amount), 0);
      return totalB - totalA;
    });
  }, [unclearedDues]);

  // Map transaction_id → Transaction for display
  const txnMap = useMemo(() => {
    const m = new Map<number, Transaction>();
    for (const t of transactions) m.set(t.id, t);
    return m;
  }, [transactions]);

  const [showPaySheet, setShowPaySheet] = useState<number | null>(null);

  const upiApps = [
    { name: "GPay", pkg: "com.google.android.apps.nbu.paisa.user", gradient: "linear-gradient(135deg, #ffffff, #f0f0f0)", text: "var(--bg-base)" },
    { name: "PhonePe", pkg: "com.phonepe.app", gradient: "linear-gradient(135deg, #5f259f, #4a1d80)", text: "#fff" },
    { name: "Paytm", pkg: "net.one97.paytm", gradient: "linear-gradient(135deg, #00b9f1, #0091c8)", text: "#fff" },
  ];

  function openUpiPay(amount: number) {
    if (!payeeUpi) return;
    // Copy amount + VPA to clipboard
    navigator.clipboard.writeText(amount.toFixed(2)).catch(() => {});
    setShowPaySheet(amount);
  }

  function launchApp(pkg: string) {
    const bridge = (window as unknown as Record<string, unknown>).AndroidUpi as
      | { openApp: (pkg: string) => void }
      | undefined;
    if (bridge?.openApp) {
      bridge.openApp(pkg);
    }
    setShowPaySheet(null);
  }

  async function clearDue(dueId: number) {
    setClearing((prev) => new Set(prev).add(dueId));
    await supabase.from("dues").update({ cleared: true, cleared_at: new Date().toISOString() }).eq("id", dueId);
    onDuesChange(dues.map((d) => d.id === dueId ? { ...d, cleared: true, cleared_at: new Date().toISOString() } : d));
    setClearing((prev) => { const s = new Set(prev); s.delete(dueId); return s; });
  }

  async function clearCategory(category: string) {
    const ids = unclearedDues.filter((d) => d.category === category).map((d) => d.id);
    setClearing((prev) => { const s = new Set(prev); ids.forEach((id) => s.add(id)); return s; });
    const now = new Date().toISOString();
    await supabase.from("dues").update({ cleared: true, cleared_at: now }).in("id", ids);
    onDuesChange(dues.map((d) => ids.includes(d.id) ? { ...d, cleared: true, cleared_at: now } : d));
    setClearing((prev) => { const s = new Set(prev); ids.forEach((id) => s.delete(id)); return s; });
    setExpandedCat(null);
  }

  if (unclearedDues.length === 0 && clearedDues.length === 0) {
    return (
      <div className="text-center py-16" style={{ color: "var(--text-tertiary)" }}>
        <div className="text-4xl mb-3">&#10003;</div>
        <div className="text-lg">{isPrimary ? "No dues to pay" : "No dues pending"}</div>
      </div>
    );
  }

  return (
    <div>
      {/* Summary card */}
      {totalOutstanding > 0 && (
        <div className={`glass-elevated rounded-xl p-4 mb-4 ${isPrimary ? "glow-red" : "glow-green"}`}>
          <div className="text-sm mb-1" style={{ color: "var(--text-secondary)" }}>
            {isPrimary ? `You owe ${payeeName}` : `${primaryName} owes you`}
          </div>
          <div className="text-2xl font-bold" style={{ color: isPrimary ? "var(--accent-red)" : "var(--accent-green)" }}>{fmt(totalOutstanding)}</div>
          <div className="text-xs mt-1" style={{ color: "var(--text-tertiary)" }}>
            {unclearedDues.length} transaction{unclearedDues.length !== 1 ? "s" : ""} across {byCategory.length} categor{byCategory.length !== 1 ? "ies" : "y"}
          </div>
          {isPrimary && payeeUpi && (
            <button
              className="w-full mt-3 py-2 btn-gradient text-white rounded-lg text-sm font-medium"
              onClick={() => openUpiPay(totalOutstanding)}
            >
              Pay {fmt(totalOutstanding)} via UPI
            </button>
          )}
        </div>
      )}

      {/* Pay bottom sheet */}
      {showPaySheet !== null && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-end backdrop-blur-sm" onClick={() => setShowPaySheet(null)}>
          <div className="w-full rounded-t-2xl p-5" style={{ background: "var(--bg-card)", borderTop: "1px solid var(--border)" }} onClick={(e) => e.stopPropagation()}>
            <div className="text-center mb-4">
              <div className="text-xs" style={{ color: "var(--text-secondary)" }}>Pay {payeeName}</div>
              <div className="text-3xl font-bold" style={{ color: "var(--text-primary)" }}>₹{showPaySheet.toFixed(2)}</div>
              <div className="text-xs mt-1" style={{ color: "var(--accent-green)" }}>✓ Amount copied to clipboard</div>
            </div>
            <div className="text-xs text-center mb-2" style={{ color: "var(--text-secondary)" }}>UPI ID: {payeeUpi}</div>
            <div className="text-xs text-center mb-4" style={{ color: "var(--text-tertiary)" }}>Open an app below → search &quot;{payeeName}&quot; → paste amount</div>
            <div className="flex gap-3 justify-center mb-3">
              {upiApps.map((app) => (
                <button
                  key={app.name}
                  className="flex-1 py-3 rounded-xl text-sm font-semibold transition-all hover:scale-105"
                  style={{ background: app.gradient, color: app.text, border: "1px solid var(--border)" }}
                  onClick={() => launchApp(app.pkg)}
                >
                  {app.name}
                </button>
              ))}
            </div>
            <button className="w-full py-2 text-sm" style={{ color: "var(--text-tertiary)" }} onClick={() => setShowPaySheet(null)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Per-category rows */}
      {byCategory.map(([category, categoryDues]) => {
        const catTotal = categoryDues.reduce((s, d) => s + Number(d.amount), 0);
        const isExpanded = expandedCat === category;

        return (
          <div key={category} className="glass rounded-xl mb-3 overflow-hidden">
            <div
              className="flex justify-between items-center p-4 cursor-pointer transition-all"
              onClick={() => setExpandedCat(isExpanded ? null : category)}
            >
              <div>
                <div className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{category}</div>
                <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>{categoryDues.length} item{categoryDues.length !== 1 ? "s" : ""}</div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-lg font-semibold" style={{ color: "var(--accent-red)" }}>{fmt(catTotal)}</span>
                <span className="text-sm" style={{ color: "var(--text-tertiary)" }}>{isExpanded ? "\u25B2" : "\u25BC"}</span>
              </div>
            </div>

            {isExpanded && (
              <div className="px-4 pb-3" style={{ borderTop: "1px solid var(--border)" }}>
                {/* Pay / Clear All for category — primary user only */}
                {isPrimary && (
                  <div className="flex gap-2 mt-3 mb-2">
                    {payeeUpi && (
                      <button
                        className="flex-1 py-2 btn-gradient text-white rounded-lg text-sm font-medium"
                        onClick={(e) => { e.stopPropagation(); openUpiPay(catTotal); }}
                      >
                        Pay {fmt(catTotal)}
                      </button>
                    )}
                    <button
                      className={`${payeeUpi ? "flex-1" : "w-full"} py-2 btn-gradient-green text-white rounded-lg text-sm font-medium disabled:opacity-40`}
                      disabled={categoryDues.some((d) => clearing.has(d.id))}
                      onClick={(e) => { e.stopPropagation(); clearCategory(category); }}
                    >
                      Clear All
                    </button>
                  </div>
                )}

                {/* Individual items */}
                {categoryDues.map((due) => {
                  const txn = txnMap.get(due.transaction_id);
                  return (
                    <div key={due.id} className="flex justify-between items-center py-2" style={{ borderBottom: "1px solid var(--border)" }}>
                      <div>
                        <div className="text-sm" style={{ color: "var(--text-secondary)" }}>{txn?.merchant ?? "Transaction #" + due.transaction_id}</div>
                        <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>{txn ? fmtDate(txn.sms_date) : ""}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{fmt(Number(due.amount))}</span>
                        {isPrimary && payeeUpi && (
                          <button
                            className="px-3 py-1 rounded text-xs font-medium transition-all"
                            style={{ background: "rgba(108, 99, 255, 0.12)", color: "var(--accent)", border: "1px solid rgba(108, 99, 255, 0.25)" }}
                            onClick={() => openUpiPay(Number(due.amount))}
                          >
                            Pay
                          </button>
                        )}
                        {isPrimary && (
                          <button
                            className="px-3 py-1 rounded text-xs font-medium disabled:opacity-40 transition-all"
                            style={{ background: "rgba(0, 200, 150, 0.12)", color: "var(--accent-green)", border: "1px solid rgba(0, 200, 150, 0.25)" }}
                            disabled={clearing.has(due.id)}
                            onClick={() => clearDue(due.id)}
                          >
                            {clearing.has(due.id) ? "..." : "Clear"}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* No outstanding */}
      {unclearedDues.length === 0 && (
        <div className="text-center py-8" style={{ color: "var(--text-tertiary)" }}>
          <div className="text-lg mb-1">{isPrimary ? "All cleared!" : "All settled!"}</div>
        </div>
      )}

      {/* Cleared section */}
      {clearedDues.length > 0 && (
        <div className="mt-6">
          <button
            className="text-sm mb-2"
            style={{ color: "var(--text-tertiary)" }}
            onClick={() => setShowCleared(!showCleared)}
          >
            {showCleared ? "\u25B2" : "\u25BC"} {clearedDues.length} cleared due{clearedDues.length !== 1 ? "s" : ""}
          </button>

          {showCleared && (
            <div className="space-y-2">
              {clearedDues.map((due) => {
                const txn = txnMap.get(due.transaction_id);
                return (
                  <div key={due.id} className="flex justify-between items-center rounded-lg px-4 py-2" style={{ background: "rgba(15, 15, 26, 0.5)", border: "1px solid var(--border)" }}>
                    <div>
                      <div className="text-sm" style={{ color: "var(--text-tertiary)" }}>{txn?.merchant ?? "Transaction #" + due.transaction_id}</div>
                      <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                        {due.category} &middot; {txn ? fmtDate(txn.sms_date) : ""}
                        {due.settlement_transaction_id && <span className="ml-1" style={{ color: "var(--accent-green)" }}>• Settled via UPI</span>}
                      </div>
                    </div>
                    <span className="text-sm line-through" style={{ color: "var(--text-tertiary)" }}>{fmt(Number(due.amount))}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
