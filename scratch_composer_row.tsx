                      >
                        <DebouncedInput
                          value={row.title}
                          enterKeyHint="done"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              e.currentTarget.blur();
                            }
                          }}
                          onDebouncedChange={(val) => { setBulkRows((rs) => rs.map((r, idx) => idx === i ? { ...r, title: val } : r)); setPreFetchedQuestions(null); }}
                          className="flex-1 h-8 px-0 bg-transparent border-0 text-[15px] font-semibold text-foreground focus-visible:ring-0 shadow-none placeholder:text-secondary-fg/50"
                        />
                        <button type="button" onClick={() => { setBulkRows((rs) => rs.filter((_, idx) => idx !== i)); setPreFetchedQuestions(null); }}
                          className="h-8 w-8 grid place-items-center rounded-full text-secondary-fg/50 hover:text-destructive hover:bg-destructive/10 pressable transition-colors shrink-0" aria-label="Remove"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </form>
                      <div className="flex flex-wrap items-center gap-2 mt-0.5">
                        <div className="relative inline-flex items-center">
                          <label
                            className={`relative flex items-center gap-1.5 h-8 px-3 rounded-full border text-[13px] font-medium pressable transition-colors cursor-pointer select-none ${row.start_time ? "pr-8" : ""} ${
                              !row.start_time && highlightMissingStartTime
                                ? "animate-warn-bg"
                                : !row.start_time
                                  ? "border-border/45 bg-muted/40 text-secondary-fg/55 italic"
                                  : "border-border/45 bg-muted/40 text-secondary-fg hover:text-foreground"
                            }`}
                          >
                            <Clock className="h-3.5 w-3.5 opacity-70 pointer-events-none" />
                            <span className="pointer-events-none">{row.start_time ? fmtTime(row.start_time) : "Set time"}</span>
                            <input
                              type="time"
                              className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                              value={row.start_time ?? ""}
                              min={isToday ? roundedNowHHMM() : undefined}
                              tabIndex={-1}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (!val) return;
                                setBulkRows((rs) => {
                                  const next = rs.map((r, idx) => idx === i ? { ...r, start_time: val } : r);
                                  if (highlightMissingStartTime && next.every(r => r.start_time)) setHighlightMissingStartTime(false);
                                  return next;
                                });
                                setPreFetchedQuestions(null);
                              }}
                              style={{ fontSize: 16 }}
                            />
                          </label>
                          {row.start_time && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setBulkRows((rs) => rs.map((r, idx) => idx === i ? { ...r, start_time: undefined } : r));
                                setPreFetchedQuestions(null);
                              }}
                              className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 rounded-full flex items-center justify-center text-secondary-fg hover:bg-foreground/10"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                        <button type="button" onClick={() => setBulkDurationEditIndex(i)}
                          className={`flex items-center gap-1.5 h-8 px-3 rounded-full border text-[13px] font-medium tabular-nums pressable transition-colors ${
                            row.duration == null && highlightMissingDuration
                              ? "border-destructive/60 bg-destructive/10 text-destructive animate-pulse"
                              : row.duration == null
                                ? "border-border/45 bg-muted/40 text-secondary-fg/45 italic"
