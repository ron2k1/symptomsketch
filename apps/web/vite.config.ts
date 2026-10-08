import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));

// Local API the dev server and `vite preview` proxy /api to. Defaults to :3030 (3000 is often taken by other local dev servers);
// SS_API_PORT lets a second local stack (other port) run without editing this file.
const apiTarget = `http://127.0.0.1:${process.env.SS_API_PORT ?? "3030"}`;
const proxy = { "/api": { target: apiTarget, changeOrigin: false } };

// js-sdk 3.1 loads its client with import("./wasm/reactor_wasm.js") and fetches the .wasm relative to
// import.meta.url. pnpm keeps @reactor-team/js-sdk out of apps/web, so reach it through
// @reactor-models/x2 (docs/providers/reactor-x2.md section 2).
function reactorWasmDir(): string {
  const x2Entry = createRequire(path.join(here, "package.json")).resolve("@reactor-models/x2");
  const sdkEntry = createRequire(x2Entry).resolve("@reactor-team/js-sdk");
  return path.join(path.dirname(sdkEntry), "wasm");
}

// Build only: emit the wasm loader + binary at dist/assets/wasm/, where the bundled SDK requests them.
function reactorWasmAssets(): Plugin {
  return {
    name: "reactor-wasm-assets",
    apply: "build",
    generateBundle() {
      const dir = reactorWasmDir();
      for (const file of ["reactor_wasm.js", "reactor_wasm_bg.wasm"]) {
        const source = fs.readFileSync(path.join(dir, file));
        this.emitFile({ type: "asset", fileName: `assets/wasm/${file}`, source });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), reactorWasmAssets()],
  resolve: {
    alias: { "@": path.resolve(here, "./src") },
  },
  optimizeDeps: {
    // Dev: pre-bundling would move the SDK's relative wasm import to .vite/deps and 404 it.
    exclude: ["@reactor-models/x2", "@reactor-models/vidu-s2-avatar", "@reactor-team/js-sdk"],
    // The excluded ESM imports CJS deps directly; pre-bundle them or their named exports break.
    include: [
      "react",
      "react/jsx-runtime",
      "@reactor-models/x2 > @reactor-team/js-sdk > awaitqueue",
    ],
  },
  server: {
    port: 5173,
    strictPort: true,
    host: "127.0.0.1",
    proxy,
  },
  preview: {
    host: "127.0.0.1",
    proxy,
  },
});
