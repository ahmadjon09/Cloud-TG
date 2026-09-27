// server.js — HTTP entry point: static shell, REST API, admin API and media streaming
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

import {
  compression,
  securityHeaders,
  rateLimit,
  requireAdmin,
  notFound,
  errorHandler
} from "./http/middleware.js";
import { staticHandler, fileHandler } from "./http/static.js";
import { pageHandler, getBuildHash, computeBuildHash } from "./http/pages.js";
import { apiRouter } from "./http/routes/api.js";
import { mediaRouter } from "./http/routes/media.js";
import { adminRouter } from "./http/routes/admin.js";
import { webAppAuthMiddleware, optionalWebAppAuth } from "./authWebApp.js";
import { LANGUAGES, webBundle } from "./utils/i18n.js";
import { limiters, sweepAll as sweepLimiters } from "./utils/rateLimit.js";
import { sweepAll as sweepCaches } from "./utils/cache.js";
import { getDriver } from "./db.js";
import { version } from "../i.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const LOCALES_DIR = path.join(__dirname, "locales");

const startedAt = Date.now();

/** Web bundles are rebuilt on demand and cached (they only change on deploy). */
const bundleCache = new Map();
function localeBundle(lang) {
  const cached = bundleCache.get(lang);
  if (cached) return cached;
  const bundle = { v: version, ...webBundle(lang) };
  const body = JSON.stringify(bundle);
  bundleCache.set(lang, body);
  return body;
}

export function startServer() {
  const app = express();
  const dev = process.env.NODE_ENV !== "production";

  computeBuildHash(PUBLIC_DIR);

  app.set("trust proxy", true);
  app.set("etag", false); // we set ETags ourselves where it matters
  app.disable("x-powered-by");

  app.use(securityHeaders({ dev }));
  app.use(compression());
  app.use(express.json({ limit: "512kb" }));
  app.use(express.urlencoded({ extended: false, limit: "512kb" }));

  // ---------------- health ----------------
  app.get("/hello", (_req, res) => res.type("text/plain").send("Hello!"));
  app.get("/health", (_req, res) =>
    res.json({
      ok: true,
      version,
      driver: getDriver(),
      uptime: Math.floor((Date.now() - startedAt) / 1000),
      telegram: Boolean(process.env.BOT_TOKEN),
      demo: process.env.DEMO_MODE === "true"
    })
  );

  // ---------------- static assets ----------------
  app.use(staticHandler("/public", PUBLIC_DIR));

  app.get("/locales/:lang.json", (req, res) => {
    const lang = String(req.params.lang).replace(/\.json$/, "");
    if (!LANGUAGES.includes(lang)) return res.status(404).json({ error: "Unknown language" });
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("cache-control", "public, max-age=3600, must-revalidate");
    res.send(localeBundle(lang));
  });

  app.get("/manifest.webmanifest", (req, res, next) =>
    fileHandler(path.join(PUBLIC_DIR, "manifest.webmanifest"), {
      cacheControl: "public, max-age=3600",
      render: body =>
        body
          .replace(/\{\{VERSION\}\}/g, version)
          .replace(/\{\{BUILD\}\}/g, getBuildHash())
    })(req, res, next)
  );

  app.get("/sw.js", (req, res, next) =>
    fileHandler(path.join(PUBLIC_DIR, "sw.js"), {
      cacheControl: "no-cache",
      render: body => body.replace(/\{\{BUILD\}\}/g, getBuildHash())
    })(req, res, next)
  );

  app.get("/offline", (req, res, next) =>
    fileHandler(path.join(PUBLIC_DIR, "offline.html"), { cacheControl: "no-store" })(req, res, next)
  );

  // ---------------- HTML shells ----------------
  app.get(
    "/app",
    optionalWebAppAuth,
    pageHandler(path.join(PUBLIC_DIR, "app.html"), { title: "Cloud" })
  );
  app.get(
    "/admin",
    optionalWebAppAuth,
    pageHandler(path.join(PUBLIC_DIR, "admin.html"), { title: "Cloud · Admin" })
  );
  app.get("/", (_req, res) => res.redirect(302, "/app"));

  // ---------------- API ----------------
  const api = express.Router();
  api.use(rateLimit(limiters.api, req => req.tgUser?.id || req.ip));

  // Media is authenticated by its own short-lived signed token (no initData needed)
  api.use(mediaRouter());

  // Everything below requires a valid Telegram WebApp session
  api.use(webAppAuthMiddleware);
  api.use(rateLimit(limiters.auth, req => `auth:${req.tgUser?.id || req.ip}`, { max: 600 }));

  api.use(apiRouter());

  app.use("/api", api);

  // Admin API lives under its own prefix so paths can never collide with the app API
  const admin = express.Router();
  admin.use(rateLimit(limiters.admin, req => req.tgUser?.id || req.ip));
  admin.use(webAppAuthMiddleware);
  admin.use(requireAdmin);
  admin.use(adminRouter());
  app.use("/api/admin", admin);

  // ---------------- fallback ----------------
  app.use(notFound);
  app.use(errorHandler);

  // housekeeping: drop expired cache entries and idle rate-limit buckets
  const sweepTimer = setInterval(() => {
    try {
      sweepCaches();
      sweepLimiters();
    } catch {
      /* ignore */
    }
  }, 5 * 60_000);
  sweepTimer.unref?.();

  const port = Number(process.env.PORT || 5000);
  const host = process.env.HOST || "0.0.0.0";
  const server = app.listen(port, host, () => {
    console.log(`🌐 HTTP listening on http://${host}:${port}`);
    console.log(`   app:   /app      admin: /admin      health: /health`);
    if (process.env.DEMO_MODE === "true") console.log("   ⚠️  DEMO_MODE is ON — never enable this in production");
  });

  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 70_000;

  return { app, server };
}

/** Utility used by the bot to know whether the web app is reachable. */
export function publicFileExists(rel) {
  return fs.existsSync(path.join(PUBLIC_DIR, rel));
}
