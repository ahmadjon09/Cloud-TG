// authWebApp.js — validates Telegram WebApp initData and maintains a signed web session
import crypto from "crypto";

const DEFAULT_INIT_DATA_TTL = 24 * 60 * 60; // Telegram initData itself is valid for one day
const DEFAULT_WEB_SESSION_TTL = 7 * 24 * 60 * 60; // keeps an already-verified WebView signed in for a week
const MIN_TTL = 1;
const MAX_INIT_DATA_TTL = 30 * 24 * 60 * 60;
const MAX_WEB_SESSION_TTL = 30 * 24 * 60 * 60;
const CLOCK_SKEW = 5 * 60;
const SESSION_COOKIE = "cloud_tg_session";
const SESSION_HEADER = "x-cloud-session";
const SESSION_VERSION = 1;

function configuredTtl(name, fallback, max) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const seconds = Number(raw);
  // A value such as INIT_DATA_TTL=0 must not make every new Telegram session
  // immediately expire. Fall back to the safe default instead.
  if (!Number.isFinite(seconds) || seconds < MIN_TTL || seconds > max) return fallback;
  return Math.floor(seconds);
}

function initDataTtl() {
  return configuredTtl("INIT_DATA_TTL", DEFAULT_INIT_DATA_TTL, MAX_INIT_DATA_TTL);
}

function webSessionTtl() {
  return configuredTtl("WEB_SESSION_TTL", DEFAULT_WEB_SESSION_TTL, MAX_WEB_SESSION_TTL);
}

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

function safeText(value, max = 256) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

/** Converts Telegram's snake_case user object (or a stored session user) to public app fields. */
function normalizeUser(raw) {
  if (!raw || typeof raw !== "object") return null;
  const rawId = raw.id;
  if ((typeof rawId !== "string" && typeof rawId !== "number") || String(rawId).trim() === "") return null;

  return {
    id: String(rawId),
    firstName: safeText(raw.first_name ?? raw.firstName, 128),
    lastName: safeText(raw.last_name ?? raw.lastName, 128),
    username: safeText(raw.username, 128),
    photoUrl: safeText(raw.photo_url ?? raw.photoUrl, 1024),
    languageCode: safeText(raw.language_code ?? raw.languageCode, 32),
    isPremium: Boolean(raw.is_premium ?? raw.isPremium),
    allowsWriteToPm: Boolean(raw.allows_write_to_pm ?? raw.allowsWriteToPm)
  };
}

export function checkHmac(initData, botToken) {
  if (!initData) return { ok: false, reason: "No initData", code: "NO_INIT_DATA" };
  if (!botToken) return { ok: false, reason: "Server misconfigured: BOT_TOKEN missing", code: "AUTH_UNAVAILABLE" };

  const data = parseInitData(initData);
  const hash = data.hash;
  if (!hash) return { ok: false, reason: "No hash", code: "BAD_INIT_DATA" };

  delete data.hash;
  // signature belongs to Telegram's third-party public-key validation and is
  // intentionally excluded from the bot-token HMAC data-check string.
  delete data.signature;

  const dataCheckString = Object.keys(data)
    .sort()
    .map(k => `${k}=${data[k]}`)
    .join("\n");

  // secret_key = HMAC_SHA256("WebAppData", botToken)
  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const calcHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  if (!safeEqual(calcHash, hash)) return { ok: false, reason: "Bad hash", code: "BAD_INIT_DATA" };

  return { ok: true, data };
}

// Small verification cache — a page load fires several API calls with the same initData.
// The token and TTL are part of the key so rotating a bot token or changing the TTL can
// never reuse a verification result created under old security settings.
const verifyCache = new Map();
const VERIFY_CACHE_MAX = 5000;

