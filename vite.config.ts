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
//   • `pdf`         — jspdf + html2canvas are massive (400kB+) and only used
//                     for export. Lazy-loaded at the call site; this entry
//                     just ensures the split chunk stays stable across
//                     deploys so it caches.
//   • `date`        — date-fns is used widely; one shared chunk avoids
//                     duplicate copies across screen bundles.
//   • `motion`      — framer-motion renders on first paint (Shell/TabBar) AND
//                     ~22 other files. One shared chunk dedupes it instead of
//                     leaking copies into every page bundle, and caches across
//                     deploys.
const splitVendor = (id: string): string | undefined => {
  if (!id.includes("node_modules")) return undefined;
  if (/[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) return "react";
  if (/[\\/]@supabase[\\/]/.test(id)) return "supabase";
  if (/[\\/]@tanstack[\\/]/.test(id)) return "query";
  if (/[\\/]@radix-ui[\\/]/.test(id)) return "radix";
  if (/[\\/]@dnd-kit[\\/]/.test(id)) return "dnd";
  if (/[\\/]jspdf[\\/]/.test(id) || /[\\/]jspdf-autotable[\\/]/.test(id) || /[\\/]html2canvas[\\/]/.test(id)) return "pdf";
  if (/[\\/]date-fns[\\/]/.test(id)) return "date";
  if (/[\\/]lucide-react[\\/]/.test(id)) return "icons";
  if (/[\\/]framer-motion[\\/]/.test(id) || /[\\/]motion-dom[\\/]/.test(id) || /[\\/]motion-utils[\\/]/.test(id)) return "motion";
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
    // By default Vite emits `<link rel="modulepreload">` for every chunk
    // statically reachable from the entry — including ones that only run
    // behind a dynamic `import()`. That was forcing every cold start to
    // download the 650 kB `pdf` chunk (jsPDF + html2canvas) and a 150 kB
    // `index.es` chunk even though users almost never export a PDF. We
    // filter those heavy on-demand chunks out so cold start stays lean.
    modulePreload: {
      resolveDependencies: (_filename, deps) =>
        deps.filter((d) => !/\/(pdf|index\.es|purify\.es)-/.test(d)),
    },
    rollupOptions: {
      output: {
        manualChunks: splitVendor,
      },
    },
  },
}));
