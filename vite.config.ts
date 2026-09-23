import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createHandler } from "./server/api.js";
import { resolveRepoRoot } from "./server/git.js";
import { createProgressStore } from "./server/progress.js";

const DEFAULT_DEV_CONTENT_DIR = "skill/teachme-authoring/examples/.teachme";

/**
 * Mounts the `server/api.js` request handler as Vite dev-server middleware,
 * so `/api/*` and `/content/*` work under `vite dev` without a separate
 * server. Content dir defaults to the example content; override with
 * `TEACHME_DIR`.
 */
function teachmeDevMiddleware(): Plugin {
  return {
    name: "teachme-dev-middleware",
    configureServer(server) {
      const contentDir = path.resolve(process.env.TEACHME_DIR ?? DEFAULT_DEV_CONTENT_DIR);
      const repoRoot = resolveRepoRoot(contentDir);
      const store = createProgressStore();
      const handler = createHandler({ contentDir, repoRoot, store });
      server.middlewares.use(handler);
    },
  };
}

export default defineConfig({
  plugins: [react(), teachmeDevMiddleware()],
});
