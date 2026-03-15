"use client";

import { useState, useMemo, useEffect } from "react";
import { supabase, RawSms, Transaction } from "@/lib/supabase";
import { detectFields } from "@/lib/smsDetector";

/** Enrich a raw SMS row with client-side field detection */
function enrichSms(raw: RawSms): Transaction {
  const fields = detectFields(raw.body);
  return {
    ...raw,
    amount: fields.amount ?? null,
    transaction_type: fields.transactionType ?? null,
    account_number: fields.accountNumber ?? null,
    merchant: fields.merchant ?? null,
    transaction_date: fields.transactionDate ?? null,
    balance: fields.balance ?? null,
    reference_id: fields.referenceId ?? null,
  };
}

export default function Home() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTxn, setSelectedTxn] = useState<Transaction | null>(null);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  useEffect(() => {
    async function fetchAll() {
      setLoading(true);
      let allData: RawSms[] = [];
      let from = 0;
      const batchSize = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("transactions")
          .select("id, address, body, sms_date, created_at")
          .order("sms_date", { ascending: false })
          .range(from, from + batchSize - 1);
        if (error) { console.error("Fetch error:", error); break; }
        if (!data || data.length === 0) break;
        allData = allData.concat(data);
        from += batchSize;
        if (data.length < batchSize) break;
      }
      const enriched = allData.map(enrichSms);
      setTransactions(enriched);
      setLoading(false);
    }
    fetchAll();

    const channel = supabase
      .channel("transactions-realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "transactions" }, (payload) => {
        const enriched = enrichSms(payload.new as RawSms);
        setTransactions((prev) => [enriched, ...prev]);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const fmt = (n: number) => "\u20B9" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtDate = (ts: number) => new Date(ts).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });

  const pageData = useMemo(() => transactions.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [transactions, page]);
  const totalPages = Math.ceil(transactions.length / PAGE_SIZE);

  if (loading) return (
    <div className="flex flex-col items-center justify-center min-h-screen">
      <div className="text-xl mb-2">Loading...</div>
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">Expense Tracker</h1>
        <span className="text-xs text-gray-400">{transactions.length} transactions</span>
      </div>

      {/* Transaction Table */}
      <div className="bg-white rounded-xl shadow overflow-hidden mb-4">
        <table className="w-full text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="text-left py-3 px-3">Date</th>
              <th className="text-left py-3 px-3">Type</th>
              <th className="text-left py-3 px-3">Merchant</th>
              <th className="text-left py-3 px-3">Account</th>
              <th className="text-right py-3 px-3">Amount</th>
            </tr>
          </thead>
          <tbody>
            {pageData.map((t, i) => (
              <tr
                key={t.id || `${t.sms_date}-${i}`}
                className="border-b hover:bg-blue-50 cursor-pointer"
                onClick={() => setSelectedTxn(t)}
              >
                <td className="py-2 px-3 whitespace-nowrap">{fmtDate(t.sms_date)}</td>
                <td className="py-2 px-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    t.transaction_type === "CREDIT" ? "bg-green-100 text-green-700" :
                    t.transaction_type === "DEBIT" ? "bg-red-100 text-red-700" :
                    "bg-gray-100 text-gray-700"
                  }`}>
                    {t.transaction_type ?? "?"}
                  </span>
                </td>
                <td className="py-2 px-3 max-w-[200px] truncate">{t.merchant ?? "-"}</td>
                <td className="py-2 px-3 text-xs font-mono">{t.account_number ?? "-"}</td>
                <td className={`py-2 px-3 text-right font-medium whitespace-nowrap ${
                  t.transaction_type === "CREDIT" ? "text-green-600" : "text-red-600"
                }`}>
                  {t.transaction_type === "DEBIT" ? "-" : "+"}{fmt(Number(t.amount) ?? 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-between items-center mb-6">
          <button
            className="px-4 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-40"
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </button>
          <span className="text-sm text-gray-500">Page {page + 1} of {totalPages}</span>
          <button
            className="px-4 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-40"
            disabled={page >= totalPages - 1}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </div>
      )}

      {/* Detail Modal */}
      {selectedTxn && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setSelectedTxn(null)}>
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold">Transaction Detail</h3>
              <button className="text-gray-400 hover:text-gray-600 text-2xl" onClick={() => setSelectedTxn(null)}>&times;</button>
            </div>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Amount</span><span className={`font-bold text-lg ${selectedTxn.transaction_type === "CREDIT" ? "text-green-600" : "text-red-600"}`}>{fmt(Number(selectedTxn.amount) ?? 0)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Type</span><span className="font-medium">{selectedTxn.transaction_type ?? "-"}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Account</span><span className="font-mono">{selectedTxn.account_number ?? "-"}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Merchant</span><span>{selectedTxn.merchant ?? "-"}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Date</span><span>{fmtDate(selectedTxn.sms_date)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Balance</span><span>{selectedTxn.balance ? fmt(Number(selectedTxn.balance)) : "-"}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Reference</span><span className="text-xs font-mono">{selectedTxn.reference_id ?? "-"}</span></div>
              <div className="mt-3 p-3 bg-gray-100 rounded-lg">
                <div className="text-xs text-gray-500 mb-1">Raw SMS</div>
                <div className="text-xs break-all">{selectedTxn.body}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
