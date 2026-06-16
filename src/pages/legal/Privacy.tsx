import { LegalLayout } from "./LegalLayout";

export default function Privacy() {
  return (
    <LegalLayout title="Privacy Policy">
      <p>DayDraft ("we", "our", "the app") respects your privacy. This policy explains what we collect, why, and your rights. It works alongside our <a href="/terms">Terms of Service</a>.</p>

      <h2>1. Data we collect</h2>
      <ul className="list-disc pl-5 space-y-1">
        <li><strong>Account data:</strong> email address, display name, password (hashed).</li>
        <li><strong>Productivity data:</strong> tasks, plans, time entries, focus sessions — all stored encrypted at rest.</li>
        <li><strong>Billing details (optional):</strong> if you bill for tracked time, your hourly rate and the invoicing details you enter (bank name, IBAN, crypto wallet/network, payment link, notes) — stored encrypted at rest, used only to show you these details for your own invoicing, never sold or shared.</li>
        <li><strong>Optional:</strong> Google Calendar tokens (only if you connect calendar), push notification subscriptions (only if you enable nudges).</li>
        <li><strong>Diagnostic:</strong> minimal error logs without personal content.</li>
      </ul>
      <p>We do <strong>not</strong> collect: location (beyond what you type), contacts, photos, microphone audio (voice input is processed by your browser only), device identifiers for tracking, advertising IDs. If you enable biometric unlock, Face ID / fingerprint matching is performed entirely by your device — we never receive or store your biometric data.</p>

      <h2>2. How we use data</h2>
      <p>Solely to operate the service: schedule your day with AI, personalize your plans from your own history, sync across your devices, send the nudges you opt into, and produce your weekly recap. We do not sell or share data with advertisers.</p>

      <h2>3. AI &amp; third-party processing</h2>
      <p>When you ask DayDraft to plan or assist, the text you enter (your task list and any context you add) is sent to our AI provider, Google Gemini, to generate your schedule or reply. Inputs are processed transiently to answer your request and are not used to train third-party models.</p>
      <p>Purchases are handled by RevenueCat together with Apple's App Store or Google Play. They receive your purchase and a pseudonymous account identifier so we can activate and restore your subscription — we never receive or store your card number. These providers act as processors and handle this data only to run billing on our behalf.</p>

      <h2>4. Personalization &amp; learning</h2>
      <p>To make your plans realistic, DayDraft learns from <strong>your own activity</strong> — how long your tasks actually take versus your estimates, the hours you tend to finish work, and tasks you repeatedly put off. It uses this to tailor <em>your</em> future schedules (for example, padding estimates you usually overshoot, or offering a small first step on a task you keep dodging). This profile is derived only from your own data, stays in your account, is never sold or used to target ads, and is rebuilt from roughly the last 30 days. You can reset it by clearing your history, turn AI off entirely at any time, or remove everything by deleting your account.</p>

      <h2>5. Storage, security &amp; retention</h2>
      <p>Data is stored on Supabase (EU/US regions) with row-level security: only your authenticated account can read your data. Transport is HTTPS/TLS. Passwords are bcrypt-hashed. Where data is processed outside your region, it is protected by standard contractual safeguards.</p>
      <p>We keep your data for as long as your account is active. When you delete your account, it is removed promptly from our active systems; any residual copies in routine encrypted backups are overwritten on our normal backup rotation. Your learning profile is rebuilt from roughly the last 30 days, so older behavioural signals age out on their own.</p>

      <h2>6. Your rights (GDPR / CCPA)</h2>
      <ul className="list-disc pl-5 space-y-1">
        <li><strong>Access &amp; export:</strong> download a copy of all your data anytime from <a href="/settings/delete-account">Settings → Delete account</a>.</li>
        <li><strong>Correction:</strong> edit anything from in-app Settings.</li>
        <li><strong>Deletion:</strong> permanently delete your account and all data from <a href="/settings/delete-account">Settings → Delete account</a>.</li>
        <li><strong>Withdraw consent:</strong> disconnect Calendar, push, or AI features anytime.</li>
      </ul>

      <h2>7. Children</h2>
      <p>DayDraft is not directed to children under 13 (or the minimum age of digital consent in your country, such as 16 in parts of the EU). We do not knowingly collect data from children below that age.</p>

      <h2>8. Changes</h2>
      <p>We will notify you via email and an in-app banner before any material change.</p>

      <h2>9. Contact</h2>
      <p>Questions or requests: <a href="mailto:shapeinc25@gmail.com">shapeinc25@gmail.com</a></p>
    </LegalLayout>
  );
}