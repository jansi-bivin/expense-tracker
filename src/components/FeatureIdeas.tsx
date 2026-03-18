"use client";

import { useState } from "react";
import { FeatureIdea } from "@/lib/supabase";

interface Props {
  ideas: FeatureIdea[];
  onAdd: (text: string, type: 'feature' | 'bug') => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export default function FeatureIdeas({ ideas, onAdd, onDelete, onClose }: Props) {
  const [text, setText] = useState("");
  const [addType, setAddType] = useState<'feature' | 'bug'>('feature');

  function handleSubmit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    onAdd(trimmed, addType);
    setText("");
  }

  function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
  }

  const pending = ideas.filter((i) => i.status !== 'implemented');
  const implemented = ideas.filter((i) => i.status === 'implemented');

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
        <div className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>Ideas & Bugs</div>
        <div className="text-xs mt-1" style={{ color: "var(--text-tertiary)" }}>
          {pending.length} pending{implemented.length > 0 ? ` · ${implemented.length} done` : ""}
        </div>
      </div>

      {/* Input */}
      <div className="shrink-0 px-5 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
        <div className="flex gap-1.5 mb-2">
          <button
            className={`flex-1 py-1.5 rounded-lg text-[11px] font-semibold transition-all ${addType === 'feature' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setAddType('feature')}
          >
            Feature
          </button>
          <button
            className={`flex-1 py-1.5 rounded-lg text-[11px] font-semibold transition-all ${addType === 'bug' ? 'btn-orange' : 'btn-ghost'}`}
            onClick={() => setAddType('bug')}
          >
            Bug
          </button>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            className="flex-1 px-3 py-2.5 text-sm rounded-xl"
            placeholder={addType === 'bug' ? "Describe the bug..." : "Quick idea..."}
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
        {pending.length === 0 && implemented.length === 0 ? (
          <div className="p-8 text-center text-sm" style={{ color: "var(--text-tertiary)" }}>
            No ideas yet. Jot one down!
          </div>
        ) : (
          <>
            {pending.map((idea) => {
              const shortId = `${idea.type === 'bug' ? 'B' : 'F'}${idea.seq || '?'}`;
              return (
              <div key={idea.id} className="px-5 py-3 flex items-start gap-3" style={{ borderBottom: "1px solid var(--border)" }}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-[10px] font-mono font-bold" style={{ color: "var(--text-tertiary)" }}>{shortId}</span>
                    <span className={`badge text-[9px] py-0 ${idea.type === 'bug' ? 'badge-red' : 'badge-purple'}`}>
                      {idea.type === 'bug' ? 'bug' : 'feature'}
                    </span>
                  </div>
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
              );
            })}

            {implemented.length > 0 && (
              <>
                <div className="px-5 py-2 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-tertiary)", background: "rgba(255,255,255,0.02)" }}>
                  Implemented
                </div>
                {implemented.map((idea) => {
                  const shortId = `${idea.type === 'bug' ? 'B' : 'F'}${idea.seq || '?'}`;
                  return (
                  <div key={idea.id} className="px-5 py-3 flex items-start gap-3" style={{ borderBottom: "1px solid var(--border)", opacity: 0.5 }}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="text-[10px] font-mono font-bold" style={{ color: "var(--text-tertiary)" }}>{shortId}</span>
                        <span className="badge badge-green text-[9px] py-0">done</span>
                        <span className={`badge text-[9px] py-0 ${idea.type === 'bug' ? 'badge-red' : 'badge-purple'}`}>
                          {idea.type === 'bug' ? 'bug' : 'feature'}
                        </span>
                      </div>
                      <div className="text-sm line-through" style={{ color: "var(--text-tertiary)" }}>{idea.text}</div>
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
                  );
                })}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
