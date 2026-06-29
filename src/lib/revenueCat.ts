import { Capacitor } from "@capacitor/core";
import {
  Purchases,
  LOG_LEVEL,
  INTRO_ELIGIBILITY_STATUS,
  type PurchasesPackage,
  type CustomerInfo,
} from "@revenuecat/purchases-capacitor";

/**
 * RevenueCat bridge — drives native in-app purchases (App Store / Play Billing).
 *
 * Crash-proof facade, mirroring liveActivity.ts: every call is a no-op on web
 * and on native when no API key is configured, and native failures are
 * swallowed so a billing hiccup can never break the app shell.
 *
 * Source-of-truth split:
 *   • Client UI trusts RevenueCat's entitlement for INSTANT Pro reflection
 *     after a purchase/restore (see getRcPro / the "dd-rc-pro" event).
 *   • The server trusts the `subscriptions` table, which the RevenueCat
 *     webhook keeps in sync (supabase/functions/revenuecat-webhook).
 *
 * Required env (public SDK keys — safe in the client bundle):
 *   VITE_RC_IOS_KEY      appl_…   (RevenueCat → Project → API keys → Apple)
 *   VITE_RC_ANDROID_KEY  goog_…   (… → Google)
 *   VITE_RC_ENTITLEMENT  entitlement id (defaults to "pro")
 */

const tag = "[revenueCat]";

const ENTITLEMENT = (import.meta.env.VITE_RC_ENTITLEMENT as string) || "pro";
const IOS_KEY = import.meta.env.VITE_RC_IOS_KEY as string | undefined;
const ANDROID_KEY = import.meta.env.VITE_RC_ANDROID_KEY as string | undefined;

let configured = false;
/** Last known Pro state from RevenueCat (client-side, immediate). */
let rcProStatus = false;

/** Whether RevenueCat is configured and usable on this device. */
export function revenueCatReady(): boolean {
  return configured;
}

/** Latest client-side Pro flag from RevenueCat (false until first read). */
export function getRcPro(): boolean {
  return rcProStatus;
}

function platformKey(): string | null {
  const p = Capacitor.getPlatform();
  if (p === "ios") return IOS_KEY || null;
  if (p === "android") return ANDROID_KEY || null;
  return null;
}

function isProFrom(info: CustomerInfo): boolean {
  return !!info.entitlements.active[ENTITLEMENT];
}

/** Push the latest Pro state to the app (module store + a window event the
 *  entitlement hook listens to so the UI flips instantly). */
function broadcastPro(isPro: boolean): void {
  rcProStatus = isPro;
  try {
    window.dispatchEvent(new CustomEvent("dd-rc-pro", { detail: isPro }));
  } catch {
    /* ignore */
  }
}

/**
 * Configure RevenueCat once at startup. No-op on web / when no key is set.
 * Registers a single customer-info listener so renewals, expirations and
 * cross-device changes flip the UI without polling.
 */
export async function configureRevenueCat(): Promise<void> {
  if (configured) return;
  if (!Capacitor.isNativePlatform()) return;
  const apiKey = platformKey();
  if (!apiKey) {
    console.warn(`${tag} no API key for ${Capacitor.getPlatform()} — purchases disabled`);
    return;
  }
  try {
    if (import.meta.env.DEV) {
      await Purchases.setLogLevel({ level: LOG_LEVEL.DEBUG });
    }
    await Purchases.configure({ apiKey });
    configured = true;

    // One global listener — avoids per-component subscriptions leaking.
    await Purchases.addCustomerInfoUpdateListener((info: CustomerInfo) => {
      broadcastPro(isProFrom(info));
    });

    // Seed the initial state.
    try {
      const { customerInfo } = await Purchases.getCustomerInfo();
      broadcastPro(isProFrom(customerInfo));
    } catch {
      /* ignore — listener will catch up */
    }

    // Warm the offerings cache while the app is idle. The FIRST getOfferings()
    // does a native round-trip + JSON parse on the main thread; paying that
    // here (not on the user's first paywall tap) removes the one-time hitch
    // when the upgrade sheet opens, since usePlanPrices + annualTrialEligible
    // then read RevenueCat's in-memory cache instead of a cold fetch.
    const warmOfferings = () => { void Purchases.getOfferings().catch(() => {}); };
    if (typeof requestIdleCallback !== "undefined") requestIdleCallback(warmOfferings, { timeout: 4000 });
    else setTimeout(warmOfferings, 1500);
  } catch (e) {
    console.error(`${tag} configure failed`, e);
  }
}

/** Tie purchases to the Supabase user id so the webhook can map app_user_id. */
export async function identifyRevenueCat(userId: string): Promise<void> {
  if (!configured || !userId) return;
  try {
    const { customerInfo } = await Purchases.logIn({ appUserID: userId });
    broadcastPro(isProFrom(customerInfo));
  } catch (e) {
    console.warn(`${tag} logIn failed`, e);
  }
}

/** Reset to an anonymous RevenueCat id on sign-out. */
export async function logoutRevenueCat(): Promise<void> {
  if (!configured) return;
  try {
    await Purchases.logOut();
    broadcastPro(false);
  } catch {
    /* already anonymous — ignore */
  }
}

export type PurchaseOutcome = "purchased" | "cancelled" | "unavailable" | "error";

/** Resolve the package for a plan from the current offering. */
function packageForPlan(
  offeringAnnual: PurchasesPackage | null,
  offeringMonthly: PurchasesPackage | null,
  offeringWeekly: PurchasesPackage | null,
  plan: "weekly" | "monthly" | "annual",
): PurchasesPackage | null {
  if (plan === "annual") return offeringAnnual;
  if (plan === "monthly") return offeringMonthly;
  return offeringWeekly;
}

