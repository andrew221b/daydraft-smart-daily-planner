import { LegalLayout } from "./LegalLayout";

export default function Privacy() {
  return (
    <LegalLayout title="Privacy Policy">
      <p>DayDraft ("we", "our", "the app") respects your privacy. This policy explains what we collect, why, and your rights.</p>

      <h2>1. Data we collect</h2>
      <ul className="list-disc pl-5 space-y-1">
        <li><strong>Account data:</strong> email address, display name, password (hashed).</li>
        <li><strong>Productivity data:</strong> tasks, plans, time entries, focus sessions, streaks — all stored encrypted at rest.</li>
        <li><strong>Optional:</strong> Google Calendar tokens (only if you connect calendar), push notification subscriptions (only if you enable nudges).</li>
        <li><strong>Diagnostic:</strong> minimal error logs without personal content.</li>
      </ul>
      <p>We do <strong>not</strong> collect: location (beyond what you type), contacts, photos, microphone audio (voice input is processed by your browser only), device identifiers for tracking, advertising IDs.</p>

      <h2>2. How we use data</h2>
      <p>Solely to operate the service: schedule your day with AI, sync across your devices, send the nudges you opt into, and produce your weekly recap. We do not sell or share data with advertisers.</p>

      <h2>3. AI processing</h2>
      <p>When you tap "Plan My Day", the text you enter is sent to our AI provider (Google Gemini / OpenAI via Lovable AI Gateway) to generate your schedule. Inputs are processed transiently and not used to train third-party models.</p>

      <h2>4. Storage & security</h2>
      <p>Data is stored on Supabase (EU/US regions) with row-level security: only your authenticated account can read your data. Transport is HTTPS/TLS. Passwords are bcrypt-hashed.</p>

      <h2>5. Your rights (GDPR / CCPA)</h2>
      <ul className="list-disc pl-5 space-y-1">
        <li><strong>Access & export:</strong> request a copy of all your data.</li>
        <li><strong>Correction:</strong> edit anything from in-app Settings.</li>
        <li><strong>Deletion:</strong> permanently delete your account and all data from <a href="/settings/delete-account">Settings → Delete account</a>.</li>
        <li><strong>Withdraw consent:</strong> disconnect Calendar, push, or AI features anytime.</li>
      </ul>

      <h2>6. Children</h2>
      <p>DayDraft is not directed to children under 13. We do not knowingly collect data from children.</p>

      <h2>7. Changes</h2>
      <p>We will notify you via email and an in-app banner before any material change.</p>

      <h2>8. Contact</h2>
      <p>Questions or requests: <a href="mailto:privacy@daydraft.app">privacy@daydraft.app</a></p>
    </LegalLayout>
  );
}