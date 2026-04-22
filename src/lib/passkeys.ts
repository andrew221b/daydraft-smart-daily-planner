// Minimal WebAuthn passkey helpers (browser-only). Uses platform authenticator
// (Face ID / Touch ID / Windows Hello / Android fingerprint).

const STORAGE_KEY = "daydraft.passkey";

function bufToB64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function b64ToBuf(b64: string): ArrayBuffer {
  const s = atob(b64); const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes.buffer;
}
function randomChallenge(): Uint8Array {
  const a = new Uint8Array(32); crypto.getRandomValues(a); return a;
}

export const passkeySupported = () =>
  typeof window !== "undefined" &&
  !!window.PublicKeyCredential &&
  typeof navigator.credentials?.create === "function";

interface StoredPasskey { credentialId: string; userEmail: string; }

export const getStoredPasskey = (): StoredPasskey | null => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch { return null; }
};

export const clearStoredPasskey = () => localStorage.removeItem(STORAGE_KEY);

export async function enrollPasskey(opts: { userId: string; userEmail: string; userName: string }) {
  if (!passkeySupported()) throw new Error("Passkeys not supported on this device");
  const challenge = randomChallenge();
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: "DayDraft", id: window.location.hostname },
      user: {
        id: new TextEncoder().encode(opts.userId),
        name: opts.userEmail,
        displayName: opts.userName || opts.userEmail,
      },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "preferred" },
      timeout: 60000,
      attestation: "none",
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("Could not create passkey");
  const stored: StoredPasskey = { credentialId: bufToB64(cred.rawId), userEmail: opts.userEmail };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  return stored;
}

export async function verifyPasskey(): Promise<{ ok: boolean; userEmail?: string }> {
  const stored = getStoredPasskey();
  if (!stored) return { ok: false };
  if (!passkeySupported()) return { ok: false };
  try {
    const challenge = randomChallenge();
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        timeout: 60000,
        rpId: window.location.hostname,
        allowCredentials: [{ id: b64ToBuf(stored.credentialId), type: "public-key", transports: ["internal"] }],
        userVerification: "required",
      },
    });
    return { ok: !!assertion, userEmail: stored.userEmail };
  } catch {
    return { ok: false };
  }
}