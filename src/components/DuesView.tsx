"use client";

import React, { useState, useMemo } from "react";
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

function DuesView({ dues, transactions, categories, onDuesChange, payeeUpi, payeeName, isPrimary, primaryName }: Props) {
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

  const txnMap = useMemo(() => {
    const m = new Map<number, Transaction>();
    for (const t of transactions) m.set(t.id, t);
    return m;
  }, [transactions]);

  const [showPaySheet, setShowPaySheet] = useState<number | null>(null);
  const [expandedSmsId, setExpandedSmsId] = useState<number | null>(null);

  const upiApps = [
    { name: "GPay", pkg: "com.google.android.apps.nbu.paisa.user", icon: "G", gradient: "linear-gradient(135deg, #fff, #f0f0f0)", textColor: "#333" },
    { name: "PhonePe", pkg: "com.phonepe.app", icon: "P", gradient: "linear-gradient(135deg, #5f259f, #4a1d80)", textColor: "#fff" },
    { name: "Paytm", pkg: "net.one97.paytm", icon: "₹", gradient: "linear-gradient(135deg, #00b9f1, #0091c8)", textColor: "#fff" },
  ];

  function openUpiPay(amount: number) {
    if (!payeeUpi) return;
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
      <div className="text-center py-20 animate-fade-in">
        <div className="text-5xl mb-4">✨</div>
        <div className="text-lg font-semibold mb-1" style={{ color: "var(--text-primary)" }}>
          {isPrimary ? "All Clear!" : "All Settled!"}
        </div>
        <div className="text-sm" style={{ color: "var(--text-tertiary)" }}>No dues pending</div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      {/* ═══ Summary Hero Card ═══ */}
      {totalOutstanding > 0 && (
        <div className={`${isPrimary ? "card-gradient-red" : "card-gradient-green"} shimmer p-5 mb-5 animate-slide-up`}>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-base">{isPrimary ? "💸" : "💰"}</span>
            <span className="section-label" style={{ color: isPrimary ? "var(--accent-red-bright)" : "var(--accent-green-bright)" }}>
              {isPrimary ? `You owe ${payeeName}` : `${primaryName} owes you`}
            </span>
          </div>

          <div className="amount-large mb-1" style={{ color: isPrimary ? "var(--accent-red)" : "var(--accent-green)", fontSize: "32px" }}>
            {fmt(totalOutstanding)}
          </div>
          <div className="text-xs mb-4" style={{ color: "var(--text-tertiary)" }}>
            {unclearedDues.length} transaction{unclearedDues.length !== 1 ? "s" : ""} across {byCategory.length} categor{byCategory.length !== 1 ? "ies" : "y"}
          </div>

          {isPrimary && payeeUpi && (
            <button
              className="w-full py-3 btn-primary rounded-xl text-sm"
              onClick={() => openUpiPay(totalOutstanding)}
            >
              Pay {fmt(totalOutstanding)} via UPI →
            </button>
          )}
        </div>
      )}

      {/* ═══ Pay Bottom Sheet ═══ */}
      {showPaySheet !== null && (
        <div className="fixed inset-0 sheet-backdrop z-50 flex items-end animate-fade-in" onClick={() => setShowPaySheet(null)}>
          <div className="sheet w-full p-6 animate-slide-up" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" />

            <div className="text-center mb-5">
              <div className="text-xs font-medium mb-1" style={{ color: "var(--text-tertiary)" }}>Pay {payeeName}</div>
              <div className="text-4xl font-extrabold tracking-tight" style={{ color: "var(--text-primary)" }}>₹{showPaySheet.toFixed(2)}</div>
              <div className="badge badge-green mt-2 text-[10px]">✓ Amount copied</div>
            </div>

            <div className="text-xs text-center mb-1" style={{ color: "var(--text-secondary)" }}>UPI: {payeeUpi}</div>
            <div className="text-[11px] text-center mb-5" style={{ color: "var(--text-tertiary)" }}>Open app → search &quot;{payeeName}&quot; → paste amount</div>

            <div className="flex gap-3 mb-4">
              {upiApps.map((app) => (
                <button
                  key={app.name}
                  className="flex-1 py-3.5 rounded-2xl text-sm font-bold transition-all hover:scale-105 active:scale-95"
                  style={{ background: app.gradient, color: app.textColor, border: "1px solid var(--border-light)" }}
                  onClick={() => launchApp(app.pkg)}
                >
                  {app.name}
                </button>
              ))}
            </div>

            <button className="w-full py-2.5 text-sm font-medium rounded-xl" style={{ color: "var(--text-tertiary)" }} onClick={() => setShowPaySheet(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ═══ Category Rows ═══ */}
      <div className="stagger">
        {byCategory.map(([category, categoryDues]) => {
          const catTotal = categoryDues.reduce((s, d) => s + Number(d.amount), 0);
          const isExpanded = expandedCat === category;

          return (
            <div key={category} className="card mb-3 overflow-hidden animate-slide-up">
              <div
                className="flex justify-between items-center p-4 cursor-pointer"
                onClick={() => setExpandedCat(isExpanded ? null : category)}
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold"
                    style={{ background: "rgba(255, 90, 110, 0.1)", color: "var(--accent-red)", border: "1px solid rgba(255,90,110,0.15)" }}>
                    {categoryDues.length}
                  </div>
                  <div>
                    <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{category}</div>
                    <div className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                      {categoryDues.length} item{categoryDues.length !== 1 ? "s" : ""}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold" style={{ color: "var(--accent-red)" }}>{fmt(catTotal)}</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                    style={{ color: "var(--text-tertiary)", transition: "transform 0.2s", transform: isExpanded ? "rotate(180deg)" : "rotate(0)" }}>
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </div>
              </div>

              {isExpanded && (
                <div className="px-4 pb-4 animate-fade-in" style={{ borderTop: "1px solid var(--border)" }}>
                  {/* Actions — primary only */}
                  {isPrimary && (
                    <div className="flex gap-2 mt-3 mb-3">
                      {payeeUpi && (
                        <button
                          className="flex-1 py-2.5 btn-primary text-sm rounded-xl"
                          onClick={(e) => { e.stopPropagation(); openUpiPay(catTotal); }}
                        >
                          Pay {fmt(catTotal)}
                        </button>
                      )}
                      <button
                        className={`${payeeUpi ? "flex-1" : "w-full"} py-2.5 btn-green text-sm rounded-xl disabled:opacity-35`}
                        disabled={categoryDues.some((d) => clearing.has(d.id))}
                        onClick={(e) => { e.stopPropagation(); clearCategory(category); }}
                      >
                        ✓ Clear All
                      </button>
                    </div>
                  )}

                  {/* Items */}
                  {categoryDues.map((due, i) => {
                    const txn = txnMap.get(due.transaction_id);
                    const smsExpanded = expandedSmsId === due.id;
                    return (
                      <div key={due.id} className="py-3"
                        style={{ borderBottom: i < categoryDues.length - 1 ? "1px solid var(--border)" : "none" }}>
                        <div className="flex justify-between items-center">
                          <div>
                            <div className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>{txn?.merchant ?? txn?.notes ?? "Transaction #" + due.transaction_id}</div>
                            <div className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>{txn ? fmtDate(txn.sms_date) : ""}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{fmt(Number(due.amount))}</span>
                            {txn?.body && (
                              <button
                                className={`badge text-[10px] cursor-pointer ${smsExpanded ? "badge-purple" : ""}`}
                                style={smsExpanded ? {} : { background: "rgba(255,255,255,0.06)", color: "var(--text-tertiary)", border: "1px solid var(--border-light)" }}
                                onClick={() => setExpandedSmsId(smsExpanded ? null : due.id)}
                              >
                                SMS
                              </button>
                            )}
                            {isPrimary && payeeUpi && (
                              <button className="badge badge-purple text-[10px] cursor-pointer" onClick={() => openUpiPay(Number(due.amount))}>
                                Pay
                              </button>
                            )}
                            {isPrimary && (
                              <button
                                className="badge badge-green text-[10px] cursor-pointer disabled:opacity-35"
                                disabled={clearing.has(due.id)}
                                onClick={() => clearDue(due.id)}
                              >
                                {clearing.has(due.id) ? "..." : "Clear"}
                              </button>
                            )}
                          </div>
                        </div>
                        {smsExpanded && txn?.body && (
                          <div className="mt-2 px-3 py-2 rounded-xl text-[11px] leading-relaxed animate-fade-in"
                            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", color: "var(--text-tertiary)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                            {txn.body}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* No outstanding */}
      {unclearedDues.length === 0 && (
        <div className="text-center py-10 animate-fade-in">
          <div className="text-4xl mb-3">🎉</div>
          <div className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
            {isPrimary ? "All cleared!" : "All settled!"}
          </div>
        </div>
      )}

      {/* ═══ Cleared Section ═══ */}
      {clearedDues.length > 0 && (
        <div className="mt-6">
          <button
            className="flex items-center gap-2 text-xs font-medium mb-3 transition-all"
            style={{ color: "var(--text-tertiary)" }}
            onClick={() => setShowCleared(!showCleared)}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              style={{ transition: "transform 0.2s", transform: showCleared ? "rotate(180deg)" : "rotate(0)" }}>
              <path d="M6 9l6 6 6-6" />
            </svg>
            {clearedDues.length} cleared due{clearedDues.length !== 1 ? "s" : ""}
          </button>

          {showCleared && (
            <div className="space-y-2 stagger">
              {clearedDues.map((due) => {
                const txn = txnMap.get(due.transaction_id);
                return (
                  <div key={due.id} className="flex justify-between items-center rounded-2xl px-4 py-3 animate-slide-up"
                    style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)" }}>
                    <div>
                      <div className="text-sm" style={{ color: "var(--text-tertiary)" }}>{txn?.merchant ?? txn?.notes ?? "Transaction #" + due.transaction_id}</div>
                      <div className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                        {due.category} · {txn ? fmtDate(txn.sms_date) : ""}
                        {due.settlement_transaction_id && (
                          <span className="ml-1" style={{ color: "var(--accent-green)" }}>• Settled</span>
                        )}
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

export default React.memo(DuesView);
