"use client";

import { useState } from "react";
import { FeatureIdea } from "@/lib/supabase";

interface Props {
  ideas: FeatureIdea[];
  onAdd: (text: string, type: 'feature' | 'bug') => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, text: string) => void;
  onClose: () => void;
}

const STATUS_CONFIG: Record<string, { label: string; badge: string; icon: string }> = {
  pending:       { label: "pending",     badge: "badge-yellow", icon: "" },
  "in-progress": { label: "in progress", badge: "badge-purple", icon: "" },
  implemented:   { label: "done",        badge: "badge-green",  icon: "" },
  "needs-input": { label: "needs input", badge: "badge-orange", icon: "" },
  skipped:       { label: "skipped",     badge: "badge-red",    icon: "" },
  error:         { label: "infra error", badge: "badge-red",    icon: "" },
};

export default function FeatureIdeas({ ideas, onAdd, onDelete, onUpdate, onClose }: Props) {
  const [text, setText] = useState("");
  const [addType, setAddType] = useState<'feature' | 'bug'>('feature');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  function handleSubmit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    onAdd(trimmed, addType);
    setText("");
  }

  function startEdit(idea: FeatureIdea) {
    setEditingId(idea.id);
    setEditText(idea.text);
  }

  function saveEdit() {
    if (!editingId || !editText.trim()) return;
    onUpdate(editingId, editText.trim());
    setEditingId(null);
    setEditText("");
  }

  function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
  }

  function downloadHistory() {
    const done = ideas.filter((i) => i.status === 'implemented' || i.status === 'skipped');
    if (done.length === 0) return;
    const lines = done.map((i) => {
      const tag = i.type === 'bug' ? 'B' : 'F';
      const note = i.resolution_note ? ` — ${i.resolution_note}` : '';
      return `[${tag}${i.seq}] [${i.status}] ${i.text} (${fmtDate(i.created_at)})${note}`;
    });
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `exptrack-history-${new Date().toISOString().split("T")[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Group by status
  const needsInput = ideas.filter((i) => i.status === 'needs-input');
  const errorItems = ideas.filter((i) => i.status === 'error');
  const inProgress = ideas.filter((i) => i.status === 'in-progress');
  const pending = ideas.filter((i) => i.status === 'pending');
  const implemented = ideas.filter((i) => i.status === 'implemented');
  const skipped = ideas.filter((i) => i.status === 'skipped');
  const historyItems = [...implemented, ...skipped];
  const openCount = needsInput.length + errorItems.length + inProgress.length + pending.length;

  function renderIdea(idea: FeatureIdea, dimmed = false) {
    const shortId = `${idea.type === 'bug' ? 'B' : 'F'}${idea.seq || '?'}`;
    const cfg = STATUS_CONFIG[idea.status] || STATUS_CONFIG.pending;
    const isEditing = editingId === idea.id;

    return (
      <div key={idea.id} className="px-5 py-3 flex items-start gap-3" style={{ borderBottom: "1px solid var(--border)", opacity: dimmed ? 0.45 : 1 }}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
            <span className="text-[10px] font-mono font-bold" style={{ color: "var(--text-tertiary)" }}>{shortId}</span>
            <span className={`badge text-[9px] py-0 ${idea.type === 'bug' ? 'badge-red' : 'badge-purple'}`}>
              {idea.type === 'bug' ? 'bug' : 'feature'}
            </span>
            <span className={`badge text-[9px] py-0 ${cfg.badge}`}>
              {cfg.label}
            </span>
          </div>
          {isEditing ? (
            <div className="flex gap-2 mt-1">
              <input
                type="text"
                className="flex-1 px-2 py-1.5 text-sm rounded-lg"
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditingId(null); }}
                autoFocus
              />
              <button className="text-[10px] px-2 py-1 rounded-lg btn-primary" onClick={saveEdit}>ok</button>
              <button className="text-[10px] px-2 py-1 rounded-lg btn-ghost" onClick={() => setEditingId(null)}>x</button>
            </div>
          ) : (
            <div className={`text-sm ${dimmed ? 'line-through' : ''}`}
              style={{ color: dimmed ? "var(--text-tertiary)" : "var(--text-primary)" }}>
              {idea.text}
            </div>
          )}
          {idea.resolution_note && (
            <div className="text-[11px] mt-1.5 px-2.5 py-1.5 rounded-lg"
              style={{ background: "rgba(255,255,255,0.03)", color: "var(--text-secondary)", lineHeight: 1.5 }}>
              Claude: {idea.resolution_note}
            </div>
          )}
          {idea.pr_url && (
            <a href={idea.pr_url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[10px] mt-1 font-medium"
              style={{ color: "var(--accent)" }}>
              View PR
            </a>
          )}
          <div className="text-[10px] mt-1" style={{ color: "var(--text-tertiary)" }}>{fmtDate(idea.created_at)}</div>
        </div>
        {!isEditing && !dimmed && (
          <div className="shrink-0 flex gap-1">
            <button
              className="w-7 h-7 rounded-lg flex items-center justify-center text-xs btn-ghost"
              style={{ color: "var(--accent)" }}
              onClick={() => startEdit(idea)}
            >
              e
            </button>
            <button
              className="w-7 h-7 rounded-lg flex items-center justify-center text-xs btn-ghost"
              style={{ color: "var(--accent-red)" }}
              onClick={() => onDelete(idea.id)}
            >
              x
            </button>
          </div>
        )}
        {dimmed && (
          <button
            className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-xs btn-ghost"
            style={{ color: "var(--accent-red)" }}
            onClick={() => onDelete(idea.id)}
          >
            x
          </button>
        )}
      </div>
    );
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
        <div className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>Ideas & Bugs</div>
        <div className="text-xs mt-1" style={{ color: "var(--text-tertiary)" }}>
          {openCount} open{historyItems.length > 0 ? ` · ${historyItems.length} done` : ""}
          {needsInput.length > 0 ? ` · ${needsInput.length} awaiting input` : ""}
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
        {ideas.length === 0 ? (
          <div className="p-8 text-center text-sm" style={{ color: "var(--text-tertiary)" }}>
            No ideas yet. Jot one down!
          </div>
        ) : (
          <>
            {/* Needs input — most urgent */}
            {needsInput.length > 0 && (
              <>
                <div className="px-5 py-2 text-[10px] font-semibold uppercase tracking-wider"
                  style={{ color: "var(--accent-orange)", background: "rgba(255,179,71,0.05)" }}>
                  Needs your input ({needsInput.length})
                </div>
                {needsInput.map((idea) => renderIdea(idea))}
              </>
            )}

            {/* Infra errors */}
            {errorItems.length > 0 && (
              <>
                <div className="px-5 py-2 text-[10px] font-semibold uppercase tracking-wider"
                  style={{ color: "var(--accent-red)", background: "rgba(239,68,68,0.05)" }}>
                  Infra error ({errorItems.length})
                </div>
                {errorItems.map((idea) => renderIdea(idea))}
              </>
            )}

            {/* In progress */}
            {inProgress.length > 0 && (
              <>
                <div className="px-5 py-2 text-[10px] font-semibold uppercase tracking-wider"
                  style={{ color: "var(--accent)", background: "rgba(123,108,246,0.05)" }}>
                  In progress ({inProgress.length})
                </div>
                {inProgress.map((idea) => renderIdea(idea))}
              </>
            )}

            {/* Pending */}
            {pending.map((idea) => renderIdea(idea))}

            {/* History — collapsible */}
            {historyItems.length > 0 && (
              <>
                <div className="px-5 py-2 flex justify-between items-center"
                  style={{ background: "rgba(255,255,255,0.02)" }}>
                  <button
                    className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider"
                    style={{ color: "var(--text-tertiary)" }}
                    onClick={() => setShowHistory(!showHistory)}
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                      style={{ transition: "transform 0.2s", transform: showHistory ? "rotate(180deg)" : "rotate(0)" }}>
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                    History ({historyItems.length})
                  </button>
                  {showHistory && (
                    <button
                      className="text-[10px] font-semibold px-2.5 py-1 rounded-lg"
                      style={{ color: "var(--accent)", background: "rgba(123,108,246,0.08)" }}
                      onClick={downloadHistory}
                    >
                      Download
                    </button>
                  )}
                </div>
                {showHistory && historyItems.map((idea) => renderIdea(idea, true))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
