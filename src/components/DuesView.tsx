"use client";

import React, { useState, useMemo, useEffect } from "react";
import QRCode from "qrcode";
import { supabase, Transaction, Category } from "@/lib/supabase";
import { SettleDue, monthKey, monthLabel } from "@/lib/dues";
import { CategoryPosition } from "@/lib/budget";
import { upiNote } from "@/lib/pendingPayment";

interface Props {
  dues: SettleDue[];
  /** Extra paid beyond all dues, used up by future dues. */
  advance: number;
  transactions: Transaction[];
  categories: Category[];
  onDuesChange: (dues: SettleDue[]) => void;
  payeeUpi: string | null;
  payeeName: string;
  isPrimary: boolean;
  primaryName: string;
  /** Spend vs limit per category for the month shown in the header. */
  positions: Map<string, CategoryPosition>;
  periodLabel: string; // e.g. "Nov"
  periodYear: number;
  lockedNames: Set<string>;
  /** Primary only: lock/unlock a category for new expenses. */
  onToggleLock?: (categoryName: string) => void;
  /** Primary only: a payment was started for these dues (Pay → UPI app or QR). */
  onPayStarted?: (p: { amount: number; dueIds: number[]; label: string }) => void;
}

const STATUS_COLOR: Record<CategoryPosition["status"], string> = {
  nocap: "var(--text-tertiary)",
  within: "var(--accent-green)",
  near: "var(--accent-orange)",
  over: "var(--accent-red)",
};

