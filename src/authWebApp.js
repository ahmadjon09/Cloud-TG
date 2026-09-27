// authWebApp.js — validates Telegram WebApp `initData` (HMAC-SHA256)
import crypto from "crypto";

const DEFAULT_TTL = 24 * 60 * 60; // Telegram keeps initData valid for a day

function parseInitData(initData) {
  const obj = {};
  for (const [k, v] of new URLSearchParams(initData).entries()) obj[k] = v;
  return obj;
}

function safeEqual(a = "", b = "") {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function checkHmac(initData, botToken) {
  if (!initData) return { ok: false, reason: "No initData" };
  if (!botToken) return { ok: false, reason: "Server misconfigured: BOT_TOKEN missing" };

  const data = parseInitData(initData);
  const hash = data.hash;
  if (!hash) return { ok: false, reason: "No hash" };

  delete data.hash;
  // signature_type must stay out of the check string (Telegram ≥ 9.0)
  delete data.signature;

  const dataCheckString = Object.keys(data)
    .sort()
    .map(k => `${k}=${data[k]}`)
    .join("\n");

  // secret_key = HMAC_SHA256("WebAppData", botToken)
  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const calcHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  if (!safeEqual(calcHash, hash)) return { ok: false, reason: "Bad hash" };

  return { ok: true, data };
}

// Small verification cache — a page load fires several API calls with the same initData
const verifyCache = new Map();
const VERIFY_CACHE_MAX = 5000;

function verifyCached(initData, token, ttl) {
  const key = crypto.createHash("sha1").update(initData).digest("hex");
  const hit = verifyCache.get(key);
  const now = Math.floor(Date.now() / 1000);

  if (hit && hit.expires > now + 5) return { ...hit.result, cached: true };

  const result = verifyOnce(initData, token, ttl);
  if (verifyCache.size > VERIFY_CACHE_MAX) verifyCache.clear();
  if (result.ok && result.user) {
    verifyCache.set(key, {
      result,
      expires: (result.authDate || now) + ttl
    });
  }
  return result;
}

function verifyOnce(initData, token, ttl) {
  const v = checkHmac(initData, token);
  if (!v.ok) return { ok: false, error: "Invalid initData", reason: v.reason };

  const authDate = Number(v.data.auth_date || 0);
  if (!authDate) return { ok: false, error: "Missing auth_date" };

  const age = Math.floor(Date.now() / 1000) - authDate;
  if (age > ttl) return { ok: false, error: "initData expired" };

  let user = null;
  try {
    user = v.data.user ? JSON.parse(v.data.user) : null;
  } catch {
    return { ok: false, error: "Malformed user payload" };
  }
  if (!user?.id) return { ok: false, error: "No user in initData" };

  return {
    ok: true,
    authDate,
    queryId: v.data.query_id || "",
    chatInstance: v.data.chat_instance || "",
    canSendAfter: Number(v.data.can_send_after || 0),
    user: {
      id: String(user.id),
      firstName: user.first_name || "",
      lastName: user.last_name || "",
      username: user.username || "",
      photoUrl: user.photo_url || "",
      languageCode: user.language_code || "",
      isPremium: !!user.is_premium,
      allowsWriteToPm: !!user.allows_write_to_pm
    }
  };
}

function demoUser(req) {
  const id = process.env.DEMO_USER_ID || req.header("x-demo-user") || "100000001";
  return {
    ok: true,
    demo: true,
    authDate: Math.floor(Date.now() / 1000),
    queryId: "",
    chatInstance: "demo",
    canSendAfter: 0,
    user: {
      id: String(id),
      firstName: process.env.DEMO_FIRST_NAME || "Demo",
      lastName: process.env.DEMO_LAST_NAME || "User",
      username: process.env.DEMO_USERNAME || "demo_user",
      photoUrl: "",
      languageCode: process.env.DEMO_LANG || "en",
      isPremium: false,
      allowsWriteToPm: true
    }
  };
}

/**
 * Express middleware: attaches `req.tgUser` (or 401s).
 * Token is read per request so a missing env var fails loudly at runtime.
 */
export function webAppAuthMiddleware(req, res, next) {
  const token = process.env.BOT_TOKEN;
  const ttl = Number(process.env.INIT_DATA_TTL || DEFAULT_TTL);

  const initData =
    req.header("x-telegram-init-data") ||
    (typeof req.query?.initData === "string" ? req.query.initData : "") ||
    "";

  if (!initData) {
    if (process.env.DEMO_MODE === "true" && !token) return attach(req, demoUser(req), next);
    return res.status(401).json({ error: "Missing initData", code: "NO_INIT_DATA" });
  }

  const result = verifyCached(initData, token, ttl);
  if (!result.ok) {
    return res.status(401).json({
      error: result.error || "Invalid initData",
      reason: result.reason,
      code: "BAD_INIT_DATA"
    });
  }
  return attach(req, result, next);
}

/** Same as above but never blocks: `req.tgUser` may be null. */
export function optionalWebAppAuth(req, _res, next) {
  const token = process.env.BOT_TOKEN;
  const ttl = Number(process.env.INIT_DATA_TTL || DEFAULT_TTL);
  const initData = req.header("x-telegram-init-data") || (typeof req.query?.initData === "string" ? req.query.initData : "");

  if (!initData) {
    if (process.env.DEMO_MODE === "true" && !token) return attach(req, demoUser(req), next);
    req.tgUser = null;
    return next();
  }
  const result = verifyCached(initData, token, ttl);
  attach(req, result.ok ? result : { ok: false }, next);
}

function attach(req, result, next) {
  req.tgUser = result.ok ? result.user : null;
  req.tgAuth = result.ok
    ? { demo: !!result.demo, authDate: result.authDate, queryId: result.queryId }
    : { demo: false };
  // kept for backwards compatibility with older code
  req.webAppUser = req.tgUser;
  next();
}

export function clearVerifyCache() {
  const n = verifyCache.size;
  verifyCache.clear();
  return n;
}

export function verifyCacheSize() {
  return verifyCache.size;
}
