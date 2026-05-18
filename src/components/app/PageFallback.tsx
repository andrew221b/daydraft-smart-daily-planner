export const PageFallback = () => (
  <div className="min-h-[60vh] w-full flex flex-col items-center justify-center gap-4 bg-background">
    <div className="relative grid place-items-center">
      <div className="pill-loader" aria-hidden />
      <span className="pill-loader-dot absolute" aria-hidden />
    </div>
    <span className="eyebrow text-secondary-fg/80">DayDraft</span>
  </div>
);