/**
 * Run the native purchase sheet for a plan. Returns an outcome the caller can
 * react to; on success the global listener has already flipped the UI to Pro.
 */
export async function purchasePlan(
  plan: "weekly" | "monthly" | "annual",
): Promise<{ outcome: PurchaseOutcome; isPro: boolean }> {
  if (!configured) return { outcome: "unavailable", isPro: false };
  try {
    const offerings = await Purchases.getOfferings();
    const current = offerings.current;
    if (!current) return { outcome: "unavailable", isPro: false };

    const pkg = packageForPlan(current.annual, current.monthly, current.weekly, plan);
    if (!pkg) return { outcome: "unavailable", isPro: false };

    const res = await Purchases.purchasePackage({ aPackage: pkg });
    const isPro = isProFrom(res.customerInfo);
    broadcastPro(isPro);
    return { outcome: "purchased", isPro };
  } catch (e) {
    if ((e as { userCancelled?: boolean })?.userCancelled) {
      return { outcome: "cancelled", isPro: false };
    }
    console.error(`${tag} purchase failed`, e);
    return { outcome: "error", isPro: false };
  }
}

export type PlanPrice = { priceString: string; price: number; currencyCode: string };
export type PlanPrices = Partial<Record<"weekly" | "monthly" | "annual", PlanPrice>>;

/**
 * Localized store prices for the current offering, in the user's App Store /
 * Play region currency (e.g. "€59,99", "₴2 499", "₹4,499"). The store
 * auto-localizes from the base price you set; we surface the real string so the
 * paywall never shows a hardcoded "$" to a non-US user (which also fails Apple
 * 3.1.2). Returns {} on web / when RC isn't configured / no offering — callers
 * fall back to their default labels.
 */
export async function getLocalizedPrices(): Promise<PlanPrices> {
  if (!configured) return {};
  try {
    const offerings = await Purchases.getOfferings();
    const current = offerings.current;
    if (!current) return {};
    const grab = (pkg: PurchasesPackage | null): PlanPrice | undefined =>
      pkg
        ? {
            priceString: pkg.product.priceString,
            price: pkg.product.price,
            currencyCode: pkg.product.currencyCode,
          }
        : undefined;
    return {
      annual: grab(current.annual),
      monthly: grab(current.monthly),
      weekly: grab(current.weekly),
    };
  } catch (e) {
    console.warn(`${tag} getLocalizedPrices failed`, e);
    return {};
  }
}

/**
 * Whether the annual free-trial offer should still be advertised to THIS user.
 *
 * iOS reports real eligibility — a user who already burned the 3-day trial
 * comes back INELIGIBLE, so we stop promising "3 days free" (the App Store
 * wouldn't honour it and it reads as a lie). Android always returns UNKNOWN
 * (Google only decides at purchase time), so there we keep showing it.
 *
 * Rule: hide ONLY when we positively know it won't apply — INELIGIBLE, or the
 * product carries no intro offer at all. UNKNOWN / ELIGIBLE → show. Fail-safe
 * to `true` on web / unconfigured / error so a real offer is never silently
 * dropped (matches the previous always-on behaviour).
 */
export async function annualTrialEligible(): Promise<boolean> {
  if (!configured) return true;
  try {
    const offerings = await Purchases.getOfferings();
    const pkg = offerings.current?.annual;
    if (!pkg) return true;

    // Android: checkTrialOrIntroductoryPriceEligibility ALWAYS returns UNKNOWN
    // (Google decides only at purchase), so it can't tell us anything. But
    // Google Play already filters offers by eligibility — when the base plan's
    // free-trial offer is gated to "new customer acquisition", a returning
    // customer simply doesn't get it back, so RevenueCat's defaultOption has NO
    // freePhase. Presence of a freePhase is therefore the real eligibility
    // signal: it's there iff this user can still start the trial.
    if (Capacitor.getPlatform() === "android") {
      return !!pkg.product.defaultOption?.freePhase;
    }

    // iOS: StoreKit reports real per-user eligibility. Hide the trial only when
    // we positively know it won't apply (INELIGIBLE / no intro offer); UNKNOWN
    // or ELIGIBLE → show.
    const productId = pkg.product.identifier;
    const elig = await Purchases.checkTrialOrIntroductoryPriceEligibility({
      productIdentifiers: [productId],
    });
    const status = elig[productId]?.status;
    return (
      status !== INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_INELIGIBLE &&
      status !== INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_NO_INTRO_OFFER_EXISTS
    );
  } catch (e) {
    console.warn(`${tag} annual trial eligibility check failed`, e);
    return true;
  }
}

/**
 * The store's subscription-management URL for the current customer — App Store
 * subscriptions on iOS, Google Play subscriptions on Android. RevenueCat fills
 * it in from the active store transaction. Returns `null` when there's no
 * store-managed subscription (e.g. a manually-granted entitlement), so the
 * caller can fall back to the platform's generic subscriptions page.
 */
export async function getManagementURL(): Promise<string | null> {
  if (!configured) return null;
  try {
    const { customerInfo } = await Purchases.getCustomerInfo();
    return customerInfo.managementURL ?? null;
  } catch (e) {
    console.warn(`${tag} getManagementURL failed`, e);
    return null;
  }
}

/** Restore prior purchases (required by App Store review). */
export async function restorePurchases(): Promise<{ isPro: boolean; ok: boolean }> {
  if (!configured) return { isPro: false, ok: false };
  try {
    const { customerInfo } = await Purchases.restorePurchases();
    const isPro = isProFrom(customerInfo);
    broadcastPro(isPro);
    return { isPro, ok: true };
  } catch (e) {
    console.warn(`${tag} restore failed`, e);
    return { isPro: false, ok: false };
  }
}
