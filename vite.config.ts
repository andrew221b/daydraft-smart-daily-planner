import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// Vendor split:
//   • `react`       — react, react-dom, react-router. Loaded on every page,
//                     so caching it across deploys is the single biggest win.
//   • `supabase`    — auth + db client. Stable across deploys.
//   • `radix`       — the handful of Radix primitives the app still uses.
//   • `dnd`         — only DayView pulls dnd-kit; ship it once.
//   • `query`       — @tanstack/react-query, used everywhere data is fetched.
// Recharts, jspdf, and html2canvas already chunk themselves through React.lazy
// at the route level, so no entry here.
const splitVendor = (id: string): string | undefined => {
  if (!id.includes("node_modules")) return undefined;
  if (/[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) return "react";
  if (/[\\/]@supabase[\\/]/.test(id)) return "supabase";
  if (/[\\/]@tanstack[\\/]/.test(id)) return "query";
  if (/[\\/]@radix-ui[\\/]/.test(id)) return "radix";
  if (/[\\/]@dnd-kit[\\/]/.test(id)) return "dnd";
  return undefined;
};

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
    // Lift the warning from 500kB → 700kB so legitimate chunks like the
    // jsPDF route bundle don't spam every CI log. The actual main bundle
    // sits well under this after splitting.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: splitVendor,
      },
    },
  },
}));
