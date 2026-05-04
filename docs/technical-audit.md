# Technical Audit (May 2026)

## Scope

Quick audit focused on:

- obvious runtime gaps,
- conflicting or fragile dependencies,
- architectural inconsistencies likely to cause regressions.

## Findings

### High

1. Push cron delivery depends on VAPID secrets.
   - File: `supabase/functions/send-daily-nudges/index.ts`
   - Current behavior: live dispatch is enabled when `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` are configured; otherwise function runs in dry-run mode.
   - Impact: without secrets, nudges are scheduled/logged but not delivered.
   - Status: transport and cleanup logic implemented; environment configuration required for production delivery.

### Medium

1. Large production chunks.
   - Build warning indicated >500KB chunks.
   - Mitigation added: `manualChunks` strategy in `vite.config.ts`.
   - Expected result: better cacheability and less heavy initial vendor load.

2. Dependency lag with many major versions available.
   - `npm outdated` shows broad drift (React/Vite/Tailwind ecosystem and others).
   - Risk: delayed upgrades become high-risk migrations.
   - Recommendation: incremental upgrade plan in small batches.

3. Hook dependency suppressions in a few sensitive files.
   - `eslint-disable-next-line react-hooks/exhaustive-deps` appears in planning/focus/history/theme flows.
   - Risk: stale closures after future refactors.

### Low

1. Tone default inconsistency risk.
   - Some flows previously defaulted to `motivational`, others to `professional`.
   - Status: aligned to `professional` fallback in major paths.

## Changes Applied During This Audit

- Added copy guide:
  - `docs/copy-guidelines.md`
- Improved editorial consistency across core UX text and notifications.
- Aligned tone fallback defaults to `professional`.
- Added `manualChunks` in `vite.config.ts`.
- Improved push subscription robustness:
  - `src/lib/push.ts` now uses upsert on `(user_id, endpoint)` to avoid duplicate insert errors.
- Improved nudge scheduler observability and tone-awareness:
  - `supabase/functions/send-daily-nudges/index.ts` now returns mode + counters and uses tone-specific copy.
- Added live push dispatch path with endpoint cleanup:
  - removes expired subscriptions (404/410) after send failures.

## Dependency Upgrade Roadmap

### Phase 1 (safe patch/minor, low risk)

- Update patch/minor versions within current majors:
  - `@tanstack/react-query`, `@supabase/supabase-js`, Radix patch set, eslint patches.
- Validate with:
  - `npm test`
  - `npm run build`

### Phase 2 (tooling baseline)

- Upgrade TypeScript + lint toolchain together:
  - `typescript`, `typescript-eslint`, `eslint` (compatible set).
- Fix new lint/type findings before any runtime-library majors.

### Phase 3 (runtime majors in isolation)

- Perform one major at a time:
  - Vite/plugin chain,
  - React ecosystem,
  - Tailwind stack.
- After each major:
  - run full build/tests,
  - smoke-test primary flows (`Today`, `DayView`, `Focus`, `Recap`, `Settings`).

### Phase 4 (push production hardening)

- Configure VAPID envs in all environments (prod/stage/dev).
- Add delivery telemetry:
  - successful sends,
  - expired endpoints cleanup,
  - retry/error buckets.

## Recommended Next Step

Prioritize Phase 4 (real push dispatch), since this is the only remaining high-impact functional gap.
