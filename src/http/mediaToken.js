// http/mediaToken.js — short-lived signed URLs for images/video/audio
// (keeps a 1 KB `initData` string out of every single media request)
import crypto from "crypto";

const DEFAULT_TTL = 6 * 60 * 60; // 6 hours

function secret() {
  return process.env.BOT_TOKEN || process.env.MEDIA_SECRET || "dev-media-secret";
}

function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

/** @returns {string} token in the form `<payload>.<signature>` */
export function signMediaToken({ fileId, userId, purpose = "preview", ttl = DEFAULT_TTL }) {
  const payload = {
    f: String(fileId),
    u: String(userId),
    p: purpose,
    e: Math.floor(Date.now() / 1000) + Math.floor(ttl)
  };
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac("sha256", secret()).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyMediaToken(token, { purpose } = {}) {
  if (typeof token !== "string" || !token.includes(".")) return { ok: false, reason: "Malformed token" };

  const [body, sig] = token.split(".");
  const expected = b64url(crypto.createHmac("sha256", secret()).update(body).digest());
  if (!safeEqual(sig, expected)) return { ok: false, reason: "Bad signature" };

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "Malformed payload" };
  }
  if (!payload?.f || !payload?.u) return { ok: false, reason: "Incomplete payload" };
  if (purpose && payload.p !== purpose) return { ok: false, reason: "Wrong purpose" };
  if (payload.e * 1000 < Date.now()) return { ok: false, reason: "Token expired" };

  return { ok: true, fileId: payload.f, userId: payload.u, purpose: payload.p, expiresAt: payload.e * 1000 };
}

function safeEqual(a = "", b = "") {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
