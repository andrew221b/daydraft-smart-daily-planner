import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "dev.daydraft.app",
  appName: "DayDraft",
  webDir: "dist",
  ios: {
    contentInset: "automatic",
  },
};

export default config;
