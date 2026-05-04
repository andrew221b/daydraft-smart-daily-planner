import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("@supabase/supabase-js")) return "supabase";
            if (id.includes("@tanstack/react-query")) return "react-query";
            if (id.includes("recharts")) return "charts";
            if (id.includes("jspdf")) return "pdf";
            if (id.includes("react-router-dom")) return "router";
            if (id.includes("react-day-picker")) return "calendar";
            if (id.includes("@radix-ui")) return "radix";
            return "vendor";
          }
          if (id.includes("/src/pages/app/Tracker")) return "tracker";
          if (id.includes("/src/pages/app/DayView")) return "dayview";
          if (id.includes("/src/pages/app/Today")) return "today";
        },
      },
    },
  },
}));
