"use client";

import { Transaction, Category, Due } from "@/lib/supabase";
import SmsCard from "./SmsCard";

interface Props {
  transactions: Transaction[];
  categories: Category[];
  onDone: (id: number, category?: string, notes?: string) => void;
  userName?: string;
  isPrimary?: boolean;
  unclearedDues?: Due[];
  onSettle?: (txnId: number, dueIds: number[]) => void;
  settlementHints?: string[];
  onSnooze?: (id: number) => void;
  merchantCategoryMap?: Map<string, string>;
}

export default function NewSmsReview({ transactions, categories, onDone, userName, isPrimary, unclearedDues, onSettle, settlementHints, onSnooze, merchantCategoryMap }: Props) {
  return (
    <div className="animate-fade-in">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold"
          style={{ background: "rgba(123, 108, 246, 0.12)", color: "var(--accent-bright)", border: "1px solid rgba(123,108,246,0.2)" }}>
          {transactions.length}
        </div>
        <div>
          <div className="text-base font-bold" style={{ color: "var(--text-primary)" }}>
            New transaction{transactions.length !== 1 ? "s" : ""} to review
          </div>
          {userName && (
            <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>{userName}&apos;s phone</div>
          )}
        </div>
      </div>
      <div className="stagger">
        {transactions.map((txn) => (
          <SmsCard
            key={txn.id}
            txn={txn}
            categories={categories}
            onDone={onDone}
            isPrimary={isPrimary}
            unclearedDues={unclearedDues}
            onSettle={onSettle}
            settlementHints={settlementHints}
            onSnooze={onSnooze}
            merchantCategoryMap={merchantCategoryMap}
          />
        ))}
      </div>
    </div>
  );
}
