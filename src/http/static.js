// http/static.js — dependency-free static serving with ETag, gzip cache and
// per-build versioned module URLs
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import crypto from "crypto";
import zlib from "zlib";
import { getBuildHash } from "./pages.js";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".map": "application/json; charset=utf-8"
};

export function mimeFor(file) {
  return MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
}

/**
 * In-memory store of compressed file bodies.
 * Static assets are tiny and change rarely — serving them from RAM
 * removes disk I/O and re-compression from every single request.
 */
class AssetStore {
  constructor({ maxBytes = 24 * 1024 * 1024 } = {}) {
    this.maxBytes = maxBytes;
    this.entries = new Map(); // filePath -> { stat, etag, gzip, deflate, raw }
    this.bytes = 0;
  }

  async load(filePath, { compress = true, transform = null, salt = "" } = {}) {
    try {
      const stat = await fsp.stat(filePath);
      const cached = this.entries.get(filePath);
      if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size && cached.salt === salt) return cached;

      let raw = await fsp.readFile(filePath);
      if (transform) raw = Buffer.from(transform(raw.toString("utf8"), filePath), "utf8");
      const type = mimeFor(filePath);
      const isText = /^(text\/|application\/(javascript|json|manifest)|image\/svg)/i.test(type);
      const entry = {
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        salt,
        type,
        etag: `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}${salt ? "-" + salt : ""}"`,
        raw,
        gzip: compress && isText && raw.length > 400 ? zlib.gzipSync(raw, { level: 9 }) : null,
        deflate: compress && isText && raw.length > 400 ? zlib.deflateSync(raw, { level: 9 }) : null
      };

      const cost = (entry.raw?.length || 0) + (entry.gzip?.length || 0) + (entry.deflate?.length || 0);
      if (this.bytes + cost > this.maxBytes) {
        // simple FIFO eviction
        const firstKey = this.entries.keys().next().value;
        if (firstKey) {
          const old = this.entries.get(firstKey);
          this.bytes -= (old.raw?.length || 0) + (old.gzip?.length || 0) + (old.deflate?.length || 0);
          this.entries.delete(firstKey);
        }
      }
      this.entries.set(filePath, entry);
      this.bytes += cost;
      return entry;
    } catch {
      return null;
    }
  }

  invalidate() {
    this.entries.clear();
    this.bytes = 0;
  }

  stats() {
    return { files: this.entries.size, bytes: this.bytes };
  }
}

const stores = new Map();
function storeFor(key) {
  if (!stores.has(key)) stores.set(key, new AssetStore());
  return stores.get(key);
}

function sendAsset(req, res, entry, { cacheable }) {
  const accept = req.headers["accept-encoding"] || "";
  res.setHeader("content-type", entry.type);
  res.setHeader("etag", entry.etag);
  res.setHeader("vary", "accept-encoding");
  // CODE is always no-store: a stale icon()/el() bundle renders dead SVG
  // markup, so nothing may reuse it. Images/fonts keep a short TTL.
  res.setHeader(
    "cache-control",
    cacheable ? "public, max-age=300, must-revalidate" : "no-store"
  );

  if (entry.etag && req.headers["if-none-match"] === entry.etag) {
    res.status(304).end();
    return;
  }

  if (/\bgzip\b/.test(accept) && entry.gzip) {
    res.setHeader("content-encoding", "gzip");
    res.setHeader("content-length", entry.gzip.length);
    return res.end(entry.gzip);
  }
  if (/\bdeflate\b/.test(accept) && entry.deflate) {
    res.setHeader("content-encoding", "deflate");
    res.setHeader("content-length", entry.deflate.length);
    return res.end(entry.deflate);
  }
  res.setHeader("content-length", entry.raw.length);
  res.end(entry.raw);
}

/**
 * @param {string} urlPrefix  e.g. "/public"
 * @param {string} rootDir     absolute directory on disk
 */
/**
 * Rewrite ES-module import specifiers so EVERY module URL changes per build:
 *   import { icon } from "./icons.js"
 *     → import { icon } from "./icons.js?v=a1b2c3d4e5"
 * No cache layer (browser, service worker, proxy) can then serve a module
 * that doesn't match the HTML it came with.
 */
function versionModuleImports(body, _filePath) {
  const v = getBuildHash();
  return body.replace(
    /(\bfrom\s+|import\s+)["'](\.[^"']+\.m?js)["']/g,
    (_m, head, spec) => `${head}"${spec}?v=${v}"`
  );
}

export function staticHandler(urlPrefix, rootDir, { immutable = false } = {}) {
  const store = storeFor(rootDir);
  const prefix = urlPrefix.endsWith("/") ? urlPrefix.slice(0, -1) : urlPrefix;

  return async function serve(req, res, next) {
    if (!req.path.startsWith(prefix + "/") && req.path !== prefix) return next();
    if (req.method !== "GET" && req.method !== "HEAD") return next();

    const rel = decodeURIComponent(req.path.slice(prefix.length).replace(/^\/+/, ""));
    if (!rel || rel.includes("\0")) return next();

    const filePath = path.resolve(rootDir, rel);
    if (!filePath.startsWith(path.resolve(rootDir) + path.sep)) return next(); // traversal guard

    const isJs = /\.m?js$/i.test(filePath);
    const entry = await store.load(filePath, {
      transform: isJs ? versionModuleImports : null,
      salt: isJs ? getBuildHash() : ""
    });
    if (!entry) return next();

    const isCode = /\.(m?js|css|json|webmanifest)$/i.test(filePath);
    // code → no-store (always fresh); images/fonts → short TTL, fine to reuse
    sendAsset(req, res, entry, { cacheable: !isCode });
  };
}

/** Serve one specific file (used for /app, /admin, /manifest.webmanifest, /sw.js). */
export function fileHandler(filePath, { cacheControl = "no-store", render } = {}) {
  const store = storeFor(path.dirname(filePath));
  return async function serve(req, res, next) {
    const entry = await store.load(filePath);
    if (!entry) return next();
    let body = entry.raw;
    let etag = entry.etag;
    if (typeof render === "function") {
      const out = render(body.toString("utf8"), req, res);
      body = Buffer.from(out, "utf8");
      etag = `W/"${crypto.createHash("sha1").update(body).digest("hex").slice(0, 16)}"`;
      entry.type = mimeFor(filePath);
    }
    if (req.headers["if-none-match"] === etag) {
      res.status(304).end();
      return;
    }
    res.setHeader("content-type", entry.type);
    res.setHeader("etag", etag);
    res.setHeader("cache-control", cacheControl);
    if (req.method === "HEAD") return res.end();
    res.end(body);
  };
}

export function assetVersion(relPath) {
  try {
    const stat = fs.statSync(relPath);
    return `${Math.floor(stat.mtimeMs).toString(36)}${stat.size.toString(36)}`;
  } catch {
    return "1";
  }
}

export function clearAssetStores() {
  let n = 0;
  for (const s of stores.values()) {
    n += s.entries.size;
    s.invalidate();
  }
  return n;
}

export function assetStats() {
  return [...stores.values()].map(s => s.stats());
}
