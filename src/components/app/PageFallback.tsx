// Orbital loader markup mirrors the inline #boot-overlay in index.html.
// The .boot-logo class + @keyframes live there as the single source of truth.
//
// CRITICAL for a seamless boot: the logo here must sit at the EXACT same spot
// as #boot-overlay's logo — dead viewport centre. The boot overlay centres
// ONLY the logo, so if this fallback puts the logo in a flex column above the
// "Loading" copy (which pushes it upward) the logo visibly JUMPS up the moment
// the overlay fades over this view. So: logo absolutely centred (identical to
// the overlay), copy pinned below WITHOUT displacing it, and NO zoom-in/fade
// entrance — the logo is already on-screen from the overlay, it must simply
// stay put and keep its bootPulse, not re-appear with a flash.
export const PageFallback = () => (
  <div className="relative min-h-screen w-full bg-background overflow-hidden">
    {/* Logo — dead centre, matching #boot-overlay exactly. */}
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="boot-logo drop-shadow-[0_20px_40px_rgba(0,0,0,0.4)]" />
    </div>

    {/* Copy sits below centre; absolute so it never shifts the logo. */}
    <div className="absolute inset-x-0 bottom-[20%] flex flex-col items-center gap-2 text-center px-6">
      <h2 className="text-2xl font-display font-semibold tracking-tight text-foreground/95 animate-pulse">
        Loading
      </h2>
      <p className="text-[14px] text-secondary-fg/80 max-w-[280px] leading-relaxed">
        Just a moment...
      </p>
    </div>
  </div>
);
