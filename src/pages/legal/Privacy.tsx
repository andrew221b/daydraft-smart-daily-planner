import { LegalLayout } from "./LegalLayout";

export default function Privacy() {
  return (
    <LegalLayout title="Privacy Policy">
      <p>DayDraft ("we", "our", "us", "the app") is operated by Andrew Plashevskyi. We respect your privacy. This policy explains what personal data we collect, why we collect it, how we use it, and your rights. It applies to all versions of DayDraft (iOS, Android, and web) and supplements our <a href="/terms">Terms of Service</a>.</p>

      <h2>1. Who we are and how to contact us</h2>
      <p>DayDraft is an AI-assisted daily planning application. The data controller responsible for your personal data is:</p>
      <p><strong>DayDraft / Andrew Plashevskyi</strong><br />
      Contact: <a href="mailto:shapeinc25@gmail.com">shapeinc25@gmail.com</a></p>
      <p>For privacy-related requests, questions, or complaints, write to us at the address above. We respond within 30 days.</p>

      <h2>2. Data we collect</h2>
      <ul className="list-disc pl-5 space-y-1">
        <li><strong>Account data:</strong> email address, display name, hashed password.</li>
        <li><strong>Productivity data:</strong> tasks, plans, time entries, focus sessions, checklist items — all stored encrypted at rest.</li>
        <li><strong>Billing details (optional):</strong> if you use billing features, your hourly rate and payment instructions you enter (bank name, IBAN, crypto wallet, payment link, notes). Stored encrypted at rest, used only to populate your own exports. Never sold or shared with advertisers.</li>
        <li><strong>Optional integrations:</strong> Google Calendar OAuth tokens (only if you connect your calendar); push notification tokens (only if you enable nudges).</li>
        <li><strong>Technical &amp; diagnostic:</strong> minimal error logs and performance data that do not contain the personal content of your tasks.</li>
      </ul>
      <p>We do <strong>not</strong> collect: precise location, contacts, photos, or microphone audio (voice input, if available, is processed locally in your browser only), device identifiers for cross-app tracking, or advertising IDs. If you enable biometric unlock, Face ID / fingerprint matching is performed entirely on your device — we never receive or store any biometric data.</p>

      <h2>3. Legal basis for processing (GDPR)</h2>
      <p>If you are in the European Economic Area (EEA) or the United Kingdom, we process your personal data on the following legal bases under GDPR Article 6:</p>
      <ul className="list-disc pl-5 space-y-1">
        <li><strong>Performance of a contract (Art. 6(1)(b)):</strong> account data, productivity data, and billing data — necessary to provide the service you signed up for.</li>
        <li><strong>Legitimate interests (Art. 6(1)(f)):</strong> technical and diagnostic data, security logging, and fraud prevention — we have a legitimate interest in keeping the service secure and stable, and these interests are not overridden by your rights.</li>
        <li><strong>Consent (Art. 6(1)(a)):</strong> push notifications, Google Calendar integration, and AI personalisation — you opt in explicitly and can withdraw consent at any time in Settings without penalty.</li>
      </ul>

      <h2>4. How we use your data</h2>
      <p>Solely to operate and improve the service:</p>
      <ul className="list-disc pl-5 space-y-1">
        <li>Generate AI-assisted daily plans and responses to your questions.</li>
        <li>Personalise your plans using your own history (see Section 5).</li>
        <li>Sync your data across your devices.</li>
        <li>Send push nudges and reminders you have opted into.</li>
        <li>Produce usage reports visible only to you.</li>
        <li>Maintain service security and fix bugs.</li>
      </ul>
      <p>We do <strong>not</strong> use your data for advertising, sell your data to third parties, or share it with any party except as described in Section 6 below.</p>

      <h2>5. Personalisation &amp; learning</h2>
      <p>To make your plans realistic, DayDraft learns from <strong>your own activity</strong> — how long your tasks actually take versus your estimates, the hours you tend to finish work, and tasks you repeatedly put off. This profile stays in your account, is never sold or used to target ads, and is rebuilt from the last 30 days of activity. You can turn AI personalisation off at any time in Settings → AI, or reset it by clearing your history. Deleting your account removes the profile entirely.</p>

      <h2>6. Third-party processors</h2>
      <p>We engage the following third-party processors, each acting only on our instructions and bound by data processing agreements (DPAs):</p>
      <ul className="list-disc pl-5 space-y-1">
        <li><strong>Supabase</strong> — database hosting (EU/US regions). Your data is stored with row-level security so only your account can access it. <a href="https://supabase.com/privacy" target="_blank" rel="noopener noreferrer">Supabase Privacy Policy</a>.</li>
        <li><strong>Google (Gemini API)</strong> — AI text generation. When you ask DayDraft to plan or assist, your task text and any context you added is sent to Google Gemini to generate a reply. Inputs are processed transiently; they are not used to train Google's foundation models under our API agreement. <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Google Privacy Policy</a>.</li>
        <li><strong>RevenueCat</strong> — subscription management. Receives your purchase receipt and a pseudonymous user ID to activate and restore subscriptions. We never receive or store your card details. <a href="https://www.revenuecat.com/privacy" target="_blank" rel="noopener noreferrer">RevenueCat Privacy Policy</a>.</li>
        <li><strong>Apple App Store / Google Play</strong> — payment processing for in-app purchases, governed by their own privacy policies.</li>
      </ul>
      <p>We do not use any advertising networks, analytics trackers, or data brokers.</p>

      <h2>7. International data transfers</h2>
      <p>Our servers and processors may be located outside your country of residence, including in the United States. Where data is transferred from the EEA or UK, we rely on Standard Contractual Clauses (SCCs) approved by the European Commission, or equivalent safeguards required by applicable law, to ensure an adequate level of protection.</p>

      <h2>8. Storage, security &amp; retention</h2>
      <p>All data is stored on Supabase with row-level security enforced at the database level. Transport uses HTTPS/TLS. Passwords are bcrypt-hashed and never stored in plain text.</p>
      <p><strong>Retention periods:</strong> We keep your account data and productivity data for as long as your account is active. Diagnostic logs are retained for up to 90 days. When you delete your account, your data is removed promptly from active systems; residual copies in encrypted backups are overwritten within our standard backup rotation (typically 30 days). Your personalisation profile is derived from the last 30 days of activity and ages out automatically.</p>

      <h2>9. Your rights</h2>
      <p>Depending on your location, you have the following rights:</p>

      <p><strong>For everyone:</strong></p>
      <ul className="list-disc pl-5 space-y-1">
        <li><strong>Access &amp; export:</strong> download a copy of all your data from Settings → Delete account → Export data.</li>
        <li><strong>Correction:</strong> edit your profile and data from in-app Settings.</li>
        <li><strong>Deletion:</strong> permanently delete your account and all data from Settings → Delete account. We act within 30 days.</li>
        <li><strong>Withdraw consent:</strong> disconnect Calendar, push notifications, or AI personalisation at any time in Settings without any penalty to your account.</li>
      </ul>

      <p><strong>EEA / UK residents (GDPR / UK GDPR):</strong></p>
      <ul className="list-disc pl-5 space-y-1">
        <li><strong>Right to data portability (Art. 20):</strong> receive your data in a structured, machine-readable format — use the Export function in Settings.</li>
        <li><strong>Right to restrict processing (Art. 18):</strong> request that we limit how we use your data while a dispute is pending.</li>
        <li><strong>Right to object (Art. 21):</strong> object to processing based on legitimate interests. We will stop unless we can demonstrate compelling grounds that override your interests.</li>
        <li><strong>Right to lodge a complaint:</strong> you have the right to lodge a complaint with the data protection supervisory authority in your country of residence at any time. A list of EU supervisory authorities is available at <a href="https://edpb.europa.eu/about-edpb/about-edpb/members_en" target="_blank" rel="noopener noreferrer">edpb.europa.eu</a>. UK residents may contact the <a href="https://ico.org.uk" target="_blank" rel="noopener noreferrer">ICO</a>.</li>
      </ul>

      <p><strong>California residents (CCPA / CPRA):</strong></p>
      <ul className="list-disc pl-5 space-y-1">
        <li><strong>We do not sell or share your personal information</strong> for cross-context behavioural advertising. You do not need to opt out — we simply do not engage in these activities.</li>
        <li><strong>Right to know:</strong> you can request disclosure of the categories of personal information collected, the purposes for collection, and the categories of third parties with whom it is shared.</li>
        <li><strong>Right to delete:</strong> request deletion of your personal information (subject to limited exceptions, e.g., legal obligation to retain).</li>
        <li><strong>Right to non-discrimination:</strong> we will not discriminate against you for exercising any of the above rights.</li>
      </ul>

      <p>To exercise any right, contact us at <a href="mailto:shapeinc25@gmail.com">shapeinc25@gmail.com</a>. We may need to verify your identity before fulfilling a request.</p>

      <h2>10. Children</h2>
      <p>DayDraft is not directed to children under 13 (or the applicable minimum age of digital consent in your country — 16 in certain EU member states). We do not knowingly collect personal data from children below that age. If you believe a child has provided us data without appropriate consent, please contact us and we will delete it promptly.</p>

      <h2>11. Changes to this policy</h2>
      <p>We will notify you of material changes via email and an in-app banner at least 14 days before the change takes effect, giving you time to review and, where required, provide fresh consent or delete your account.</p>

      <h2>12. Contact</h2>
      <p>Privacy questions or requests: <a href="mailto:shapeinc25@gmail.com">shapeinc25@gmail.com</a>. We respond within 30 days.</p>
    </LegalLayout>
  );
}
