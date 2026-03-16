"use client";

interface Props {
  activeDays: number;
  daysInMonth: number;
  isPrimary: boolean;
  onUpdate: (days: number) => void;
}

export default function ActiveDaysControl({ activeDays, daysInMonth, isPrimary, onUpdate }: Props) {
  const isScaled = activeDays !== daysInMonth;

  return (
    <div className="flex items-center justify-between px-4 py-2.5 mb-4 rounded-2xl animate-fade-in"
      style={{ background: isScaled ? "rgba(255,179,71,0.08)" : "rgba(255,255,255,0.02)", border: `1px solid ${isScaled ? "rgba(255,179,71,0.15)" : "var(--border)"}` }}>

      <div className="flex items-center gap-2">
        <span className="text-xs">📅</span>
        <span className="text-xs font-medium" style={{ color: isScaled ? "var(--accent-orange)" : "var(--text-tertiary)" }}>
          Active Days
        </span>
      </div>

      <div className="flex items-center gap-2">
        {isPrimary && (
          <button
            className="w-7 h-7 rounded-lg flex items-center justify-center text-sm font-bold btn-ghost"
            onClick={() => onUpdate(Math.max(1, activeDays - 1))}
          >
            −
          </button>
        )}

        <span className="text-sm font-bold min-w-[3ch] text-center" style={{ color: isScaled ? "var(--accent-orange)" : "var(--text-primary)" }}>
          {activeDays}
        </span>
        <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>/ {daysInMonth}</span>

        {isPrimary && (
          <button
            className="w-7 h-7 rounded-lg flex items-center justify-center text-sm font-bold btn-ghost"
            onClick={() => onUpdate(Math.min(daysInMonth, activeDays + 1))}
          >
            +
          </button>
        )}

        {isPrimary && isScaled && (
          <button
            className="text-[10px] font-semibold px-2 py-1 rounded-lg transition-all"
            style={{ color: "var(--accent-orange)", background: "rgba(255,179,71,0.1)" }}
            onClick={() => onUpdate(daysInMonth)}
          >
            Reset
          </button>
        )}
      </div>
    </div>
  );
}
