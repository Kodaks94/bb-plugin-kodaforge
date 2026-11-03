// Koda, the KodaForge bear cub. Drawn from lib/koda-sprite.ts as crisp pixels.
import { useEffect, useMemo, useState } from "react";
import { runs, spriteFor, type Mood } from "@/lib/koda-sprite";

const STYLE_ID = "koda-forge-motion";
const STYLE = `
@keyframes koda-hop { 0% { transform: translateY(0) } 30% { transform: translateY(-18%) } 55% { transform: translateY(0) } 70% { transform: translateY(-6%) } 100% { transform: translateY(0) } }
@keyframes koda-bob { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-5%) } }
.koda-sprite[data-mood="happy"] { animation: koda-hop 700ms cubic-bezier(0.22, 1, 0.36, 1) 1; }
.koda-sprite[data-mood="working"] { animation: koda-bob 900ms ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .koda-sprite { animation: none !important; } }
`;

export const MOOD_LINES: Record<Mood, string> = {
  idle: "Koda is ready to forge.",
  blink: "Koda is ready to forge.",
  working: "Koda is working on it…",
  happy: "Koda: saved and sound!",
  worried: "Koda spotted a problem. Check Problems or the conflict banner.",
  sleepy: "Koda dozed off. Type anything to wake him.",
};

export function Koda({ mood, size = 16, title }: { mood: Mood; size?: number; title?: string }) {
  useEffect(() => {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = STYLE;
    document.head.append(style);
  }, []);

  // An idle cub blinks now and then.
  const [blinking, setBlinking] = useState(false);
  useEffect(() => {
    if (mood !== "idle") return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        setBlinking(true);
        timer = setTimeout(() => {
          setBlinking(false);
          schedule();
        }, 140);
      }, 3500 + Math.random() * 3000);
    };
    schedule();
    return () => clearTimeout(timer);
  }, [mood]);

  const shown: Mood = mood === "idle" && blinking ? "blink" : mood;
  const rects = useMemo(() => runs(spriteFor(shown)), [shown]);

  return (
    <svg
      className="koda-sprite shrink-0"
      data-mood={mood}
      // A fresh key restarts the hop each time Koda celebrates.
      key={mood}
      width={size}
      height={(size * 14) / 16}
      viewBox="0 0 16 14"
      shapeRendering="crispEdges"
      role="img"
      aria-label={title ?? MOOD_LINES[mood]}
    >
      <title>{title ?? MOOD_LINES[mood]}</title>
      {rects.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={1} fill={r.color} />
      ))}
    </svg>
  );
}
