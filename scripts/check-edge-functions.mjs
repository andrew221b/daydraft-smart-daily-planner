/**
 * QA gate for Supabase edge functions: bundle every function with esbuild and
 * fail on any ERROR. Catches the class of bugs nothing else validates before
 * deploy — syntax errors, const-reassignment (the yesterday-debrief `const
 * mode` incident: Deno refuses to load the module, the function 500s on every
 * call), duplicate declarations, broken `_shared` imports.
 *
 * Deliberately NOT type-checking (that would need Deno); esbuild-level errors
 * are exactly the "function won't even load" class we've been bitten by.
 *
 * Usage: npm run check:functions   (run before `supabase functions deploy`)
 */
import { build } from "esbuild";
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const FUNCTIONS_DIR = "supabase/functions";

const entries = readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
  .map((d) => ({ name: d.name, entry: join(FUNCTIONS_DIR, d.name, "index.ts") }))
  .filter(({ entry }) => existsSync(entry));

let failed = 0;
for (const { name, entry } of entries) {
  try {
    await build({
      entryPoints: [entry],
      bundle: true,
      write: false,
      platform: "neutral",
      format: "esm",
      logLevel: "silent",
      // Deno-scheme + remote imports are the runtime's job, not the gate's.
      external: ["https://*", "npm:*", "jsr:*", "node:*"],
    });
    console.log(`✅ ${name}`);
  } catch (err) {
    failed += 1;
    const first = err?.errors?.[0];
    const where = first?.location ? ` (${first.location.file}:${first.location.line})` : "";
    console.error(`❌ ${name}${where}: ${first?.text || err?.message || err}`);
  }
}

console.log(failed ? `\n${failed} function(s) FAILED to compile` : `\nAll ${entries.length} functions compile cleanly`);
process.exit(failed ? 1 : 0);
