# Apple In-App Purchase — backend reference

This project ships **only** the backend scaffolding for StoreKit 2 / App Store
Server API. The native iOS app (built separately in Cursor / Xcode using
SwiftUI) is the only client that talks to these endpoints.

## Endpoints

| Function | Auth | Purpose |
|----------|------|---------|
| `verify-apple-iap` | Supabase JWT | Called from the iOS client after `Transaction.latest` returns a signed JWS. Upserts `subscriptions` for the current user. |
| `apple-iap-webhook` | Public (Apple-signed) | App Store Server Notifications V2. Reconciles renewals, cancellations, refunds. |

## Required secrets (set later in Cursor / Supabase dashboard)

- `APPLE_BUNDLE_ID` — e.g. `com.yourname.daydraft`
- `APPLE_ISSUER_ID` — App Store Connect → Users and Access → Keys → Issuer ID
- `APPLE_KEY_ID` — 10-char Key ID for the in-app purchase key
- `APPLE_PRIVATE_KEY` — full `.p8` content (PEM, with newlines)
- `APPLE_ENVIRONMENT` — `sandbox` (default) or `production`

## Database

`subscriptions` table has Apple-specific columns:
- `platform` (`apple` | `stripe` | `web` | `manual`)
- `environment` (`sandbox` | `production`)
- `apple_original_transaction_id` (unique)
- `apple_product_id`
- `apple_latest_transaction_id`
- `last_notification_type`
- `last_event_at`

RLS: users can only `SELECT` their own row. Writes go through the
`service_role` key inside edge functions.

## Status mapping

The `status` column drives `useEntitlement` on the client:

| status | Tier | Meaning |
|--------|------|---------|
| `active` | pro | Paid + within current period |
| `trialing` | trial | Intro offer in flight, `trial_ends_at` in future |
| `canceled` | free | User turned off auto-renew (still has access until `current_period_end`, but tier flips to free at expiry) |
| `expired` | free | Past `current_period_end` |
| `past_due` | free | Billing retry |
| `refunded` | free | Apple-issued refund or revocation |
| `free` | free | Never subscribed |

## What's intentionally missing (do this in Cursor)

1. **JWS signature verification.** The scaffolds only decode the payload. You
   must validate the `x5c` chain against Apple's root CA before trusting any
   field. Use a Deno crypto library or proxy through a small Swift helper.
2. **App Store Server API client.** For lookups (`/inApps/v1/lookup`,
   `/subscriptions/{originalTransactionId}`), generate ES256 JWTs from
   `APPLE_PRIVATE_KEY`/`APPLE_KEY_ID`/`APPLE_ISSUER_ID`.
3. **Native StoreKit 2 wiring** — `Product.products(for:)`, `product.purchase()`,
   then POST `Transaction.latest`'s `jwsRepresentation` to `verify-apple-iap`.
4. **Restore Purchases** button — call `AppStore.sync()` then re-verify.
5. **Webhook URL** in App Store Connect → App Information → App Store Server
   Notifications. Use the `apple-iap-webhook` URL for both Production and
   Sandbox.