// Standard Vite + TanStack Start config for Railway (Node.js) deployment.
// Replaces @lovable.dev/vite-tanstack-config which targeted Cloudflare Workers.
//
// Plugins registered here (in order):
//   1. tailwindcss       — CSS build
//   2. tsconfigPaths     — @ path alias
//   3. tanstackStart     — SSR framework (file-based routing, server functions)
//   4. nitro             — server bundler; preset "node-server" → .output/server/index.mjs
//   5. viteReact         — React JSX transform
import { defineConfig, loadEnv } from "vite";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import react from "@vitejs/plugin-react";

export default defineConfig(async ({ command, mode }) => {
  // Inject VITE_* env vars so import.meta.env works in client code.
  const loadedEnv = loadEnv(mode, process.cwd(), "VITE_");
  const envDefine: Record<string, string> = {};
  for (const [key, value] of Object.entries(loadedEnv)) {
    envDefine[`import.meta.env.${key}`] = JSON.stringify(value);
  }

  const plugins = [
    tailwindcss(),
    tsconfigPaths({ projects: ["./tsconfig.json"] }),
    tanstackStart({
      server: { entry: "server" },
    }),
    // Only bundle the server during builds (nitro is a build-only plugin).
    ...(command === "build"
      ? [
          nitro({
            // "node-server" outputs a portable Node.js server to .output/server/index.mjs
            preset: "node-server",
            handlers: [
              {
                route: "/api/email-inbound",
                handler: "./server/api/email-inbound.post.ts",
                method: "POST"
              }
            ]
          }),
        ]
      : []),
    react(),
  ];

  return {
    define: envDefine,
    plugins,
  };
});
