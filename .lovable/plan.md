
# DayDraft v2 — Retention + Monetization Build

Three phases shipped together. Pricing: **$7.99/mo · $59/yr**. Free tier: **5 plans/week**, then soft paywall.

---

## Phase 1 — Retention foundation

**Spillover (yesterday's incomplete tasks)**
- On `/today`, fetch yesterday's plan; list incomplete blocks as dismissible chips above the textarea: *"3 unfinished from yesterday — tap to carry over"*. Tap = prepend to input.

**Apple + Google sign-in**
- Add to `Auth.tsx` via Lovable's managed OAuth (`lovable.auth.signInWithOAuth`). Two new buttons above email form, divider "or continue with email".

**Streaks (with weekly freeze)**
- New table `streaks` (user_id, current, longest, last_planned_date, freezes_remaining, freeze_resets_at).
- Increment on first plan saved each day; if a day is missed and freezes_remaining > 0, auto-consume one freeze (no break). Reset to 1 freeze every Monday.
- Display: small flame + number next to greeting on `/today`. Tap → bottom sheet with calendar heatmap, longest streak, freezes left.

**PWA install prompt**
- Web manifest + icons + simple `display: standalone` (no service worker, per Lovable PWA guidance). Custom install banner shown once on day 3+ visit, dismissible, stored in localStorage.

**Weekly digest email**
- Set up email infrastructure + verified domain.
- pg_cron job, Sundays 6pm user-local (stored in profiles): edge function aggregates last 7 days (focus min, completion %, top type, best day) → renders branded email → enqueues. Unsubscribe link respected.

---

## Phase 2 — Payments + paywall

**Stripe (built-in Lovable Payments)**
- Run eligibility check → enable Stripe → create two products: `DayDraft Pro Monthly` ($7.99) and `DayDraft Pro Annual` ($59).
- Webhook handler updates `subscriptions` table (user_id, status, plan, current_period_end, trial_ends_at, stripe_customer_id).

**Free-tier enforcement**
- Edge function `check-plan-quota`: counts plans created in last rolling 7 days for the user. If >= 5 and not Pro → return `quota_exceeded`.
- `Today.tsx` calls this before `generate-plan`. On block, show paywall sheet.

**Paywall sheet (`<UpgradeSheet />`)**
- Bottom sheet, drag handle, indigo gradient header, 3-bullet value prop, monthly/annual toggle (annual pre-selected with "Save 38%" badge), "Start 7-day free trial" CTA → Stripe checkout, "Maybe later" link.
- Trigger points wired:
  1. 6th plan attempt of the week
  2. Tap on "Calendar sync" in Settings
  3. Day 14 banner on `/today`
  4. Streak milestone toasts (7/30/100) → tap to upgrade

**Settings additions**
- "DayDraft Pro" section: shows status (Free / Trial · X days left / Pro), "Manage subscription" → Stripe portal, or "Upgrade" → paywall.

---

## Phase 3 — Killer Pro feature: Google Calendar sync (read-only)

- Per-user OAuth (not connector — each user grants their own calendar). Setup Google OAuth credentials, store refresh tokens in new `calendar_tokens` table (RLS, encrypted at rest by Supabase).
- "Connect Google Calendar" button in Settings (Pro only; Free users see paywall sheet).
- Edge function `fetch-calendar-events`: pulls today's events for connected users, returns to client.
- `generate-plan` enhanced: if user has calendar connected + is Pro, fetched events are passed to Gemini as **fixed blocks** the AI must schedule around. Events appear in Day View with a calendar icon and slightly muted styling.

---

## Database changes

```sql
-- streaks
create table streaks (
  user_id uuid primary key references auth.users on delete cascade,
  current int default 0, longest int default 0,
  last_planned_date date, freezes_remaining int default 1,
  freeze_resets_at date default (current_date + 7),
  updated_at timestamptz default now()
);
-- subscriptions
create table subscriptions (
  user_id uuid primary key references auth.users on delete cascade,
  stripe_customer_id text, stripe_subscription_id text,
  status text not null default 'free', -- free|trialing|active|past_due|canceled
  plan text, -- monthly|annual
  current_period_end timestamptz, trial_ends_at timestamptz,
  updated_at timestamptz default now()
);
-- calendar_tokens (Pro)
create table calendar_tokens (
  user_id uuid primary key references auth.users on delete cascade,
  refresh_token text not null, access_token text, expires_at timestamptz,
  email text, created_at timestamptz default now()
);
-- profiles additions
alter table profiles add column timezone text default 'UTC',
  add column digest_opt_in boolean default true,
  add column install_prompted_at timestamptz;
```
All tables: RLS own-row policies (select/insert/update). Subscriptions writes restricted to service role (webhook only).

---

## New edge functions
- `check-plan-quota` — gate the planner
- `stripe-webhook` — sync subscription state
- `create-checkout` — Stripe checkout session
- `customer-portal` — Stripe portal redirect
- `weekly-digest` — cron-triggered, enqueues emails
- `google-oauth-callback` — store refresh token
- `fetch-calendar-events` — pull today's events with refresh

---

## New / changed screens
- `Today.tsx` — spillover chips, streak flame, quota check, paywall trigger
- `Auth.tsx` — Apple + Google buttons
- `Settings.tsx` — Pro section, calendar connect, digest toggle, timezone
- `Streak.tsx` (new bottom sheet) — heatmap + freezes
- `UpgradeSheet.tsx` (new) — paywall component, used everywhere
- `CalendarConnected.tsx` (new) — settings sub-screen
- `InstallPrompt.tsx` (new) — PWA banner

---

## Build order (single-message build)
1. DB migrations (streaks, subscriptions, calendar_tokens, profiles cols)
2. Apple/Google OAuth wiring + Auth UI update
3. Spillover + streak logic + flame UI on Today
4. PWA manifest + install banner
5. Email infra + weekly digest function + cron
6. Stripe enable + products + webhook + checkout/portal functions
7. Quota check + UpgradeSheet + all 4 trigger points
8. Settings Pro section
9. Google Calendar OAuth + fetch-events + plan integration
10. Polish: trial countdown, milestone toasts, paywall analytics events

## What I'll need from you during the build
- Confirm enabling Stripe when prompted (eligibility check first)
- Pick a custom domain or use the free `*.lovable.app` for the email digest sender
- Approve Google Calendar OAuth credential setup (I'll guide you through Google Cloud Console)
