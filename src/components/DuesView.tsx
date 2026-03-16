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
}

export default function DuesView({ dues, transactions, categories, onDuesChange, payeeUpi, payeeName }: Props) {
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

  function openUpiPay(amount: number) {
    if (!payeeUpi) return;
    const amt = amount.toFixed(2);
    const tr = `EXPTRK${Date.now()}${Math.random().toString(36).slice(2, 8)}`;

    // Use native Android bridge if available (launches UPI via proper
    // startActivityForResult — UPI apps treat it as a real app, not a web link)
    const androidUpi = (window as unknown as Record<string, unknown>).AndroidUpi as
      | { pay: (vpa: string, name: string, amount: string, txnRef: string) => void }
      | undefined;
    if (androidUpi?.pay) {
      androidUpi.pay(payeeUpi, payeeName, amt, tr);
      return;
    }

    // Fallback for browser testing — DOM anchor approach
    const url = `upi://pay?pa=${payeeUpi}&pn=${encodeURIComponent(payeeName)}&tr=${tr}&am=${amt}&cu=INR`;
    const a = document.createElement("a");
    a.href = url;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => document.body.removeChild(a), 100);
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
      <div className="text-center py-16 text-gray-400">
        <div className="text-4xl mb-3">&#10003;</div>
        <div className="text-lg">No dues</div>
      </div>
    );
  }

  return (
    <div>
      {/* Summary card */}
      {totalOutstanding > 0 && (
        <div className="bg-white rounded-xl shadow p-4 mb-4">
          <div className="text-sm text-gray-500 mb-1">Outstanding Dues</div>
          <div className="text-2xl font-bold text-red-600">{fmt(totalOutstanding)}</div>
          <div className="text-xs text-gray-400 mt-1">{unclearedDues.length} transaction{unclearedDues.length !== 1 ? "s" : ""} across {byCategory.length} categor{byCategory.length !== 1 ? "ies" : "y"}</div>
          {payeeUpi && (
            <button
              className="w-full mt-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium"
              onClick={() => openUpiPay(totalOutstanding)}
            >
              Pay {fmt(totalOutstanding)} via UPI
            </button>
          )}
        </div>
      )}

      {/* Per-category rows */}
      {byCategory.map(([category, categoryDues]) => {
        const catTotal = categoryDues.reduce((s, d) => s + Number(d.amount), 0);
        const isExpanded = expandedCat === category;

        return (
          <div key={category} className="bg-white rounded-xl shadow mb-3 overflow-hidden">
            <div
              className="flex justify-between items-center p-4 cursor-pointer"
              onClick={() => setExpandedCat(isExpanded ? null : category)}
            >
              <div>
                <div className="text-sm font-medium text-gray-800">{category}</div>
                <div className="text-xs text-gray-400">{categoryDues.length} item{categoryDues.length !== 1 ? "s" : ""}</div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-lg font-semibold text-red-600">{fmt(catTotal)}</span>
                <span className="text-gray-300 text-sm">{isExpanded ? "\u25B2" : "\u25BC"}</span>
              </div>
            </div>

            {isExpanded && (
              <div className="border-t px-4 pb-3">
                {/* Pay / Clear All for category */}
                <div className="flex gap-2 mt-3 mb-2">
                  {payeeUpi && (
                    <button
                      className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium"
                      onClick={(e) => { e.stopPropagation(); openUpiPay(catTotal); }}
                    >
                      Pay {fmt(catTotal)}
                    </button>
                  )}
                  <button
                    className={`${payeeUpi ? "flex-1" : "w-full"} py-2 bg-green-600 text-white rounded-lg text-sm font-medium disabled:opacity-40`}
                    disabled={categoryDues.some((d) => clearing.has(d.id))}
                    onClick={(e) => { e.stopPropagation(); clearCategory(category); }}
                  >
                    Clear All
                  </button>
                </div>

                {/* Individual items */}
                {categoryDues.map((due) => {
                  const txn = txnMap.get(due.transaction_id);
                  return (
                    <div key={due.id} className="flex justify-between items-center py-2 border-b last:border-0">
                      <div>
                        <div className="text-sm text-gray-700">{txn?.merchant ?? "Transaction #" + due.transaction_id}</div>
                        <div className="text-xs text-gray-400">{txn ? fmtDate(txn.sms_date) : ""}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{fmt(Number(due.amount))}</span>
                        {payeeUpi && (
                          <button
                            className="px-3 py-1 bg-blue-100 text-blue-700 rounded text-xs font-medium"
                            onClick={() => openUpiPay(Number(due.amount))}
                          >
                            Pay
                          </button>
                        )}
                        <button
                          className="px-3 py-1 bg-green-100 text-green-700 rounded text-xs font-medium disabled:opacity-40"
                          disabled={clearing.has(due.id)}
                          onClick={() => clearDue(due.id)}
                        >
                          {clearing.has(due.id) ? "..." : "Clear"}
                        </button>
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
        <div className="text-center py-8 text-gray-400">
          <div className="text-lg mb-1">All cleared!</div>
        </div>
      )}

      {/* Cleared section */}
      {clearedDues.length > 0 && (
        <div className="mt-6">
          <button
            className="text-sm text-gray-400 mb-2"
            onClick={() => setShowCleared(!showCleared)}
          >
            {showCleared ? "\u25B2" : "\u25BC"} {clearedDues.length} cleared due{clearedDues.length !== 1 ? "s" : ""}
          </button>

          {showCleared && (
            <div className="space-y-2">
              {clearedDues.map((due) => {
                const txn = txnMap.get(due.transaction_id);
                return (
                  <div key={due.id} className="flex justify-between items-center bg-gray-50 rounded-lg px-4 py-2">
                    <div>
                      <div className="text-sm text-gray-400">{txn?.merchant ?? "Transaction #" + due.transaction_id}</div>
                      <div className="text-xs text-gray-300">{due.category} &middot; {txn ? fmtDate(txn.sms_date) : ""}</div>
                    </div>
                    <span className="text-sm text-gray-400 line-through">{fmt(Number(due.amount))}</span>
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
