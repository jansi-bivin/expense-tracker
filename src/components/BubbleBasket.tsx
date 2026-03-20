"use client";

import { useRef, useEffect, useState, useCallback } from "react";

export interface BubbleItem {
  id: number;
  label: string;
  amount: string;
  detail?: string;
  isOver: boolean;
  color: string;
  bgColor: string;
  size: number;
  onClick: () => void;
}

interface Body {
  x: number; y: number; vx: number; vy: number; r: number; held: boolean;
}

const G = 0.35, DAMP = 0.93, BOUNCE = 0.3, BOWL = 45, PAD = 8, LABEL_H = 22, RIM = 28;

export default function BubbleBasket({ bubbles, title }: { bubbles: BubbleItem[]; title?: string }) {
  const cRef = useRef<HTMLDivElement>(null);
  const bRef = useRef<Body[]>([]);
  const eRef = useRef<(HTMLDivElement | null)[]>([]);
  const raf = useRef(0);
  const drg = useRef<{ i: number; dist: number } | null>(null);
  const bblRef = useRef(bubbles);
  bblRef.current = bubbles;
  const [w, setW] = useState(0);

  // Estimate settled height: rim + stacked rows + bowl curve + label space
  const avgSize = bubbles.length > 0 ? bubbles.reduce((s, b) => s + b.size, 0) / bubbles.length : 60;
  const rows = Math.ceil(bubbles.length / 3);
  const h = Math.max(180, Math.min(400, RIM + rows * avgSize * 0.85 + BOWL + LABEL_H + PAD));
  const bubbleKey = bubbles.map(b => b.id).join(",");

  // Measure container width
  useEffect(() => {
    const el = cRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    setW(el.clientWidth);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Bucket geometry: tapers inward toward the bottom
  const TAPER = 0.15; // how much narrower the bottom is vs top (0 = straight, 0.3 = very tapered)

  // Bowl floor: parabolic curve — deepest at center, curves up at edges
  const floorAt = useCallback((x: number) => {
    if (w <= 0) return h;
    const n = (x - w / 2) / (w / 2);
    return h - PAD - LABEL_H - BOWL * n * n;
  }, [w, h]);

  // Bucket side walls: at a given y, compute the left and right wall x positions
  // Wider at rim (y=RIM), narrower at bottom (y=h)
  const wallsAt = useCallback((y: number) => {
    if (w <= 0) return { left: PAD, right: w - PAD };
    const t = Math.max(0, Math.min(1, (y - RIM) / (h - RIM - PAD))); // 0 at rim, 1 at bottom
    const inset = t * TAPER * w * 0.5;
    return { left: PAD + inset, right: w - PAD - inset };
  }, [w, h]);

  // Initialize physics bodies — drop from above with stagger
  useEffect(() => {
    if (w <= 0 || bubbles.length === 0) return;
    bRef.current = bubbles.map((b, i) => ({
      x: w * 0.15 + w * 0.7 * (bubbles.length > 1 ? i / (bubbles.length - 1) : 0.5),
      y: -b.size - i * 30 - Math.random() * 40,
      vx: (Math.random() - 0.5) * 1.5, vy: 0,
      r: b.size / 2, held: false,
    }));
  }, [bubbleKey, w]);

  // Keep radii in sync when sizes change without reinit
  useEffect(() => {
    bubbles.forEach((b, i) => { if (bRef.current[i]) bRef.current[i].r = b.size / 2; });
  });

  // Physics loop
  useEffect(() => {
    if (w <= 0) return;

    const tick = () => {
      const bs = bRef.current;

      // Apply forces
      for (const b of bs) {
        if (b.held) continue;
        b.vy += G;
        b.x += b.vx; b.y += b.vy;
        b.vx *= DAMP; b.vy *= DAMP;

        // Bowl floor
        const fl = floorAt(b.x);
        if (b.y + b.r > fl) { b.y = fl - b.r; b.vy *= -BOUNCE; b.vx *= 0.9; }
        // Tapered bucket walls
        const walls = wallsAt(b.y);
        if (b.x - b.r < walls.left) { b.x = walls.left + b.r; b.vx *= -BOUNCE; }
        if (b.x + b.r > walls.right) { b.x = walls.right - b.r; b.vx *= -BOUNCE; }
        // Rim (bubbles can peek above but not fly away)
        if (b.y - b.r < RIM - 20) { b.y = RIM - 20 + b.r; b.vy *= -BOUNCE; }
      }

      // Circle-circle collisions
      for (let i = 0; i < bs.length; i++) {
        for (let j = i + 1; j < bs.length; j++) {
          const a = bs[i], b = bs[j];
          const dx = b.x - a.x, dy = b.y - a.y;
          const d = Math.sqrt(dx * dx + dy * dy), min = a.r + b.r + 2;
          if (d < min && d > 0.01) {
            const nx = dx / d, ny = dy / d, ov = min - d;
            const af = a.held ? 0 : 1, bf = b.held ? 0 : 1, t = af + bf;
            if (t > 0) {
              a.x -= nx * ov * af / t; a.y -= ny * ov * af / t;
              b.x += nx * ov * bf / t; b.y += ny * ov * bf / t;
            }
            const rv = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
            if (rv > 0) {
              if (!a.held) { a.vx -= rv * nx * 0.5; a.vy -= rv * ny * 0.5; }
              if (!b.held) { b.vx += rv * nx * 0.5; b.vy += rv * ny * 0.5; }
            }
          }
        }
      }

      // Update DOM positions directly (no React re-render)
      for (let i = 0; i < bs.length; i++) {
        const el = eRef.current[i];
        if (el) el.style.transform = `translate(${bs[i].x - bs[i].r}px,${bs[i].y - bs[i].r}px)`;
      }

      raf.current = requestAnimationFrame(tick);
    };

    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [w, floorAt]);

  // Touch & mouse drag events
  useEffect(() => {
    const c = cRef.current;
    if (!c) return;

    const pos = (e: TouchEvent | MouseEvent) => {
      const r = c.getBoundingClientRect();
      const s = ("touches" in e && e.touches.length > 0) ? e.touches[0] : e as MouseEvent;
      return { x: s.clientX - r.left, y: s.clientY - r.top };
    };

    const down = (e: TouchEvent | MouseEvent) => {
      const p = pos(e);
      for (let i = bRef.current.length - 1; i >= 0; i--) {
        const b = bRef.current[i];
        if ((p.x - b.x) ** 2 + (p.y - b.y) ** 2 <= (b.r + 5) ** 2) {
          e.preventDefault();
          drg.current = { i, dist: 0 };
          b.held = true; b.vx = 0; b.vy = 0;
          const el = eRef.current[i];
          if (el) el.style.zIndex = "10";
          return;
        }
      }
    };

    const move = (e: TouchEvent | MouseEvent) => {
      if (!drg.current) return;
      e.preventDefault();
      const p = pos(e), b = bRef.current[drg.current.i];
      drg.current.dist += Math.abs(p.x - b.x) + Math.abs(p.y - b.y);
      b.vx = (p.x - b.x) * 0.5;
      b.vy = (p.y - b.y) * 0.5;
      b.x = p.x; b.y = p.y;
    };

    const up = () => {
      if (!drg.current) return;
      const { i, dist } = drg.current;
      bRef.current[i].held = false;
      const el = eRef.current[i];
      if (el) el.style.zIndex = "1";
      // Short distance = tap → drill down; long distance = drag
      if (dist < 10) bblRef.current[i]?.onClick();
      drg.current = null;
    };

    c.addEventListener("touchstart", down, { passive: false });
    c.addEventListener("mousedown", down);
    window.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("mousemove", move);
    window.addEventListener("touchend", up);
    window.addEventListener("mouseup", up);
    return () => {
      c.removeEventListener("touchstart", down);
      c.removeEventListener("mousedown", down);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("touchend", up);
      window.removeEventListener("mouseup", up);
    };
  }, []);

  // Bucket SVG: trapezoid walls + curved bottom + rim
  const bucketSvg = w > 0 ? (() => {
    const topL = PAD, topR = w - PAD;
    const botL = PAD + TAPER * w * 0.5, botR = w - PAD - TAPER * w * 0.5;
    const rimY = RIM;
    const botY = h - PAD - LABEL_H;
    // Curved bottom
    const bottomPts: string[] = [];
    for (let x = botL; x <= botR; x += 2) {
      const n = (x - w / 2) / ((botR - botL) / 2);
      const y = botY - BOWL * (1 - n * n) + BOWL;
      bottomPts.push(`${x},${Math.min(y, botY + 6)}`);
    }
    // Full bucket path: left wall → bottom curve → right wall
    const path = `M${topL},${rimY} L${botL},${botY - BOWL + 6} `
      + bottomPts.map(p => `L${p}`).join(" ")
      + ` L${topR},${rimY}`;
    return path;
  })() : "";

  if (bubbles.length === 0) return null;

  return (
    <div ref={cRef} className="relative overflow-hidden rounded-2xl"
      style={{ height: h, touchAction: "none", userSelect: "none" }}>
      {/* Bucket outline */}
      {bucketSvg && (
        <svg className="absolute inset-0 pointer-events-none" width={w} height={h}>
          {/* Bucket body */}
          <path d={bucketSvg} fill="rgba(255,255,255,0.02)" stroke="rgba(255,255,255,0.1)" strokeWidth="1.5" strokeLinejoin="round" />
          {/* Rim band */}
          <rect x={PAD - 1} y={RIM - 4} width={w - PAD * 2 + 2} height={8} rx={4}
            fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
          {/* Month label on rim */}
          {title && (
            <text x={w / 2} y={RIM + 1} textAnchor="middle" dominantBaseline="middle"
              fill="rgba(255,255,255,0.35)" fontSize="10" fontWeight="600" fontFamily="inherit">
              {title}
            </text>
          )}
        </svg>
      )}

      {bubbles.map((b, i) => (
        <div key={b.id} ref={el => { eRef.current[i] = el; }}
          className="absolute top-0 left-0"
          style={{ width: b.size, willChange: "transform", zIndex: 1 }}>
          <div className="rounded-full flex flex-col items-center justify-center"
            style={{
              width: b.size, height: b.size,
              background: b.bgColor,
              border: `2px solid ${b.color}`,
              boxShadow: b.isOver
                ? `0 0 12px ${b.color}40, 0 0 24px ${b.color}20`
                : "0 2px 8px rgba(0,0,0,0.15)",
              animation: b.isOver ? "bubble-pulse 2s ease-in-out infinite" : "none",
              cursor: "grab",
            }}>
            <div className="font-bold leading-none"
              style={{ color: b.color, fontSize: Math.max(10, b.size * 0.19) }}>
              {b.amount}
            </div>
            {b.detail && b.size >= 52 && (
              <div className="font-semibold mt-0.5 leading-none"
                style={{
                  fontSize: Math.max(7, b.size * 0.12),
                  color: b.isOver ? "#f87171" : "var(--text-tertiary)",
                }}>
                {b.detail}
              </div>
            )}
          </div>
          <div className="text-center mt-1 leading-tight truncate"
            style={{
              fontSize: Math.max(8, Math.min(10, b.size * 0.15)),
              color: "var(--text-secondary)",
            }}>
            {b.label}
          </div>
        </div>
      ))}
    </div>
  );
}
