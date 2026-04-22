
# DayDraft — Premium AI Daily Planner

A polished iOS-feel productivity app, mobile-width (390px) centered on desktop, dark-mode first. Real AI scheduling, real persistence, real countdown timer.

## Stack
- React + Tailwind, React Router for screen transitions (fade + slight upward slide)
- Lovable Cloud for auth (email/password) + database
- Lovable AI Gateway (Gemini) via edge function for schedule generation

## Design System
Locked into `index.css` as HSL tokens + Tailwind theme:
- Background `#0A0A0F`, Surface `#13131A`, Surface elevated `#1C1C26`
- Accent indigo `#6B7FFF`, orange `#FF8C42`, success green `#4ADE80`
- Text primary `#F0F0F8`, secondary `#7A7A9A`, divider `#252535`
- Task type colors map to indigo / orange / green
- Radii: 16 cards, 12 buttons, 24 sheets · 8pt spacing grid
- SF Pro Display / SF Pro Text stacks with Dynamic Type-friendly scale
- Card shadow `0 4px 24px rgba(0,0,0,0.4)`, pressed = scale 0.95

## Database (Lovable Cloud)
- `profiles` (id, display_name, energy_preference: morning|midday|night, notifications_enabled)
- `plans` (id, user_id, date, raw_input, ai_summary, ai_subtext, created_at)
- `blocks` (id, plan_id, start_time, duration_min, title, type: deep_work|communication|routine, kind: task|break|lunch, completed, position)
- RLS: users only see/modify their own data · auto-create profile trigger on signup

## Screens & Flow

**Auth gate** — minimal email/password sign-in & sign-up screen styled to match the system (shown before onboarding for new sessions)

**1. Onboarding** (3 steps, full-screen, swipe-style with progress dots)
- Hero with animated indigo/purple gradient blobs (CSS keyframes, slow drift)
- Energy setup: 3 large tap-cards, indigo border + checkmark on select, saved to profile
- Notifications: phone illustration + soft bubble pulse, "Enable" / "Maybe Later" (stores choice; no real push needed)

**2. Morning Check-In** (`/today`)
- Greeting pulled from profile name + real date
- Indigo glow energy pill computed from `energy_preference`
- Large multiline textarea with realistic placeholder, focus-state inner glow
- Chip row: Paste from clipboard (uses `navigator.clipboard`), Voice (Web Speech API where supported), Use yesterday's (loads previous plan's raw_input)
- "Plan My Day" CTA → calls edge function

**3. AI Planning (loading state)**
- Indigo shimmer skeleton cards + "Thinking..." with animated dots
- Minimum 1.5s display so AI feels deliberate
- Edge function: sends raw tasks + energy preference to Gemini with structured tool-calling schema → returns `{summary, subtext, blocks: [{start_time, duration, title, type, kind}]}` → persisted to DB

**4. Day View** (`/today/plan`)
- AI summary card with sparkle icon, indigo left-border accent
- Vertical timeline: time labels left, colored 2px line per type, card with title / duration pill / type label
- Breaks & lunch as small centered text between cards
- Live "now" indicator: subtle horizontal indigo line moving with current time
- Edit mode: drag handle + delete on each block
- Sticky bottom: "▶ Start First Block" → Focus Mode

**5. Focus Mode** (`/focus/:blockId`, full-screen immersive)
- "FOCUS MODE" pill, large task title (max 2 lines)
- Real countdown: SVG circular progress ring (indigo, 6pt stroke), SF Mono 48pt time
- Pulses softly when <5 min remaining
- −5 min / Complete ✓ / Skip → buttons
- On complete: green checkmark scale-in animation, soft chime, auto-advance to next block (or → Recap if last)
- Pauses if tab loses focus, resumes on return
- "Next up: …" footer

**6. Evening Recap** (`/recap`)
- Subtle purple-blue gradient glow at top
- 3 stat cards: tasks done (X/Y), focus time (sum of completed deep work durations), efficiency score = `(completed_min / planned_min) × 100`
- AI insight card (second edge function call: sends today's completion data → 1-sentence insight + 1 actionable suggestion for tomorrow)
- Tomorrow preview: 3 horizontal-scroll chips (placeholder until tomorrow is planned)
- "Plan Tomorrow" CTA + "Done for today" link

**7. Tab Bar** (4 icons, no labels, active in indigo, with subtle indicator dot)
- Today (`/today`) — main flow
- History (`/history`) — list of past plans grouped by week, tap to view read-only Day View
- Stats (`/stats`) — 7-day focus time bar chart, completion rate trend, type breakdown donut
- Settings (`/settings`) — name, energy preference editor, notifications toggle, sign out

## Interactions & Polish
- Page transitions: fade + 8px upward slide (Framer-style via CSS, ~280ms)
- All cards: shadow as spec, active = scale 0.95
- Bottom sheets with drag handle for Edit block
- Success haptic-feel: green check scale-in spring on task complete
- All copy realistic — no lorem ipsum

## Build Order
1. Design system tokens + Tailwind config + base layout shell (390px centered)
2. Lovable Cloud auth + DB schema + RLS
3. Auth screen + onboarding flow (with profile save)
4. Morning check-in UI + edge function `generate-plan`
5. Day View timeline + persistence
6. Focus Mode with real timer + auto-advance
7. Evening Recap + edge function `generate-insight`
8. Tab bar + History / Stats / Settings screens
9. Page transitions, loading states, micro-animations, final polish pass
