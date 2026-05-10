
# DayDraft v2 — Revised Build Plan

Shipped in 6 phases. Each phase is independently valuable and deployable. Payments use a stub (no Stripe/Paddle wiring) — App Store / web checkout gets bolted on later via the same `useEntitlement()` hook.

---

## Phase 1 — Auth, theme, churn fixes (ship first)

**Theme system (light + dark + system)**
- Add light palette to `src/index.css` (`:root.light { ... }`) — same hues, inverted lightness, warm whites.
- `src/lib/theme.tsx` — `ThemeProvider`, `useTheme()`. Reads `profiles.theme` (`'system' | 'light' | 'dark'`), default `'system'`, follows `prefers-color-scheme` when system.
- `<ThemeToggle />` in Settings — three-state segmented control.
- Persist to `profiles.theme` (new column).

**Auth upgrades**
- **Apple + Google sign-in** in `Auth.tsx` via `lovable.auth.signInWithOAuth()` (already wired in `src/integrations/lovable/index.ts`). Two icon-buttons above email form, "or continue with email" divider.
- **Forgot password flow** — link on sign-in screen → `/forgot-password` page → `resetPasswordForEmail({ redirectTo: origin + '/reset-password' })` → new `/reset-password` page handles `type=recovery` and calls `updateUser({ password })`.
- **Biometric / passkey sign-in (WebAuthn)** — Settings → "Enable Face ID / fingerprint." Stores a passkey credential against the user. On future visits, `Auth.tsx` shows a "Sign in with Face ID" button if a passkey exists in this browser. Graceful fallback if unsupported.
- Build error fix: missing module type for `@lovable.dev/cloud-auth-js` — install dep + run typecheck.

