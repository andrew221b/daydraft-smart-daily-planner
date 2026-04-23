import { useEffect, useState } from "react";

/**
 * Lightweight DOM-based confetti burst (no canvas, no deps).
 * Mounts when `fire` becomes true, runs ~1.6s, then unmounts itself.
 */
export const Confetti = ({ fire }: { fire: boolean }) => {
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (!fire) return;
    setActive(true);
    const t = setTimeout(() => setActive(false), 1800);
    return () => clearTimeout(t);
  }, [fire]);

  if (!active) return null;

  const colors = [
    "hsl(var(--primary))",
    "hsl(var(--accent))",
    "hsl(var(--success))",
    "hsl(var(--primary-glow))",
  ];
  const pieces = Array.from({ length: 40 }, (_, i) => i);

  return (
    <div className="pointer-events-none fixed inset-0 z-[100] overflow-hidden">
      {pieces.map(i => {
        const left = Math.random() * 100;
        const delay = Math.random() * 0.3;
        const dur = 1.1 + Math.random() * 0.7;
        const size = 6 + Math.random() * 6;
        const rot = Math.random() * 360;
        const color = colors[i % colors.length];
        return (
          <span
            key={i}
            className="absolute top-[-20px] block rounded-sm"
            style={{
              left: `${left}%`,
              width: size,
              height: size * 0.5,
              background: color,
              transform: `rotate(${rot}deg)`,
              animation: `confetti-fall ${dur}s ${delay}s cubic-bezier(.2,.6,.4,1) forwards`,
            }}
          />
        );
      })}
      <style>{`
        @keyframes confetti-fall {
          0% { transform: translateY(0) rotate(0deg); opacity: 1; }
          100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
        }
      `}</style>
    </div>
  );
};