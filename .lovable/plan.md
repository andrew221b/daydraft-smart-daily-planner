
## Why you're stuck

Your profile in the database is already `onboarded: true` and the user is confirmed — yet you keep landing on `/auth`. Two bugs are causing this:

### Bug 1 — Signup navigates before a session exists
In `src/pages/app/Auth.tsx`, after `supabase.auth.signUp(...)` we immediately `nav("/onboarding")`. But because email confirmation is ON, signUp does **not** return a session. `RequireAuth` then sees no user and bounces you back to `/auth`. From your perspective, onboarding looks broken/unreachable.

### Bug 2 — `Auth.tsx` doesn't redirect already-signed-in users
When you click the confirmation email link and return to `/auth`, you already have a valid session, but the Auth screen just sits there. There's no effect that redirects an authenticated user to `/today` (or `/onboarding` if not yet onboarded).

Combined effect: signup → email confirm → land on `/auth` → no redirect → "I can't get past onboarding."

## Fix

**1. `src/pages/app/Auth.tsx`**
- After `signUp`, detect whether a session was returned:
  - If yes (auto-confirm on) → `nav("/onboarding")`
  - If no → show a clear "Check your email to confirm your account" state instead of navigating. Keep the form in a confirmed-pending mode.
- Add a `useEffect` that watches `useAuth().user` and `useProfile().profile`: if a user is signed in, redirect to `/onboarding` (when `!profile.onboarded`) or `/today` (when onboarded). This handles return-from-email-confirm and any stale session.

**2. `src/pages/app/Onboarding.tsx`**
- After `update({ onboarded: true, ... })`, the local profile state in `useProfile` updates, but `RequireAuth` re-evaluates on the next render and should allow `/today`. Confirm `update()` actually returns the row (RLS update with `.select()` requires a SELECT policy too — we have `own profile select`, so this is fine). No code change unless we still see issues after Bug 1+2 are fixed.

**3. Optional polish**
- In Auth, also handle the `weak_password` (HIBP) error with a friendlier message: "This password has appeared in known data breaches. Please choose a stronger one." You hit this 5 times during testing.
- Add a small "Resend confirmation email" link in the pending state.

## Files touched
- `src/pages/app/Auth.tsx` — add auth-state redirect effect, handle "no session after signup" case, friendlier error copy.

No DB migrations, no new dependencies. After this, signup → email confirm → automatic redirect to `/onboarding` (or `/today` if already onboarded) will work end-to-end.
