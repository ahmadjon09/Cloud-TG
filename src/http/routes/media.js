// http/routes/media.js — streaming from Telegram with Range support
import express from "express";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { getStore } from "../../db.js";
import { asyncRoute, requireUser } from "../middleware.js";
import { limiters } from "../../utils/rateLimit.js";
import { caches } from "../../utils/cache.js";
import { tgGetFile, tgFileUrl, isTelegramConfigured } from "../../tg.js";
import { verifyMediaToken } from "../mediaToken.js";
import { categoryOf, guessMime, canStreamThroughTelegram } from "../../utils/fileType.js";

const FETCH_TIMEOUT = 25_000;

/** Resolve the file requested by a short-lived token. */
async function resolveFile(req, res, purpose) {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const verified = verifyMediaToken(token, { purpose });
  if (!verified.ok) {
    res.status(401).json({ error: "Invalid or expired media link", code: "BAD_MEDIA_TOKEN", reason: verified.reason });
    return null;
  }
  const store = getStore();
  const file = await store.getFileOwned(verified.fileId, verified.userId);
  if (!file) {
    res.status(404).json({ error: "File not found", code: "NOT_FOUND" });
    return null;
  }
  if (file.isDeleted) {
    res.status(410).json({ error: "File is in the trash", code: "IN_TRASH" });
    return null;
  }
  return file;
}

async function openTelegramStream(file, rangeHeader) {
  const cached = caches.telegram.get(`path:${file.id}`);
  let tgFile = cached;
  if (!tgFile) {
    if (!isTelegramConfigured()) {
      const err = new Error("Telegram is not configured");
      err.code = "NO_TELEGRAM";
      throw err;
    }
    tgFile = await tgGetFile(file.tgFileId);
    caches.telegram.set(`path:${file.id}`, tgFile, 45 * 60_000);
  }

  const url = tgFileUrl(tgFile.file_path);
  const headers = {};
  if (rangeHeader) headers.Range = rangeHeader;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  const upstream = await fetch(url, { headers, signal: controller.signal }).finally(() => clearTimeout(timer));

  return { upstream };
}

function applyUpstreamHeaders(res, upstream, file, { asDownload }) {
  const contentType = file.mimeType || guessMime(file.fileName, file.kind) || upstream.headers.get("content-type") || "application/octet-stream";
  res.setHeader("Content-Type", contentType);

  const name = file.fileName || "file";
  const disposition = asDownload
    ? `attachment; filename*=UTF-8''${encodeURIComponent(name)}`
    : "inline";
  res.setHeader("Content-Disposition", disposition);

  for (const header of ["content-range", "accept-ranges", "content-length", "etag", "last-modified"]) {
    const value = upstream.headers.get(header);
    if (value) res.setHeader(header.split("-").map(p => p[0].toUpperCase() + p.slice(1)).join("-"), value);
  }
  // Media is immutable for a given file id → let the browser reuse it
  res.setHeader("Cache-Control", "private, max-age=86400, must-revalidate");
  res.setHeader("X-Content-Type-Options", "nosniff");
}

export function mediaRouter() {
  const router = express.Router();

  /** Previews: images / video / audio. Supports Range so <video> can seek. */
  router.get(
    ["/media/:id/preview", "/media/:id/thumb"],
    asyncRoute(async (req, res) => {
      const file = await resolveFile(req, res, "preview");
      if (!file) return;

      const limit = limiters.stream.check(`prev:${req.ip}`);
      if (!limit.ok) return res.status(429).json({ error: "Too many requests", code: "RATE_LIMIT" });

      const category = categoryOf(file.fileName, file.kind);
      if (!["images", "videos", "audio"].includes(category)) {
        return res.status(400).json({ error: "Preview not supported for this file", code: "PREVIEW_NOT_SUPPORTED" });
      }
      if (!canStreamThroughTelegram(file.fileSize)) {
        return res.status(413).json({ error: "File is too large to stream", code: "FILE_TOO_BIG" });
      }
      if (!isTelegramConfigured()) {
        return res.status(404).json({ error: "Demo file — nothing to stream", code: "DEMO_FILE" });
      }

      try {
        const { upstream } = await openTelegramStream(file, req.headers.range);
        if (!upstream.ok && upstream.status !== 206) {
          return res.status(502).json({ error: "Telegram could not serve this file", code: "UPSTREAM_ERROR" });
        }
        if (req.method === "HEAD") {
          applyUpstreamHeaders(res, upstream, file, { asDownload: false });
          return res.status(upstream.status).end();
        }
        res.status(upstream.status); // 200 or 206
        applyUpstreamHeaders(res, upstream, file, { asDownload: false });
        req.on("aborted", () => upstream.body?.cancel?.().catch(() => {}));
        await pipeline(Readable.fromWeb(upstream.body), res);
      } catch (e) {
        if (e.name === "AbortError") return;
        const message = String(e?.message || e);
        if (message.includes("file is too big")) {
          return res.status(413).json({ error: "File is too large to stream", code: "FILE_TOO_BIG" });
        }
        console.error("[media] preview failed:", message);
        res.status(502).json({ error: "Could not load the file", code: "UPSTREAM_ERROR" });
      }
    })
  );

  /** Same bytes, `attachment` disposition — always downloads. */
  router.get(
    "/media/:id/download",
    asyncRoute(async (req, res) => {
      const file = await resolveFile(req, res, "download");
      if (!file) return;

      const limit = limiters.stream.check(`dl:${req.ip}`, { max: 60 });
      if (!limit.ok) return res.status(429).json({ error: "Too many requests", code: "RATE_LIMIT" });

      if (!canStreamThroughTelegram(file.fileSize)) {
        return res.status(413).json({
          error: "File is too large to download",
          code: "FILE_TOO_BIG",
          detail: "Telegram Bot API cannot serve files larger than 50 MB. Use “Send to Telegram” instead."
        });
      }
      if (!isTelegramConfigured()) {
        return res.status(404).json({ error: "Demo file — nothing to download", code: "DEMO_FILE" });
      }

      try {
        const { upstream } = await openTelegramStream(file, req.headers.range);
        if (!upstream.ok && upstream.status !== 206) {
          return res.status(502).json({ error: "Telegram could not serve this file", code: "UPSTREAM_ERROR" });
        }
        res.status(req.headers.range && upstream.status === 206 ? 206 : 200);
        applyUpstreamHeaders(res, upstream, file, { asDownload: true });
        req.on("aborted", () => upstream.body?.cancel?.().catch(() => {}));
        await pipeline(Readable.fromWeb(upstream.body), res);
      } catch (e) {
        if (e.name === "AbortError") return;
        console.error("[media] download failed:", String(e?.message || e));
        res.status(502).json({ error: "Could not download the file", code: "UPSTREAM_ERROR" });
      }
    })
  );

  return router;
}
