// Orbital loader markup mirrors the inline #boot-overlay in index.html.
// The .dd-* classes and @keyframes live there as the single source of
// truth — touching the loader's animation timing or layout is a one-file
// edit. Only the outer wrapper + copy is React-side here.
export const PageFallback = () => (
  <div className="min-h-screen w-full flex flex-col items-center justify-center bg-background px-6 overflow-hidden">
    <div className="relative flex flex-col items-center justify-center animate-in fade-in zoom-in duration-1000">
      <div className="boot-logo mb-10 drop-shadow-[0_20px_40px_rgba(0,0,0,0.4)]" />

      <div className="flex flex-col items-center space-y-3 text-center">
        <h2 className="text-2xl font-display font-semibold tracking-tight text-foreground/95 animate-pulse">
          Loading
        </h2>
        <p className="text-[14px] text-secondary-fg/80 max-w-[280px] leading-relaxed">
          Just a moment...
        </p>
      </div>
    </div>
  </div>
);
