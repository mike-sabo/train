import { defineConfig } from "vite";
import { readFileSync, writeFileSync } from "node:fs";
import { themes } from "./shared/themes.js";
import { themeBootstrap } from "./src/theme.js";
const base = process.env.VITE_BASE_PATH || "/workout-plan/";
if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(base))
  throw new Error("VITE_BASE_PATH must be / or a path with a trailing slash.");
if (
  process.env.VITE_API_URL &&
  !/^https:\/\/[a-z0-9-]+\.supabase\.co\/functions\/v1\/train-together$/.test(
    process.env.VITE_API_URL,
  )
)
  throw new Error(
    "VITE_API_URL must be the HTTPS Train Together Supabase function URL.",
  );
export default defineConfig({
  base,
  build: { outDir: "dist" },
  plugins: [
    {
      name: "train-together-theme",
      transformIndexHtml() {
        return [
          { tag: "script", children: themeBootstrap(themes), injectTo: "head" },
        ];
      },
    },
    {
      name: "train-together-manifest",
      apply: "build",
      closeBundle() {
        const manifest = JSON.parse(
          readFileSync("public/manifest.webmanifest", "utf8"),
        );
        Object.assign(manifest, { id: base, start_url: base, scope: base });
        writeFileSync(
          "dist/manifest.webmanifest",
          JSON.stringify(manifest, null, 2) + "\n",
        );
      },
    },
  ],
});
