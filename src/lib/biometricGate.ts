import { Capacitor } from "@capacitor/core";
import { NativeBiometric } from "@capgo/capacitor-native-biometric";

/**
 * Targeted biometric gate — called before revealing payment details or
 * exporting a report. Fail-open: on web / no enrolled biometrics → true.
 *
 * The first time the user hits a gate, we show BiometricGateSheet (a friendly
 * animated opt-in). They choose "Protect" → pref stored as "on"; "Skip" →
 * stored as "off". After that the sheet never appears again:
 *   pref "on"  → system biometric prompt fires directly
 *   pref "off" → gate returns true immediately (user opted out)
 *   pref unset → first-time sheet should be shown (handled by the component)
 */

/** Apple BiometryType constants from @capgo/capacitor-native-biometric */
const BIOMETRY_FACE_ID         = 2;
const BIOMETRY_FACE_AUTH_ANDROID = 4;

const GATE_PREF_KEY  = "dd_bio_gate_v1";       // "on" | "off" | (absent)
const APPLOCK_KEY    = "daydraft.applock";

// ── Preference helpers ─────────────────────────────────────────────────────

export type GatePref = "on" | "off" | "unset";

export function getGatePref(): GatePref {
  try {
    const v = localStorage.getItem(GATE_PREF_KEY);
    if (v === "on" || v === "off") return v;
  } catch { /* ignore */ }
  return "unset";
}

export function setGatePref(pref: "on" | "off"): void {
  try { localStorage.setItem(GATE_PREF_KEY, pref); } catch { /* ignore */ }
}

// ── App Lock helpers ────────────────────────────────────────────────────────

export function getAppLockEnabled(): boolean {
  try { return localStorage.getItem(APPLOCK_KEY) === "true"; } catch { return false; }
}

export function setAppLockEnabled(on: boolean): void {
  try {
    if (on) localStorage.setItem(APPLOCK_KEY, "true");
    else    localStorage.removeItem(APPLOCK_KEY);
  } catch { /* ignore */ }
}

// ── Biometric availability ──────────────────────────────────────────────────

export type BiometricInfo = {
  available: boolean;
  /** true = Face ID (iOS) or Face Authentication (Android), false = Touch ID / Fingerprint */
  isFace: boolean;
};

export async function getBiometricInfo(): Promise<BiometricInfo> {
  if (!Capacitor.isNativePlatform()) return { available: false, isFace: false };
  try {
    const res = await NativeBiometric.isAvailable();
    if (!res.isAvailable) return { available: false, isFace: false };
    const platform = Capacitor.getPlatform();
    const isFace =
      (platform === "ios"     && res.biometryType === BIOMETRY_FACE_ID) ||
      (platform === "android" && res.biometryType === BIOMETRY_FACE_AUTH_ANDROID);
    return { available: true, isFace };
  } catch {
    return { available: false, isFace: false };
  }
}

// ── Verification ────────────────────────────────────────────────────────────

/**
 * Verify identity for a specific gate action. Only fires the system prompt
 * if the gate pref is "on" AND biometrics are available — otherwise returns
 * true (fail-open). Call this AFTER the first-time opt-in sheet.
 */
export async function verifyBiometric(reason: string): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return true;
  if (getGatePref() === "off") return true;
  try {
    const { isAvailable } = await NativeBiometric.isAvailable();
    if (!isAvailable) return true;
    await NativeBiometric.verifyIdentity({
      reason,
      title: "Verify it's you",
      subtitle: "Protected details",
      description: reason,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Verify for App Lock specifically — always fires (pref does not apply,
 * App Lock is its own toggle). Used by AppLock.tsx.
 */
export async function verifyAppLock(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return true;
  try {
    await NativeBiometric.verifyIdentity({
      reason: "Unlock DayDraft",
      title: "App Lock",
      subtitle: "Use Face ID or Fingerprint to unlock",
      description: "Keep your daily plans secure.",
    });
    return true;
  } catch {
    return false;
  }
}
