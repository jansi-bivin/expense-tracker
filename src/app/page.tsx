// Auto-implemented by watcher test
"use client";

import { useState, useEffect, useCallback, useRef, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { supabase, RawSms, Transaction, Category, User, Due, FeatureIdea, MonthlyBudget } from "@/lib/supabase";
import { detectFields } from "@/lib/smsDetector";
import NewSmsReview from "@/components/NewSmsReview";
import SmsCard from "@/components/SmsCard";
import CategoryBudget from "@/components/CategoryBudget";
import DuesView from "@/components/DuesView";
import AddCategoryForm from "@/components/AddCategoryForm";
import ManualExpenseForm from "@/components/ManualExpenseForm";
import FeatureIdeas from "@/components/FeatureIdeas";
import BudgetGrid from "@/components/BudgetGrid";

/* ── DebitOverlay: self-contained so overlayIdx doesn't re-render parent ── */
function DebitOverlay({ txns, categories, isPrimary, unclearedDues, settlementHints, merchantCategoryMap, categoryFrequencyMap, onDone, onSnooze, onSettle, onDismissAll, onSaveMapping, onCategoryCreated }: {
  txns: Transaction[]; categories: Category[]; isPrimary: boolean;
  unclearedDues: Due[]; settlementHints: string[];
  merchantCategoryMap: Map<string, string>;
  categoryFrequencyMap: Map<string, number>;
  onDone: (id: number, cat?: string, notes?: string) => void;
  onSnooze: (id: number) => void;
  onSettle: (txnId: number, dueIds: number[]) => void;
  onDismissAll: () => void;
  onSaveMapping: (merchant: string, category: string) => void;
  onCategoryCreated: (cat: Category) => void;
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
              key={txn.id}
              txn={txn}
              categories={categories}
              onDone={(t, cat, notes) => { onDone(t, cat, notes); setIdx((i) => Math.max(0, i - 1)); }}
              isPrimary={isPrimary}
              unclearedDues={unclearedDues}
              onSettle={onSettle}
              settlementHints={settlementHints}
              onSnooze={(id) => { onSnooze(id); setIdx((i) => Math.max(0, i - 1)); }}
              merchantCategoryMap={merchantCategoryMap}
              categoryFrequencyMap={categoryFrequencyMap}
              onSaveMapping={onSaveMapping}
              onCategoryCreated={onCategoryCreated}
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

  // Merchant category overrides: manually pinned mappings
  const [merchantOverrides, setMerchantOverrides] = useState<Map<string, string>>(new Map());

  // Snooze: client-side only, resets on reload
  const [snoozedTxns, setSnoozedTxns] = useState<Transaction[]>([]);
  const [showSnoozed, setShowSnoozed] = useState(false);

  // Feature ideas
  const [featureIdeas, setFeatureIdeas] = useState<FeatureIdea[]>([]);
  const [showFeatureIdeas, setShowFeatureIdeas] = useState(false);

  // Budget planner
  const [monthlyBudgets, setMonthlyBudgets] = useState<MonthlyBudget[]>([]);
  const [showBudgetPlanner, setShowBudgetPlanner] = useState(false);

  // History navigation: which month/year is the user viewing? (0-indexed month)
  const [viewDate, setViewDate] = useState<{ month: number; year: number }>(() => {
    const n = new Date();
    return { month: n.getMonth(), year: n.getFullYear() };
  });
  const { month: viewMonth, year: viewYear } = viewDate;

  // Compute days in viewed month & scale factor
  const now = new Date();
  const isCurrentMonth = viewMonth === now.getMonth() && viewYear === now.getFullYear();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
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

  // History navigation helpers
  function prevMonth() {
    setViewDate(({ month, year }) =>
      month === 0 ? { month: 11, year: year - 1 } : { month: month - 1, year }
    );
  }
  function nextMonth() {
    setViewDate(({ month, year }) =>
      month === 11 ? { month: 0, year: year + 1 } : { month: month + 1, year }
    );
  }
  function goToCurrentMonth() {
    const n = new Date();
    setViewDate({ month: n.getMonth(), year: n.getFullYear() });
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
  const handleDismissAll = useCallback(() => {
    setNewTxns((prev) => {
      setSnoozedTxns((sp) => [...prev, ...sp]);
      return [];
    });
  }, []);

  const updateBadge = useCallback((count: number) => {
    if ("setAppBadge" in navigator) {
      if (count > 0) (navigator as any).setAppBadge(count);
      else (navigator as any).clearAppBadge();
    }
    document.title = count > 0 ? `(${count}) ExpTrack` : "ExpTrack";
  }, []);

  // Badge counts all uncategorized: new + snoozed (only update after data loaded)
  useEffect(() => { if (!loading) updateBadge(newTxns.length + snoozedTxns.length); }, [loading, newTxns.length, snoozedTxns.length, updateBadge]);

  // Category usage frequency: count how often each category has been used
  const categoryFrequencyMap = useMemo(() => {
    const freq = new Map<string, number>();
    for (const txn of categorizedTxns) {
      if (!txn.category) continue;
      freq.set(txn.category, (freq.get(txn.category) || 0) + 1);
    }
    return freq;
  }, [categorizedTxns]);

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
    // Manual overrides take priority over history-based suggestions
    for (const [merchant, category] of merchantOverrides) {
      result.set(merchant, category);
    }
    return result;
  }, [categorizedTxns, merchantOverrides]);

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

      // Load manual merchant→category overrides
      const { data: mappingData } = await supabase.from("settings").select("*").eq("key", "merchant_category_overrides").single();
      if (mappingData) {
        const val = mappingData.value as { mappings?: Record<string, string> };
        if (val.mappings) setMerchantOverrides(new Map(Object.entries(val.mappings)));
      }

      // Fetch monthly budgets for current month (replaces legacy category_overrides)
      const { data: mbData } = await supabase
        .from("monthly_budgets")
        .select("*")
        .eq("month", currentMonth)
        .eq("year", currentYear);

      if (mbData && mbData.length > 0) {
        setMonthlyBudgets(mbData);
        const overrides: Record<number, number> = {};
        for (const mb of mbData) {
          if (mb.is_included) overrides[mb.category_id] = mb.cap;
        }
        setMonthlyOverrides(overrides);
      } else {
        // Fallback: migrate legacy category_overrides from settings
        const { data: legacyData } = await supabase
          .from("settings").select("*").eq("key", "category_overrides").single();
        if (legacyData) {
          const val = legacyData.value as { overrides?: Record<string, number>; month?: number; year?: number };
          if (val.month === currentMonth && val.year === currentYear && val.overrides) {
            const parsed: Record<number, number> = {};
            for (const [k, v] of Object.entries(val.overrides)) {
              parsed[Number(k)] = v;
            }
            setMonthlyOverrides(parsed);
            // Auto-migrate to monthly_budgets
            const rows = Object.entries(val.overrides).map(([catIdStr, cap]) => {
              const catId = Number(catIdStr);
              const cat = cats?.find((c: Category) => c.id === catId);
              return {
                month: currentMonth, year: currentYear,
                category_id: catId, category_name: cat?.name ?? "",
                cap, is_included: true,
              };
            });
            if (rows.length > 0) {
              await supabase.from("monthly_budgets").upsert(rows, { onConflict: "month,year,category_id" });
              await supabase.from("settings").delete().eq("key", "category_overrides");
            }
          }
        }
      }

      // Fetch feature ideas from dedicated table
      const { data: ideasData } = await supabase.from("feature_ideas").select("*").order("created_at", { ascending: false });
      if (ideasData) setFeatureIdeas(ideasData);

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

  // Reload month-specific data (active_days + monthly_budgets) when user navigates to a different month
  const skipFirstMonthLoad = useRef(true);
  useEffect(() => {
    if (skipFirstMonthLoad.current) { skipFirstMonthLoad.current = false; return; }
    async function loadMonthData() {
      const m = viewMonth + 1; // 1-indexed
      const y = viewYear;

      // Active days for this month
      const { data: settingsData } = await supabase.from("settings").select("*").eq("key", "active_days").single();
      if (settingsData) {
        const val = settingsData.value as { days?: number | null; month?: number; year?: number };
        setActiveDays(val.month === m && val.year === y && val.days != null ? val.days : null);
      } else {
        setActiveDays(null);
      }

      // Monthly budgets for this month
      const { data: mbData } = await supabase
        .from("monthly_budgets")
        .select("*")
        .eq("month", m)
        .eq("year", y);
      if (mbData && mbData.length > 0) {
        setMonthlyBudgets(mbData);
        const overrides: Record<number, number> = {};
        for (const mb of mbData) {
          if (mb.is_included) overrides[mb.category_id] = mb.cap;
        }
        setMonthlyOverrides(overrides);
      } else {
        setMonthlyBudgets([]);
        setMonthlyOverrides({});
      }
    }
    loadMonthData();
  }, [viewMonth, viewYear]);

  // Feature 3: Save active days to Supabase
  async function handleActiveDaysUpdate(days: number) {
    setActiveDays(days === daysInMonth ? null : days);
    await supabase.from("settings").upsert({
      key: "active_days",
      value: { days: days === daysInMonth ? null : days, month: viewMonth + 1, year: viewYear },
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" });
  }

  // Monthly cap override handler — writes to monthly_budgets table
  async function handleMonthlyOverride(catId: number, cap: number | null) {
    const updated = { ...monthlyOverrides };
    if (cap === null) {
      delete updated[catId];
    } else {
      updated[catId] = cap;
    }
    setMonthlyOverrides(updated);

    const currentMonth = viewMonth + 1;
    const currentYear = viewYear;
    const cat = categories.find(c => c.id === catId);

    if (cap === null) {
      await supabase.from("monthly_budgets")
        .delete()
        .eq("month", currentMonth).eq("year", currentYear).eq("category_id", catId);
    } else {
      await supabase.from("monthly_budgets").upsert({
        month: currentMonth, year: currentYear,
        category_id: catId, category_name: cat?.name ?? "",
        cap, is_included: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: "month,year,category_id" });
    }
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
  const handleSnooze = useCallback((id: number) => {
    setNewTxns((prev) => {
      const txn = prev.find((t) => t.id === id);
      if (txn) setSnoozedTxns((sp) => [txn, ...sp]);
      return prev.filter((t) => t.id !== id);
    });
  }, []);

  async function handleSaveMapping(merchant: string, category: string) {
    const key = merchant.toLowerCase().trim();
    const updated = new Map(merchantOverrides);
    updated.set(key, category);
    setMerchantOverrides(updated);
    const mappings: Record<string, string> = {};
    for (const [m, c] of updated) mappings[m] = c;
    await supabase.from("settings").upsert({
      key: "merchant_category_overrides",
      value: { mappings },
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" });
  }

  function handleUnsnooze(id: number) {
    const txn = snoozedTxns.find((t) => t.id === id);
    if (txn) {
      setSnoozedTxns((prev) => prev.filter((t) => t.id !== id));
      setNewTxns((prev) => [txn, ...prev]);
    }
  }

  // B2: Delete a manual transaction
  async function handleDeleteTxn(txnId: number) {
    await supabase.from("dues").delete().eq("transaction_id", txnId);
    await supabase.from("transactions").delete().eq("id", txnId);
    setCategorizedTxns((prev) => prev.filter((t) => t.id !== txnId));
    setDues((prev) => prev.filter((d) => d.transaction_id !== txnId));
  }

  // Reclassify: change category of an already-categorized transaction
  async function handleReclassify(txnId: number, newCategory: string) {
    await supabase.from("transactions").update({ category: newCategory }).eq("id", txnId);
    setCategorizedTxns((prev) => prev.map((t) => t.id === txnId ? { ...t, category: newCategory } : t));
    // Update associated due if any
    await supabase.from("dues").update({ category: newCategory }).eq("transaction_id", txnId);
    setDues((prev) => prev.map((d) => d.transaction_id === txnId ? { ...d, category: newCategory } : d));
  }

  // Feature ideas — now uses dedicated feature_ideas table
  async function handleAddIdea(text: string, type: 'feature' | 'bug' = 'feature') {
    const maxSeq = featureIdeas.filter((i) => i.type === type).reduce((max, i) => Math.max(max, i.seq || 0), 0);
    const newIdea = { id: crypto.randomUUID(), seq: maxSeq + 1, text, type, status: 'pending' as const };
    const { data } = await supabase.from("feature_ideas").insert(newIdea).select().single();
    if (data) setFeatureIdeas((prev) => [data, ...prev]);
  }

  async function handleUpdateIdea(id: string, newText: string) {
    await supabase.from("feature_ideas").update({ text: newText }).eq("id", id);
    setFeatureIdeas((prev) => prev.map((i) => i.id === id ? { ...i, text: newText } : i));
  }

  async function handleDeleteIdea(id: string) {
    await supabase.from("feature_ideas").delete().eq("id", id);
    setFeatureIdeas((prev) => prev.filter((i) => i.id !== id));
  }

  const handleReviewDone = useCallback(async (id: number, category?: string, notes?: string) => {
    let foundTxn: Transaction | undefined;
    setNewTxns((prev) => {
      foundTxn = prev.find((t) => t.id === id);
      return prev.filter((t) => t.id !== id);
    });
    // Wait a tick so foundTxn is set from the updater
    await new Promise((r) => setTimeout(r, 0));
    if (foundTxn && category) {
      setCategorizedTxns((prev) => [{ ...foundTxn!, category, notes: notes || null, status: "categorized" as const }, ...prev]);
      // If secondary user categorized, create a due
      const user = currentUser;
      if (user && !user.is_primary && foundTxn.amount) {
        await supabase.from("dues").insert({
          transaction_id: id,
          category,
          amount: foundTxn.amount,
        });
      }
    }
  }, [currentUser]);

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

    // Treat near-zero partial due as fully cleared (floating point edge case)
    if (partialDue && partialDue.newAmount < 0.01) {
      fullyCleared.push(partialDue.id);
      partialDue = null;
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

  // B-20: Reload monthly budgets when planner closes so main view reflects changes
  async function handlePlannerClose() {
    setShowBudgetPlanner(false);
    const m = viewMonth + 1;
    const y = viewYear;
    const { data: mbData } = await supabase
      .from("monthly_budgets")
      .select("*")
      .eq("month", m)
      .eq("year", y);
    if (mbData) {
      setMonthlyBudgets(mbData);
      const overrides: Record<number, number> = {};
      for (const mb of mbData) {
        if (mb.is_included) overrides[mb.category_id] = mb.cap;
      }
      setMonthlyOverrides(overrides);
    } else {
      setMonthlyBudgets([]);
      setMonthlyOverrides({});
    }
  }

  // Categories excluded from this month's budget
  const excludedCategoryIds = useMemo(() => {
    const set = new Set<number>();
    for (const mb of monthlyBudgets) {
      if (!mb.is_included) set.add(mb.category_id);
    }
    return set;
  }, [monthlyBudgets]);

  // Memoize derived data (must be before early returns for Rules of Hooks)
  const unclearedDues = useMemo(() => dues.filter((d) => !d.cleared), [dues]);
  const duesTotal = useMemo(() => unclearedDues.reduce((sum, d) => sum + Number(d.amount), 0), [unclearedDues]);

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
        {/* F-17: APK download link */}
        <a href="/api/download-apk" download
          className="inline-flex items-center gap-2 mt-10 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "var(--text-tertiary)" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Download SMS Reader APK
        </a>
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

  const activeView = view === "review" ? "budget" : view;
  const hasOverlay = newTxns.length > 0;

  return (
    <div className="max-w-2xl mx-auto px-4 pt-5 pb-24 animate-fade-in">
      {/* Header */}
      <div className="flex justify-between items-center mb-5">
        <div className="flex items-center gap-2.5">
          <div className="text-xl font-extrabold tracking-tight select-none"
            onTouchStart={startLongPress} onTouchEnd={cancelLongPress} onTouchCancel={cancelLongPress}
            onMouseDown={startLongPress} onMouseUp={cancelLongPress} onMouseLeave={cancelLongPress}>
            {resetting ? <span style={{ color: "var(--accent-red)" }}>Resetting...</span> : <>Exp<span style={{ color: "var(--accent)" }}>Track</span></>}
          </div>
          <div className="flex items-center gap-0.5">
            <button onClick={prevMonth} className="flex items-center justify-center w-5 h-5 rounded-full transition-opacity hover:opacity-100" style={{ opacity: 0.5, background: "transparent", border: "none", cursor: "pointer", padding: 0 }} aria-label="Previous month">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
            <button
              onClick={!isCurrentMonth ? goToCurrentMonth : undefined}
              className="text-[10px] font-bold px-2 py-0.5 rounded-full tracking-wide"
              style={{
                background: isCurrentMonth ? "rgba(123,108,246,0.1)" : "rgba(251,191,36,0.12)",
                color: isCurrentMonth ? "var(--text-tertiary)" : "rgba(251,191,36,0.9)",
                border: isCurrentMonth ? "1px solid rgba(123,108,246,0.12)" : "1px solid rgba(251,191,36,0.25)",
                cursor: isCurrentMonth ? "default" : "pointer",
              }}
              title={!isCurrentMonth ? "Tap to return to current month" : undefined}
            >
              {new Date(viewYear, viewMonth, 1).toLocaleDateString("en-IN", { month: "short", year: "numeric" }).toUpperCase()}
            </button>
            {!isCurrentMonth && (
              <button onClick={nextMonth} className="flex items-center justify-center w-5 h-5 rounded-full transition-opacity hover:opacity-100" style={{ opacity: 0.5, background: "transparent", border: "none", cursor: "pointer", padding: 0 }} aria-label="Next month">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
              </button>
            )}
          </div>
        </div>
        {currentUser && (
          <div className="flex items-center gap-2 px-2.5 py-1 rounded-full"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="pulse-dot" />
            <span className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>{currentUser.name}</span>
          </div>
        )}
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
              excludedCategoryIds={excludedCategoryIds}
              onCategoriesChange={setCategories}
              onShowAddCategory={handleShowAddCategory}
              onMonthlyOverride={handleMonthlyOverride}
              activeDays={effectiveActiveDays}
              daysInMonth={daysInMonth}
              onActiveDaysUpdate={handleActiveDaysUpdate}
              onReclassify={handleReclassify}
              onDeleteTxn={handleDeleteTxn}
              viewMonth={viewMonth}
              viewYear={viewYear}
              dues={dues}
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
          categoryFrequencyMap={categoryFrequencyMap}
          onDone={handleReviewDone}
          onSnooze={handleSnooze}
          onSettle={handleSettle}
          onDismissAll={handleDismissAll}
          onSaveMapping={handleSaveMapping}
          onCategoryCreated={handleAddCategory}
        />
      )}

      {/* Version footer — tap to open feature ideas */}
      <div className="flex items-center justify-center gap-3 mt-8 mb-2">
        <button
          className="text-[10px] bg-transparent border-0 cursor-pointer"
          style={{ color: "var(--text-tertiary)", opacity: 0.4 }}
          onClick={() => setShowFeatureIdeas(true)}
        >
          v{process.env.APP_VERSION}
        </button>
        <a href="/api/download-apk" download
          className="text-[10px] no-underline"
          style={{ color: "var(--text-tertiary)", opacity: 0.4 }}>
          APK
        </a>
      </div>

      {/* ═══ Bottom Navigation Bar ═══ */}
      {!showManualExpense && !showAddCategory && !hasOverlay && !showBudgetPlanner && !showFeatureIdeas && (
        <nav className="fixed bottom-0 left-0 right-0 z-40"
          style={{
            background: "rgba(10,10,22,0.95)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            borderTop: "1px solid rgba(255,255,255,0.06)",
          }}>
          <div className="max-w-2xl mx-auto grid px-4 pt-2 pb-5"
            style={{ gridTemplateColumns: isPrimary ? "1fr auto 1fr 1fr" : "1fr auto 1fr" }}>
            {/* Expenses */}
            <button
              onClick={() => setView("budget")}
              className="flex flex-col items-center gap-1 py-1.5 transition-all relative"
              style={activeView === "budget" ? { color: "var(--accent)" } : { color: "var(--text-tertiary)", opacity: 0.45 }}
            >
              {activeView === "budget" && <div className="nav-tab-line" />}
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
              </svg>
              <span className="text-[10px] font-semibold">Expenses</span>
            </button>

            {/* Add — FAB */}
            <button
              onClick={() => setShowManualExpense(true)}
              className="flex flex-col items-center px-4"
              style={{ color: "white" }}
            >
              <div className="fab" style={{ marginTop: "-22px" }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </div>
              <span className="text-[10px] font-semibold mt-1" style={{ color: "var(--accent-bright)" }}>Add</span>
            </button>

            {/* Dues */}
            <button
              onClick={() => setView("dues")}
              className="flex flex-col items-center gap-1 py-1.5 transition-all relative"
              style={activeView === "dues" ? { color: "var(--accent)" } : { color: "var(--text-tertiary)", opacity: 0.45 }}
            >
              {activeView === "dues" && <div className="nav-tab-line" />}
              <div className="relative">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <path d="M9 12h6M9 8h6M9 16h4" />
                </svg>
                {unclearedDues.length > 0 && Math.round(duesTotal) > 0 && (
                  <span className="absolute -top-1.5 -right-2.5 text-[7px] font-bold px-1 py-0.5 rounded-full"
                    style={{ background: "var(--accent-red)", color: "#fff", minWidth: 14, textAlign: "center", lineHeight: 1 }}>
                    {duesTotal > 999 ? Math.round(duesTotal/1000) + "K" : Math.round(duesTotal)}
                  </span>
                )}
              </div>
              <span className="text-[10px] font-semibold">Dues</span>
            </button>

            {/* Planner */}
            {isPrimary && (
              <button
                onClick={() => setShowBudgetPlanner(true)}
                className="flex flex-col items-center gap-1 py-1.5 transition-all relative"
                style={{ color: "var(--text-tertiary)", opacity: 0.45 }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="16" rx="2" />
                  <path d="M3 10h18M9 4v16" />
                </svg>
                <span className="text-[10px] font-semibold">Planner</span>
              </button>
            )}
          </div>
        </nav>
      )}

      {/* Manual Expense Form overlay */}
      {showManualExpense && (
        <ManualExpenseForm
          categories={categories}
          isPrimary={isPrimary}
          transactions={categorizedTxns}
          onSave={handleManualExpense}
          onClose={() => setShowManualExpense(false)}
        />
      )}

      {/* Feature Ideas overlay */}
      {showFeatureIdeas && (
        <FeatureIdeas
          ideas={featureIdeas}
          onAdd={handleAddIdea}
          onDelete={handleDeleteIdea}
          onUpdate={handleUpdateIdea}
          onClose={() => setShowFeatureIdeas(false)}
        />
      )}

      {/* Budget Grid overlay */}
      {showBudgetPlanner && (
        <BudgetGrid
          categories={categories}
          onCategoriesChange={setCategories}
          onClose={handlePlannerClose}
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
