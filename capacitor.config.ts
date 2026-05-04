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
};

export default config;
