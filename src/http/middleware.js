// http/middleware.js — security, compression, rate limiting, error handling
import zlib from "zlib";

const MIN_COMPRESS = 700;

/**
 * gzip/deflate for JSON API responses only.
 * Binary/media responses are never buffered — streaming stays untouched.
 */
export function compression() {
  return (req, res, next) => {
    const accept = req.headers["accept-encoding"] || "";
    const encoding = /\bgzip\b/.test(accept) ? "gzip" : /\bdeflate\b/.test(accept) ? "deflate" : null;
    if (!encoding || req.headers["x-no-compression"]) return next();

    const originalJson = res.json.bind(res);
    res.json = function (payload) {
      const body = JSON.stringify(payload);
      if (Buffer.byteLength(body) < MIN_COMPRESS) return originalJson(payload);
      try {
        const compressed = encoding === "gzip" ? zlib.gzipSync(body, { level: 6 }) : zlib.deflateSync(body, { level: 6 });
        res.setHeader("content-encoding", encoding);
        res.setHeader("vary", "accept-encoding");
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.removeHeader("content-length");
        res.end(compressed);
        return res;
      } catch {
        return originalJson(payload);
      }
    };
    next();
  };
}

/** Security headers — tuned so the app also works inside Telegram's iframe. */
export function securityHeaders({ dev = false, frameAncestors = "" } = {}) {
  const scriptSrc = [
    "'self'",
    "'unsafe-inline'",
    "https://telegram.org",
    "https://*.telegram.org",
    ...(dev ? ["'unsafe-eval'"] : [])
  ].join(" ");

  const frames = (frameAncestors || process.env.ALLOWED_FRAME_HOSTS || "https://web.telegram.org https://t.me")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean)
    .join(" ");

  return (_req, res, next) => {
    res.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        `script-src ${scriptSrc}`,
        `script-src-elem ${scriptSrc}`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https://*.t.me https://telegram.org https://*.telegram.org",
        "media-src 'self' blob:",
        "font-src 'self' data:",
        "connect-src 'self' https: wss:",
        "worker-src 'self' blob:",
        "manifest-src 'self'",
        "base-uri 'none'",
        "form-action 'none'",
        `frame-ancestors 'self' ${frames}`
      ].join("; ")
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    next();
  };
}

/** Sliding-window limiter bound to a request key. */
export function rateLimit(limiter, keyFn, opts = {}) {
  return (req, res, next) => {
    const key = keyFn(req) || req.ip || "unknown";
    const result = limiter.check(key, opts);
    res.setHeader("X-RateLimit-Remaining", String(result.remaining));
    if (!result.ok) {
      res.setHeader("Retry-After", Math.ceil(result.resetIn / 1000));
      return res.status(429).json({
        error: "Too many requests",
        code: "RATE_LIMIT",
        retryAfter: Math.ceil(result.resetIn / 1000)
      });
    }
    next();
  };
}

/** Wrap an async handler so rejections reach the error handler. */
export function asyncRoute(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/** Require a valid Telegram user (set by webAppAuthMiddleware). */
export function requireUser(req, res, next) {
  if (!req.tgUser) {
    return res.status(401).json({ error: "Not authenticated", code: "NOT_AUTHENTICATED" });
  }
  next();
}

export function adminIds() {
  return (process.env.ADMIN_IDS || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
}

export function isAdminId(id) {
  return adminIds().includes(String(id));
}

/** Require an authenticated admin. */
export function requireAdmin(req, res, next) {
  if (!req.tgUser) return res.status(401).json({ error: "Not authenticated", code: "NOT_AUTHENTICATED" });
  if (!isAdminId(req.tgUser.id)) return res.status(403).json({ error: "Admins only", code: "FORBIDDEN" });
  next();
}

export function notFound(req, res) {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "Endpoint not found", code: "NOT_FOUND", path: req.path });
  }
  res
    .status(404)
    .type("html")
    .send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>404</title><body style="font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#0b1020;color:#e5e7eb">
<div style="text-align:center"><h1 style="font-size:56px;margin:0">404</h1><p>Page not found</p>
<a href="/app" style="color:#6ea8fe">Open the app</a></div></body>`);
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  const status = Number(err.status || err.statusCode) || 500;
  const isProd = process.env.NODE_ENV === "production";
  if (status >= 500) console.error("[http]", err);

  res.status(status).json({
    error: status >= 500 && isProd ? "Internal server error" : err.message || "Request failed",
    code: err.code || (status >= 500 ? "SERVER_ERROR" : "BAD_REQUEST")
  });
}