function verifyCached(initData, token, ttl) {
  const key = crypto
    .createHash("sha256")
    .update(`${token}\u0000${ttl}\u0000${initData}`)
    .digest("hex");
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

// Throttled diagnostic log so a broken setup is visible in the host logs
// (one line per distinct initData per minute — enough to diagnose, no spam).
const rejectLogSeen = new Map();
function logReject(initData, code, detail = "") {
  const key = crypto.createHash("sha256").update(String(initData)).digest("hex");
  const last = rejectLogSeen.get(key);
  if (last && Date.now() - last < 60_000) return;
  if (rejectLogSeen.size > 500) rejectLogSeen.clear();
  rejectLogSeen.set(key, Date.now());
  console.warn(`[auth] initData rejected: ${code}${detail ? ` (${detail})` : ""}`);
}

function verifyOnce(initData, token, ttl) {
  const v = checkHmac(initData, token);
  if (!v.ok) {
    // "Bot token missing" is a server misconfiguration; the other two mean the
    // payload does not match the configured BOT_TOKEN (regenerated/typo).
    logReject(initData, v.code || "BAD_INIT_DATA", v.reason === "Bad hash" ? "HMAC mismatch — check BOT_TOKEN in the server env" : v.reason);
    return { ok: false, error: "Invalid initData", reason: v.reason, code: v.code || "BAD_INIT_DATA" };
  }

  const authDate = Number(v.data.auth_date || 0);
  if (!Number.isSafeInteger(authDate) || authDate <= 0) {
    logReject(initData, "BAD_INIT_DATA", "missing auth_date");
    return { ok: false, error: "Missing auth_date", code: "BAD_INIT_DATA" };
  }

  let user = null;
  try {
    user = normalizeUser(v.data.user ? JSON.parse(v.data.user) : null);
  } catch {
    logReject(initData, "BAD_INIT_DATA", "malformed user payload");
    return { ok: false, error: "Malformed user payload", code: "BAD_INIT_DATA" };
  }
  if (!user) {
    logReject(initData, "BAD_INIT_DATA", "no user in initData");
    return { ok: false, error: "No user in initData", code: "BAD_INIT_DATA" };
  }

  const now = Math.floor(Date.now() / 1000);
  const age = now - authDate;
  if (age > ttl) {
    // The HMAC and user are still valid. Keeping the user here lets us safely
    // continue an existing same-user server session without cross-account reuse.
    logReject(initData, "INIT_DATA_EXPIRED", `age=${Math.round(age / 60)}min ttl=${Math.round(ttl / 60)}min — if the user just opened the app, the server clock or INIT_DATA_TTL is wrong`);
    return { ok: false, error: "initData expired", code: "INIT_DATA_EXPIRED", authDate, user };
  }
  if (age < -CLOCK_SKEW) {
    logReject(initData, "BAD_INIT_DATA", `auth_date in the future by ${Math.round(-age / 60)}min — server clock is behind`);
    return { ok: false, error: "Invalid auth_date", code: "BAD_INIT_DATA" };
  }

  return {
    ok: true,
    authDate,
    queryId: v.data.query_id || "",
    chatInstance: v.data.chat_instance || "",
    canSendAfter: Number(v.data.can_send_after || 0),
    user
  };
}

function sessionSecret(token) {
  return crypto.createHmac("sha256", "CloudTG web session v1").update(token).digest();
}

function sessionUser(user) {
  // Keep the signed cookie compact and bound to only data the API already exposes.
  return {
    id: user.id,
    firstName: safeText(user.firstName, 128),
    lastName: safeText(user.lastName, 128),
    username: safeText(user.username, 128),
    photoUrl: safeText(user.photoUrl, 1024),
    languageCode: safeText(user.languageCode, 32),
    isPremium: Boolean(user.isPremium),
    allowsWriteToPm: Boolean(user.allowsWriteToPm)
  };
}

function signWebSession(result, token, ttl = webSessionTtl()) {
  if (!result?.user || !token) return "";
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    v: SESSION_VERSION,
    i: now,
    e: now + ttl,
    u: sessionUser(result.user)
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", sessionSecret(token)).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function cookieValue(req, name) {
  const header = String(req.headers?.cookie || "");
  for (const part of header.split(/;\s*/)) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    if (part.slice(0, index) === name) return part.slice(index + 1);
  }
  return "";
}

function verifyWebSession(req, token) {
  const raw = cookieValue(req, SESSION_COOKIE);
  if (!raw || !token) return { ok: false };

  const parts = raw.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false };
  const [encoded, supplied] = parts;
  const expected = crypto.createHmac("sha256", sessionSecret(token)).update(encoded).digest("base64url");
  if (!safeEqual(expected, supplied)) return { ok: false };

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    const expires = Number(payload?.e);
    const issuedAt = Number(payload?.i);
    const user = normalizeUser(payload?.u);
    const now = Math.floor(Date.now() / 1000);
    if (
      payload?.v !== SESSION_VERSION ||
      !Number.isSafeInteger(expires) ||
      !Number.isSafeInteger(issuedAt) ||
      expires <= now ||
      issuedAt > now + CLOCK_SKEW ||
      expires - issuedAt > webSessionTtl() ||
      !user
    ) {
      return { ok: false };
    }
    return {
      ok: true,
      session: true,
      authDate: issuedAt,
      sessionExpires: expires,
      queryId: "",
      chatInstance: "",
      canSendAfter: 0,
      user
    };
  } catch {
    return { ok: false };
  }
}

