# Background notifications · Phase 2

## Goal

Deliver reliable reminders when the app is **in background or closed**, without changing the current MVP semantics for in-tab reminders.

## Target platforms

- **Web (desktop / mobile browser)** – primary.
- **Hybrid / native shell (if used later)** – optional, via Capacitor.

## Stack decision

### Web

- Use **Service Worker + Web Push**:
  - Reuse existing `push_subscriptions`/VAPID pipeline (already partially wired).
  - Browser handles delivery while the origin is not in the foreground.

### Hybrid / native

- Use **Capacitor Local Notifications**:
  - Schedule local notifications on device.
  - Sync from the same reminder model as web (block id + schedule).

## Scope MVP v2

1. **Permissions & onboarding**
   - Add a clear, one-shot permission prompt in `Settings` for “background reminders”.
   - Explain difference vs current in-tab notifications.

2. **Subscription & storage**
   - Web:
     - Register Service Worker at app bootstrap.
     - On opt‑in, call `pushManager.subscribe` and send subscription to backend (Supabase function or REST).
   - Hybrid:
     - Request local-notification permission once.

3. **Scheduling strategy**

Shared concepts:

- Source of truth = **blocks + ReminderConfig** (start/end leads, repeats).
- Only schedule for **today and tomorrow** to avoid stale queues.

Web:

- Server-side scheduler hooked into:
  - Plan creation/update (`generate-plan` function).
  - ReminderConfig changes (client notifies backend).
- Enqueue push messages with:
  - User id, block id, fire-at timestamp, kind (before-start / before-end / repeat).
  - De‑duplicate when blocks or reminder config change.

Hybrid:

- Client calculates fire times locally from blocks + ReminderConfig and calls Capacitor Local Notifications to schedule/cancel.

4. **Preferences UI**

- Extend `Settings`:
  - Toggle: “Allow background reminders”.
  - Status: granted / denied / not requested.
  - Link to OS-level notification settings (where possible).

5. **Observability**

- Minimal logging:
  - Server: enqueue + send attempts, success/failure.
  - Client: subscription changes, permission flow outcomes.

## Epics / work items

1. **SW + push plumbing**
   - Implement Service Worker register/activate.
   - Implement push subscription flow and storage on backend.

2. **Backend scheduler**
   - API / function to compute reminder fire times from `(user, planDate, blocks, ReminderConfig)`.
   - Persistence for scheduled reminders and deduping.
   - Push sender that respects per-user preferences.

3. **Hybrid notifications (optional)**
   - Wire Capacitor Local Notifications with the same schedule model.
   - Handle rescheduling on app open / plan change.

4. **Settings & UX**

   - New section in `Settings` describing background reminders.
   - Permission gating and fallbacks when user declines.

5. **Telemetry & rollout**

   - Add basic metrics for opted-in users, send rate, and click-through/open-from-notification.
   - Gradual rollout flag so the feature can be enabled per cohort.

