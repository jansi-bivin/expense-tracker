"use client";

import { useState, useMemo, useEffect } from "react";
import { supabase, RawSms, Transaction } from "@/lib/supabase";
import { detectFields } from "@/lib/smsDetector";

type SortField = "date" | "amount" | "merchant";
type FilterType = "ALL" | "CREDIT" | "DEBIT";

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
  const [totalCount, setTotalCount] = useState(0);
  const [filterType, setFilterType] = useState<FilterType>("ALL");
  const [filterAccount, setFilterAccount] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(0);
  const [selectedTxn, setSelectedTxn] = useState<Transaction | null>(null);
  const PAGE_SIZE = 50;

  // Fetch raw SMS from Supabase, then detect fields client-side
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
      // Detect fields client-side
      const enriched = allData.map(enrichSms);
      setTransactions(enriched);
      setTotalCount(enriched.length);
      setLoading(false);
    }
    fetchAll();

    // Subscribe to real-time inserts — enrich new SMS on arrival
    const channel = supabase
      .channel("transactions-realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "transactions" }, (payload) => {
        const enriched = enrichSms(payload.new as RawSms);
        setTransactions((prev) => [enriched, ...prev]);
        setTotalCount((prev) => prev + 1);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  // Unique accounts
  const accounts = useMemo(() => {
    const set = new Set<string>();
    transactions.forEach((t) => { if (t.account_number) set.add(t.account_number); });
    return Array.from(set).sort();
  }, [transactions]);

  // Summary stats
  const stats = useMemo(() => {
    let totalCredit = 0, totalDebit = 0, creditCount = 0, debitCount = 0;
    transactions.forEach((t) => {
      const amt = Number(t.amount) || 0;
      if (t.transaction_type === "CREDIT") { totalCredit += amt; creditCount++; }
      else if (t.transaction_type === "DEBIT") { totalDebit += amt; debitCount++; }
    });
    return { totalCredit, totalDebit, net: totalCredit - totalDebit, creditCount, debitCount, total: transactions.length };
  }, [transactions]);

  // Filtered & sorted
  const filtered = useMemo(() => {
    let list = [...transactions];
    if (filterType !== "ALL") list = list.filter((t) => t.transaction_type === filterType);
    if (filterAccount !== "ALL") list = list.filter((t) => t.account_number === filterAccount);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter((t) =>
        (t.merchant?.toLowerCase().includes(q)) ||
        (t.body.toLowerCase().includes(q)) ||
        (t.address.toLowerCase().includes(q)) ||
        (t.reference_id?.toLowerCase().includes(q))
      );
    }
    list.sort((a, b) => {
      let cmp = 0;
      if (sortField === "date") cmp = (a.sms_date ?? 0) - (b.sms_date ?? 0);
      else if (sortField === "amount") cmp = (Number(a.amount) || 0) - (Number(b.amount) || 0);
      else if (sortField === "merchant") cmp = (a.merchant ?? "").localeCompare(b.merchant ?? "");
      return sortAsc ? cmp : -cmp;
    });
    return list;
  }, [transactions, filterType, filterAccount, searchQuery, sortField, sortAsc]);

  const pageData = useMemo(() => filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [filtered, page]);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  // Monthly breakdown
  const monthlyData = useMemo(() => {
    const map = new Map<string, { credit: number; debit: number }>();
    transactions.forEach((t) => {
      const d = new Date(t.sms_date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (!map.has(key)) map.set(key, { credit: 0, debit: 0 });
      const entry = map.get(key)!;
      const amt = Number(t.amount) || 0;
      if (t.transaction_type === "CREDIT") entry.credit += amt;
      else if (t.transaction_type === "DEBIT") entry.debit += amt;
    });
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 12);
  }, [transactions]);

  const fmt = (n: number) => "\u20B9" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtDate = (ts: number) => new Date(ts).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortAsc(!sortAsc);
    else { setSortField(field); setSortAsc(false); }
    setPage(0);
  };

  if (loading) return (
    <div className="flex flex-col items-center justify-center min-h-screen">
      <div className="text-xl mb-2">Loading transactions from cloud...</div>
      <div className="text-sm text-gray-500">Fetching from Supabase</div>
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Expense Tracker</h1>
        <div className="text-xs text-gray-400 bg-green-50 px-3 py-1 rounded-full border border-green-200">
          Live from Supabase &middot; {totalCount} transactions
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow p-4">
          <div className="text-sm text-gray-500">Total Transactions</div>
          <div className="text-2xl font-bold">{stats.total}</div>
          <div className="text-xs text-gray-400">{accounts.length} accounts detected</div>
        </div>
        <div className="bg-white rounded-xl shadow p-4">
          <div className="text-sm text-gray-500">Total Credit</div>
          <div className="text-2xl font-bold text-green-600">{fmt(stats.totalCredit)}</div>
          <div className="text-xs text-gray-400">{stats.creditCount} transactions</div>
        </div>
        <div className="bg-white rounded-xl shadow p-4">
          <div className="text-sm text-gray-500">Total Debit</div>
          <div className="text-2xl font-bold text-red-600">{fmt(stats.totalDebit)}</div>
          <div className="text-xs text-gray-400">{stats.debitCount} transactions</div>
        </div>
        <div className="bg-white rounded-xl shadow p-4">
          <div className="text-sm text-gray-500">Net</div>
          <div className={`text-2xl font-bold ${stats.net >= 0 ? "text-green-600" : "text-red-600"}`}>{fmt(stats.net)}</div>
        </div>
      </div>

      {/* Monthly Breakdown */}
      <div className="bg-white rounded-xl shadow p-4 mb-6">
        <h2 className="text-lg font-semibold mb-3">Monthly Breakdown</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 px-2">Month</th>
                <th className="text-right py-2 px-2 text-green-600">Credit</th>
                <th className="text-right py-2 px-2 text-red-600">Debit</th>
                <th className="text-right py-2 px-2">Net</th>
              </tr>
            </thead>
            <tbody>
              {monthlyData.map(([month, data]) => (
                <tr key={month} className="border-b hover:bg-gray-50">
                  <td className="py-2 px-2 font-medium">{month}</td>
                  <td className="py-2 px-2 text-right text-green-600">{fmt(data.credit)}</td>
                  <td className="py-2 px-2 text-right text-red-600">{fmt(data.debit)}</td>
                  <td className={`py-2 px-2 text-right font-medium ${data.credit - data.debit >= 0 ? "text-green-600" : "text-red-600"}`}>
                    {fmt(data.credit - data.debit)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow p-4 mb-4">
        <div className="flex flex-wrap gap-3 items-center">
          <input
            type="text"
            placeholder="Search merchant, sender, SMS body..."
            className="border rounded-lg px-3 py-2 flex-1 min-w-[200px]"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setPage(0); }}
          />
          <select className="border rounded-lg px-3 py-2" value={filterType} onChange={(e) => { setFilterType(e.target.value as FilterType); setPage(0); }}>
            <option value="ALL">All Types</option>
            <option value="CREDIT">Credit Only</option>
            <option value="DEBIT">Debit Only</option>
          </select>
          <select className="border rounded-lg px-3 py-2" value={filterAccount} onChange={(e) => { setFilterAccount(e.target.value); setPage(0); }}>
            <option value="ALL">All Accounts</option>
            {accounts.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <span className="text-sm text-gray-500">{filtered.length} results</span>
        </div>
      </div>

      {/* Transaction Table */}
      <div className="bg-white rounded-xl shadow overflow-hidden mb-4">
        <table className="w-full text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="text-left py-3 px-3 cursor-pointer hover:bg-gray-200" onClick={() => handleSort("date")}>
                Date {sortField === "date" ? (sortAsc ? "\u2191" : "\u2193") : ""}
              </th>
              <th className="text-left py-3 px-3">Type</th>
              <th className="text-left py-3 px-3 cursor-pointer hover:bg-gray-200" onClick={() => handleSort("merchant")}>
                Merchant {sortField === "merchant" ? (sortAsc ? "\u2191" : "\u2193") : ""}
              </th>
              <th className="text-left py-3 px-3">Account</th>
              <th className="text-left py-3 px-3">Sender</th>
              <th className="text-right py-3 px-3 cursor-pointer hover:bg-gray-200" onClick={() => handleSort("amount")}>
                Amount {sortField === "amount" ? (sortAsc ? "\u2191" : "\u2193") : ""}
              </th>
              <th className="text-right py-3 px-3">Balance</th>
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
                <td className="py-2 px-3 text-xs">{t.address}</td>
                <td className={`py-2 px-3 text-right font-medium whitespace-nowrap ${
                  t.transaction_type === "CREDIT" ? "text-green-600" : "text-red-600"
                }`}>
                  {t.transaction_type === "DEBIT" ? "-" : "+"}{fmt(Number(t.amount) ?? 0)}
                </td>
                <td className="py-2 px-3 text-right text-xs text-gray-500">{t.balance ? fmt(Number(t.balance)) : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
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
              <div className="flex justify-between"><span className="text-gray-500">Date (in SMS)</span><span>{selectedTxn.transaction_date ?? "-"}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Date (received)</span><span>{fmtDate(selectedTxn.sms_date)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Balance</span><span>{selectedTxn.balance ? fmt(Number(selectedTxn.balance)) : "-"}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Reference</span><span className="text-xs font-mono">{selectedTxn.reference_id ?? "-"}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Sender</span><span>{selectedTxn.address}</span></div>
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
