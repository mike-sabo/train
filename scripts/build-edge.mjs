import { build } from "esbuild";
await build({
  entryPoints: ["cloud/edge-entry.js"],
  outfile: "supabase/functions/train-together/index.js",
  bundle: true,
  platform: "neutral",
  format: "esm",
  target: "es2022",
  minify: true,
});
console.log("Supabase Edge Function built.");
