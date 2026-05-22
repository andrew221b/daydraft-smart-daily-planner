import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "dev.daydraft.app",
  appName: "DayDraft",
  webDir: "dist",
  ios: {
    contentInset: "automatic",
    /** Mobile content mode keeps layout predictable on iPad-class devices. */
    preferredContentMode: "mobile",
  },
  plugins: {
    /**
     * Splash screen behaviour. Default Capacitor splash auto-hides the
     * moment WKWebView reports first paint — which happens *before*
     * React has mounted, leaving a black gap. We keep the splash up
     * until the app explicitly calls `SplashScreen.hide()` once the
     * shell has rendered, then fade it out smoothly.
     */
    SplashScreen: {
      // Failsafe duration. The app calls `SplashScreen.hide()` right after
      // React's first paint so the actual visible duration is more like
      // 600–1200ms on a real device. The 3s value just means "if React
      // never boots, don't strand the user on a frozen logo forever".
      launchShowDuration: 3000,
      launchAutoHide: false,
      // No backgroundColor — the LaunchScreen.storyboard uses
      // systemBackgroundColor, which adapts to the user's iOS appearance
      // (white in light mode, near-black in dark mode). Setting an
      // explicit colour here would override the storyboard and flash a
      // mismatched colour against the web app's first paint.
      iosSpinnerStyle: "small",
      splashFullScreen: true,
      splashImmersive: true,
      fadeOutDuration: 220,
    },
  },
};

export default config;
