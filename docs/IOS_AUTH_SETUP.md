# iOS Native Sign-In Setup (Apple + Google)

The DayDraft iOS Capacitor build can sign users in via Apple and Google
*natively* — no browser round-trip, no `404` dead-ends in the WebView.

The **code** is wired and shipped. To make sign-in actually work on a real
device or simulator, you (the human) have to do a few one-time config
steps in three external dashboards. This file is the checklist.

---

## What's already in the repo

| Piece | Location | Status |
| --- | --- | --- |
| Plugin install | `package.json` → `@capgo/capacitor-social-login` | ✅ done |
| Native auth wrapper | `src/lib/nativeAuth.ts` | ✅ done |
| Route OAuth via native on iOS | `src/pages/app/Auth.tsx` | ✅ done |
| Apple Sign In entitlement file | `ios/App/App/App.entitlements` | ✅ done |
| Entitlement wired in build settings | `ios/App/App.xcodeproj/project.pbxproj` | ✅ done |
| Google URL scheme placeholder | `ios/App/App/Info.plist` | ✅ placeholder |
| Google iOS client ID env var | `.env.example` (`VITE_GOOGLE_IOS_CLIENT_ID`) | ✅ documented |

What you still have to do is below.

---

## 1. Sign in with Apple

### 1a. Apple Developer portal
1. Go to <https://developer.apple.com/account/resources/identifiers>.
2. Find the App ID for bundle `dev.daydraft.app` (create one if missing).
3. Enable the **Sign In with Apple** capability on it. Save.
4. Create a **Services ID** (e.g. `dev.daydraft.app.signin`). This is what
   Supabase uses as the *Client ID* for Apple sign-in.
5. Configure the Services ID:
   - Enable Sign In with Apple.
   - Primary App ID: pick the App ID from step 2.
   - Domains and Subdomains: your Supabase project domain, e.g.
     `bavuqskjcehfvdkoreso.supabase.co`.
   - Return URLs: `https://bavuqskjcehfvdkoreso.supabase.co/auth/v1/callback`
6. Create a **Key** (Keys → +). Enable Sign In with Apple, link it to the
   App ID. Download the `.p8` file (you only get one download — keep it safe).
   Note the Key ID + your Team ID.

### 1b. Supabase Auth dashboard
1. Project → Authentication → Providers → **Apple** → Enable.
2. Paste:
   - **Client IDs**: `dev.daydraft.app.signin` *and* `dev.daydraft.app`
     (comma-separated). The first is the Services ID for the web flow; the
     second is the bundle ID for the native flow.
   - **Secret Key**: paste the contents of the `.p8` you downloaded.
   - **Team ID** + **Key ID**: from the Apple Developer portal.
3. Save.

### 1c. Xcode (one click — not editable from the file system reliably)
1. Open `ios/App/App.xcworkspace`.
2. Select the **App** target → **Signing & Capabilities**.
3. If you don't see "Sign In with Apple" in the capabilities list,
   click **+ Capability** and add it. (The entitlement file is already in
   the repo, so Xcode just needs to read it.)
4. Pick a Team if signing complains.

You can now test Apple sign-in on a real device or simulator.

---

## 2. Sign in with Google

### 2a. Google Cloud Console
1. Go to <https://console.cloud.google.com/apis/credentials> and pick the
   project for DayDraft (create one if needed).
2. Configure the OAuth consent screen if you haven't already (User type:
   External, app name + support email).
3. Create **two** OAuth 2.0 Client IDs:
   - **Web application** — for the web build / Supabase to verify tokens.
     - Authorized redirect URI:
       `https://bavuqskjcehfvdkoreso.supabase.co/auth/v1/callback`
     - Note the Client ID. Call this the **Web Client ID**.
   - **iOS** — for the Capacitor app.
     - Bundle ID: `dev.daydraft.app`
     - Note the Client ID and the **iOS URL scheme** (looks like
       `com.googleusercontent.apps.123456-abc`).

### 2b. Wire the iOS Client ID into the build
1. Open `ios/App/App/Info.plist`. Find the placeholder
   `com.googleusercontent.apps.REPLACE_WITH_REVERSED_IOS_CLIENT_ID` and
   replace it with the **iOS URL scheme** from Google.
2. Set the env var in `.env` (or your build env):
   ```
   VITE_GOOGLE_IOS_CLIENT_ID=123456-abc.apps.googleusercontent.com
   ```
   (use the **iOS Client ID**, not the URL scheme).
3. Rebuild + sync:
   ```
   npm run cap:sync
   ```

### 2c. Supabase Auth dashboard
1. Project → Authentication → Providers → **Google** → Enable.
2. Paste the **Web Client ID** + Client Secret from Google Cloud (web
   client) into the regular fields.
3. In **Authorized Client IDs** add the **iOS Client ID** too — this lets
   Supabase accept tokens minted by the iOS app, not just the web flow.
4. Save.

You can now test Google sign-in on a real device or simulator.

---

## How to test

```
npm run ios
```

In Xcode, run on a Simulator or a real device. On the sign-in screen, tap
Google or Apple — the native system sheet should appear, you complete
sign-in, and the app navigates to the home/onboarding screen with an
authenticated Supabase session.

If something fails:
- **Apple says "Sign in not completed"**: check the Services ID is enabled
  for Sign In with Apple and the Supabase Apple provider has both client
  IDs listed.
- **Google says "Sign-in failed"**: check
  - `VITE_GOOGLE_IOS_CLIENT_ID` matches the Google Cloud iOS client
  - the URL scheme in `Info.plist` matches the Google Cloud iOS URL scheme
  - the iOS Client ID is in Supabase's "Authorized Client IDs" field
- **The button does nothing**: check Safari devtools (Develop menu on
  Mac → your device → app) for console errors.

---

## What still uses the Lovable broker

The **web** build (browser + PWA) keeps using `@lovable.dev/cloud-auth-js`
for OAuth — it works fine there, and the native path only applies when
`Capacitor.isNativePlatform()` is true. So the changes above only affect
iOS (and Android, if you add that target later).
