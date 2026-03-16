"use client";

import { useState, useEffect } from "react";
import { supabase, RawSms, Transaction, Category } from "@/lib/supabase";
import { detectFields } from "@/lib/smsDetector";
import NewSmsReview from "@/components/NewSmsReview";
import CategoryBudget from "@/components/CategoryBudget";

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
  const [newTxns, setNewTxns] = useState<Transaction[]>([]);
  const [categorizedTxns, setCategorizedTxns] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);

      // Fetch categories
      const { data: cats } = await supabase.from("categories").select("*").order("name");
      if (cats) setCategories(cats);

      // Fetch new (unreviewed) SMS
      const { data: newData } = await supabase
        .from("transactions")
        .select("*")
        .eq("status", "new")
        .order("sms_date", { ascending: false });
      if (newData) setNewTxns(newData.map(enrichSms));

      // Fetch categorized SMS (for budget view)
      let allCategorized: RawSms[] = [];
      let from = 0;
      const batchSize = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("transactions")
          .select("*")
          .eq("status", "categorized")
          .order("sms_date", { ascending: false })
          .range(from, from + batchSize - 1);
        if (error || !data || data.length === 0) break;
        allCategorized = allCategorized.concat(data);
        from += batchSize;
        if (data.length < batchSize) break;
      }
      setCategorizedTxns(allCategorized.map(enrichSms));

      setLoading(false);
    }
    load();

    // Realtime: new SMS arrives → add to review queue; updates sync across devices
    const channel = supabase
      .channel("transactions-realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "transactions" }, (payload) => {
        const enriched = enrichSms(payload.new as RawSms);
        if (enriched.status === "new") {
          setNewTxns((prev) => [enriched, ...prev]);
        }
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "transactions" }, (payload) => {
        const updated = payload.new as RawSms;
        if (updated.status === "categorized" || updated.status === "ignored") {
          // Remove from review queue (syncs across devices)
          setNewTxns((prev) => prev.filter((t) => t.id !== updated.id));
          if (updated.status === "categorized") {
            const enriched = enrichSms(updated);
            setCategorizedTxns((prev) => [enriched, ...prev]);
          }
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  function handleReviewDone(id: number, category?: string, notes?: string) {
    const txn = newTxns.find((t) => t.id === id);
    setNewTxns((prev) => prev.filter((t) => t.id !== id));
    // If categorized, add to budget data with updated fields
    if (txn && category) {
      setCategorizedTxns((prev) => [{ ...txn, category, notes: notes || null, status: "categorized" as const }, ...prev]);
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-lg text-gray-500">Loading...</div>
    </div>
  );

  const showReview = newTxns.length > 0;

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">Expense Tracker</h1>
        {!showReview && (
          <span className="text-xs text-gray-400">{categorizedTxns.length} categorized</span>
        )}
      </div>

      {showReview ? (
        <NewSmsReview
          transactions={newTxns}
          categories={categories}
          onDone={handleReviewDone}
        />
      ) : (
        <CategoryBudget
          transactions={categorizedTxns}
          categories={categories}
        />
      )}
    </div>
  );
}
