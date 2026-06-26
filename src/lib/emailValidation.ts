/**
 * Soft, advisory email checking for the billing payment fields.
 *
 * These fields are deliberately dual-purpose — a PayPal/Wise/Interac row can
 * hold an email OR a @handle, a paypal.me link, a phone number, etc. So this is
 * NOT a hard validator: it only speaks up when the value clearly *looks like an
 * attempted email* and something about it is off (missing "@", a stray space, or
 * a recognisable domain typo like "gnail.com"). Everything else returns "ok" so
 * we never block a legitimate non-email value.
 */

export type EmailCheck = {
  status: "ok" | "warn";
  /** Short, human reason shown under the field when status is "warn". */
  message?: string;
  /** A confident corrected address the user can tap to apply, when we have one. */
  suggestion?: string;
};

const OK: EmailCheck = { status: "ok" };

/** Mail domains people actually use — the targets for typo correction. */
const COMMON_DOMAINS = [
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com",
  "yahoo.com", "icloud.com", "me.com", "proton.me", "protonmail.com",
  "aol.com", "gmx.com", "yandex.com", "mail.com", "msn.com", "zoho.com",
];

/** High-frequency domain misspellings → the canonical domain. Cheaper and more
 *  certain than edit-distance for the ones we see constantly. */
const DOMAIN_TYPOS: Record<string, string> = {
  // gmail
  "gnail.com": "gmail.com", "gmial.com": "gmail.com", "gmai.com": "gmail.com",
  "gmal.com": "gmail.com", "gmil.com": "gmail.com", "gamil.com": "gmail.com",
  "gmaill.com": "gmail.com", " gmail.com": "gmail.com", "gmail.co": "gmail.com",
  "gmail.con": "gmail.com", "gmail.cm": "gmail.com", "gmail.comm": "gmail.com",
  "gmail.om": "gmail.com", "gmaul.com": "gmail.com", "gmeil.com": "gmail.com",
  // hotmail
  "hotmial.com": "hotmail.com", "hotmil.com": "hotmail.com", "hotmai.com": "hotmail.com",
  "hotmal.com": "hotmail.com", "hotnail.com": "hotmail.com", "hotmail.co": "hotmail.com",
  "hotmail.con": "hotmail.com",
  // outlook
  "outlok.com": "outlook.com", "outloo.com": "outlook.com", "outllok.com": "outlook.com",
  "outlook.co": "outlook.com", "outlook.con": "outlook.com", "putlook.com": "outlook.com",
  // yahoo
  "yaho.com": "yahoo.com", "yahooo.com": "yahoo.com", "yhaoo.com": "yahoo.com",
  "yahoo.co": "yahoo.com", "yahoo.con": "yahoo.com",
  // icloud
  "iclod.com": "icloud.com", "iclould.com": "icloud.com", "icloud.co": "icloud.com",
  "icloud.con": "icloud.com", "icloude.com": "icloud.com",
  // proton
  "protonmail.co": "protonmail.com", "proton.com": "proton.me",
};

/** Common bare-TLD slips, applied only when the rest of the domain is sound. */
const TLD_TYPOS: Record<string, string> = {
  con: "com", cmo: "com", comm: "com", ocm: "com", vom: "com", xom: "com",
  co: "com", om: "com", cm: "com", "c0m": "com", nett: "net", orgg: "org",
};

const levenshtein = (a: string, b: string): number => {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const row = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = tmp;
    }
  }
  return row[n];
};

/** Best-effort domain correction. Returns a fixed domain only when we're
 *  reasonably sure; otherwise null (leave the user's value alone). */
function correctDomain(domain: string): string | null {
  const d = domain.toLowerCase();
  if (DOMAIN_TYPOS[d]) return DOMAIN_TYPOS[d];
  if (COMMON_DOMAINS.includes(d)) return null; // already valid

  // Fix an obvious TLD slip (e.g. gmail.con → gmail.com) when the name part
  // before the dot is itself a known-good domain stem.
  const lastDot = d.lastIndexOf(".");
  if (lastDot > 0) {
    const stem = d.slice(0, lastDot);
    const tld = d.slice(lastDot + 1);
    if (TLD_TYPOS[tld]) {
      const candidate = `${stem}.${TLD_TYPOS[tld]}`;
      if (COMMON_DOMAINS.includes(candidate) || stem.length >= 3) return candidate;
    }
  }

  // Fall back to nearest common domain within a SINGLE-character edit — catches
  // one-off slips we didn't hardcode (gmaip→gmail) without "correcting" genuine
  // custom domains. Distance 1 only: anything looser starts mangling real
  // domains like "me.io" → "me.com". Multi-character typos are covered by the
  // hardcoded DOMAIN_TYPOS map above.
  let best: string | null = null;
  let bestDist = Infinity;
  for (const cand of COMMON_DOMAINS) {
    const dist = levenshtein(d, cand);
    if (dist < bestDist) { bestDist = dist; best = cand; }
  }
  if (best && bestDist === 1 && best !== d) return best;
  return null;
}

