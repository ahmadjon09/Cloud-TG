// tg.js — Telegram Bot API helpers (with caching, timeouts and retries)
import { caches } from "./utils/cache.js";
import { limiters } from "./utils/rateLimit.js";

const API = "https://api.telegram.org";

export function botToken() {
  return process.env.BOT_TOKEN || "";
}

export function isTelegramConfigured() {
  return Boolean(process.env.BOT_TOKEN);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Call any Bot API method with a timeout and a small retry for 429/5xx. */
export async function tgCall(method, payload = {}, { timeout = 20_000, retries = 2, token } = {}) {
  const tk = token || botToken();
  if (!tk) throw new Error("BOT_TOKEN is not configured");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetch(`${API}/bot${tk}/${method}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
        const data = await res.json().catch(() => ({}));

        if (res.status === 429) {
          const wait = Number(data?.parameters?.retry_after || 1) * 1000;
          if (attempt < retries) {
            await sleep(Math.min(wait, 5000));
            continue;
          }
        }
        if (!res.ok && res.status >= 500 && attempt < retries) {
          await sleep(300 * (attempt + 1));
          continue;
        }
        if (!data.ok) {
          const err = new Error(data.description || `Telegram ${method} failed`);
          err.code = data.error_code;
          err.description = data.description;
          err.method = method;
          throw err;
        }
        return data.result;
      } catch (e) {
        lastErr = e;
        if (e.name === "AbortError") break;
        if (attempt === retries) break;
        await sleep(200 * (attempt + 1));
      }
    }
    throw lastErr || new Error(`Telegram ${method} failed`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve a file_id to a download path. Telegram keeps paths valid ~1 hour,
 * so we cache for 45 minutes (saves one round-trip per preview).
 */
export async function tgGetFile(fileId, token = botToken()) {
  const key = `tgfile:${fileId}`;
  const cached = caches.telegram.get(key);
  if (cached) return cached;

  const result = await tgCall("getFile", { file_id: fileId }, { token, retries: 0 });
  if (!result?.file_path) throw new Error("Telegram did not return a file path");

  caches.telegram.set(key, result, 45 * 60_000);
  return result;
}

export function tgFileUrl(filePath, token = botToken()) {
  return `${API}/file/bot${token}/${filePath}`;
}

export function pickTelegramSend(kind, mimeType = "") {
  if (kind === "photo") return { method: "sendPhoto", field: "photo" };
  if (kind === "video") return { method: "sendVideo", field: "video" };
  if (kind === "audio") return { method: "sendAudio", field: "audio" };
  if (kind === "voice") return { method: "sendVoice", field: "voice" };
  if (String(mimeType).startsWith("image/")) return { method: "sendPhoto", field: "photo" };
  return { method: "sendDocument", field: "document" };
}

/** Re-send a stored file_id back to its owner. */
export async function sendStoredFile({ chatId, file, caption }) {
  const { method, field } = pickTelegramSend(file.kind, file.mimeType);
  const payload = { chat_id: chatId };
  payload[field] = file.tgFileId;
  if (caption) payload.caption = String(caption).slice(0, 1024);

  const limit = limiters.telegram.check(`send:${chatId}`, { max: 25 });
  if (!limit.ok) {
    const err = new Error("Too many send requests, please wait a moment");
    err.code = "RATE_LIMIT";
    throw err;
  }
  return tgCall(method, payload);
}

export const TG_MAX_BYTES = 50 * 1024 * 1024;
