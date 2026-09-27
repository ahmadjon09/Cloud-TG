// utils/fileType.js — one place that decides what a file "is"
// Mirrored by public/js/utils.js (categoryFor) so the UI and the API agree.

export const CATEGORIES = ["images", "videos", "audio", "documents", "archives"];

const EXT = {
  images: ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "tif", "tiff", "heic", "heif", "ico", "avif"],
  videos: ["mp4", "mov", "avi", "mkv", "webm", "flv", "wmv", "m4v", "3gp", "mpeg", "mpg", "ts"],
  audio: ["mp3", "wav", "ogg", "oga", "m4a", "flac", "aac", "wma", "opus", "aiff", "alac", "amr"],
  archives: ["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "iso", "dmg", "apk"]
};

const DOC_ICON = {
  pdf: "pdf",
  doc: "word",
  docx: "word",
  rtf: "word",
  odt: "word",
  xls: "excel",
  xlsx: "excel",
  csv: "excel",
  ods: "excel",
  ppt: "powerpoint",
  pptx: "powerpoint",
  odp: "powerpoint",
  txt: "text",
  md: "text",
  log: "text",
  json: "code",
  xml: "code",
  yml: "yaml",
  yaml: "code",
  js: "code",
  mjs: "code",
  ts: "code",
  jsx: "code",
  tsx: "code",
  html: "code",
  css: "code",
  scss: "code",
  py: "code",
  java: "code",
  c: "code",
  cpp: "code",
  cs: "code",
  go: "code",
  rs: "code",
  php: "code",
  rb: "code",
  sh: "code",
  sql: "code"
};

export function extensionOf(name = "") {
  const parts = String(name).split(".");
  if (parts.length < 2) return "";
  const ext = parts.pop().toLowerCase();
  return /^[a-z0-9]{1,6}$/.test(ext) ? ext : "";
}

/** "images" | "videos" | "audio" | "archives" | "documents" */
export function categoryOf(fileName = "", kind = "") {
  const ext = extensionOf(fileName);
  const k = String(kind || "").toLowerCase();

  for (const [cat, list] of Object.entries(EXT)) {
    if (list.includes(ext)) return cat;
  }
  if (k.includes("image") || k === "photo") return "images";
  if (k.includes("video")) return "videos";
  if (k.includes("audio") || k === "voice") return "audio";
  if (k.includes("zip") || k.includes("archive") || k.includes("compressed")) return "archives";
  return "documents";
}

/** Icon id used by the frontend (`icon(id)` in public/js/icons.js) */
export function iconOf(fileName = "", kind = "") {
  const ext = extensionOf(fileName);
  const cat = categoryOf(fileName, kind);
  if (cat === "images") return "image";
  if (cat === "videos") return "video";
  if (cat === "audio") return "audio";
  if (cat === "archives") return "archive";
  return DOC_ICON[ext] || "file";
}

/** Can the browser show this inline? */
export function isPreviewable(fileName = "", kind = "") {
  return ["images", "videos", "audio"].includes(categoryOf(fileName, kind));
}

/** Telegram Bot API cannot stream files above ~50 MB. */
export const TELEGRAM_MAX_BYTES = 50 * 1024 * 1024;

export function canStreamThroughTelegram(size = 0) {
  return Number(size || 0) <= TELEGRAM_MAX_BYTES;
}

const MIME_BY_EXT = {
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  json: "application/json",
  xml: "application/xml",
  html: "text/html",
  css: "text/css",
  js: "text/javascript",
  mjs: "text/javascript",
  svg: "image/svg+xml",
  webp: "image/webp",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  flac: "audio/flac",
  zip: "application/zip",
  rar: "application/vnd.rar",
  "7z": "application/x-7z-compressed"
};

/** Guess a mime type when Telegram did not give us one. */
export function guessMime(fileName = "", kind = "", fallback = "application/octet-stream") {
  const ext = extensionOf(fileName);
  if (MIME_BY_EXT[ext]) return MIME_BY_EXT[ext];
  if (kind === "photo") return "image/jpeg";
  if (kind === "video") return "video/mp4";
  if (kind === "audio" || kind === "voice") return "audio/mpeg";
  return fallback;
}
