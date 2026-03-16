"use client";

import { useState } from "react";

interface Props {
  activeDays: number;
  daysInMonth: number;
  isPrimary: boolean;
  onUpdate: (days: number) => void;
}

export default function ActiveDaysControl({ activeDays, daysInMonth, isPrimary, onUpdate }: Props) {
  const [open, setOpen] = useState(false);
  const isScaled = activeDays !== daysInMonth;

  function handleUpdate(days: number) {
    onUpdate(days);
  }

  function handleReset() {
    onUpdate(daysInMonth);
    setOpen(false);
  }

  // Collapsed: compact badge — only shows when scaled (orange) or tappable by primary
  if (!open) {
    return (
      <button
        className="flex items-center gap-1.5 px-3 py-1.5 mt-1 rounded-xl text-xs font-medium transition-all"
        style={{
          background: isScaled ? "rgba(255,179,71,0.08)" : "rgba(255,255,255,0.03)",
          border: `1px solid ${isScaled ? "rgba(255,179,71,0.15)" : "var(--border)"}`,
          color: isScaled ? "var(--accent-orange)" : "var(--text-tertiary)",
        }}
        onClick={() => { if (isPrimary) setOpen(true); }}
      >
        <span>📅</span>
        <span>{activeDays}/{daysInMonth} days</span>
        {isScaled && <span className="text-[10px] font-bold ml-0.5">⚡</span>}
        {isPrimary && <span style={{ color: "var(--text-tertiary)", fontSize: "10px", marginLeft: "2px" }}>✎</span>}
      </button>
    );
  }

  // Expanded: stepper controls
  return (
    <div className="flex items-center justify-between px-4 py-2.5 mt-1 rounded-2xl animate-scale-in"
      style={{ background: isScaled ? "rgba(255,179,71,0.08)" : "rgba(255,255,255,0.02)", border: `1px solid ${isScaled ? "rgba(255,179,71,0.15)" : "var(--border)"}` }}>

      <div className="flex items-center gap-2">
        <span className="text-xs">📅</span>
        <span className="text-xs font-medium" style={{ color: isScaled ? "var(--accent-orange)" : "var(--text-tertiary)" }}>
          Active Days
        </span>
      </div>

      <div className="flex items-center gap-2">
        <button
          className="w-7 h-7 rounded-lg flex items-center justify-center text-sm font-bold btn-ghost"
          onClick={() => handleUpdate(Math.max(1, activeDays - 1))}
        >
          −
        </button>

        <span className="text-sm font-bold min-w-[3ch] text-center" style={{ color: isScaled ? "var(--accent-orange)" : "var(--text-primary)" }}>
          {activeDays}
        </span>
        <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>/ {daysInMonth}</span>

        <button
          className="w-7 h-7 rounded-lg flex items-center justify-center text-sm font-bold btn-ghost"
          onClick={() => handleUpdate(Math.min(daysInMonth, activeDays + 1))}
        >
          +
        </button>

        {isScaled && (
          <button
            className="text-[10px] font-semibold px-2 py-1 rounded-lg transition-all"
            style={{ color: "var(--accent-orange)", background: "rgba(255,179,71,0.1)" }}
            onClick={handleReset}
          >
            Reset
          </button>
        )}

        <button
          className="text-[10px] font-semibold px-2 py-1 rounded-lg btn-ghost"
          onClick={() => setOpen(false)}
        >
          Done
        </button>
      </div>
    </div>
  );
}
