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
}

export default function NewSmsReview({ transactions, categories, onDone, userName, isPrimary, unclearedDues, onSettle, settlementHints }: Props) {
  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-bold">
          {transactions.length} new transaction{transactions.length !== 1 ? "s" : ""} to review
          {userName && <span className="text-sm font-normal text-gray-400 ml-2">({userName}&apos;s phone)</span>}
        </h2>
      </div>
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
        />
      ))}
    </div>
  );
}
