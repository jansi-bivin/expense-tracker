"use client";

import { useState } from "react";
import { FeatureIdea } from "@/lib/supabase";

interface Props {
  ideas: FeatureIdea[];
  onAdd: (text: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export default function FeatureIdeas({ ideas, onAdd, onDelete, onClose }: Props) {
  const [text, setText] = useState("");

  function handleSubmit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setText("");
  }

  function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col animate-fade-in" style={{ background: "var(--bg-base)" }}>
      {/* Header */}
      <div className="shrink-0 px-5 pt-5 pb-4" style={{ background: "var(--bg-elevated)", borderBottom: "1px solid var(--border)" }}>
        <div className="flex justify-between items-center mb-3">
          <button
            className="flex items-center gap-1.5 text-sm font-medium"
            style={{ color: "var(--accent)" }}
            onClick={onClose}
          >
            <span>←</span> Back
          </button>
        </div>
        <div className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>Feature Ideas</div>
        <div className="text-xs mt-1" style={{ color: "var(--text-tertiary)" }}>{ideas.length} idea{ideas.length !== 1 ? "s" : ""}</div>
      </div>

      {/* Input */}
      <div className="shrink-0 px-5 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
        <div className="flex gap-2">
          <input
            type="text"
            className="flex-1 px-3 py-2.5 text-sm rounded-xl"
            placeholder="Quick idea..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
            autoFocus
          />
          <button
            className="px-4 py-2.5 btn-primary text-sm rounded-xl disabled:opacity-35"
            disabled={!text.trim()}
            onClick={handleSubmit}
          >
            +
          </button>
        </div>
      </div>

      {/* Ideas list */}
      <div className="flex-1 overflow-y-auto">
        {ideas.length === 0 ? (
          <div className="p-8 text-center text-sm" style={{ color: "var(--text-tertiary)" }}>
            No ideas yet. Jot one down!
          </div>
        ) : (
          ideas.map((idea) => (
            <div key={idea.id} className="px-5 py-3 flex items-start gap-3" style={{ borderBottom: "1px solid var(--border)" }}>
              <div className="flex-1 min-w-0">
                <div className="text-sm" style={{ color: "var(--text-primary)" }}>{idea.text}</div>
                <div className="text-[10px] mt-1" style={{ color: "var(--text-tertiary)" }}>{fmtDate(idea.created_at)}</div>
              </div>
              <button
                className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-xs btn-ghost"
                style={{ color: "var(--accent-red)" }}
                onClick={() => onDelete(idea.id)}
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
