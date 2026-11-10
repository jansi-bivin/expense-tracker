// Auto-implemented by watcher test
"use client";

import { useState, useEffect, useCallback, useRef, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { supabase, RawSms, Transaction, Category, User, Due, FeatureIdea, MonthlyBudget } from "@/lib/supabase";
import { detectFields } from "@/lib/smsDetector";
import { SettleDue, SettlementPlan, applyAdvance, round2, planSettlement, categoryNeedsNote } from "@/lib/dues";
import { AutoFiledEvent, activityItems, fetchActivity, logActivity, flushActivity, clearActivity, fetchLastSeen, saveLastSeen } from "@/lib/activity";
import ActivityPanel from "@/components/ActivityPanel";
import {
  VendorRule, fetchVendorRules, saveVendorRules, fetchSharedVendorRules, saveSharedVendorRules,
  matchVendorRule, vendorKey, withRule,
} from "@/lib/vendorRules";
import { PendingPayment, fetchPendingPayment, savePendingPayment, findPaymentSms, MATCH_WINDOW_MS, ASK_AFTER_MS, upiRef } from "@/lib/pendingPayment";
import { computePositions, fetchLockedCategories, saveLockedCategories, saveSetting } from "@/lib/budget";
import { SyncHealth, fetchSyncHealth, syncIssues, fmtAgo } from "@/lib/syncHealth";
import { AccountBalance, fetchBalances, saveManualBalance } from "@/lib/balances";
import {
  ExpectedDebit, ExpectedDebits, MissingDebit, fetchExpectedDebits, saveExpectedDebits,
  findMissingDebits, matchExpectedDebit, monthKey, ordinal,
} from "@/lib/expectedDebits";

const ADVANCE_KEY = "dues_advance";

async function fetchAdvance(): Promise<number> {
  const { data } = await supabase.from("settings").select("*").eq("key", ADVANCE_KEY).maybeSingle();
  const v = (data?.value as { amount?: number } | undefined)?.amount;
  return typeof v === "number" && v > 0 ? v : 0;
}

async function saveAdvance(amount: number) {
  await saveSetting(ADVANCE_KEY, { amount: round2(Math.max(0, amount)) });
}

/** Create a due for a secondary-user expense, using up any advance first. */
async function createDue(transactionId: number, category: string, amount: number): Promise<number> {
  const advance = await fetchAdvance();
  const { dueLeft, advanceLeft, used } = applyAdvance(amount, advance);
  if (used > 0) await saveAdvance(advanceLeft);
  if (used > 0 && dueLeft <= 0) {
    // Fully covered by the advance: record it as already settled.
    await supabase.from("dues").insert({
      transaction_id: transactionId, category, amount,
      cleared: true, cleared_at: new Date().toISOString(),
    });
  } else {
    await supabase.from("dues").insert({ transaction_id: transactionId, category, amount: dueLeft });
  }
  return advanceLeft;
}
import NewSmsReview from "@/components/NewSmsReview";
import SmsCard from "@/components/SmsCard";
import CategoryBudget from "@/components/CategoryBudget";
import DuesView from "@/components/DuesView";
import AddCategoryForm from "@/components/AddCategoryForm";
import ManualExpenseForm from "@/components/ManualExpenseForm";
import FeatureIdeas from "@/components/FeatureIdeas";
import BudgetGrid from "@/components/BudgetGrid";
import VendorRules from "@/components/VendorRules";
import { SplitPart } from "@/components/SplitSheet";

/* ── DebitOverlay: self-contained so overlayIdx doesn't re-render parent ── */
function DebitOverlay({ txns, categories, isPrimary, unclearedDues, settlementHints, merchantCategoryMap, categoryFrequencyMap, onDone, onSnooze, onSettle, onDismissAll, onSaveMapping, onCategoryCreated, onAutoFile }: {
  txns: Transaction[]; categories: Category[]; isPrimary: boolean;
  unclearedDues: SettleDue[]; settlementHints: string[];
  merchantCategoryMap: Map<string, string>;
  categoryFrequencyMap: Map<string, number>;
  onDone: (id: number, cat?: string, notes?: string) => void;
  onSnooze: (id: number) => void;
  onSettle: (txnId: number, plan: SettlementPlan) => void;
  onDismissAll: () => void;
  onSaveMapping: (merchant: string, category: string) => void;
  onCategoryCreated: (cat: Category) => void;
  onAutoFile: (vendor: string, category: string, shared: boolean) => void;
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
              onAutoFile={onAutoFile}
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
    // A split payment keeps its part's amount (and the vendor) on the row itself
    amount: raw.amount ?? fields.amount ?? null,
    transaction_type: fields.transactionType ?? null,
    account_number: fields.accountNumber ?? null,
    merchant: raw.merchant ?? fields.merchant ?? null,
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
  const [duesAdvance, setDuesAdvance] = useState(0);
  // Categories locked by the primary user: no new expenses from the secondary user
  const [lockedCatIds, setLockedCatIds] = useState<Set<number>>(new Set());
  // What each phone's SMS reader last reported (for the "not syncing" warning)
  const [syncHealth, setSyncHealth] = useState<Map<string, SyncHealth>>(new Map());
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [dismissedIssues, setDismissedIssues] = useState<Set<string>>(new Set());
  // Fixed monthly auto-debits (EMIs) to watch for
  const [expectedDebits, setExpectedDebits] = useState<ExpectedDebits>({ items: {}, dismissed: {} });
  // A dues payment started from Pay, waiting for its bank SMS (or the user's word)
  const [pendingPay, setPendingPay] = useState<PendingPayment | null>(null);
  const [payNotice, setPayNotice] = useState<string | null>(null);
  // Bumped on every new SMS so the pending payment is checked again
  const [txnTick, setTxnTick] = useState(0);
  // Last balance the bank stated per account (primary only)
  const [balances, setBalances] = useState<AccountBalance[]>([]);
  // Pick up lock and sync changes when the app comes back to the foreground
  useEffect(() => {
    const refresh = () => {
      setClockNow(Date.now());
      fetchSyncHealth().then(setSyncHealth).catch(() => {});
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        fetchLockedCategories().then(setLockedCatIds);
        refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(refresh, 5 * 60 * 1000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, []);
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
      setDuesAdvance(await fetchAdvance());
      setLockedCatIds(await fetchLockedCategories());
      fetchSyncHealth().then(setSyncHealth).catch(() => {});
      setExpectedDebits(await fetchExpectedDebits());
      setPendingPay(await fetchPendingPayment());

      setLoading(false);
    }
    load();

    // Realtime
    const channel = supabase
      .channel("all-realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "transactions" }, (payload) => {
        const enriched = enrichSms(payload.new as RawSms);
        setTxnTick((n) => n + 1);
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
            // Already listed (filed here, or an edit such as a split): take the saved version
            setCategorizedTxns((prev) => prev.some((t) => t.id === enriched.id)
              ? prev.map((t) => (t.id === enriched.id ? enriched : t))
              : [enriched, ...prev]);
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

      // If secondary user, create a due (an advance, if any, is used up first)
      if (currentUser && !currentUser.is_primary) {
        setDuesAdvance(await createDue(inserted.id, expense.category, expense.amount));
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
    const txn = categorizedTxns.find((t) => t.id === txnId);
    const partDue = dues.find((d) => d.transaction_id === txnId);
    await supabase.from("dues").delete().eq("transaction_id", txnId);
    await supabase.from("transactions").delete().eq("id", txnId);
    setCategorizedTxns((prev) => prev.filter((t) => t.id !== txnId));
    setDues((prev) => prev.filter((d) => d.transaction_id !== txnId));
    // A split part goes back into the payment it was split from
    const parentId = txn?.device_id?.startsWith("split:") ? Number(txn.device_id.slice(6)) : null;
    const parent = parentId ? categorizedTxns.find((t) => t.id === parentId) : undefined;
    if (txn && parent && txn.amount != null && parent.amount != null) {
      const back = round2(Number(parent.amount) + Number(txn.amount));
      const whole = detectFields(parent.body).amount;
      const amount = whole != null && Math.abs(whole - back) < 0.01 ? null : back;
      await supabase.from("transactions").update({ amount }).eq("id", parent.id);
      setCategorizedTxns((prev) => prev.map((t) => (t.id === parent.id ? { ...t, amount: back } : t)));
      const parentDue = dues.find((d) => d.transaction_id === parent.id);
      if (parentDue && !parentDue.cleared && partDue && !partDue.cleared) {
        const dueAmount = round2(Number(parentDue.amount) + Number(partDue.amount));
        await supabase.from("dues").update({ amount: dueAmount }).eq("id", parentDue.id);
        setDues((prev) => prev.map((d) => (d.id === parentDue.id ? { ...d, amount: dueAmount } : d)));
      }
    }
  }

  /**
   * Split a filed payment into parts, each in its own category. The payment keeps the
   * first part; every other part becomes its own row ("split:<id>"). Dues follow the parts.
   * Returns an error to show, or null.
   */
  async function handleSplit(txnId: number, parts: SplitPart[]): Promise<string | null> {
    const txn = categorizedTxns.find((t) => t.id === txnId);
    if (!txn || txn.amount == null || parts.length < 2) return "This payment can't be split";
    const total = Number(txn.amount);
    if (Math.abs(parts.reduce((s, p) => s + p.amount, 0) - total) > 0.01) return "The parts don't add up to the payment";
    const { data: dueRows, error: dueErr } = await supabase.from("dues").select("*").eq("transaction_id", txnId);
    if (dueErr) return "Couldn't check its due, try again";
    const due = (dueRows ?? [])[0] as Due | undefined;
    if (due?.cleared) return "Its due is already cleared, so it can't be split now";

    const [first, ...rest] = parts;
    const firstUpdate = { category: first.category, notes: first.note || null, amount: first.amount };
    const { error } = await supabase.from("transactions").update(firstUpdate).eq("id", txnId);
    if (error) return "Couldn't save, try again";
    const { data: inserted, error: insErr } = await supabase.from("transactions").insert(rest.map((p) => ({
      address: "SPLIT",
      body: `Rs.${p.amount.toFixed(2)} debited. Split part`,
      sms_date: txn.sms_date,
      phone_number: txn.phone_number,
      category: p.category,
      notes: p.note || null,
      status: "categorized",
      amount: p.amount,
      merchant: txn.merchant,
      device_id: `split:${txnId}`,
    }))).select();
    if (insErr || !inserted) {
      // Put the payment back as it was
      const whole = detectFields(txn.body).amount;
      await supabase.from("transactions").update({
        category: txn.category, notes: txn.notes, amount: whole != null && Math.abs(whole - total) < 0.01 ? null : total,
      }).eq("id", txnId);
      return "Couldn't save, try again";
    }

    // Dues: the same total as before, shared out over the parts
    if (due) {
      const share = Number(due.amount) / total;
      const restDues = rest.map((p) => round2(p.amount * share));
      const firstDue = round2(Number(due.amount) - restDues.reduce((s, a) => s + a, 0));
      await supabase.from("dues").update({ amount: firstDue, category: first.category }).eq("id", due.id);
      await supabase.from("dues").insert(inserted.map((row, i) => ({
        transaction_id: row.id, category: rest[i].category, amount: restDues[i],
      })));
      const { data: duesData } = await supabase.from("dues").select("*").order("created_at", { ascending: false });
      if (duesData) setDues(duesData);
    }

    const added = (inserted as RawSms[]).map(enrichSms);
    setCategorizedTxns((prev) => [
      ...added.filter((a) => !prev.some((t) => t.id === a.id)),
      ...prev.map((t) => (t.id === txnId ? { ...t, ...firstUpdate } : t)),
    ]);
    return null;
  }

  // Reclassify: change category of an already-categorized transaction
  async function handleReclassify(txnId: number, newCategory: string, note?: string) {
    const update: { category: string; notes?: string } = note ? { category: newCategory, notes: note } : { category: newCategory };
    await supabase.from("transactions").update(update).eq("id", txnId);
    setCategorizedTxns((prev) => prev.map((t) => t.id === txnId ? { ...t, ...update } : t));
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
      const filed = { ...foundTxn, category, notes: notes || null, status: "categorized" as const };
      // The realtime UPDATE may have added it already: replace rather than add twice
      setCategorizedTxns((prev) => prev.some((t) => t.id === id)
        ? prev.map((t) => (t.id === id ? filed : t))
        : [filed, ...prev]);
      // If secondary user categorized, create a due
      const user = currentUser;
      if (user && !user.is_primary && foundTxn.amount) {
        setDuesAdvance(await createDue(id, category, foundTxn.amount));
      }
    }
  }, [currentUser]);

  // Settlement: primary user marks a debit as payment, partially settles dues
  async function handleSettle(txnId: number, plan: SettlementPlan) {
    await markSettlementTxn(txnId);
    await applySettlementPlan(plan, txnId);
    // Settled by hand from review: the payment started from Pay is done
    if (pendingPay && Math.abs(plan.payment - pendingPay.amount) < 0.01) {
      setPendingPay(null);
      await savePendingPayment(null);
    }
  }

  /** Record an SMS as a dues payment (kept out of the budget, off the review list). */
  async function markSettlementTxn(txnId: number, txnHint?: Transaction) {
    const txn = newTxns.find((t) => t.id === txnId) ?? txnHint;
    setNewTxns((prev) => prev.filter((t) => t.id !== txnId));
    await supabase.from("transactions").update({ category: "Settlement", status: "categorized" }).eq("id", txnId);
    if (txn) {
      setCategorizedTxns((prev) => prev.some((t) => t.id === txnId) ? prev
        : [{ ...txn, category: "Settlement", status: "categorized" as const }, ...prev]);
    }
  }

  /** Clear / reduce dues as planned; `txnId` is the SMS proving the payment, if any. */
  async function applySettlementPlan(plan: SettlementPlan, txnId: number | null) {
    // The plan was computed on the card (oldest first / chosen month / manual,
    // round-off, extra → advance). Apply it as-is.
    const nowIso = new Date().toISOString();
    const fullyCleared = plan.clearIds;
    const partialDue = plan.partial;

    // Payment beyond all dues becomes an advance used by future dues
    if (plan.extra > 0) {
      const newAdvance = round2((await fetchAdvance()) + plan.extra);
      await saveAdvance(newAdvance);
      setDuesAdvance(newAdvance);
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
  // Dues enriched with the original amount and payment date of their transaction
  const settleDues = useMemo<SettleDue[]>(() => {
    const txnById = new Map<number, Transaction>();
    for (const t of categorizedTxns) txnById.set(t.id, t);
    return dues.map((d) => {
      const t = txnById.get(d.transaction_id);
      const paidOn = t?.sms_date ?? Date.parse(d.created_at);
      const original = Math.max(Number(t?.amount ?? 0), Number(d.amount));
      return { ...d, original_amount: original, paid_on: paidOn };
    });
  }, [dues, categorizedTxns]);
  const unclearedDues = useMemo(() => settleDues.filter((d) => !d.cleared), [settleDues]);

  // Spend vs limit per category for the month shown in the header
  const categoryPositions = useMemo(
    () => computePositions(categories, categorizedTxns, {
      month: viewMonth, year: viewYear, monthlyOverrides, scaleFactor, excludedCategoryIds,
    }),
    [categories, categorizedTxns, viewMonth, viewYear, monthlyOverrides, scaleFactor, excludedCategoryIds]
  );

  const lockedCatNames = useMemo(
    () => new Set(categories.filter((c) => lockedCatIds.has(c.id)).map((c) => c.name)),
    [categories, lockedCatIds]
  );

  // Categories offered when entering/categorizing an expense: locked ones are
  // removed for the secondary user (the primary user can still use them).
  const entryCategories = useMemo(
    () => (currentUser?.is_primary ? categories : categories.filter((c) => !lockedCatIds.has(c.id))),
    [categories, lockedCatIds, currentUser]
  );

  async function toggleCategoryLock(categoryName: string) {
    const cat = categories.find((c) => c.name === categoryName);
    if (!cat) return;
    const next = new Set(lockedCatIds);
    if (next.has(cat.id)) next.delete(cat.id); else next.add(cat.id);
    setLockedCatIds(next);
    await saveLockedCategories(next);
  }

  // ── Phone sync warnings ──
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("syncIssueDismissed") || "{}") as Record<string, number>;
      const t = Date.now();
      setDismissedIssues(new Set(Object.entries(saved).filter(([, until]) => until > t).map(([id]) => id)));
    } catch { /* storage unavailable: show everything */ }
  }, []);

  const visibleSyncIssues = useMemo(
    () => syncIssues(allUsers, currentUser, syncHealth, clockNow).filter((i) => !dismissedIssues.has(i.id)),
    [allUsers, currentUser, syncHealth, clockNow, dismissedIssues]
  );

  /** Hide a warning for a day (errors stay until fixed). */
  function dismissSyncIssue(id: string) {
    setDismissedIssues((prev) => new Set(prev).add(id));
    try {
      const saved = JSON.parse(localStorage.getItem("syncIssueDismissed") || "{}") as Record<string, number>;
      saved[id] = Date.now() + 24 * 60 * 60 * 1000;
      localStorage.setItem("syncIssueDismissed", JSON.stringify(saved));
    } catch { /* ignore */ }
  }

  const mySyncHealth = currentUser ? syncHealth.get(currentUser.phone_number) : undefined;

  // ── Bank balances: each person sees only their own accounts ──
  const balancePhone = currentUser?.phone_number ?? "";
  useEffect(() => {
    if (!balancePhone) { setBalances([]); return; }
    fetchBalances([balancePhone]).then(setBalances).catch(() => {});
  }, [balancePhone, txnTick]);
  const shownBalances = useMemo(
    () => balances.filter((b) => b.phone === balancePhone).sort((a, b) => b.at - a.at),
    [balances, balancePhone],
  );
  // Manual update: tap a balance, type what the bank app shows
  const [editBal, setEditBal] = useState<{ key: string; value: string } | null>(null);
  async function saveEditedBalance() {
    if (!editBal) return;
    const value = parseFloat(editBal.value.replace(/[,₹\s]/g, ""));
    if (!isFinite(value)) return;
    const key = editBal.key;
    setEditBal(null);
    setBalances((prev) => prev.map((b) => b.key === key ? { ...b, balance: value, at: Date.now(), source: "manual" } : b));
    await saveManualBalance(key, value);
  }

  // ── Expected auto-debits (EMIs) that haven't shown up ──
  const missingDebits = useMemo(
    () => (currentUser?.is_primary
      ? findMissingDebits(expectedDebits, categories, categorizedTxns, newTxns, new Date(clockNow))
      : []),
    [currentUser, expectedDebits, categories, categorizedTxns, newTxns, clockNow]
  );

  async function handleSaveExpectedDebit(categoryId: number, item: ExpectedDebit | null) {
    const items = { ...expectedDebits.items };
    if (item) items[String(categoryId)] = item;
    else delete items[String(categoryId)];
    const next = { ...expectedDebits, items };
    setExpectedDebits(next);
    await saveExpectedDebits(next);
  }

  async function skipMissingDebit(m: MissingDebit) {
    const key = monthKey(new Date(clockNow));
    // Only this month's skips are kept, so the list never grows
    const next = { ...expectedDebits, dismissed: { [key]: [...(expectedDebits.dismissed[key] ?? []), m.category.id] } };
    setExpectedDebits(next);
    await saveExpectedDebits(next);
  }

  async function addMissingDebit(m: MissingDebit) {
    await handleManualExpense({
      amount: m.amount,
      category: m.category.name,
      note: "Auto-debit (no bank message)",
      date: m.dueDate,
    });
  }
  const duesTotal = useMemo(() => unclearedDues.reduce((sum, d) => sum + Number(d.amount), 0), [unclearedDues]);

  // Build settlement hints from non-primary user's details
  const secondaryUser = allUsers.find((u) => !u.is_primary);
  const settlementHints = secondaryUser
    ? [secondaryUser.name, secondaryUser.phone_number, secondaryUser.upi_id].filter(Boolean) as string[]
    : [];

  // ── Dues payment started from Pay: settle it from the bank SMS ──
  const settleDuesRef = useRef(settleDues);
  settleDuesRef.current = settleDues;
  const checkingPayRef = useRef(false);

  async function startPayment(p: { amount: number; dueIds: number[]; label: string }) {
    const next: PendingPayment = { ...p, amount: round2(p.amount), created: Date.now() };
    setPendingPay(next);
    setPayNotice(null);
    await savePendingPayment(next);
  }

  const openDueIds = (ids: number[]) =>
    new Set(ids.filter((id) => settleDuesRef.current.some((d) => d.id === id && !d.cleared)));

  useEffect(() => {
    const p = pendingPay;
    const payer = currentUser;
    const payee = secondaryUser;
    if (!p || !payer?.is_primary || !payee || checkingPayRef.current) return;
    checkingPayRef.current = true;
    (async () => {
      try {
        const m = await findPaymentSms(p, payer, payee, enrichSms);
        // The debit was already handled by hand (settled or categorized): nothing to do
        const handled = m.debit && m.debit.status !== "new";
        const proof = handled ? undefined
          : m.debit ?? (m.credit?.status === "new" ? m.credit : undefined);
        if (!proof && !handled) {
          if (Date.now() - p.created > MATCH_WINDOW_MS) {
            if (p.confirmed) { setPendingPay(null); await savePendingPayment(null); }
          }
          return;
        }
        // Another device may have settled it meanwhile
        const latest = await fetchPendingPayment();
        if (!latest || latest.created !== p.created) { setPendingPay(latest); return; }
        setPendingPay(null);
        await savePendingPayment(null);
        if (!proof) return;

        const open = openDueIds(p.dueIds);
        if (p.confirmed || open.size === 0) {
          // Dues were already cleared: just keep the SMS as the payment's record
          await markSettlementTxn(proof.id, proof);
          const linkIds = p.dueIds;
          await supabase.from("dues").update({ settlement_transaction_id: proof.id })
            .in("id", linkIds).is("settlement_transaction_id", null);
          setDues((prev) => prev.map((d) => linkIds.includes(d.id) && d.settlement_transaction_id == null
            ? { ...d, settlement_transaction_id: proof.id } : d));
          setPayNotice(`Bank SMS for ₹${p.amount.toLocaleString("en-IN")} received and linked to that payment.`);
        } else {
          const plan = planSettlement(p.amount, settleDuesRef.current, { onlyIds: open });
          await markSettlementTxn(proof.id, proof);
          await applySettlementPlan(plan, proof.id);
          const n = plan.clearIds.length;
          setPayNotice(`✓ Paid ₹${p.amount.toLocaleString("en-IN")} to ${payee.name}: ${n} due${n !== 1 ? "s" : ""} cleared${plan.partial ? ", 1 part-paid" : ""}${plan.extra > 0 ? `, ₹${plan.extra} kept as advance` : ""}.`);
        }
        // Her matching credit is part of the same payment: take it off her review list
        if (m.credit && m.credit.id !== proof.id && m.credit.status === "new") {
          await markSettlementTxn(m.credit.id, m.credit);
        }
      } finally {
        checkingPayRef.current = false;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPay, txnTick, newTxns.length, clockNow, currentUser, secondaryUser?.id]);

  // The other side of a settled payment (her credit, or a late debit) carries the
  // same UPI reference: file it as Settlement too, whenever it arrives.
  const filedRefTxns = useRef(new Set<number>());
  useEffect(() => {
    const settledRefs = new Set(
      categorizedTxns.filter((t) => t.category === "Settlement").map((t) => upiRef(t.body)).filter(Boolean) as string[]
    );
    if (settledRefs.size === 0) return;
    for (const t of newTxns) {
      const ref = upiRef(t.body);
      if (ref && settledRefs.has(ref) && !filedRefTxns.current.has(t.id)) {
        filedRefTxns.current.add(t.id);
        markSettlementTxn(t.id, t);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newTxns, categorizedTxns]);

  // ── Vendor rules: each person's own vendor → category pairs, plus the shared ones ──
  const [vendorRules, setVendorRules] = useState<VendorRule[]>([]);
  const vendorRulesRef = useRef<VendorRule[]>([]);
  const [sharedRules, setSharedRules] = useState<VendorRule[]>([]);
  const sharedRulesRef = useRef<VendorRule[]>([]);
  const [autoFiledNotes, setAutoFiledNotes] = useState<string[]>([]);
  const rulesPhone = currentUser?.phone_number ?? "";
  useEffect(() => {
    if (!rulesPhone) return;
    // Re-read on foreground / every few minutes, so rules made on another device apply here too
    fetchVendorRules(rulesPhone).then((r) => { vendorRulesRef.current = r; setVendorRules(r); }).catch(() => {});
    fetchSharedVendorRules().then((r) => { sharedRulesRef.current = r; setSharedRules(r); }).catch(() => {});
  }, [rulesPhone, clockNow]);

  async function updateMyRules(change: (rules: VendorRule[]) => VendorRule[]) {
    if (!rulesPhone) return;
    const next = change(vendorRulesRef.current);
    vendorRulesRef.current = next;
    setVendorRules(next);
    await saveVendorRules(rulesPhone, next);
  }
  /** Shared rules can be changed from either profile: start from the latest saved list. */
  async function updateSharedRules(change: (rules: VendorRule[]) => VendorRule[]) {
    const latest = await fetchSharedVendorRules().catch(() => sharedRulesRef.current);
    const next = change(latest);
    sharedRulesRef.current = next;
    setSharedRules(next);
    await saveSharedVendorRules(next);
  }
  function addVendorRule(vendor: string, categoryId: number, shared: boolean) {
    (shared ? updateSharedRules : updateMyRules)((rules) => withRule(rules, vendor, categoryId));
  }
  function removeVendorRule(key: string, shared: boolean) {
    (shared ? updateSharedRules : updateMyRules)((rules) => rules.filter((r) => r.key !== key));
  }
  /** Move a pairing between "only me" and "both of us". */
  function setVendorRuleShared(key: string, toShared: boolean) {
    const rule = (toShared ? vendorRulesRef.current : sharedRulesRef.current).find((r) => r.key === key);
    if (!rule) return;
    (toShared ? updateMyRules : updateSharedRules)((rules) => rules.filter((r) => r.key !== key));
    (toShared ? updateSharedRules : updateMyRules)((rules) => withRule(rules, rule.vendor, rule.categoryId));
  }
  /** From the review card's "Auto-file future … payments" tick. */
  function autoFileFromReview(vendor: string, categoryName: string, shared: boolean) {
    const cat = categories.find((c) => c.name === categoryName);
    if (cat) addVendorRule(vendor, cat.id, shared && cat.visible_to === "all");
  }

  // Vendors paid before, most frequent first (to pick from when pairing): this
  // person's own, and both people's (for a pairing that applies to both)
  const [vendorsMine, vendorsBoth] = useMemo(() => {
    // Never list vendors from categories hidden from this person (e.g. the other one's private ones)
    const isPrimaryUser = !!currentUser?.is_primary;
    const hidden = new Set(isPrimaryUser ? [] : categories.filter((c) => c.visible_to === "primary").map((c) => c.name));
    const count = (mineOnly: boolean) => {
      const m = new Map<string, { vendor: string; count: number }>();
      for (const t of categorizedTxns) {
        if (mineOnly && t.phone_number !== rulesPhone) continue;
        if (t.category && hidden.has(t.category)) continue;
        if (!t.merchant || t.category === "Settlement" || t.transaction_type !== "DEBIT") continue;
        const k = vendorKey(t.merchant);
        if (k.length < 3) continue;
        const e = m.get(k) ?? { vendor: t.merchant.trim(), count: 0 };
        e.count++;
        m.set(k, e);
      }
      return Array.from(m.values()).sort((a, b) => b.count - a.count).slice(0, 150);
    };
    return [count(true), count(false)];
  }, [categorizedTxns, rulesPhone, categories, currentUser?.is_primary]);

  // ── New events since this person last looked (count on the bell; cleared once viewed) ──
  const otherName = allUsers.find((u) => u.phone_number !== rulesPhone)?.name ?? "";
  const [activity, setActivity] = useState<AutoFiledEvent[]>([]);
  /** When this person last viewed the updates: only later events count. */
  const [lastSeenAt, setLastSeenAt] = useState<number | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const activityStarted = useRef(false);
  useEffect(() => {
    if (!rulesPhone || loading) return;
    // Read on open and whenever the app comes back to the screen (it may have been viewed elsewhere)
    const refresh = async () => {
      await flushActivity(); // events this device filed but couldn't save yet
      const [events, seen] = await Promise.all([
        fetchActivity(rulesPhone).catch(() => null),
        fetchLastSeen(rulesPhone).catch(() => undefined),
      ]);
      if (events) setActivity(events);
      if (seen === undefined) return; // couldn't read it: don't guess
      if (seen === null) {
        // First time: start counting from now
        const now = Date.now();
        setLastSeenAt(now);
        saveLastSeen(rulesPhone, now).catch(() => {});
      } else {
        setLastSeenAt(seen);
      }
    };
    const onVisibility = () => { if (document.visibilityState === "visible") refresh(); };
    if (!activityStarted.current) { activityStarted.current = true; refresh(); }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [rulesPhone, loading]);

  const newActivity = useMemo(
    () => (currentUser && lastSeenAt != null ? activityItems(activity, dues, lastSeenAt, currentUser, otherName) : []),
    [activity, dues, lastSeenAt, currentUser, otherName]
  );

  /** Closing the panel counts as viewed: clear these events (no history is kept). */
  function closeActivity() {
    setActivityOpen(false);
    if (!rulesPhone || newActivity.length === 0) return;
    const now = Date.now();
    setLastSeenAt(now);
    setActivity((prev) => prev.filter((e) => e.at > now));
    saveLastSeen(rulesPhone, now).catch(() => {});
    clearActivity(rulesPhone, now);
  }

  // A new debit SMS is filed straight into its category when it's from a paired vendor,
  // or when it's a monthly EMI set up as an auto-debit (same amount, around its usual day)
  const autoFiledIds = useRef(new Set<number>());
  const emiMonthsFiled = useRef(new Set<string>());
  const settleHintKey = settlementHints.join("\n").toLowerCase();
  useEffect(() => {
    const user = currentUser;
    if (!user || loading) return;
    if (vendorRules.length === 0 && sharedRules.length === 0 && Object.keys(expectedDebits.items).length === 0) return;
    const hints = settleHintKey.split("\n").filter(Boolean);
    for (const t of newTxns) {
      if (autoFiledIds.current.has(t.id)) continue;
      if (t.phone_number !== user.phone_number || t.transaction_type !== "DEBIT") continue;
      // A payment to the other person is a dues settlement, never an expense
      if (user.is_primary && hints.some((h) => t.body.toLowerCase().includes(h))) continue;
      // This person's own pairing first, then a shared one
      const myRule = matchVendorRule(vendorRules, t.merchant);
      const rule = myRule ?? matchVendorRule(sharedRules, t.merchant);
      let cat = rule ? entryCategories.find((c) => c.id === rule.categoryId) : undefined;
      let why: AutoFiledEvent["why"] = myRule ? "vendor" : "shared";
      let emiKey = "";
      if (!cat) {
        const emi = matchExpectedDebit(expectedDebits, entryCategories, categorizedTxns, t);
        emiKey = emi ? `${emi.category.id}:${emi.month}` : "";
        // Two copies of one EMI's message (SMS + notification) must not both be filed
        if (emi && !emiMonthsFiled.current.has(emiKey)) { cat = emi.category; why = "emi"; }
      }
      // Category gone, locked, hidden from this person, or needs a note: leave it for review
      if (!cat || categoryNeedsNote(cat.name) || (!user.is_primary && cat.visible_to === "primary")) continue;
      const target = cat.name;
      autoFiledIds.current.add(t.id);
      if (emiKey) emiMonthsFiled.current.add(emiKey);
      (async () => {
        // File it only if it's still new: another device, or a hand, may have filed it already
        const { data } = await supabase.from("transactions")
          .update({ category: target, status: "categorized" })
          .eq("id", t.id).eq("status", "new").select("id");
        if (!data || data.length === 0) return;
        // Log it for the bell first (kept on the device until saved)
        const event: AutoFiledEvent = {
          kind: "autofile", at: Date.now(), txnId: t.id,
          amount: t.amount != null ? Number(t.amount) : null, vendor: t.merchant ?? null, category: target, why,
        };
        logActivity(user.phone_number, event);
        setActivity((prev) => [...prev, event]);
        // Same as filing it by hand, without depending on it still being in the review list
        const filed = { ...t, category: target, notes: null, status: "categorized" as const };
        setNewTxns((prev) => prev.filter((x) => x.id !== t.id));
        setCategorizedTxns((prev) => prev.some((x) => x.id === t.id)
          ? prev.map((x) => (x.id === t.id ? filed : x))
          : [filed, ...prev]);
        if (!user.is_primary && t.amount) setDuesAdvance(await createDue(t.id, target, Number(t.amount)));
        const amt = t.amount ? `₹${Number(t.amount).toLocaleString("en-IN")} ` : "";
        const from = t.merchant ?? (emiKey ? "monthly auto-debit" : "payment");
        setAutoFiledNotes((prev) => [...prev, `${amt}${from} → ${target}`].slice(-5));
      })();
    }
  }, [newTxns, vendorRules, sharedRules, expectedDebits, categorizedTxns, entryCategories, currentUser, loading, settleHintKey]);

  // Re-check (and show the "did you pay?" card) once the SMS had time to arrive
  useEffect(() => {
    if (!pendingPay || pendingPay.confirmed) return;
    const wait = pendingPay.created + ASK_AFTER_MS - Date.now();
    if (wait <= 0) return;
    const t = setTimeout(() => setClockNow(Date.now()), wait + 500);
    return () => clearTimeout(t);
  }, [pendingPay]);

  const askAboutPayment = !!(currentUser?.is_primary && pendingPay && !pendingPay.confirmed
    && clockNow - pendingPay.created >= ASK_AFTER_MS);

  /** No SMS yet, but the user says it went through: clear now, link the SMS if it comes. */
  async function confirmPaid() {
    const p = pendingPay;
    if (!p) return;
    const open = openDueIds(p.dueIds);
    if (open.size > 0) {
      await applySettlementPlan(planSettlement(p.amount, settleDuesRef.current, { onlyIds: open }), null);
    }
    const next = { ...p, confirmed: Date.now() };
    setPendingPay(next);
    await savePendingPayment(next);
    setPayNotice(`✓ Dues cleared for ₹${p.amount.toLocaleString("en-IN")}. The bank SMS will be linked when it arrives.`);
  }

  async function cancelPayment() {
    setPendingPay(null);
    await savePendingPayment(null);
  }

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
          <div className="flex items-center gap-2">
            {/* New updates since you last checked: count on the bell, tap to view (viewing clears them) */}
            <button type="button" className="relative w-8 h-8 flex items-center justify-center rounded-full cursor-pointer"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
              onClick={() => setActivityOpen(true)}
              aria-label={newActivity.length > 0 ? `${newActivity.length} new updates` : "No new updates"}>
              <span className="text-sm leading-none">🔔</span>
              {newActivity.length > 0 && (
                <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full text-[9px] font-bold flex items-center justify-center"
                  style={{ background: "var(--accent-red)", color: "#fff" }}>{newActivity.length}</span>
              )}
            </button>
            <div className="flex items-center gap-2 px-2.5 py-1 rounded-full"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <div className="pulse-dot" />
              <span className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>{currentUser.name}</span>
            </div>
          </div>
        )}
      </div>

      {/* Phone sync warnings: a phone that stopped sending bank messages */}
      {visibleSyncIssues.length > 0 && (
        <div className="space-y-2 mb-4">
          {visibleSyncIssues.map((issue) => (
            <div key={issue.id} className="card px-3 py-2.5 flex items-start gap-2"
              style={{ borderLeft: `3px solid ${issue.level === "error" ? "var(--accent-red)" : "var(--accent-orange)"}` }}>
              <span className="text-xs leading-5">{issue.level === "error" ? "⚠️" : "ℹ️"}</span>
              <span className="flex-1 text-xs leading-5" style={{ color: "var(--text-secondary)" }}>{issue.text}</span>
              {issue.level === "warn" && (
                <button className="text-xs px-1 bg-transparent border-0 cursor-pointer" style={{ color: "var(--text-tertiary)" }}
                  onClick={() => dismissSyncIssue(issue.id)} aria-label="Hide for a day">
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Dues payment started from Pay: no bank SMS yet */}
      {askAboutPayment && pendingPay && (
        <div className="card p-3.5 mb-4" style={{ borderLeft: "3px solid var(--accent-orange)" }}>
          <div className="text-sm font-semibold mb-0.5" style={{ color: "var(--text-primary)" }}>
            Paid ₹{pendingPay.amount.toLocaleString("en-IN")} to {secondaryUser?.name ?? "payee"}?
          </div>
          <div className="text-xs mb-3" style={{ color: "var(--text-tertiary)" }}>
            {pendingPay.label} · waiting for the bank SMS
          </div>
          <div className="flex gap-2">
            <button className="flex-1 py-2 btn-green text-sm rounded-xl" onClick={confirmPaid}>Yes, clear dues</button>
            <button className="flex-1 py-2 text-sm rounded-xl" style={{ border: "1px solid var(--border-light)", color: "var(--text-secondary)" }}
              onClick={cancelPayment}>Didn&apos;t pay</button>
          </div>
        </div>
      )}
      {payNotice && (
        <div className="card px-3 py-2.5 mb-4 flex items-start gap-2" style={{ borderLeft: "3px solid var(--accent-green)" }}>
          <span className="flex-1 text-xs leading-5" style={{ color: "var(--text-secondary)" }}>{payNotice}</span>
          <button className="text-xs px-1 bg-transparent border-0 cursor-pointer" style={{ color: "var(--text-tertiary)" }}
            onClick={() => setPayNotice(null)} aria-label="Close">✕</button>
        </div>
      )}
      {autoFiledNotes.length > 0 && (
        <div className="card px-3 py-2.5 mb-4 flex items-start gap-2" style={{ borderLeft: "3px solid var(--accent)" }}>
          <span className="flex-1 text-xs leading-5" style={{ color: "var(--text-secondary)" }}>
            ⚡ Auto-filed: {autoFiledNotes.join(" · ")}
          </span>
          <button className="text-xs px-1 bg-transparent border-0 cursor-pointer" style={{ color: "var(--text-tertiary)" }}
            onClick={() => setAutoFiledNotes([])} aria-label="Close">✕</button>
        </div>
      )}

      {/* Content */}
      <div className="animate-fade-in">
        {activeView === "dues" ? (
          <DuesView
            dues={settleDues}
            advance={duesAdvance}
            transactions={categorizedTxns}
            categories={categories}
            onDuesChange={setDues}
            payeeUpi={allUsers.find((u) => !u.is_primary)?.upi_id ?? null}
            payeeName={allUsers.find((u) => !u.is_primary)?.name ?? ""}
            isPrimary={isPrimary}
            primaryName={allUsers.find((u) => u.is_primary)?.name ?? ""}
            positions={categoryPositions}
            periodLabel={new Date(viewYear, viewMonth, 1).toLocaleDateString("en-IN", { month: "short" })}
            periodYear={viewYear}
            lockedNames={lockedCatNames}
            onToggleLock={isPrimary ? toggleCategoryLock : undefined}
            onPayStarted={isPrimary ? startPayment : undefined}
            paymentWaiting={!!pendingPay && !pendingPay.confirmed}
          />
        ) : (
          <>
            {/* Last balance each bank stated in an SMS (own accounts only) */}
            {shownBalances.length > 0 && (
              <div className="card px-3.5 py-3 mb-3">
                <div className="text-[10px] font-bold tracking-wide mb-2" style={{ color: "var(--text-tertiary)" }}>
                  BANK BALANCES · FROM SMS · TAP TO UPDATE
                </div>
                <div className="space-y-1.5">
                  {shownBalances.map((b) => {
                    const owner = allUsers.find((u) => u.phone_number === b.phone);
                    const stale = clockNow - b.at > 30 * 24 * 60 * 60 * 1000;
                    const label = (
                      <span className="flex-1 truncate" style={{ color: "var(--text-secondary)" }}>
                        {owner && owner.phone_number !== currentUser?.phone_number && (
                          <span style={{ color: "var(--text-tertiary)" }}>{owner.name} · </span>
                        )}
                        {b.bank} ··{b.last}
                      </span>
                    );
                    if (editBal?.key === b.key) {
                      return (
                        <div key={b.key} className="flex items-center gap-2 text-sm">
                          {label}
                          <input
                            autoFocus inputMode="decimal" value={editBal.value}
                            onChange={(e) => setEditBal({ key: b.key, value: e.target.value })}
                            onKeyDown={(e) => { if (e.key === "Enter") saveEditedBalance(); if (e.key === "Escape") setEditBal(null); }}
                            className="w-28 px-2 py-1 rounded-lg text-right tabular-nums text-sm"
                            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--border-light)", color: "var(--text-primary)" }}
                            aria-label={`Current balance of ${b.bank} ${b.last}`}
                          />
                          <button className="px-2 py-1 btn-primary text-xs rounded-lg" onClick={saveEditedBalance}>Save</button>
                          <button className="px-1 text-xs bg-transparent border-0 cursor-pointer" style={{ color: "var(--text-tertiary)" }}
                            onClick={() => setEditBal(null)} aria-label="Cancel">✕</button>
                        </div>
                      );
                    }
                    return (
                      <button key={b.key} type="button"
                        className="w-full flex items-baseline gap-2 text-sm text-left bg-transparent border-0 p-0 cursor-pointer"
                        title="Tap to update from your bank app"
                        onClick={() => setEditBal({ key: b.key, value: String(Math.round(b.balance * 100) / 100) })}>
                        {label}
                        <span className="font-semibold tabular-nums" style={{ color: stale ? "var(--text-tertiary)" : "var(--text-primary)" }}>
                          ₹{b.balance.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                        </span>
                        <span className="text-[11px] w-16 text-right" style={{ color: stale ? "var(--accent-orange)" : "var(--text-tertiary)" }}>
                          {b.source === "manual" ? "✎ " : ""}{new Date(b.at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {/* Expected auto-debits (EMIs) that haven't shown up this month */}
            {isCurrentMonth && missingDebits.map((m) => (
              <div key={m.category.id} className="card p-3.5 mb-3" style={{ borderLeft: "3px solid var(--accent-orange)" }}>
                <div className="text-sm font-semibold mb-0.5" style={{ color: "var(--text-primary)" }}>
                  {m.category.name}: not seen this month
                </div>
                <div className="text-xs mb-2.5" style={{ color: "var(--text-tertiary)" }}>
                  ₹{m.amount.toLocaleString("en-IN")} is usually debited on the {ordinal(m.day)}, but no bank message for it has come in.
                </div>
                <div className="flex gap-2">
                  <button className="flex-1 py-1.5 btn-primary text-xs rounded-lg" onClick={() => addMissingDebit(m)}>
                    Add ₹{m.amount.toLocaleString("en-IN")}
                  </button>
                  <button className="px-3 py-1.5 btn-ghost text-xs rounded-lg" onClick={() => skipMissingDebit(m)}>
                    Not this month
                  </button>
                </div>
              </div>
            ))}
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
              onSplit={handleSplit}
              myPhone={currentUser?.phone_number ?? null}
              viewMonth={viewMonth}
              viewYear={viewYear}
              dues={dues}
              lockedNames={lockedCatNames}
              onToggleLock={isPrimary ? toggleCategoryLock : undefined}
              expectedDebits={expectedDebits.items}
              onSaveExpectedDebit={isPrimary ? handleSaveExpectedDebit : undefined}
            />
            <VendorRules
              myRules={vendorRules}
              sharedRules={sharedRules}
              categories={entryCategories.filter((c) => isPrimary || c.visible_to !== "primary")}
              allCategories={categories}
              vendorsMine={vendorsMine}
              vendorsBoth={vendorsBoth}
              onAdd={addVendorRule}
              onRemove={removeVendorRule}
              onSetShared={setVendorRuleShared}
            />
          </>
        )}
      </div>

      {/* ═══ New updates panel (above the review overlay) ═══ */}
      {activityOpen && (
        <ActivityPanel
          title="New since you last checked"
          items={newActivity}
          findTxn={(id) => categorizedTxns.find((t) => t.id === id)}
          categories={entryCategories.filter((c) => isPrimary || c.visible_to !== "primary")}
          onReclassify={handleReclassify}
          onOpenDues={() => { closeActivity(); setView("dues"); }}
          onClose={closeActivity}
        />
      )}

      {/* ═══ Debit Overlay — own component so overlayIdx doesn't re-render parent ═══ */}
      {hasOverlay && (
        <DebitOverlay
          txns={newTxns}
          categories={entryCategories}
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
          onAutoFile={autoFileFromReview}
        />
      )}

      {/* Version footer — tap to open feature ideas */}
      <div className="flex items-center justify-center gap-3 mt-8 mb-2">
        <button
          className="text-[10px] bg-transparent border-0 cursor-pointer"
          style={{ color: "var(--text-tertiary)", opacity: 0.4 }}
          onClick={() => setShowFeatureIdeas(true)}
        >
          v{process.env.APP_VERSION} · {process.env.BUILD_SHA}
        </button>
        {mySyncHealth && (
          <span className="text-[10px]" style={{ color: "var(--text-tertiary)", opacity: 0.4 }}
            title={`SMS reader ${mySyncHealth.app_version} on ${mySyncHealth.device ?? "phone"}`}>
            phone synced {fmtAgo(mySyncHealth.last_sync, clockNow)}
          </span>
        )}
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
          categories={entryCategories}
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
