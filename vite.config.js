import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { resolve, join } from "path";
import { createReadStream, statSync } from "fs";
import { resolvePaths } from "./server/lib/paths.js";

// /assets/(cards|avatars)/<nome> com nome restrito (sem barras nem "..").
const DATA_ASSET_RE = /^\/assets\/(cards|avatars)\/([A-Za-z0-9_-]+\.(jpg|jpeg|png|webp))$/;
const IMAGE_TYPES = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

/**
 * Em desenvolvimento, serve as imagens enviadas em runtime (DATA_DIR/assets)
 * antes do public/ do Vite — a mesma ordem do servidor em producao. Se o
 * arquivo nao existir em DATA_DIR, segue para o Vite (public/).
 */
function dataDirAssets({ CARDS_IMG_DIR, AVATARS_DIR }) {
  return {
    name: "forja-data-dir-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.method !== "GET" && req.method !== "HEAD") return next();
        const match = (req.url || "").split("?")[0].match(DATA_ASSET_RE);
        if (!match) return next();

        const file = join(match[1] === "cards" ? CARDS_IMG_DIR : AVATARS_DIR, match[2]);
        let stats;
        try {
          stats = statSync(file);
        } catch {
          return next();
        }
        if (!stats.isFile()) return next();

        res.statusCode = 200;
        res.setHeader("Content-Type", IMAGE_TYPES[match[3]]);
        res.setHeader("Content-Length", String(stats.size));
        res.setHeader("Cache-Control", "no-cache");
        if (req.method === "HEAD") return res.end();
        createReadStream(file)
          .on("error", (err) => {
            if (!res.headersSent) return next(err);
            res.destroy(err);
          })
          .pipe(res);
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Mesma regra do servidor: DATA_DIR do ambiente/.env, padrao server/.
  const paths = resolvePaths(loadEnv(mode, process.cwd(), ""));

  return {
    plugins: [react(), dataDirAssets(paths)],
    base: "/",
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, "index.html"),
          admin: resolve(__dirname, "admin.html"),
        },
      },
    },
    server: {
      proxy: {
        "/api": {
          target: "http://localhost:3001",
          changeOrigin: true,
        },
      },
    },
  };
});