function isSecureRequest(req) {
  return process.env.NODE_ENV === "production" || req.secure === true || req.header("x-forwarded-proto") === "https";
}

function setWebSession(res, req, result, token) {
  const ttl = webSessionTtl();
  const value = signWebSession(result, token, ttl);
  if (!value) return;
  const secure = isSecureRequest(req);
  res.cookie(SESSION_COOKIE, value, {
    httpOnly: true,
    secure,
    // Partitioned keeps this third-party WebView cookie scoped to Telegram in
    // browsers that implement CHIPS, while older clients safely ignore it.
    partitioned: secure,
    sameSite: secure ? "none" : "lax",
    path: "/",
    maxAge: ttl * 1000
  });
}

function canUseSession(req, session, initData, initResult, { requireClientHeader = false } = {}) {
  if (!session.ok) return false;
  // A custom header is required on API calls that authenticate via the cookie.
  // It makes the cookie unusable by cross-site form/image requests (CSRF).
  if (requireClientHeader && req.header(SESSION_HEADER) !== "1") return false;
  if (!initData) return true;
  // If Telegram did send data, only fall back when it is an authentic but stale
  // payload for the exact same account. This prevents a stale cookie from one
  // Telegram account being used while another account opens the Mini App.
  return initResult?.code === "INIT_DATA_EXPIRED" && initResult.user?.id === session.user.id;
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

function initDataFrom(req) {
  return req.header("x-telegram-init-data") || (typeof req.query?.initData === "string" ? req.query.initData : "") || "";
}

function authError(res, result, fallback = "NO_INIT_DATA") {
  const code = result?.code || fallback;
  const messages = {
    NO_INIT_DATA: "Telegram session is required",
    INIT_DATA_EXPIRED: "Telegram session expired",
    AUTH_UNAVAILABLE: "Authentication is temporarily unavailable",
    BAD_INIT_DATA: "Invalid Telegram session"
  };
  return res.status(401).json({ error: messages[code] || "Authentication failed", code });
}

/**
 * Express middleware: validates Telegram initData, then creates a short server-side
 * browser session. The session only bridges an already verified WebView after the
 * one-day Telegram payload expires; a fresh Telegram payload always takes priority.
 */
export function webAppAuthMiddleware(req, res, next) {
  const token = process.env.BOT_TOKEN;
  const ttl = initDataTtl();
  const initData = initDataFrom(req);

  if (!initData && process.env.DEMO_MODE === "true" && !token) return attach(req, demoUser(req), next, "demo");

  const initResult = initData ? verifyCached(initData, token, ttl) : null;
  if (initResult?.ok) {
    setWebSession(res, req, initResult, token);
    return attach(req, initResult, next, "telegram");
  }

  const session = verifyWebSession(req, token);
  if (canUseSession(req, session, initData, initResult, { requireClientHeader: true })) {
    return attach(req, session, next, "session");
  }

  return authError(res, initResult, initData ? "BAD_INIT_DATA" : "NO_INIT_DATA");
}

/** Same as above but never blocks: `req.tgUser` may be null. */
export function optionalWebAppAuth(req, res, next) {
  const token = process.env.BOT_TOKEN;
  const ttl = initDataTtl();
  const initData = initDataFrom(req);

  if (!initData && process.env.DEMO_MODE === "true" && !token) return attach(req, demoUser(req), next, "demo");

  const initResult = initData ? verifyCached(initData, token, ttl) : null;
  if (initResult?.ok) {
    setWebSession(res, req, initResult, token);
    return attach(req, initResult, next, "telegram");
  }

  const session = verifyWebSession(req, token);
  if (canUseSession(req, session, initData, initResult)) return attach(req, session, next, "session");

  return attach(req, { ok: false }, next);
}

function attach(req, result, next, source = "") {
  req.tgUser = result.ok ? result.user : null;
  req.tgAuth = result.ok
    ? {
        demo: !!result.demo,
        authDate: result.authDate,
        queryId: result.queryId,
        source,
        sessionExpires: result.sessionExpires || null
      }
    : { demo: false, source: "" };
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
