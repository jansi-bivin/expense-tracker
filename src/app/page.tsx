"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { supabase, RawSms, Transaction, Category, User, Due } from "@/lib/supabase";
import { detectFields } from "@/lib/smsDetector";
import NewSmsReview from "@/components/NewSmsReview";
import CategoryBudget from "@/components/CategoryBudget";
import DuesView from "@/components/DuesView";

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

function HomeInner() {
  const searchParams = useSearchParams();
  const [newTxns, setNewTxns] = useState<Transaction[]>([]);
  const [categorizedTxns, setCategorizedTxns] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [dues, setDues] = useState<Due[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"review" | "budget" | "dues">("budget");

  const updateBadge = useCallback((count: number) => {
    if ("setAppBadge" in navigator) {
      if (count > 0) (navigator as any).setAppBadge(count);
      else (navigator as any).clearAppBadge();
    }
    document.title = count > 0 ? `(${count}) ExpTrack` : "ExpTrack";
  }, []);

  useEffect(() => { updateBadge(newTxns.length); }, [newTxns.length, updateBadge]);

  // Store phone from URL param
  useEffect(() => {
    const phoneFromUrl = searchParams.get("phone");
    if (phoneFromUrl) {
      localStorage.setItem("userPhone", phoneFromUrl);
    }
  }, [searchParams]);

  useEffect(() => {
    async function load() {
      setLoading(true);

      // Fetch users
      const { data: users } = await supabase.from("users").select("*");
      if (users) setAllUsers(users);

      // Identify current user
      const phone = localStorage.getItem("userPhone");
      const user = users?.find((u: User) => u.phone_number === phone) || null;
      setCurrentUser(user);

      if (!user && users && users.length > 0 && !phone) {
        setLoading(false);
        return;
      }

      // Fetch categories
      const { data: cats } = await supabase.from("categories").select("*").order("name");
      if (cats) setCategories(cats);

      // Fetch new SMS for this user (or all if no phone_number filter)
      let newQuery = supabase.from("transactions").select("*").eq("status", "new").order("sms_date", { ascending: false });
      if (user) {
        newQuery = newQuery.eq("phone_number", user.phone_number);
      }
      const { data: newData } = await newQuery;
      if (newData) setNewTxns(newData.map(enrichSms));

      // Fetch ALL categorized SMS (both users, shared budget)
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

      // Fetch dues
      const { data: duesData } = await supabase.from("dues").select("*").order("created_at", { ascending: false });
      if (duesData) setDues(duesData);

      setLoading(false);
    }
    load();

    // Realtime
    const channel = supabase
      .channel("all-realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "transactions" }, (payload) => {
        const enriched = enrichSms(payload.new as RawSms);
        const phone = localStorage.getItem("userPhone");
        if (enriched.status === "new" && enriched.phone_number === phone) {
          setNewTxns((prev) => [enriched, ...prev]);
        }
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "transactions" }, (payload) => {
        const updated = payload.new as RawSms;
        if (updated.status === "categorized" || updated.status === "ignored") {
          setNewTxns((prev) => prev.filter((t) => t.id !== updated.id));
          if (updated.status === "categorized") {
            const enriched = enrichSms(updated);
            setCategorizedTxns((prev) => [enriched, ...prev]);
          }
        }
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "dues" }, (payload) => {
        setDues((prev) => [payload.new as Due, ...prev]);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "dues" }, (payload) => {
        const updated = payload.new as Due;
        setDues((prev) => prev.map((d) => d.id === updated.id ? updated : d));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  async function handleReviewDone(id: number, category?: string, notes?: string) {
    const txn = newTxns.find((t) => t.id === id);
    setNewTxns((prev) => prev.filter((t) => t.id !== id));
    if (txn && category) {
      setCategorizedTxns((prev) => [{ ...txn, category, notes: notes || null, status: "categorized" as const }, ...prev]);

      // If secondary user categorized, create a due
      // Don't update state here — realtime INSERT listener will add it
      if (currentUser && !currentUser.is_primary && txn.amount) {
        await supabase.from("dues").insert({
          transaction_id: id,
          category,
          amount: txn.amount,
        });
      }
    }
  }

  // Settlement: primary user marks a debit as payment to wife, clears selected dues
  async function handleSettle(txnId: number, dueIds: number[]) {
    const txn = newTxns.find((t) => t.id === txnId);
    setNewTxns((prev) => prev.filter((t) => t.id !== txnId));

    // Mark transaction as Settlement
    await supabase.from("transactions").update({ category: "Settlement", status: "categorized" }).eq("id", txnId);
    if (txn) {
      setCategorizedTxns((prev) => [{ ...txn, category: "Settlement", status: "categorized" as const }, ...prev]);
    }

    // Clear selected dues and link settlement
    const now = new Date().toISOString();
    await supabase.from("dues").update({
      cleared: true,
      cleared_at: now,
      settlement_transaction_id: txnId,
    }).in("id", dueIds);

    // Update local dues state
    setDues((prev) => prev.map((d) =>
      dueIds.includes(d.id) ? { ...d, cleared: true, cleared_at: now, settlement_transaction_id: txnId } : d
    ));
  }

  // Build settlement hints from non-primary user's details
  const secondaryUser = allUsers.find((u) => !u.is_primary);
  const settlementHints = secondaryUser
    ? [secondaryUser.name, secondaryUser.phone_number, secondaryUser.upi_id].filter(Boolean) as string[]
    : [];

  function handleSelectUser(user: User) {
    localStorage.setItem("userPhone", user.phone_number);
    setCurrentUser(user);
    window.location.reload();
  }

  // User selection screen
  if (!loading && !currentUser && allUsers.length > 0) {
    return (
      <div className="max-w-sm mx-auto px-4 py-16 text-center">
        <h1 className="text-2xl font-bold mb-2" style={{ color: "var(--text-primary)" }}>ExpTrack</h1>
        <p className="mb-8" style={{ color: "var(--text-secondary)" }}>Who are you?</p>
        <div className="space-y-3">
          {allUsers.map((u) => (
            <button
              key={u.id}
              onClick={() => handleSelectUser(u)}
              className="glass w-full py-4 px-6 rounded-xl text-lg font-medium transition-all hover:scale-[1.02]"
              style={{ color: "var(--text-primary)" }}
            >
              {u.name} {u.is_primary && <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>(primary)</span>}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-lg" style={{ color: "var(--text-secondary)" }}>Loading...</div>
    </div>
  );

  const showReview = newTxns.length > 0;
  const unclearedDues = dues.filter((d) => !d.cleared);
  const duesTotal = unclearedDues.reduce((sum, d) => sum + Number(d.amount), 0);
  const activeView = showReview ? "review" : view === "review" ? "budget" : view;

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex justify-between items-center mb-4 pb-3" style={{ borderBottom: "1px solid var(--border)" }}>
        <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>ExpTrack</h1>
        <div className="text-right">
          {currentUser && <div className="text-xs" style={{ color: "var(--text-secondary)" }}>{currentUser.name}</div>}
          <div className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>v15</div>
        </div>
      </div>

      {!showReview && (
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setView("budget")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeView === "budget" ? "btn-gradient text-white glow-accent" : "glass"}`}
            style={activeView !== "budget" ? { color: "var(--text-secondary)" } : undefined}
          >
            Budget
          </button>
          <button
            onClick={() => setView("dues")}
            className={`px-4 py-2 rounded-lg text-sm font-medium relative transition-all ${activeView === "dues" ? "btn-gradient text-white glow-accent" : "glass"}`}
            style={activeView !== "dues" ? { color: "var(--text-secondary)" } : undefined}
          >
            Dues
            {duesTotal > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 text-white text-xs rounded-full" style={{ background: "var(--accent-red)" }}>
                {"\u20B9"}{duesTotal.toLocaleString("en-IN")}
              </span>
            )}
          </button>
        </div>
      )}

      {activeView === "review" ? (
        <NewSmsReview
          transactions={newTxns}
          categories={categories}
          onDone={handleReviewDone}
          userName={currentUser?.name}
          isPrimary={currentUser?.is_primary}
          unclearedDues={unclearedDues}
          onSettle={handleSettle}
          settlementHints={settlementHints}
        />
      ) : activeView === "dues" ? (
        <DuesView
          dues={dues}
          transactions={categorizedTxns}
          categories={categories}
          onDuesChange={setDues}
          payeeUpi={allUsers.find((u) => !u.is_primary)?.upi_id ?? null}
          payeeName={allUsers.find((u) => !u.is_primary)?.name ?? ""}
          isPrimary={currentUser?.is_primary ?? false}
          primaryName={allUsers.find((u) => u.is_primary)?.name ?? ""}
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

export default function Home() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><div className="text-lg" style={{ color: "var(--text-secondary)" }}>Loading...</div></div>}>
      <HomeInner />
    </Suspense>
  );
}
