export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    if (typeof c === "string" && c.startsWith("<") && c.trimEnd().endsWith(">")) {
      const tpl = document.createElement("template");
      tpl.innerHTML = c;
      node.append(tpl.content);
    } else {
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
  }
  return node;
}

export const escapeHtml = (s = "") =>
  String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function debounce(fn, ms = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function throttle(fn, ms = 100) {
  let last = 0;
  let timer = null;
  return (...args) => {
    const now = Date.now();
    if (now - last >= ms) {
      last = now;
      fn(...args);
    } else if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        last = Date.now();
        fn(...args);
      }, ms - (now - last));
    }
  };
}

export function raf(fn) {
  return requestAnimationFrame(() => requestAnimationFrame(fn));
}

const UNITS = ["B", "KB", "MB", "GB", "TB"];
export function formatSize(bytes, digits) {
  const b = Number(bytes) || 0;
  if (b <= 0) return "0 B";
  let i = 0;
  let size = b;
  while (size >= 1024 && i < UNITS.length - 1) {
    size /= 1024;
    i++;
  }
  const d = digits ?? (i === 0 ? 0 : size >= 100 ? 0 : 1);
  return `${size.toFixed(d)} ${UNITS[i]}`;
}

export function formatDate(value, locale = "en-US", opts = {}) {
  const d = new Date(value);
  if (!value || Number.isNaN(d.getTime())) return "—";
  try {
    return d.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric", ...opts });
  } catch {
    return "";
  }
}

export function formatDateTime(value, locale = "en-US") {
  const d = new Date(value);
  if (!value || Number.isNaN(d.getTime())) return "—";
  try {
    return d.toLocaleString(locale, {
      day: "numeric", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit"
    });
  } catch {
    return "";
  }
}

export function formatRelative(value, locale = "en-US") {
  const ts = new Date(value).getTime();
  if (!ts || Number.isNaN(ts)) return "—";
  const diff = Date.now() - ts;
  const min = Math.round(diff / 60000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (Math.abs(min) < 60) return rtf.format(-min, "minute");
  const hours = Math.round(min / 60);
  if (Math.abs(hours) < 24) return rtf.format(-hours, "hour");
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return rtf.format(-days, "day");
  return formatDate(value, locale);
}

export function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

export function initials(name = "") {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function hashHue(str = "") {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return h;
}

const EXT = {
  images: ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "tif", "tiff", "heic", "heif", "ico", "avif", "jfif", "pjpeg", "pjp"],
  videos: ["mp4", "mov", "avi", "mkv", "webm", "flv", "wmv", "m4v", "3gp", "mpeg", "mpg", "ts", "ogv", "vob"],
  audio: ["mp3", "wav", "ogg", "oga", "m4a", "flac", "aac", "wma", "opus", "aiff", "alac", "amr", "mid", "midi"],
  archives: ["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "iso", "dmg", "apk", "lz", "lzma", "zst"]
};

export const CATEGORIES = ["images", "videos", "audio", "documents", "archives"];

const HEIC_EXTS = new Set(["heic", "heif"]);

export function isHeic(name = "") {
  return HEIC_EXTS.has(extOf(name));
}

export function extOf(name = "") {
  const parts = String(name).split(".");
  if (parts.length < 2) return "";
  const ext = parts.pop().toLowerCase();
  return /^[a-z0-9]{1,6}$/.test(ext) ? ext : "";
}

export function categoryOf(name = "", kind = "") {
  const ext = extOf(name);
  const k = String(kind || "").toLowerCase();
  for (const [cat, list] of Object.entries(EXT)) if (list.includes(ext)) return cat;
  if (k.includes("image") || k === "photo") return "images";
  if (k.includes("video")) return "videos";
  if (k.includes("audio") || k === "voice") return "audio";
  if (k.includes("zip") || k.includes("archive") || k.includes("compressed")) return "archives";
  return "documents";
}

const ICON_BY_EXT = {
  pdf: "pdf", doc: "word", docx: "word", rtf: "word", odt: "word",
  xls: "excel", xlsx: "excel", csv: "excel", ods: "excel",
  ppt: "powerpoint", pptx: "powerpoint", odp: "powerpoint",
  txt: "text", md: "text", log: "text",
  json: "code", xml: "code", yml: "code", yaml: "code", js: "code", mjs: "code", ts: "code",
  jsx: "code", tsx: "code", html: "code", css: "code", scss: "code", py: "code", java: "code",
  c: "code", cpp: "code", cs: "code", go: "code", rs: "code", php: "code", rb: "code", sh: "code", sql: "code"
};

export function iconFor(file) {
  const ext = extOf(file?.fileName);
  const cat = categoryOf(file?.fileName, file?.kind);
  if (cat === "images") return "image";
  if (cat === "videos") return "video";
  if (cat === "audio") return "audio";
  if (cat === "archives") return "archive";
  return ICON_BY_EXT[ext] || "file";
}

export function colorFor(file) {
  return `var(--c-${categoryOf(file?.fileName, file?.kind)})`;
}

export function colorSoftFor(file) {
  return `var(--c-${categoryOf(file?.fileName, file?.kind)}-soft)`;
}

export const isImage = f => categoryOf(f?.fileName, f?.kind) === "images";
export const isVideo = f => categoryOf(f?.fileName, f?.kind) === "videos";
export const isAudio = f => categoryOf(f?.fileName, f?.kind) === "audio";
export const isPreviewable = f => ["images", "videos", "audio"].includes(categoryOf(f?.fileName, f?.kind));

const LS_PREFIX = "cloud:";
export const store = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(LS_PREFIX + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
  del(key) {
    try {
      localStorage.removeItem(LS_PREFIX + key);
    } catch {}
  }
};

const bus = new EventTarget();
export function on(name, handler) {
  bus.addEventListener(name, e => handler(e.detail));
}
export function emit(name, detail) {
  bus.dispatchEvent(new CustomEvent(name, { detail }));
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

export function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const ta = el("textarea", { style: { position: "fixed", opacity: "0" } });
  ta.value = text;
  document.body.append(ta);
  ta.select();
  try { document.execCommand("copy"); } catch {}
  ta.remove();
  return Promise.resolve();
}

let lazyObserver = null;
export function observeLazy(root = document) {
  if (!lazyObserver) {
    lazyObserver = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const img = entry.target;
          const src = img.dataset.src;
          if (src) {
            img.src = src;
            img.removeAttribute("data-src");
          }
          lazyObserver.unobserve(img);
        }
      },
      { rootMargin: "400px 0px", threshold: 0.01 }
    );
  }
  $$("img[data-src]", root).forEach(img => lazyObserver.observe(img));
}

export function resetLazy() {
  lazyObserver?.disconnect();
  lazyObserver = null;
}

export function haptic(type = "light") {
  const tg = window.Telegram?.WebApp;
  if (!tg?.HapticFeedback) return;
  try {
    if (type === "success" || type === "error" || type === "warning") tg.HapticFeedback.notificationOccurred(type);
    else tg.HapticFeedback.impactOccurred(type);
  } catch {}
}