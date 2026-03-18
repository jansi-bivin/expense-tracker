"use client";

import { useState, useEffect, useCallback, useRef, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { supabase, RawSms, Transaction, Category, User, Due, FeatureIdea } from "@/lib/supabase";
import { detectFields } from "@/lib/smsDetector";
import NewSmsReview from "@/components/NewSmsReview";
import SmsCard from "@/components/SmsCard";
import CategoryBudget from "@/components/CategoryBudget";
import DuesView from "@/components/DuesView";
import AddCategoryForm from "@/components/AddCategoryForm";
import ManualExpenseForm from "@/components/ManualExpenseForm";
import FeatureIdeas from "@/components/FeatureIdeas";

/* ── DebitOverlay: self-contained so overlayIdx doesn't re-render parent ── */
function DebitOverlay({ txns, categories, isPrimary, unclearedDues, settlementHints, merchantCategoryMap, onDone, onSnooze, onSettle, onDismissAll }: {
  txns: Transaction[]; categories: Category[]; isPrimary: boolean;
  unclearedDues: Due[]; settlementHints: Record<number, { txnId: number; amount: number }>;
  merchantCategoryMap: Record<string, string>;
  onDone: (txn: Transaction, cat: string, notes?: string) => void;
  onSnooze: (id: number) => void;
  onSettle: (dueId: number, txnId: number) => void;
  onDismissAll: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const safeIdx = Math.min(idx, txns.length - 1);
  const txn = txns[safeIdx];
  return (
    <>
      <div className="fixed inset-0 z-30" style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(2px)" }}
        onClick={onDismissAll} />
      <div className="fixed bottom-0 left-0 right-0 z-40 animate-slide-up">
        <div className="max-w-2xl mx-auto px-3 pb-4">
          <div className="flex justify-between items-center mb-2 px-1">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold px-2.5 py-1 rounded-full"
                style={{ background: "rgba(255,90,110,0.15)", color: "var(--accent-red)" }}>
                {safeIdx + 1} / {txns.length}
              </span>
              {txns.length > 1 && (
                <div className="flex gap-1">
                  <button className="text-xs px-2 py-0.5 rounded-lg"
                    style={{ background: "rgba(255,255,255,0.08)", color: idx > 0 ? "var(--text-primary)" : "var(--text-tertiary)" }}
                    disabled={idx <= 0} onClick={() => setIdx((i) => Math.max(0, i - 1))}>‹</button>
                  <button className="text-xs px-2 py-0.5 rounded-lg"
                    style={{ background: "rgba(255,255,255,0.08)", color: idx < txns.length - 1 ? "var(--text-primary)" : "var(--text-tertiary)" }}
                    disabled={idx >= txns.length - 1} onClick={() => setIdx((i) => Math.min(txns.length - 1, i + 1))}>›</button>
                </div>
              )}
            </div>
            <button className="text-[11px] font-medium px-3 py-1 rounded-full"
              style={{ background: "rgba(255,255,255,0.08)", color: "var(--text-secondary)" }}
              onClick={() => { onDismissAll(); setIdx(0); }}>
              Dismiss all
            </button>
          </div>
          <div className="rounded-2xl overflow-hidden"
            style={{ background: "var(--bg-elevated)", border: "1.5px solid rgba(255,255,255,0.1)", boxShadow: "0 -4px 30px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.05)" }}>
            <SmsCard
              txn={txn}
              categories={categories}
              onDone={(t, cat, notes) => { onDone(t, cat, notes); setIdx((i) => Math.max(0, i - 1)); }}
              isPrimary={isPrimary}
              unclearedDues={unclearedDues}
              onSettle={onSettle}
              settlementHints={settlementHints}
              onSnooze={(id) => { onSnooze(id); setIdx((i) => Math.max(0, i - 1)); }}
              merchantCategoryMap={merchantCategoryMap}
            />
          </div>
        </div>
      </div>
    </>
  );
}

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
  const [resetting, setResetting] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Feature 3: Active days
  const [activeDays, setActiveDays] = useState<number | null>(null);

  // Feature 4: Manual expense
  const [showManualExpense, setShowManualExpense] = useState(false);

  // Feature 5: Add category
  const [showAddCategory, setShowAddCategory] = useState(false);

  // overlayIdx moved into DebitOverlay component

  // Monthly cap overrides: { categoryId: overrideCap }
  const [monthlyOverrides, setMonthlyOverrides] = useState<Record<number, number>>({});

  // Snooze: client-side only, resets on reload
  const [snoozedTxns, setSnoozedTxns] = useState<Transaction[]>([]);
  const [showSnoozed, setShowSnoozed] = useState(false);

  // Feature ideas
  const [featureIdeas, setFeatureIdeas] = useState<FeatureIdea[]>([]);
  const [showFeatureIdeas, setShowFeatureIdeas] = useState(false);

  // Compute days in current month & scale factor
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const effectiveActiveDays = activeDays ?? daysInMonth;
  const scaleFactor = effectiveActiveDays / daysInMonth;

  // Secret reset: long-press logo for 3 seconds
  function startLongPress() {
    longPressTimer.current = setTimeout(() => {
      if (confirm("🗑️ RESET ALL DATA?\n\nThis will delete all transactions & dues.\nUsers and categories will be kept.\n\nAre you sure?")) {
        resetAllData();
      }
    }, 3000);
  }
  function cancelLongPress() {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  }
  async function resetAllData() {
    setResetting(true);
    await supabase.from("dues").delete().gt("id", 0);
    await supabase.from("transactions").delete().gt("id", 0);
    setNewTxns([]);
    setCategorizedTxns([]);
    setDues([]);
    setResetting(false);
  }

  const handleShowAddCategory = useCallback(() => setShowAddCategory(true), []);

  const updateBadge = useCallback((count: number) => {
    if ("setAppBadge" in navigator) {
      if (count > 0) (navigator as any).setAppBadge(count);
      else (navigator as any).clearAppBadge();
    }
    document.title = count > 0 ? `(${count}) ExpTrack` : "ExpTrack";
  }, []);

  // Badge counts all uncategorized: new + snoozed (only update after data loaded)
  useEffect(() => { if (!loading) updateBadge(newTxns.length + snoozedTxns.length); }, [loading, newTxns.length, snoozedTxns.length, updateBadge]);

  // Merchant → category auto-detect: build map from past categorized transactions
  const merchantCategoryMap = useMemo(() => {
    const counts = new Map<string, Map<string, number>>();
    for (const txn of categorizedTxns) {
      if (!txn.merchant || !txn.category) continue;
      const merchant = txn.merchant.toLowerCase().trim();
      if (!merchant) continue;
      if (!counts.has(merchant)) counts.set(merchant, new Map());
      const catMap = counts.get(merchant)!;
      catMap.set(txn.category, (catMap.get(txn.category) || 0) + 1);
    }
    const result = new Map<string, string>();
    const entries = Array.from(counts.entries())
      .map(([m, catMap]) => {
        const totalCount = Array.from(catMap.values()).reduce((a, b) => a + b, 0);
        let bestCat = "";
        let bestCount = 0;
        for (const [cat, count] of catMap) {
          if (count > bestCount) { bestCat = cat; bestCount = count; }
        }
        return { merchant: m, category: bestCat, totalCount };
      })
      .sort((a, b) => b.totalCount - a.totalCount)
      .slice(0, 20);
    for (const e of entries) result.set(e.merchant, e.category);
    return result;
  }, [categorizedTxns]);

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

      // Fetch active days setting
      const currentMonth = now.getMonth() + 1; // 1-indexed
      const currentYear = now.getFullYear();

      const { data: settingsData } = await supabase.from("settings").select("*").eq("key", "active_days").single();
      if (settingsData) {
        const val = settingsData.value as { days?: number | null; month?: number; year?: number };
        if (val.month === currentMonth && val.year === currentYear && val.days != null) {
          setActiveDays(val.days);
        } else {
          setActiveDays(null);
        }
      }

      // Fetch monthly cap overrides
      const { data: overridesData } = await supabase.from("settings").select("*").eq("key", "category_overrides").single();
      if (overridesData) {
        const val = overridesData.value as { overrides?: Record<string, number>; month?: number; year?: number };
        if (val.month === currentMonth && val.year === currentYear && val.overrides) {
          // Convert string keys back to numbers
          const parsed: Record<number, number> = {};
          for (const [k, v] of Object.entries(val.overrides)) {
            parsed[Number(k)] = v;
          }
          setMonthlyOverrides(parsed);
        }
      }

      // Fetch feature ideas
      const { data: ideasData } = await supabase.from("settings").select("*").eq("key", "feature_ideas").single();
      if (ideasData) {
        const val = ideasData.value as { ideas?: FeatureIdea[] };
        if (val.ideas) setFeatureIdeas(val.ideas);
      }

      // Fetch new SMS for this user
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
          setNewTxns((prev) => prev.some((t) => t.id === enriched.id) ? prev : [enriched, ...prev]);
        }
        // Manual expenses arrive as INSERT with status=categorized
        if (enriched.status === "categorized") {
          setCategorizedTxns((prev) => prev.some((t) => t.id === enriched.id) ? prev : [enriched, ...prev]);
        }
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "transactions" }, (payload) => {
        const updated = payload.new as RawSms;
        if (updated.status === "categorized" || updated.status === "ignored") {
          setNewTxns((prev) => prev.filter((t) => t.id !== updated.id));
          if (updated.status === "categorized") {
            const enriched = enrichSms(updated);
            // Deduplicate: skip if already added by handleReviewDone or handleManualExpense
            setCategorizedTxns((prev) => prev.some((t) => t.id === enriched.id) ? prev : [enriched, ...prev]);
          }
        }
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "dues" }, (payload) => {
        const d = payload.new as Due;
        setDues((prev) => prev.some((x) => x.id === d.id) ? prev : [d, ...prev]);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "dues" }, (payload) => {
        const updated = payload.new as Due;
        setDues((prev) => prev.map((d) => d.id === updated.id ? updated : d));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  // Feature 3: Save active days to Supabase
  async function handleActiveDaysUpdate(days: number) {
    setActiveDays(days === daysInMonth ? null : days);
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();
    await supabase.from("settings").upsert({
      key: "active_days",
      value: { days: days === daysInMonth ? null : days, month: currentMonth, year: currentYear },
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" });
  }

  // Monthly cap override handler
  async function handleMonthlyOverride(catId: number, cap: number | null) {
    const updated = { ...monthlyOverrides };
    if (cap === null) {
      delete updated[catId];
    } else {
      updated[catId] = cap;
    }
    setMonthlyOverrides(updated);

    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();
    await supabase.from("settings").upsert({
      key: "category_overrides",
      value: { overrides: updated, month: currentMonth, year: currentYear },
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" });
  }

  // Feature 4: Save manual expense
  async function handleManualExpense(expense: { amount: number; category: string; note: string; date: number }) {
    const phone = currentUser?.phone_number ?? null;
    // Format body so detectFields can parse amount: "Rs.500.00 debited. Manual: note"
    const amtStr = expense.amount.toFixed(2);
    const body = expense.note
      ? `Rs.${amtStr} debited. Manual: ${expense.note}`
      : `Rs.${amtStr} debited. Manual expense`;

    const { data: inserted } = await supabase.from("transactions").insert({
      address: "MANUAL",
      body,
      sms_date: expense.date,
      phone_number: phone,
      category: expense.category,
      notes: expense.note || null,
      status: "categorized",
    }).select().single();

    if (inserted) {
      const enriched = enrichSms(inserted as RawSms);
      setCategorizedTxns((prev) => [enriched, ...prev]);

      // If secondary user, create a due
      if (currentUser && !currentUser.is_primary) {
        await supabase.from("dues").insert({
          transaction_id: inserted.id,
          category: expense.category,
          amount: expense.amount,
        });
      }
    }

    setShowManualExpense(false);
  }

  // Feature 5: Add new category
  function handleAddCategory(cat: Category) {
    setCategories((prev) => [...prev, cat].sort((a, b) => a.name.localeCompare(b.name)));
    setShowAddCategory(false);
  }

  // Snooze: move from newTxns to snoozedTxns (client-side only)
  function handleSnooze(id: number) {
    const txn = newTxns.find((t) => t.id === id);
    if (txn) {
      setNewTxns((prev) => prev.filter((t) => t.id !== id));
      setSnoozedTxns((prev) => [txn, ...prev]);
    }
  }

  function handleUnsnooze(id: number) {
    const txn = snoozedTxns.find((t) => t.id === id);
    if (txn) {
      setSnoozedTxns((prev) => prev.filter((t) => t.id !== id));
      setNewTxns((prev) => [txn, ...prev]);
    }
  }

  // Reclassify: change category of an already-categorized transaction
  async function handleReclassify(txnId: number, newCategory: string) {
    await supabase.from("transactions").update({ category: newCategory }).eq("id", txnId);
    setCategorizedTxns((prev) => prev.map((t) => t.id === txnId ? { ...t, category: newCategory } : t));
    // Update associated due if any
    await supabase.from("dues").update({ category: newCategory }).eq("transaction_id", txnId);
    setDues((prev) => prev.map((d) => d.transaction_id === txnId ? { ...d, category: newCategory } : d));
  }

  // Feature ideas
  async function handleAddIdea(text: string, type: 'feature' | 'bug' = 'feature') {
    const maxSeq = featureIdeas.filter((i) => i.type === type).reduce((max, i) => Math.max(max, i.seq || 0), 0);
    const idea: FeatureIdea = { id: crypto.randomUUID(), seq: maxSeq + 1, text, type, status: 'pending', created_at: new Date().toISOString() };
    const updated = [idea, ...featureIdeas];
    setFeatureIdeas(updated);
    await supabase.from("settings").upsert({
      key: "feature_ideas",
      value: { ideas: updated },
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" });
  }

  async function handleDeleteIdea(id: string) {
    const updated = featureIdeas.filter((i) => i.id !== id);
    setFeatureIdeas(updated);
    await supabase.from("settings").upsert({
      key: "feature_ideas",
      value: { ideas: updated },
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" });
  }

  async function handleReviewDone(id: number, category?: string, notes?: string) {
    const txn = newTxns.find((t) => t.id === id);
    setNewTxns((prev) => prev.filter((t) => t.id !== id));
    if (txn && category) {
      setCategorizedTxns((prev) => [{ ...txn, category, notes: notes || null, status: "categorized" as const }, ...prev]);

      // If secondary user categorized, create a due
      if (currentUser && !currentUser.is_primary && txn.amount) {
        await supabase.from("dues").insert({
          transaction_id: id,
          category,
          amount: txn.amount,
        });
      }
    }
  }

  // Settlement: primary user marks a debit as payment, partially settles dues
  async function handleSettle(txnId: number, dueIds: number[]) {
    const txn = newTxns.find((t) => t.id === txnId);
    const paymentAmount = txn?.amount || 0;
    setNewTxns((prev) => prev.filter((t) => t.id !== txnId));

    await supabase.from("transactions").update({ category: "Settlement", status: "categorized" }).eq("id", txnId);
    if (txn) {
      setCategorizedTxns((prev) => [{ ...txn, category: "Settlement", status: "categorized" as const }, ...prev]);
    }

    const nowIso = new Date().toISOString();
    const selectedDues = dues.filter((d) => dueIds.includes(d.id));
    let remaining = paymentAmount;
    const fullyCleared: number[] = [];
    let partialDue: { id: number; newAmount: number } | null = null;

    for (const due of selectedDues) {
      const dueAmt = Number(due.amount);
      if (remaining >= dueAmt) {
        fullyCleared.push(due.id);
        remaining -= dueAmt;
      } else if (remaining > 0) {
        // Partial: reduce the due amount by what's left
        partialDue = { id: due.id, newAmount: dueAmt - remaining };
        remaining = 0;
      }
      // remaining === 0 and more dues selected? leave them untouched
    }

    // Clear fully covered dues
    if (fullyCleared.length > 0) {
      await supabase.from("dues").update({
        cleared: true,
        cleared_at: nowIso,
        settlement_transaction_id: txnId,
      }).in("id", fullyCleared);
    }

    // Reduce partially covered due
    if (partialDue) {
      await supabase.from("dues").update({
        amount: partialDue.newAmount,
      }).eq("id", partialDue.id);
    }

    setDues((prev) => prev.map((d) => {
      if (fullyCleared.includes(d.id)) {
        return { ...d, cleared: true, cleared_at: nowIso, settlement_transaction_id: txnId };
      }
      if (partialDue && d.id === partialDue.id) {
        return { ...d, amount: partialDue.newAmount };
      }
      return d;
    }));
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

  const isPrimary = currentUser?.is_primary ?? false;

  // User selection screen
  if (!loading && !currentUser && allUsers.length > 0) {
    return (
      <div className="max-w-sm mx-auto px-5 py-20 text-center animate-fade-in">
        <div className="text-3xl font-extrabold tracking-tight mb-1" style={{ color: "var(--text-primary)" }}>
          Exp<span style={{ color: "var(--accent)" }}>Track</span>
        </div>
        <p className="text-sm mb-10" style={{ color: "var(--text-tertiary)" }}>Select your profile</p>
        <div className="space-y-3 stagger">
          {allUsers.map((u) => (
            <button
              key={u.id}
              onClick={() => handleSelectUser(u)}
              className="card w-full py-4 px-6 text-left animate-slide-up"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center text-base font-bold"
                  style={{ background: u.is_primary ? "linear-gradient(135deg, #7b6cf6, #5b4cd4)" : "linear-gradient(135deg, #00d4a1, #00a67d)", color: "#fff" }}>
                  {u.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1">
                  <div className="font-semibold" style={{ color: "var(--text-primary)" }}>{u.name}</div>
                  <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                    {u.is_primary ? "Primary account" : "Secondary account"}
                  </div>
                </div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: "var(--text-tertiary)" }}>
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (loading) return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-3">
      <div className="w-8 h-8 rounded-full border-2 border-transparent animate-spin"
        style={{ borderTopColor: "var(--accent)", borderRightColor: "var(--accent)" }} />
      <div className="text-sm" style={{ color: "var(--text-tertiary)" }}>Loading...</div>
    </div>
  );

  const unclearedDues = dues.filter((d) => !d.cleared);
  const duesTotal = unclearedDues.reduce((sum, d) => sum + Number(d.amount), 0);
  const activeView = view === "review" ? "budget" : view;
  const hasOverlay = newTxns.length > 0;

  return (
    <div className="max-w-2xl mx-auto px-4 pt-5 pb-24 animate-fade-in">
      {/* Header */}
      <div className="flex justify-between items-center mb-5">
        <div>
          <div className="text-xl font-extrabold tracking-tight select-none"
            onTouchStart={startLongPress} onTouchEnd={cancelLongPress} onTouchCancel={cancelLongPress}
            onMouseDown={startLongPress} onMouseUp={cancelLongPress} onMouseLeave={cancelLongPress}>
            {resetting ? <span style={{ color: "var(--accent-red)" }}>Resetting...</span> : <>Exp<span style={{ color: "var(--accent)" }}>Track</span></>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {currentUser && (
            <div className="flex items-center gap-2">
              <div className="pulse-dot" />
              <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>{currentUser.name}</span>
            </div>
          )}
        </div>
      </div>

      {/* Tab bar — always visible */}
      <div className="flex gap-1.5 mb-5 p-1 rounded-2xl" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)" }}>
        <button
          onClick={() => setView("budget")}
          className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all ${
            activeView === "budget" ? "btn-primary" : ""
          }`}
          style={activeView !== "budget" ? { color: "var(--text-tertiary)" } : undefined}
        >
          💰 Budget
        </button>
        <button
          onClick={() => setView("dues")}
          className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all relative ${
            activeView === "dues" ? "btn-primary" : ""
          }`}
          style={activeView !== "dues" ? { color: "var(--text-tertiary)" } : undefined}
        >
          📋 Dues
          {duesTotal > 0 && (
            <span className="badge badge-red ml-1.5 text-[10px] py-0">
              {"\u20B9"}{duesTotal.toLocaleString("en-IN")}
            </span>
          )}
        </button>
      </div>

      {/* Content */}
      <div className="animate-fade-in">
        {activeView === "dues" ? (
          <DuesView
            dues={dues}
            transactions={categorizedTxns}
            categories={categories}
            onDuesChange={setDues}
            payeeUpi={allUsers.find((u) => !u.is_primary)?.upi_id ?? null}
            payeeName={allUsers.find((u) => !u.is_primary)?.name ?? ""}
            isPrimary={isPrimary}
            primaryName={allUsers.find((u) => u.is_primary)?.name ?? ""}
          />
        ) : (
          <>
            <CategoryBudget
              transactions={categorizedTxns}
              categories={categories}
              isPrimary={isPrimary}
              scaleFactor={scaleFactor}
              monthlyOverrides={monthlyOverrides}
              onCategoriesChange={setCategories}
              onShowAddCategory={handleShowAddCategory}
              onMonthlyOverride={handleMonthlyOverride}
              activeDays={effectiveActiveDays}
              daysInMonth={daysInMonth}
              onActiveDaysUpdate={handleActiveDaysUpdate}
              onReclassify={handleReclassify}
            />
          </>
        )}
      </div>

      {/* ═══ Debit Overlay — own component so overlayIdx doesn't re-render parent ═══ */}
      {hasOverlay && (
        <DebitOverlay
          txns={newTxns}
          categories={categories}
          isPrimary={isPrimary}
          unclearedDues={unclearedDues}
          settlementHints={settlementHints}
          merchantCategoryMap={merchantCategoryMap}
          onDone={handleReviewDone}
          onSnooze={handleSnooze}
          onSettle={handleSettle}
          onDismissAll={() => newTxns.forEach((t) => handleSnooze(t.id))}
        />
      )}

      {/* Version footer — tap to open feature ideas */}
      <div className="text-center mt-8 mb-2">
        <button
          className="text-[10px] bg-transparent border-0 cursor-pointer"
          style={{ color: "var(--text-tertiary)", opacity: 0.4 }}
          onClick={() => setShowFeatureIdeas(true)}
        >
          v{process.env.APP_VERSION}
        </button>
      </div>

      {/* Add Expense button — fixed bottom bar, budget view only */}
      {activeView === "budget" && !showManualExpense && !showAddCategory && !hasOverlay && (
        <div className="fixed bottom-0 left-0 right-0 z-40 px-4 pb-5 pt-3"
          style={{ background: "linear-gradient(to top, var(--bg-base) 70%, transparent)" }}>
          <button
            className="w-full max-w-2xl mx-auto flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-semibold transition-all active:scale-[0.98]"
            style={{
              background: "linear-gradient(135deg, var(--accent), var(--accent-dim))",
              color: "#fff",
              boxShadow: "0 4px 20px rgba(123, 108, 246, 0.3)",
            }}
            onClick={() => setShowManualExpense(true)}
          >
            <span>+</span>
            <span>Add Expense</span>
          </button>
        </div>
      )}

      {/* Manual Expense Form overlay */}
      {showManualExpense && (
        <ManualExpenseForm
          categories={categories}
          isPrimary={isPrimary}
          onSave={handleManualExpense}
          onClose={() => setShowManualExpense(false)}
        />
      )}

      {/* Add Category Form overlay */}
      {showAddCategory && (
        <AddCategoryForm
          onSave={handleAddCategory}
          onClose={() => setShowAddCategory(false)}
        />
      )}

      {/* Feature Ideas overlay */}
      {showFeatureIdeas && (
        <FeatureIdeas
          ideas={featureIdeas}
          onAdd={handleAddIdea}
          onDelete={handleDeleteIdea}
          onClose={() => setShowFeatureIdeas(false)}
        />
      )}
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={
      <div className="flex flex-col items-center justify-center min-h-screen gap-3">
        <div className="w-8 h-8 rounded-full border-2 border-transparent animate-spin"
          style={{ borderTopColor: "var(--accent)", borderRightColor: "var(--accent)" }} />
        <div className="text-sm" style={{ color: "var(--text-tertiary)" }}>Loading...</div>
      </div>
    }>
      <HomeInner />
    </Suspense>
  );
}