**Spillover (yesterday's incomplete tasks)**
- On `/today`, fetch yesterday's plan + incomplete blocks. Show as dismissible chips above textarea: *"3 unfinished from yesterday — tap to carry over."* Tap = prepend to input.

**PWA install prompt (manifest only, no service worker)**
- `public/manifest.json` + 192 / 512 icons + `apple-touch-icon`.
- `<InstallPrompt />` banner — shown once on day 3+ visit, dismissible, stored in `localStorage` + `profiles.install_prompted_at`. Per Lovable PWA guidance: no service worker (avoids preview iframe issues).

---

## Phase 2 — Streaks, recap, share card

**Streaks with weekly freeze**
- Increment `current_streak` on first plan saved each day.
- If a day is missed: auto-consume one freeze (no break) if `freezes_remaining > 0`. Reset to 1 freeze every Monday via `freeze_resets_at` check on read.
- Update `longest_streak` on every change.
- Display: 🔥 + number next to greeting on `/today`. Tap → `<StreakSheet />` bottom sheet with: heatmap of last 12 weeks, longest streak, freezes remaining, milestone badges (7 / 30 / 100).

**In-app weekly recap (replaces email digest for now)**
- New page `/recap/week` — focus minutes, completion %, top task type, best day, streak progress. Sunday push notification (Phase 5) deep-links here. Email digest can come later when domain is verified.

**Public streak share card**
- Edge function `generate-share-card` — uses `@vercel/og`-style HTML-to-image (Deno's `jsr:@deno/canvas` or render via `<canvas>` in browser). Beautiful gradient PNG: streak number, longest streak, "DayDraft." Share button → native share sheet → Twitter / IG / iMessage. Free viral loop.

---

## Phase 3 — Entitlement layer + paywall (no payment provider yet)

**`subscriptions` table** — already exists. Add `useEntitlement()` hook returning `{ tier: 'free' | 'pro' | 'trial', daysLeftInTrial, planQuotaUsed, planQuotaLimit }`.

**Quota enforcement**
- Edge function `check-plan-quota` — counts plans last 7 days. If >= 5 and not Pro → return `quota_exceeded`.
- `Today.tsx` calls before `generate-plan`. Block → open `<UpgradeSheet />`.

**`<UpgradeSheet />` paywall component**
- Bottom sheet, drag handle, gradient header, 3 bullets, monthly/annual toggle (annual pre-selected with "Save 38%" badge).
- CTA "Start 7-day free trial" calls `startCheckout(plan)` — **stub** that opens a "Coming soon — payments wired later" toast for now. Hidden dev-only "Simulate Pro" button flips your own subscription row to `status='active'` for testing all gated flows.
- Trigger points wired: 6th plan attempt, "Calendar sync" tap in Settings, day-14 banner on `/today`, milestone toasts.

**Settings — Pro section**
- Status badge (Free / Trial · X days / Pro). "Manage subscription" → portal stub. "Upgrade" → paywall.

---

## Phase 4 — Day View polish + smart features

**Drag-to-reschedule**
- Long-press a block → drag to new time slot. Snaps to 15-min increments. Other blocks shift to accommodate. Persisted to `blocks` table.

**"Why this order?" explanations**
- New column `blocks.ai_reasoning` (text). `generate-plan` returns short reasoning per block (*"Deep work first because you complete 87% of morning deep blocks"*). Tap any block in Day View → bottom sheet shows reasoning.

**Mid-day re-plan**
- On `/today` if a plan exists for today, show "Re-plan rest of day" button. Sends remaining incomplete blocks + current time to `generate-plan` with `mode: 'replan'`. AI returns updated schedule from now until end of day.

**Quick capture**
- Floating "+" button on every authenticated screen → modal textarea → saves to `quick_captures` table → auto-prepended to tomorrow's `/today` input (above spillover).

**Location + Maps deep-link**
- New columns `blocks.location` (text) and `blocks.location_lat`, `location_lng` (numeric, optional).
- AI prompt updated: extract location hints from raw input (*"gym at 2pm"*, *"meeting at Starbucks Mission St"*).
- Day View: blocks with location show pin icon. Tap pin → opens Apple Maps (`maps://?daddr=...`) on iOS or Google Maps (`https://www.google.com/maps/dir/?api=1&destination=...`) elsewhere with directions from current GPS.

**Traffic / commute awareness**
- New edge function `check-eta` — takes `origin` (current GPS) + `destination` + `arrival_time`. Calls Google Distance Matrix API (server-side, single shared API key in secrets). Returns ETA + delay vs. baseline.
- Triggered: 30 min before any block with location. If delay > 10 min → push notification *"Traffic to {location} +{X} min — leave by {time}"* + offer to shift block.
- Free tier: 40k requests/month — fine for early users. Will need user's API key or rate-limit for scale.

---

## Phase 5 — Notifications + Google Calendar (Pro)

**Morning + evening notifications**
- Web Push API. Settings → "Enable notifications." Subscribes to push, stores subscription in new `push_subscriptions` table.
- Edge function `send-daily-nudges` — pg_cron every 15 min. Picks users whose local time is 7am (morning) or 9pm (evening), sends respective payload.
- Morning: *"Ready to draft today?"* → opens `/today`.
- Evening: *"Mark today's wins"* → opens `/recap`.
- Sunday 6pm local: *"Your week in review"* → opens `/recap/week`.

**Google Calendar read-only sync (Pro feature)**
- Per-user OAuth: user's own Google account, scope `calendar.readonly`. Setup Google OAuth client in Google Cloud Console (I'll guide via UI when we get there).
- `google-oauth-callback` edge function stores refresh token in `calendar_tokens` (encrypted at rest, RLS own-row).
- Settings → "Connect Google Calendar" — Pro-only. Free users see paywall.
- `fetch-calendar-events` edge function pulls today's events, refreshes access token as needed.
- `generate-plan` enhanced: if Pro + connected, fetched events are passed to Gemini as **fixed blocks** the AI must schedule around. Calendar events show in Day View with calendar icon + muted styling.

---

## Phase 6 — Compounding AI + Pro polish

**Compounding intelligence**
- New table `user_patterns` (rolling stats: avg deep-work overrun %, top completed types per time-of-day, abandoned task patterns).
- Updated nightly via `update-user-patterns` cron. Fed into `generate-plan` system prompt.
- Surfaces as toasts: *"You overestimate deep work by 20% — adjusting"*, *"You skip 73% of afternoon workouts — moved to morning"*.

**Custom energy zones (Pro)**
- Settings → "My energy zones" — drag handles on a 24h slider to mark peak/dip/recovery windows. Replaces simple `energy_preference`.

**Block templates**
- Save current day as template. One-tap apply on `/today`.

**Soundscapes (Pro)**
- 8–10 royalty-free loops (rain, café, brown noise, lofi, deep focus). Played in Focus Mode. Pause/resume tied to timer.

---

## Database changes

```sql
alter table profiles
  add column theme text not null default 'system',
  add column passkey_enabled boolean not null default false;

alter table blocks
  add column ai_reasoning text,
  add column location text,
  add column location_lat numeric,
  add column location_lng numeric;

create table quick_captures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  content text not null,
  consumed boolean not null default false,
  created_at timestamptz not null default now()
);

create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create table user_patterns (
  user_id uuid primary key references auth.users on delete cascade,
  deep_work_overrun_pct numeric default 0,
  completion_by_hour jsonb default '{}',
  abandoned_types jsonb default '[]',
  updated_at timestamptz not null default now()
);
```

All RLS own-row select/insert/update/delete (except `subscriptions` writes = service role only).

---

## Build order (one phase per message)

1. **Phase 1** — fix build error, theme, OAuth, forgot password, passkeys, spillover, install banner
2. **Phase 2** — streaks, recap, share card
3. **Phase 3** — entitlement + paywall (stub)
4. **Phase 4** — drag, reasoning, re-plan, quick capture, location/maps, traffic
5. **Phase 5** — notifications + Google Calendar
6. **Phase 6** — compounding AI + soundscapes + templates + energy zones

## Secrets I'll need from you (when we hit each phase)

- **Phase 4 (traffic)**: `GOOGLE_MAPS_API_KEY` — Distance Matrix API enabled in Google Cloud Console. I'll guide you through setup.
- **Phase 5 (push)**: `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` — I'll generate them and tell you where to paste.
- **Phase 5 (calendar)**: Google OAuth client ID + secret with `calendar.readonly` scope.
- **Payments later**: Whatever provider you pick (App Store Server API for native, Stripe/Paddle for web). Same `useEntitlement()` interface, no UI changes needed.

## What's explicitly deferred

- Weekly digest **email** (until you have a verified domain — in-app recap covers this for now)
- Real payment provider wiring (entitlement layer + paywall UI ship now; checkout is stubbed)
- Accountability partner social feature (you didn't pick it; revisit later if engagement is high)
- Native iOS app via Capacitor (separate decision; web/PWA covers everything until then)