/** Does this value look like the user is trying to enter an email — as opposed
 *  to a @handle, a payment link, or a phone number? Conservative on purpose. */
function looksLikeEmailAttempt(trimmed: string): boolean {
  if (!trimmed) return false;
  // Pure handle: "@wisetag", "@username" — not an email.
  if (/^@[\w.-]+$/.test(trimmed)) return false;
  // URLs / known payment links — not an email.
  if (/^https?:\/\//i.test(trimmed)) return false;
  if (/\b(paypal\.me|buy\.stripe\.com|wise\.com|revolut\.me|venmo\.com)\b/i.test(trimmed)) return false;
  // Phone-ish: starts with + or digit and is mostly digits/spaces/punctuation.
  if (/^[+(]?\d[\d\s()\-.]{5,}$/.test(trimmed)) return false;
  // Has an "@" → almost certainly an email attempt.
  if (trimmed.includes("@")) return true;
  // No "@" but contains a mail-host-looking domain (e.g. "namegmail.com").
  return /[a-z0-9][a-z0-9._%+-]*\.(com|net|org|me|io|co|ru|ua)\b/i.test(trimmed) &&
    /(gmail|gmial|gnail|googlemail|outlook|hotmail|yahoo|icloud|proton|yandex)/i.test(trimmed);
}

/**
 * Check a billing field value that might be an email. Non-blocking by design —
 * returns "warn" with a friendly nudge (and a one-tap fix when confident),
 * never an error that stops the user from saving.
 */
export function checkEmailish(raw: string): EmailCheck {
  if (typeof raw !== "string") return OK;
  const trimmed = raw.trim();
  if (!looksLikeEmailAttempt(trimmed)) return OK;

  // Stray whitespace — the classic copy-paste slip. Offer the cleaned value.
  if (/\s/.test(trimmed) || raw !== trimmed) {
    const cleaned = raw.replace(/\s+/g, "");
    const sub = checkEmailish(cleaned);
    return {
      status: "warn",
      message: "Looks like there's a stray space in the address.",
      suggestion: sub.status === "ok" ? cleaned : sub.suggestion ?? cleaned,
    };
  }

  const atCount = (trimmed.match(/@/g) || []).length;

  if (atCount === 0) {
    // "namegmail.com" — recognisable domain glued to the local part. Try to
    // split it back out so we can offer a real fix.
    const m = trimmed.match(/^(.+?)(gmail|googlemail|outlook|hotmail|yahoo|icloud|proton|yandex)(\.[a-z.]+)$/i);
    if (m) {
      const guess = `${m[1]}@${m[2].toLowerCase()}${m[3].toLowerCase()}`;
      const sub = checkEmailish(guess);
      return {
        status: "warn",
        message: 'Missing the "@" — check the address.',
        suggestion: sub.status === "ok" ? guess : sub.suggestion ?? guess,
      };
    }
    return { status: "warn", message: 'This looks like an email but is missing the "@".' };
  }

  if (atCount > 1) {
    return { status: "warn", message: 'An email should have only one "@".' };
  }

  const [local, domain] = trimmed.split("@");
  if (!local) return { status: "warn", message: 'Nothing before the "@" — check the address.' };
  if (!domain) return { status: "warn", message: 'Nothing after the "@" — add the mail provider.' };
  if (!domain.includes(".") || domain.startsWith(".") || domain.endsWith(".")) {
    return { status: "warn", message: "The domain part looks incomplete." };
  }

  const fixed = correctDomain(domain);
  if (fixed && fixed !== domain.toLowerCase()) {
    const suggestion = `${local}@${fixed}`;
    return { status: "warn", message: `Did you mean ${suggestion}?`, suggestion };
  }

  // Final structural sanity check for anything still off (odd characters, etc.).
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed)) {
    return { status: "warn", message: "This doesn't look like a valid email." };
  }

  return OK;
}
