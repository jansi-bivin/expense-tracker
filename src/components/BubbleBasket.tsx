"use client";

import { useRef, useEffect, useState, useCallback, useMemo } from "react";

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

const G = 0.35, DAMP = 0.92, BOUNCE = 0.25, BOWL = 45, PAD = 12, LABEL_H = 22, RIM = 32;
const WALL_MARGIN = 4; // extra inset so bubbles never clip the basket edge

export default function BubbleBasket({ bubbles, title }: { bubbles: BubbleItem[]; title?: string }) {
  const cRef = useRef<HTMLDivElement>(null);
  const bRef = useRef<Body[]>([]);
  const eRef = useRef<(HTMLDivElement | null)[]>([]);
  const raf = useRef(0);
  const drg = useRef<{ i: number; dist: number } | null>(null);
  const bblRef = useRef(bubbles);
  bblRef.current = bubbles;
  const [w, setW] = useState(0);

  const avgSize = bubbles.length > 0 ? bubbles.reduce((s, b) => s + b.size, 0) / bubbles.length : 60;
  const rows = Math.ceil(bubbles.length / 3);
  const h = Math.max(200, Math.min(420, RIM + rows * avgSize * 0.85 + BOWL + LABEL_H + PAD + 10));
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
  const TAPER = 0.18;

  // Bowl floor: parabolic curve
  const floorAt = useCallback((x: number) => {
    if (w <= 0) return h;
    const n = (x - w / 2) / (w / 2);
    return h - PAD - LABEL_H - BOWL * n * n;
  }, [w, h]);

  // Tapered bucket walls with extra margin so bubbles stay inside
  const wallsAt = useCallback((y: number) => {
    if (w <= 0) return { left: PAD + WALL_MARGIN, right: w - PAD - WALL_MARGIN };
    const t = Math.max(0, Math.min(1, (y - RIM) / (h - RIM - PAD)));
    const inset = t * TAPER * w * 0.5;
    return { left: PAD + inset + WALL_MARGIN, right: w - PAD - inset - WALL_MARGIN };
  }, [w, h]);

  // Initialize physics bodies
  useEffect(() => {
    if (w <= 0 || bubbles.length === 0) return;
    bRef.current = bubbles.map((b, i) => ({
      x: w * 0.2 + w * 0.6 * (bubbles.length > 1 ? i / (bubbles.length - 1) : 0.5),
      y: -b.size - i * 30 - Math.random() * 40,
      vx: (Math.random() - 0.5) * 1.2, vy: 0,
      r: b.size / 2, held: false,
    }));
  }, [bubbleKey, w]);

  useEffect(() => {
    bubbles.forEach((b, i) => { if (bRef.current[i]) bRef.current[i].r = b.size / 2; });
  });

  // Physics loop
  useEffect(() => {
    if (w <= 0) return;

    const tick = () => {
      const bs = bRef.current;

      for (const b of bs) {
        if (b.held) continue;
        b.vy += G;
        b.x += b.vx; b.y += b.vy;
        b.vx *= DAMP; b.vy *= DAMP;

        // Bowl floor
        const fl = floorAt(b.x);
        if (b.y + b.r > fl) { b.y = fl - b.r; b.vy *= -BOUNCE; b.vx *= 0.85; }
        // Tapered bucket walls — hard clamp
        const walls = wallsAt(b.y);
        if (b.x - b.r < walls.left) { b.x = walls.left + b.r; b.vx = Math.abs(b.vx) * BOUNCE; }
        if (b.x + b.r > walls.right) { b.x = walls.right - b.r; b.vx = -Math.abs(b.vx) * BOUNCE; }
        // Ceiling: bubbles must not escape above the rim
        if (b.y - b.r < RIM) { b.y = RIM + b.r; b.vy = Math.abs(b.vy) * BOUNCE; }
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

      // Post-collision: re-clamp all bodies inside walls (prevents collision pushout escapes)
      for (const b of bs) {
        const walls = wallsAt(b.y);
        if (b.x - b.r < walls.left) b.x = walls.left + b.r;
        if (b.x + b.r > walls.right) b.x = walls.right - b.r;
        const fl = floorAt(b.x);
        if (b.y + b.r > fl) b.y = fl - b.r;
        if (b.y - b.r < RIM) b.y = RIM + b.r;
      }

      for (let i = 0; i < bs.length; i++) {
        const el = eRef.current[i];
        if (el) el.style.transform = `translate(${bs[i].x - bs[i].r}px,${bs[i].y - bs[i].r}px)`;
      }

      raf.current = requestAnimationFrame(tick);
    };

    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [w, floorAt, wallsAt]);

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

  // Unique SVG gradient IDs for this instance
  const svgId = useMemo(() => `bb-${Math.random().toString(36).slice(2, 8)}`, []);

  // Basket SVG path
  const bucketSvg = w > 0 ? (() => {
    const topL = PAD, topR = w - PAD;
    const botL = PAD + TAPER * w * 0.5, botR = w - PAD - TAPER * w * 0.5;
    const rimY = RIM;
    const botY = h - PAD - LABEL_H;
    const bottomPts: string[] = [];
    for (let x = botL; x <= botR; x += 2) {
      const n = (x - w / 2) / ((botR - botL) / 2);
      const y = botY - BOWL * (1 - n * n) + BOWL;
      bottomPts.push(`${x},${Math.min(y, botY + 6)}`);
    }
    const path = `M${topL},${rimY} L${botL},${botY - BOWL + 6} `
      + bottomPts.map(p => `L${p}`).join(" ")
      + ` L${topR},${rimY}`;
    return { path, topL, topR, botL, botR, rimY, botY };
  })() : null;

  // Wicker horizontal lines for basket texture
  const wickerLines = useMemo(() => {
    if (!bucketSvg || w <= 0) return [];
    const { rimY, botY, botL, topL, botR, topR } = bucketSvg;
    const lines: { y: number; x1: number; x2: number }[] = [];
    const step = 12;
    for (let y = rimY + step; y < botY - 4; y += step) {
      const t = (y - rimY) / (botY - rimY);
      const lx = topL + t * (botL - topL);
      const rx = topR + t * (botR - topR);
      lines.push({ y, x1: lx + 2, x2: rx - 2 });
    }
    return lines;
  }, [bucketSvg, w]);

  if (bubbles.length === 0) return null;

  return (
    <div ref={cRef} className="relative overflow-hidden rounded-2xl"
      style={{ height: h, touchAction: "none", userSelect: "none" }}>
      {/* Basket SVG */}
      {bucketSvg && (
        <svg className="absolute inset-0 pointer-events-none" width={w} height={h}>
          <defs>
            {/* Basket wicker gradient */}
            <linearGradient id={`${svgId}-wicker`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(180,140,80,0.18)" />
              <stop offset="50%" stopColor="rgba(160,120,60,0.12)" />
              <stop offset="100%" stopColor="rgba(120,90,40,0.18)" />
            </linearGradient>
            {/* Rim metallic gradient */}
            <linearGradient id={`${svgId}-rim`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(220,200,160,0.25)" />
              <stop offset="40%" stopColor="rgba(180,160,120,0.15)" />
              <stop offset="100%" stopColor="rgba(140,120,80,0.25)" />
            </linearGradient>
          </defs>

          {/* Basket body fill */}
          <path d={bucketSvg.path} fill={`url(#${svgId}-wicker)`}
            stroke="rgba(180,150,100,0.22)" strokeWidth="2" strokeLinejoin="round" />

          {/* Wicker horizontal weave lines */}
          {wickerLines.map((l, i) => (
            <line key={i} x1={l.x1} y1={l.y} x2={l.x2} y2={l.y}
              stroke={i % 2 === 0 ? "rgba(180,150,100,0.12)" : "rgba(140,110,70,0.10)"}
              strokeWidth="1" strokeDasharray={i % 2 === 0 ? "6 4" : "4 6"} />
          ))}

          {/* Inner shadow on left & right walls */}
          <path d={bucketSvg.path} fill="none"
            stroke="rgba(0,0,0,0.06)" strokeWidth="6" strokeLinejoin="round"
            style={{ filter: "blur(3px)" }} />

          {/* Rim band — thicker, with a highlight */}
          <rect x={PAD - 2} y={RIM - 6} width={w - PAD * 2 + 4} height={12} rx={6}
            fill={`url(#${svgId}-rim)`} stroke="rgba(180,150,100,0.25)" strokeWidth="1.5" />
          {/* Rim highlight line */}
          <rect x={PAD + 4} y={RIM - 4} width={w - PAD * 2 - 8} height={2} rx={1}
            fill="rgba(255,255,255,0.12)" />

          {/* Month label on rim */}
          {title && (
            <text x={w / 2} y={RIM + 1} textAnchor="middle" dominantBaseline="middle"
              fill="rgba(255,255,255,0.45)" fontSize="10" fontWeight="700" fontFamily="inherit"
              letterSpacing="0.5">
              {title}
            </text>
          )}
        </svg>
      )}

      {/* Bubble elements */}
      {bubbles.map((b, i) => (
        <div key={b.id} ref={el => { eRef.current[i] = el; }}
          className="absolute top-0 left-0"
          style={{ width: b.size, willChange: "transform", zIndex: 1 }}>
          <div className="rounded-full flex flex-col items-center justify-center"
            style={{
              width: b.size, height: b.size,
              /* Sphere-like radial gradient for 3D look */
              background: `radial-gradient(ellipse 55% 45% at 40% 35%, rgba(255,255,255,0.25), transparent 60%),
                           radial-gradient(ellipse 100% 100% at 50% 50%, ${b.bgColor}, ${b.color}22)`,
              border: `2px solid ${b.color}88`,
              boxShadow: b.isOver
                ? `0 0 14px ${b.color}50, 0 0 28px ${b.color}25, inset 0 -4px 8px ${b.color}15`
                : `0 4px 12px rgba(0,0,0,0.2), inset 0 -3px 6px rgba(0,0,0,0.08), inset 0 2px 4px rgba(255,255,255,0.1)`,
              animation: b.isOver ? "bubble-pulse 2s ease-in-out infinite" : "none",
              cursor: "grab",
              position: "relative",
              overflow: "hidden",
            }}>
            {/* Glass highlight — top-left crescent */}
            <div style={{
              position: "absolute",
              top: "8%", left: "15%",
              width: "40%", height: "30%",
              borderRadius: "50%",
              background: "linear-gradient(180deg, rgba(255,255,255,0.35) 0%, rgba(255,255,255,0) 100%)",
              pointerEvents: "none",
            }} />
            {/* Bottom reflection */}
            <div style={{
              position: "absolute",
              bottom: "12%", right: "20%",
              width: "25%", height: "15%",
              borderRadius: "50%",
              background: "radial-gradient(ellipse, rgba(255,255,255,0.12) 0%, transparent 70%)",
              pointerEvents: "none",
            }} />
            <div className="font-bold leading-none" style={{
              color: b.color, fontSize: Math.max(10, b.size * 0.19),
              textShadow: "0 1px 2px rgba(0,0,0,0.15)",
              position: "relative", zIndex: 1,
            }}>
              {b.amount}
            </div>
            {b.detail && b.size >= 52 && (
              <div className="font-semibold mt-0.5 leading-none" style={{
                fontSize: Math.max(7, b.size * 0.12),
                color: b.isOver ? "#f87171" : "var(--text-tertiary)",
                position: "relative", zIndex: 1,
              }}>
                {b.detail}
              </div>
            )}
          </div>
          <div className="text-center mt-1 leading-tight truncate" style={{
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
