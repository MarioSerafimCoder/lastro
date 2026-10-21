import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Vite runs on loopback. The token stays in the dev server process, never in the browser bundle.
function localToken() {
  const vars = readFileSync(
    resolve(import.meta.dirname, "../../.dev.vars"),
    "utf8",
  );
  const token = vars.match(/^DEV_TOKEN=(.+)$/m)?.[1]?.trim();
  if (!token)
    throw new Error("Execute npm run setup antes de iniciar a interface.");
  return token;
}
export default defineConfig(({ command }) => ({
  plugins: [react()],
  root: import.meta.dirname,
  build: { outDir: "../../dist/web", emptyOutDir: true },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy:
      command === "serve"
        ? {
            "/api": {
              target: "http://127.0.0.1:8787",
              changeOrigin: true,
              configure(proxy) {
                proxy.on("proxyReq", (req) =>
                  req.setHeader("Authorization", `Bearer ${localToken()}`),
                );
              },
            },
          }
        : undefined,
  },
}));
