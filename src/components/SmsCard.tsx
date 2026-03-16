"use client";

import { useState } from "react";
import { supabase, Transaction, Category } from "@/lib/supabase";

const CATEGORY_GROUPS = [
  { label: "General", filter: (c: Category) => !c.name.startsWith("FC :") && !c.name.startsWith("FOC :") && !c.name.startsWith("Service:") && !c.name.startsWith("Insurance:") },
  { label: "FC (From City)", filter: (c: Category) => c.name.startsWith("FC :") },
  { label: "FOC (Home Town)", filter: (c: Category) => c.name.startsWith("FOC :") },
  { label: "Services & Insurance", filter: (c: Category) => c.name.startsWith("Service:") || c.name.startsWith("Insurance:") },
];

interface Props {
  txn: Transaction;
  categories: Category[];
  onDone: (id: number, category?: string, notes?: string) => void;
}

export default function SmsCard({ txn, categories, onDone }: Props) {
  const [category, setCategory] = useState("");
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const fmt = (n: number) => "\u20B9" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtDate = (ts: number) => new Date(ts).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });

  async function handleSave() {
    if (!category) return;
    setSaving(true);
    await supabase.from("transactions").update({ category, notes: comment || null, status: "categorized" }).eq("id", txn.id);
    onDone(txn.id, category, comment || undefined);
  }

  async function handleIgnore() {
    setSaving(true);
    await supabase.from("transactions").update({ status: "ignored" }).eq("id", txn.id);
    onDone(txn.id);
  }

  return (
    <div className="bg-white rounded-xl shadow p-4 mb-3">
      {/* Top row: amount + date */}
      <div className="flex justify-between items-start mb-2">
        <div>
          <span className={`text-2xl font-bold ${txn.transaction_type === "CREDIT" ? "text-green-600" : "text-red-600"}`}>
            {txn.transaction_type === "DEBIT" ? "-" : "+"}{fmt(Number(txn.amount) || 0)}
          </span>
          <span className={`ml-2 px-2 py-0.5 rounded text-xs font-medium ${
            txn.transaction_type === "CREDIT" ? "bg-green-100 text-green-700" :
            txn.transaction_type === "DEBIT" ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-700"
          }`}>
            {txn.transaction_type ?? "?"}
          </span>
        </div>
        <span className="text-sm text-gray-400">{fmtDate(txn.sms_date)}</span>
      </div>

      {/* Merchant + Account */}
      <div className="text-sm text-gray-700 mb-1">{txn.merchant ?? "Unknown merchant"}</div>
      {txn.account_number && <div className="text-xs text-gray-400 font-mono mb-2">{txn.account_number}</div>}

      {/* Raw SMS (expandable) */}
      <div
        className="text-xs text-gray-400 bg-gray-50 rounded p-2 mb-3 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? txn.body : txn.body.substring(0, 80) + (txn.body.length > 80 ? "..." : "")}
      </div>

      {/* Category dropdown */}
      <select
        className="w-full border rounded-lg px-3 py-2 mb-2 text-sm"
        value={category}
        onChange={(e) => setCategory(e.target.value)}
      >
        <option value="">Select category...</option>
        {CATEGORY_GROUPS.map((group) => {
          const items = categories.filter(group.filter);
          if (items.length === 0) return null;
          return (
            <optgroup key={group.label} label={group.label}>
              {items.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name} ({fmt(c.cap)} {c.recurrence.toLowerCase()})
                </option>
              ))}
            </optgroup>
          );
        })}
      </select>

      {/* Comment */}
      <input
        type="text"
        placeholder="Comment (optional)"
        className="w-full border rounded-lg px-3 py-2 mb-3 text-sm"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />

      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm font-medium disabled:opacity-40"
          disabled={!category || saving}
          onClick={handleSave}
        >
          {saving ? "Saving..." : "Save"}
        </button>
        <button
          className="flex-1 bg-gray-200 text-gray-700 rounded-lg py-2 text-sm font-medium disabled:opacity-40"
          disabled={saving}
          onClick={handleIgnore}
        >
          Ignore
        </button>
      </div>
    </div>
  );
}
