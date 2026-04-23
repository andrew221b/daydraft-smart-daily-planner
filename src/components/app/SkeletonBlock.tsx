/**
 * Reusable skeleton placeholder rows for plan blocks / list rows.
 * Uses the .shimmer utility from index.css.
 */
export const SkeletonBlock = ({ count = 3 }: { count?: number }) => (
  <div className="space-y-3">
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} className="flex gap-3">
        <div className="w-12 pt-3">
          <div className="h-3 w-10 rounded shimmer" />
        </div>
        <div className="w-[3px] rounded-full bg-border" />
        <div className="flex-1 rounded-2xl border border-border bg-surface p-4 shadow-card">
          <div className="h-4 w-3/4 rounded shimmer" />
          <div className="mt-3 flex gap-2">
            <div className="h-3 w-14 rounded-full shimmer" />
            <div className="h-3 w-20 rounded-full shimmer" />
          </div>
        </div>
      </div>
    ))}
  </div>
);