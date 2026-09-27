// api.js — backend client
import { store } from "./core.js";

function initData() {
  return window.Telegram?.WebApp?.initData || store.get("initData", "") || "";
}

async function request(path, { method = "GET", body, headers = {}, raw = false, timeout = 25000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const opts = {
    method,
    headers: { accept: "application/json", ...headers },
    signal: controller.signal,
    credentials: "same-origin"
  };
  const data = initData();
  if (data) opts.headers["x-telegram-init-data"] = data;
  if (body !== undefined) {
    opts.headers["content-type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  try {
    const res = await fetch(path, opts);
    if (res.status === 401) {
      window.dispatchEvent(new CustomEvent("cloud:unauthorized"));
      throw new ApiError("Session expired", 401, "NOT_AUTHENTICATED");
    }
    if (raw) return res;
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new ApiError(payload.error || `HTTP ${res.status}`, res.status, payload.code, payload);
    }
    return payload;
  } catch (e) {
    if (e.name === "AbortError") throw new ApiError("Request timed out", 0, "TIMEOUT");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export class ApiError extends Error {
  constructor(message, status = 0, code = "ERROR", payload = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

export const api = {
  /* ---- session ---- */
  me: () => request("/api/me"),
  updateMe: patch => request("/api/me", { method: "PATCH", body: patch }),
  detectLanguage: () => request("/api/me/detect-language", { method: "POST" }),
  stats: () => request("/api/stats"),

  /* ---- files ---- */
  files: params => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params || {})) {
      if (v === undefined || v === null || v === "" || v === "all") continue;
      qs.set(k, String(v));
    }
    return request(`/api/files?${qs}`);
  },
  counts: () => request("/api/files/counts"),
  file: id => request(`/api/files/${id}`),
  token: id => request(`/api/files/${id}/token`, { method: "POST" }),
  updateFile: (id, patch) => request(`/api/files/${id}`, { method: "PATCH", body: patch }),
  deleteFile: (id, hard = false) => request(`/api/files/${id}${hard ? "?hard=1" : ""}`, { method: "DELETE" }),
  restoreFile: id => request(`/api/files/${id}/restore`, { method: "POST" }),
  sendFile: id => request(`/api/files/${id}/send`, { method: "POST", timeout: 40000 }),
  bulk: (ids, action) => request("/api/files/bulk", { method: "POST", body: { ids, action }, timeout: 60000 }),

  /* ---- admin ---- */
  admin: {
    overview: () => request("/api/admin/overview"),
    users: params => {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(params || {})) if (v) qs.set(k, String(v));
      return request(`/api/admin/users?${qs}`);
    },
    user: id => request(`/api/admin/users/${id}`),
    deleteUserFiles: id => request(`/api/admin/users/${id}/files`, { method: "DELETE" }),
    files: params => {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(params || {})) if (v) qs.set(k, String(v));
      return request(`/api/admin/files?${qs}`);
    },
    deleteFile: id => request(`/api/admin/files/${id}`, { method: "DELETE" }),
    broadcast: text => request("/api/admin/broadcast", { method: "POST", body: { text }, timeout: 40000 }),
    broadcastStatus: jobId => request(`/api/admin/broadcast/${jobId}`),
    cancelBroadcast: jobId => request(`/api/admin/broadcast/${jobId}/cancel`, { method: "POST" }),
    broadcasts: () => request("/api/admin/broadcasts"),
    system: () => request("/api/admin/system"),
    clearCache: () => request("/api/admin/cache/clear", { method: "POST" }),
    cleanup: () => request("/api/admin/cleanup", { method: "POST" })
  }
};

/** Media links are cached for a few minutes — a file id never changes. */
const tokenCache = new Map();

const pendingTokens = new Map();
export async function mediaLink(file, kind = "preview") {
  const key = file.id;
  const hit = tokenCache.get(key);
  if (hit && hit.expires > Date.now() + 30_000) return hit[kind];
  try {
    if (!pendingTokens.has(key)) {
      pendingTokens.set(key, api.token(file.id).then(res => {
        const entry = { preview: res.preview, thumb: res.thumb, download: res.download, expires: Date.now() + res.expiresIn * 1000 };
        tokenCache.set(key, entry);
        return entry;
      }).finally(() => pendingTokens.delete(key)));
    }
    return (await pendingTokens.get(key))[kind];
  } catch {
    return "";
  }
}

/** Telegram WebViews support native downloads; ordinary browsers use an anchor. */
export async function downloadMedia(file) {
  const url = await mediaLink(file, "download");
  if (!url) throw new ApiError("Could not get a download link");
  const tg = window.Telegram?.WebApp;
  if (tg?.isVersionAtLeast?.("8.0") && typeof tg.downloadFile === "function") {
    tg.downloadFile({ url: new URL(url, window.location.href).href, file_name: file.fileName || "file" });
    return;
  }
  const a = document.createElement("a");
  a.href = url;
  a.download = file.fileName || "file";
  document.body.append(a);
  a.click();
  a.remove();
}

export function clearMediaLinks() {
  tokenCache.clear();
}
