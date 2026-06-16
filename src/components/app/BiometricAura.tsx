import { motion } from "framer-motion";

/**
 * BiometricAura — a continuously *scanning* biometric animation.
 *
 * The hero is the real platform glyph: an Apple-style Face ID face (iOS) or a
 * fingerprint (Android), drawn cleanly and symmetrically. Over it, a beam of
 * light sweeps up and down on a loop while a dashed enrolment ring turns slowly
 * around the emblem — the universal, unmistakable "I'm scanning you right now"
 * language, modelled on the real Face ID activation. It deliberately never
 * resolves to a checkmark: this is the *waiting-to-authenticate* moment, so it
 * loops until the OS prompt itself resolves.
 *
 * `subtle` (lock screen, seen on every unlock) dials the glow and speed down so
 * it stays calm; the opt-in sheet (seen once) runs a touch brighter/faster.
 */

type Variant = "face" | "fingerprint";

// Symmetric, hand-tuned glyphs in a 120×120 box centred on (60,60).
const GLYPHS: Record<Variant, string[]> = {
  face: [
    // Face ID corner frame
    "M46 26 H34 a8 8 0 0 0 -8 8 V46",
    "M74 26 H86 a8 8 0 0 1 8 8 V46",
    "M46 94 H34 a8 8 0 0 1 -8 -8 V74",
    "M74 94 H86 a8 8 0 0 0 8 -8 V74",
    // eyes
    "M46 49 V59",
    "M74 49 V59",
    // nose — vertical stroke with a small foot to the left (the Apple glyph)
    "M60 47 V64 H53",
    // smile
    "M46 73 Q60 82 74 73",
  ],
  fingerprint: [
    // concentric ridges, outer → core
    "M28 57 Q60 27 92 57",
    "M37 61 Q60 38 83 61",
    "M46 65 Q60 50 74 67",
    "M54 71 Q60 64 66 73",
    // descending outer ridges + centre stem
    "M32 65 Q30 83 40 95",
    "M88 65 Q90 83 80 95",
    "M60 75 V95",
  ],
};

export function BiometricAura({
  variant = "face",
  size = 160,
  subtle = false,
}: {
  variant?: Variant;
  size?: number;
  subtle?: boolean;
}) {
  const emblem = Math.round(size * 0.68);
  const glyph = Math.round(emblem * 0.86);
  const cx = size / 2;
  const ringR = size / 2 - 4;
  const paths = GLYPHS[variant];

  const scanDur = subtle ? 2.6 : 2.0;
  const glow = subtle ? 0.32 : 0.5;
  const beamH = emblem * 0.34;

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: size, height: size }}
      aria-hidden
    >
      {/* ── Breathing accent glow behind everything ─────────────────────── */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: size * 0.82, height: size * 0.82,
          background: "radial-gradient(circle, hsl(var(--primary) / 0.55) 0%, transparent 68%)",
          filter: "blur(16px)",
        }}
        animate={{ opacity: [glow * 0.55, glow, glow * 0.55], scale: [0.95, 1.04, 0.95] }}
        transition={{ duration: scanDur, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* ── Rotating dashed enrolment ring (the Face ID signature) ───────── */}
      <motion.svg
        className="absolute" width={size} height={size} viewBox={`0 0 ${size} ${size}`}
        animate={{ rotate: 360 }}
        transition={{ duration: subtle ? 14 : 9, repeat: Infinity, ease: "linear" }}
      >
        <circle
          cx={cx} cy={cx} r={ringR}
          fill="none" stroke="hsl(var(--primary) / 0.5)" strokeWidth={2.5}
          strokeLinecap="round" strokeDasharray="3 11"
          style={{ filter: "drop-shadow(0 0 4px hsl(var(--primary) / 0.5))" }}
        />
      </motion.svg>
      {/* Faint static guide ring just inside the dashes */}
      <svg className="absolute" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cx} r={ringR - 6} fill="none" stroke="hsl(var(--primary) / 0.12)" strokeWidth={1} />
      </svg>

      {/* ── Glass emblem: holds the glyph and clips the scan beam ────────── */}
      <motion.div
        className="relative flex items-center justify-center border border-white/20 dark:border-white/10 overflow-hidden"
        style={{
          width: emblem, height: emblem,
          borderRadius: Math.round(emblem * 0.3),
          background: "linear-gradient(135deg, hsl(var(--card) / 0.92), hsl(var(--card) / 0.55))",
          backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)",
          boxShadow: "0 18px 44px -10px rgba(0,0,0,0.5), inset 0 1px 1px rgba(255,255,255,0.35), inset 0 -10px 22px rgba(0,0,0,0.18)",
        }}
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 280, damping: 22 }}
      >
        {/* The glyph — draws itself in once, then sits steady to be lit. */}
        <svg width={glyph} height={glyph} viewBox="0 0 120 120" fill="none" className="relative">
          {paths.map((d, i) => (
            <motion.path
              key={i}
              d={d}
              stroke="hsl(var(--primary))"
              strokeWidth={5}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ filter: "drop-shadow(0 0 5px hsl(var(--primary) / 0.45))" }}
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 0.9 }}
              transition={{
                pathLength: { duration: 0.7, ease: "easeInOut", delay: 0.25 + i * 0.06 },
                opacity: { duration: 0.3, delay: 0.25 + i * 0.06 },
              }}
            />
          ))}
        </svg>

        {/* The scan beam — sweeps the surface and lights the glyph (screen blend). */}
        <motion.div
          className="absolute left-0 right-0 pointer-events-none"
          style={{
            top: 0, height: beamH,
            background:
              "linear-gradient(to bottom, transparent 0%, hsl(var(--primary) / 0) 16%, hsl(var(--primary) / 0.85) 50%, hsl(var(--primary) / 0) 84%, transparent 100%)",
            mixBlendMode: "screen",
            filter: "blur(0.5px)",
          }}
          initial={{ y: -beamH }}
          animate={{ y: [-beamH, emblem - beamH * 0.4] }}
          transition={{ duration: scanDur, repeat: Infinity, repeatType: "reverse", ease: "easeInOut", delay: 0.45 }}
        >
          {/* crisp leading line for definition */}
          <div
            className="absolute left-[12%] right-[12%]"
            style={{
              top: "50%", height: 2, borderRadius: 2,
              background: "hsl(var(--primary))",
              boxShadow: "0 0 10px 1px hsl(var(--primary) / 0.9)",
            }}
          />
        </motion.div>

        {/* top sheen */}
        <div className="absolute -top-5 -right-5 h-16 w-16 rounded-full bg-white/25 blur-[18px] pointer-events-none" />
      </motion.div>
    </div>
  );
}
