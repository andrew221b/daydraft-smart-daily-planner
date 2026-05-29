import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "dev.daydraft.app",
  appName: "DayDraft",
  webDir: "dist",
  ios: {
    contentInset: "never",
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
      // Keep splash visible until React calls hide(). This prevents the "white flash"
      // or "black flash" between the WebView booting and React first paint.
      launchAutoHide: false,
      // Match LaunchScreen.storyboard's #090A0C so the LaunchScreen → plugin
      // splash → boot-overlay handoff has no colour flash.
      backgroundColor: "#090A0C",
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
      fadeOutDuration: 400,
    },
    Keyboard: {
      // 'none' = Capacitor does not touch the layout when the keyboard
      // opens. We manage everything via `window.visualViewport` →
      // `--keyboard-inset` CSS var (see src/lib/visualViewport.ts), so
      // 'body' resize would conflict by shrinking the document while we
      // also pad the sheet/page. Single source of truth wins.
      resize: "none",
      resizeOnFullScreen: true,
    },
  },
};

export default config;
