"use client";

import { Transaction, Category } from "@/lib/supabase";
import SmsCard from "./SmsCard";

interface Props {
  transactions: Transaction[];
  categories: Category[];
  onDone: (id: number) => void;
}

export default function NewSmsReview({ transactions, categories, onDone }: Props) {
  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-bold">{transactions.length} new transaction{transactions.length !== 1 ? "s" : ""} to review</h2>
      </div>
      {transactions.map((txn) => (
        <SmsCard key={txn.id} txn={txn} categories={categories} onDone={onDone} />
      ))}
    </div>
  );
}
