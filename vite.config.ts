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
            if (
              id.includes("/react/") ||
              id.includes("/react-dom/") ||
              id.includes("/scheduler/") ||
              id.includes("/use-sync-external-store/")
            ) return "react-core";
            if (id.includes("@supabase/supabase-js")) return "supabase";
            if (id.includes("@tanstack/react-query") || id.includes("@tanstack/query-core")) return "react-query";
            if (id.includes("recharts")) return "charts";
            if (id.includes("jspdf")) return "pdf";
            if (id.includes("react-router-dom")) return "router";
            if (id.includes("react-day-picker")) return "calendar";
            if (id.includes("@radix-ui")) return "radix";
            if (id.includes("@dnd-kit")) return "dnd";
            if (id.includes("lucide-react")) return "icons";
            if (id.includes("date-fns")) return "date";
            if (id.includes("class-variance-authority") || id.includes("clsx") || id.includes("tailwind-merge")) return "ui-utils";
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