function DuesView({ dues, advance, transactions, categories, onDuesChange, payeeUpi, payeeName, isPrimary, primaryName, positions, periodLabel, periodYear, lockedNames, onToggleLock, onPayStarted }: Props) {
  const [expandedCat, setExpandedCat] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<"category" | "month">(() => {
    try { return localStorage.getItem("duesGroupBy") === "month" ? "month" : "category"; } catch { return "category"; }
  });
  function changeGroupBy(g: "category" | "month") {
    setGroupBy(g);
    setExpandedCat(null);
    try { localStorage.setItem("duesGroupBy", g); } catch { /* ignore */ }
  }
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
    const map = new Map<string, SettleDue[]>();
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

  // Month of the original payment, newest month first; items newest first
  const byMonth = useMemo(() => {
    const map = new Map<string, SettleDue[]>();
    for (const d of unclearedDues) {
      const k = monthKey(d.paid_on);
      const arr = map.get(k) || [];
      arr.push(d);
      map.set(k, arr);
    }
    for (const arr of map.values()) arr.sort((a, b) => b.paid_on - a.paid_on);
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [unclearedDues]);

  const groups = groupBy === "month" ? byMonth : byCategory;

  /**
   * Second level of grouping, returned as [label, dues]:
   * month view → split by category (largest total first);
   * category view → split by month (newest first), items newest first.
   */
  function subGroups(list: SettleDue[]): [string, SettleDue[]][] {
    const map = new Map<string, SettleDue[]>();
    const keyOf = (d: SettleDue) => (groupBy === "month" ? d.category : monthKey(d.paid_on));
    for (const d of list) map.set(keyOf(d), [...(map.get(keyOf(d)) || []), d]);
    if (groupBy === "month") {
      const total = (arr: SettleDue[]) => arr.reduce((s, d) => s + Number(d.amount), 0);
      return Array.from(map.entries()).sort((a, b) => total(b[1]) - total(a[1]));
    }
    return Array.from(map.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([k, arr]) => [monthLabel(k), [...arr].sort((a, b) => b.paid_on - a.paid_on)]);
  }

  /** "Nov: ₹3,200 of ₹4,000 · ₹800 left" (amounts for primary, % for secondary). */
  function positionText(catName: string): { text: string; color: string; pct: number | null } | null {
    const p = positions.get(catName);
    if (!p) return null;
    const when = p.period === "month" ? periodLabel : String(periodYear);
    if (p.status === "nocap") {
      return isPrimary
        ? { text: `${when}: ${fmt(p.spent)} spent · no limit`, color: STATUS_COLOR.nocap, pct: null }
        : null;
    }
    const pct = (p.spent / p.cap) * 100;
    const tail = p.spent > p.cap ? `${fmt(p.spent - p.cap)} over` : `${fmt(p.cap - p.spent)} left`;
    const text = isPrimary
      ? `${when}: ${fmt(p.spent)} of ${fmt(p.cap)} · ${tail}`
      : `${when}: ${Math.round(pct)}% used${p.spent > p.cap ? " · over limit" : ""}`;
    return { text, color: STATUS_COLOR[p.status], pct };
  }

  function PositionBlock({ catName }: { catName: string }) {
    const pos = positionText(catName);
    if (!pos) return null;
    return (
      <div className="mt-1">
        <div className="text-[11px] font-semibold" style={{ color: pos.color }}>{pos.text}</div>
        {pos.pct != null && (
          <div className="h-1 rounded-full mt-1 overflow-hidden" style={{ background: "rgba(255,255,255,0.08)", width: 140 }}>
            <div className="h-full rounded-full" style={{ width: `${Math.min(pos.pct, 100)}%`, background: pos.color }} />
          </div>
        )}
      </div>
    );
  }

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

  // What the open Pay sheet is paying for: reported when the UPI app opens, so
  // the bank SMS can settle exactly these dues later.
  const [payCtx, setPayCtx] = useState<{ dueIds: number[]; label: string }>({ dueIds: [], label: "" });

  function openUpiPay(amount: number, dueIds: number[], label: string) {
    if (!payeeUpi) return;
    const ctx = { dueIds, label: upiNote(label) };
    setPayCtx(ctx);
    // Not in the phone app (e.g. a PC browser): no UPI app here, so show the QR
    // straight away to scan with the phone. The bank SMS then clears these dues.
    if (!bridge?.openApp) {
      if (isPrimary && dueIds.length > 0) onPayStarted?.({ amount, ...ctx });
      setQrNote(ctx.label);
      setQrAmount(amount);
      return;
    }
    navigator.clipboard.writeText(amount.toFixed(2)).catch(() => {});
    setShowPaySheet(amount);
  }

  function reportPayStarted(amount: number) {
    if (isPrimary && payCtx.dueIds.length > 0) onPayStarted?.({ amount, dueIds: payCtx.dueIds, label: payCtx.label });
  }

  // UPI QR with the amount built in. Shown on one phone and scanned with the UPI
  // app's camera on the other — UPI allows that, unlike app-to-app prefilled links.
  const [qrAmount, setQrAmount] = useState<number | null>(null);
  const [qrNote, setQrNote] = useState("ExpTrack dues");
  const [qrSrc, setQrSrc] = useState("");
  const qrDataUrl = (amount: number, note: string) =>
    QRCode.toDataURL(
      `upi://pay?pa=${payeeUpi}&pn=${encodeURIComponent(payeeName || "Payee")}` +
        `&am=${amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(upiNote(note))}`,
      { width: 360, margin: 2, errorCorrectionLevel: "M" },
    );
  useEffect(() => {
    if (qrAmount === null || !payeeUpi) { setQrSrc(""); return; }
    qrDataUrl(qrAmount, qrNote).then(setQrSrc).catch(() => setQrSrc(""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrAmount, qrNote, payeeUpi, payeeName]);

  // UPI apps accept QRs picked from the gallery up to this amount.
  const GALLERY_QR_LIMIT = 2000;
  const bridge = typeof window !== "undefined"
    ? (window as unknown as Record<string, unknown>).AndroidUpi as
        | { openApp: (pkg: string) => void; canSaveQr?: () => boolean; saveQrAndOpen?: (png: string, pkg: string) => boolean }
        | undefined
    : undefined;
  const canGalleryQr = (amount: number) =>
    amount <= GALLERY_QR_LIMIT && !!bridge?.saveQrAndOpen && !!bridge.canSaveQr?.();

  /** From the Pay sheet (payer) or the payee's "get paid" button. */
  function showQr(amount: number, fromPaySheet: boolean) {
    setShowPaySheet(null);
    if (fromPaySheet) reportPayStarted(amount);
    setQrNote(fromPaySheet ? payCtx.label : "ExpTrack dues");
    setQrAmount(amount);
  }

  async function launchApp(pkg: string) {
    const amount = showPaySheet;
    setShowPaySheet(null);
    if (amount !== null) reportPayStarted(amount);
    if (amount !== null && canGalleryQr(amount)) {
      // Save this due's QR as the newest gallery picture, then open the app:
      // Scan → gallery → pick it → amount and payee are filled in.
      try {
        const dataUrl = await qrDataUrl(amount, payCtx.label);
        bridge!.saveQrAndOpen!(dataUrl.split(",")[1], pkg);
        return;
      } catch { /* fall through to a plain open */ }
    }
    bridge?.openApp?.(pkg);
  }

  async function clearDue(dueId: number) {
    setClearing((prev) => new Set(prev).add(dueId));
    await supabase.from("dues").update({ cleared: true, cleared_at: new Date().toISOString() }).eq("id", dueId);
    onDuesChange(dues.map((d) => d.id === dueId ? { ...d, cleared: true, cleared_at: new Date().toISOString() } : d));
    setClearing((prev) => { const s = new Set(prev); s.delete(dueId); return s; });
  }

  async function clearGroup(groupDues: SettleDue[]) {
    const ids = groupDues.map((d) => d.id);
    setClearing((prev) => { const s = new Set(prev); ids.forEach((id) => s.add(id)); return s; });
    const now = new Date().toISOString();
    await supabase.from("dues").update({ cleared: true, cleared_at: now }).in("id", ids);
    onDuesChange(dues.map((d) => ids.includes(d.id) ? { ...d, cleared: true, cleared_at: now } : d));
    setClearing((prev) => { const s = new Set(prev); ids.forEach((id) => s.delete(id)); return s; });
    setExpandedCat(null);
  }

  if (unclearedDues.length === 0 && clearedDues.length === 0 && advance <= 0) {
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
            {unclearedDues.length} transaction{unclearedDues.length !== 1 ? "s" : ""} across {byCategory.length} categor{byCategory.length !== 1 ? "ies" : "y"} · {byMonth.length} month{byMonth.length !== 1 ? "s" : ""}
          </div>

          {isPrimary && payeeUpi && (
            <button
              className="w-full py-3 btn-primary rounded-xl text-sm"
              onClick={() => openUpiPay(totalOutstanding, unclearedDues.map((d) => d.id), `ExpTrack dues till ${fmtDate(Date.now())}`)}
            >
              Pay {fmt(totalOutstanding)} via UPI →
            </button>
          )}
          {!isPrimary && payeeUpi && (
            <button
              className="w-full py-3 btn-green rounded-xl text-sm"
              onClick={() => showQr(totalOutstanding, false)}
            >
              Show QR to get paid {fmt(totalOutstanding)}
            </button>
          )}
        </div>
      )}

      {/* ═══ QR with the amount built in ═══ */}
      {qrAmount !== null && (
        <div className="fixed inset-0 sheet-backdrop z-50 flex items-center justify-center p-4 animate-fade-in" onClick={() => setQrAmount(null)}>
          <div className="sheet w-full max-w-sm p-6 rounded-3xl text-center animate-slide-up" onClick={(e) => e.stopPropagation()}>
            <div className="text-xs font-medium mb-1" style={{ color: "var(--text-tertiary)" }}>Pay {payeeName}</div>
            <div className="text-4xl font-extrabold tracking-tight mb-4" style={{ color: "var(--text-primary)" }}>₹{qrAmount.toFixed(2)}</div>
            <div className="mx-auto mb-3 rounded-2xl p-2" style={{ background: "#fff", width: "fit-content" }}>
              {qrSrc
                ? <img src={qrSrc} alt={`UPI QR to pay ₹${qrAmount.toFixed(2)}`} width={260} height={260} />
                : <div style={{ width: 260, height: 260 }} />}
            </div>
            <div className="text-xs mb-1" style={{ color: "var(--text-secondary)" }}>UPI: {payeeUpi}</div>
            <div className="text-[11px] mb-5" style={{ color: "var(--text-tertiary)" }}>
              On the other phone: GPay / PhonePe / Paytm → Scan → point here. Amount is filled in.
              {isPrimary && <><br />The dues clear by themselves when the bank SMS arrives.</>}
            </div>
            <button className="w-full py-2.5 text-sm font-medium rounded-xl" style={{ color: "var(--text-tertiary)" }} onClick={() => setQrAmount(null)}>
              Close
            </button>
          </div>
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
              <div className="badge badge-green mt-2 text-[10px]">
                {canGalleryQr(showPaySheet) ? "✓ QR goes to your gallery" : "✓ Amount copied"}
              </div>
            </div>

            <div className="text-xs text-center mb-1" style={{ color: "var(--text-secondary)" }}>UPI: {payeeUpi}</div>
            <div className="text-[11px] text-center mb-5" style={{ color: "var(--text-tertiary)" }}>
              {canGalleryQr(showPaySheet)
                ? "Open app → Scan → gallery → pick the newest picture"
                : showPaySheet > GALLERY_QR_LIMIT
                  ? `Over ₹${GALLERY_QR_LIMIT.toLocaleString("en-IN")}: scan the QR from another phone, or search "${payeeName}" and paste the amount`
                  : `Open app → search "${payeeName}" → paste amount`}
            </div>

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

            <button
              className="w-full py-3 mb-2 rounded-xl text-sm font-semibold"
              style={{ border: "1px solid var(--border-light)", color: "var(--text-primary)" }}
              onClick={() => showQr(showPaySheet, true)}
            >
              Show QR to scan from another phone
            </button>

            <button className="w-full py-2.5 text-sm font-medium rounded-xl" style={{ color: "var(--text-tertiary)" }} onClick={() => setShowPaySheet(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ═══ Advance (paid beyond all dues) ═══ */}
      {advance > 0 && (
        <div className="card p-3 mb-4 flex justify-between items-center text-sm animate-slide-up">
          <span style={{ color: "var(--text-secondary)" }}>
            {isPrimary ? `Advance paid to ${payeeName}` : "Advance you hold"}
            <span className="block text-[11px]" style={{ color: "var(--text-tertiary)" }}>Used up automatically by the next dues</span>
          </span>
          <span className="font-bold" style={{ color: "var(--accent-green)" }}>{fmt(advance)}</span>
        </div>
      )}

      {/* ═══ Group-by toggle ═══ */}
      {unclearedDues.length > 0 && (
        <div className="flex gap-1.5 mb-3">
          {(["category", "month"] as const).map((g) => (
            <button
              key={g}
              type="button"
              className={`badge text-[11px] py-1 px-3 cursor-pointer ${groupBy === g ? "badge-purple" : "badge-muted"}`}
              onClick={() => changeGroupBy(g)}
            >
              By {g}
            </button>
          ))}
        </div>
      )}

      {/* ═══ Group Rows (category or month) ═══ */}
      <div className="stagger">
        {groups.map(([category, categoryDues]) => {
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
                    <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                      {groupBy === "month" ? monthLabel(category) : category}
                      {groupBy === "category" && lockedNames.has(category) && (
                        <span className="badge badge-orange text-[9px] py-0 ml-1.5">🔒 Locked</span>
                      )}
                    </div>
                    <div className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                      {categoryDues.length} item{categoryDues.length !== 1 ? "s" : ""}
                      {(() => {
                        if (groupBy === "month") {
                          const n = new Set(categoryDues.map((d) => d.category)).size;
                          return ` · ${n} categor${n !== 1 ? "ies" : "y"}`;
                        }
                        const n = new Set(categoryDues.map((d) => monthKey(d.paid_on))).size;
                        return ` · ${n} month${n !== 1 ? "s" : ""}`;
                      })()}
                    </div>
                    {groupBy === "category" && <PositionBlock catName={category} />}
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
                          onClick={(e) => { e.stopPropagation(); openUpiPay(catTotal, categoryDues.map((d) => d.id), `${category} dues (${categoryDues.length})`); }}
                        >
                          Pay {fmt(catTotal)}
                        </button>
                      )}
                      <button
                        className={`${payeeUpi ? "flex-1" : "w-full"} py-2.5 btn-green text-sm rounded-xl disabled:opacity-35`}
                        disabled={categoryDues.some((d) => clearing.has(d.id))}
                        onClick={(e) => { e.stopPropagation(); clearGroup(categoryDues); }}
                      >
                        ✓ Clear All
                      </button>
                    </div>
                  )}
                  {groupBy === "category" && onToggleLock && (
                    <button
                      className="w-full py-2 mb-1 text-xs rounded-xl btn-ghost"
                      style={lockedNames.has(category) ? { color: "var(--accent-orange)" } : undefined}
                      onClick={(e) => { e.stopPropagation(); onToggleLock(category); }}
                    >
                      {lockedNames.has(category)
                        ? `🔓 Unlock "${category}" for new expenses`
                        : `🔒 Lock "${category}": no new expenses from ${payeeName || "others"}`}
                    </button>
                  )}

                  {/* Items — in month view, sub-grouped by category */}
                  {subGroups(categoryDues).map(([subCat, subDues]) => (
                  <div key={subCat ?? "all"} className={subCat ? "mt-3" : undefined}>
                  {subCat && (
                    <div className="flex justify-between items-center px-2 py-1.5 rounded-lg"
                      style={{ background: "rgba(255,255,255,0.04)" }}>
                      <span className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
                        {subCat}
                        <span className="ml-1 font-normal" style={{ color: "var(--text-tertiary)" }}>· {subDues.length}</span>
                        {groupBy === "month" && (() => {
                          const pos = positionText(subCat);
                          return pos ? (
                            <span className="block text-[10px] font-semibold" style={{ color: pos.color }}>{pos.text}</span>
                          ) : null;
                        })()}
                      </span>
                      <span className="flex items-center gap-2">
                        {groupBy === "month" && onToggleLock && (
                          <button
                            className={`badge text-[10px] cursor-pointer ${lockedNames.has(subCat) ? "badge-orange" : "badge-muted"}`}
                            title={lockedNames.has(subCat) ? "Unlock for new expenses" : "Lock: no new expenses"}
                            onClick={(e) => { e.stopPropagation(); onToggleLock(subCat); }}
                          >
                            {lockedNames.has(subCat) ? "🔒 Unlock" : "🔓 Lock"}
                          </button>
                        )}
                        <span className="text-xs font-bold" style={{ color: "var(--accent-red)" }}>
                          {fmt(subDues.reduce((s, d) => s + Number(d.amount), 0))}
                        </span>
                      </span>
                    </div>
                  )}
                  {subDues.map((due, i) => {
                    const txn = txnMap.get(due.transaction_id);
                    const smsExpanded = expandedSmsId === due.id;
                    return (
                      <div key={due.id} className={subCat ? "py-3 pl-2" : "py-3"}
                        style={{ borderBottom: i < subDues.length - 1 ? "1px solid var(--border)" : "none" }}>
                        <div className="flex justify-between items-center">
                          <div>
                            <div className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>{txn?.merchant ?? txn?.notes ?? "Transaction #" + due.transaction_id}</div>
                            <div className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                              {fmtDate(due.paid_on)}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-right">
                              <span className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{fmt(Number(due.amount))}</span>
                              {due.original_amount - Number(due.amount) >= 0.5 && (
                                <span className="block text-[10px]" style={{ color: "var(--accent-orange)" }}>left of {fmt(due.original_amount)}</span>
                              )}
                            </span>
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
                              <button className="badge badge-purple text-[10px] cursor-pointer" onClick={() => openUpiPay(Number(due.amount), [due.id], `${due.category} ${txn?.merchant ?? ""} ${fmtDate(due.paid_on)}`)}>
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
                  ))}
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
