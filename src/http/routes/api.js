// http/routes/api.js — user + file endpoints used by the web app
import express from "express";
import { getStore } from "../../db.js";
import { asyncRoute, requireUser, isAdminId } from "../middleware.js";
import { limiters } from "../../utils/rateLimit.js";
import { caches, invalidateUser } from "../../utils/cache.js";
import { detectLanguage, normalizeLang, updateUserLanguage, setUserLanguageCache, getUserLanguage } from "../../utils/i18n.js";
import { categoryOf, isPreviewable, canStreamThroughTelegram, guessMime } from "../../utils/fileType.js";
import { sendStoredFile, isTelegramConfigured } from "../../tg.js";
import { signMediaToken } from "../mediaToken.js";
import { version } from "../../../i.js";

const MAX_LIMIT = 120;
const AUTO_EXPIRE = { "24h": 86_400_000, "7d": 604_800_000, "30d": 2_592_000_000, "90d": 7_776_000_000 };

const clamp = (n, min, max, fallback) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(v)));
};

/** Reads the query, applies to the store and returns { items, total, hasMore } */
async function queryFiles(req, { admin = false } = {}) {
  const owner = admin ? req.query.owner || "" : req.tgUser.id;
  const opts = {
    owner: owner || undefined,
    q: typeof req.query.q === "string" ? req.query.q.trim().slice(0, 120) : "",
    category: typeof req.query.category === "string" && req.query.category !== "all" ? req.query.category : "",
    kind: typeof req.query.kind === "string" ? req.query.kind : "",
    favorite: req.query.favorite === "true" ? true : undefined,
    private: req.query.private === "true" ? true : req.query.private === "false" ? false : undefined,
    trash: req.query.trash === "true" ? true : false,
    sort: typeof req.query.sort === "string" ? req.query.sort : "newest",
    limit: clamp(req.query.limit, 1, MAX_LIMIT, 48),
    skip: clamp(req.query.skip, 0, 100_000, 0)
  };
  return getStore().listFiles(opts);
}

export function apiRouter() {
  const router = express.Router();

  /** Creates the user on first visit and returns profile + settings + stats. */
  router.get(
    "/me",
    requireUser,
    asyncRoute(async (req, res) => {
      const tg = req.tgUser;
      const store = getStore();

      let user = await store.getUser(tg.id);
      if (!user) {
        user = await store.ensureUser({
          id: tg.id,
          firstName: tg.firstName,
          lastName: tg.lastName,
          username: tg.username,
          photoUrl: tg.photoUrl,
          languageCode: tg.languageCode,
          language: detectLanguage(tg.languageCode)
        });
      } else {
        // keep the profile fresh (name/avatar can change)
        user = await store.ensureUser({
          id: tg.id,
          firstName: tg.firstName,
          lastName: tg.lastName,
          username: tg.username,
          photoUrl: tg.photoUrl,
          languageCode: tg.languageCode
        });
        if (!user.languageCode && tg.languageCode) {
          user = await store.updateUser(tg.id, { languageCode: tg.languageCode });
        }
      }

      const stats = await store.userStats(tg.id);
      const counts = {};
      for (const cat of ["images", "videos", "audio", "documents", "archives"]) {
        const r = await store.listFiles({ owner: tg.id, category: cat, limit: 0 });
        counts[cat] = r.total;
      }

      res.json({
        ok: true,
        version,
        demo: !!req.tgAuth?.demo,
        telegram: isTelegramConfigured(),
        isAdmin: isAdminId(tg.id),
        user,
        stats: { files: stats.files, size: stats.size, counts },
        serverTime: Date.now()
      });
    })
  );

  /** Update language and/or settings. */
  router.patch(
    "/me",
    requireUser,
    asyncRoute(async (req, res) => {
      const store = getStore();
      const { language, settings } = req.body || {};

      if (language !== undefined) {
        const lang = normalizeLang(language, null);
        if (!lang) return res.status(400).json({ error: "Unsupported language", code: "BAD_LANGUAGE" });
        await updateUserLanguage(req.tgUser.id, lang);
      }

      const patch = {};
      if (settings && typeof settings === "object") {
        const allowed = [
          "notifications",
          "privateByDefault",
          "autoExpire",
          "theme",
          "view",
          "density",
          "desktopMode",
          "autoFullscreen",
          "autoThumbnails"
        ];
        for (const key of allowed) {
          if (settings[key] !== undefined) {
            if (key === "autoExpire" && settings[key] !== null && !AUTO_EXPIRE[settings[key]]) {
              return res.status(400).json({ error: "Invalid autoExpire value", code: "BAD_VALUE" });
            }
            if (key === "theme" && !["auto", "light", "dark"].includes(settings[key])) {
              return res.status(400).json({ error: "Invalid theme", code: "BAD_VALUE" });
            }
            if (key === "view" && !["grid", "list"].includes(settings[key])) {
              return res.status(400).json({ error: "Invalid view", code: "BAD_VALUE" });
            }
            if (key === "density" && !["compact", "comfortable"].includes(settings[key])) {
              return res.status(400).json({ error: "Invalid density", code: "BAD_VALUE" });
            }
            patch[key] = settings[key];
          }
        }
      }

      const user = Object.keys(patch).length
        ? await store.updateUser(req.tgUser.id, { settings: patch })
        : await store.getUser(req.tgUser.id);

      invalidateUser(req.tgUser.id);
      res.json({ ok: true, user });
    })
  );

  /**
   * Short-lived signed links for images / video / audio / downloads.
   * Keeps the (large) initData string out of every media request.
   */
  router.post(
    "/files/:id/token",
    requireUser,
    asyncRoute(async (req, res) => {
      const file = await getStore().getFileOwned(req.params.id, req.tgUser.id);
      if (!file) return res.status(404).json({ error: "File not found", code: "NOT_FOUND" });

      const ttl = 6 * 60 * 60;
      const make = purpose => signMediaToken({ fileId: file.id, userId: req.tgUser.id, purpose, ttl });
      res.json({
        ok: true,
        expiresIn: ttl,
        preview: `/api/media/${file.id}/preview?token=${make("preview")}`,
        thumb: `/api/media/${file.id}/thumb?token=${make("preview")}`,
        download: `/api/media/${file.id}/download?token=${make("download")}`
      });
    })
  );

  /** Paginated, filtered file list. */
  router.get(
    "/files",
    requireUser,
    asyncRoute(async (req, res) => {
      const skip = clamp(req.query.skip, 0, 100_000, 0);
      const limit = clamp(req.query.limit, 1, MAX_LIMIT, 48);
      const { items, total } = await queryFiles(req);
      res.json({
        ok: true,
        items,
        total,
        skip,
        limit,
        hasMore: skip + items.length < total
      });
    })
  );

  /** Aggregated counters for the sidebar badges / dashboard. */
  router.get(
    "/files/counts",
    requireUser,
    asyncRoute(async (req, res) => {
      const store = getStore();
      const key = `counts:${req.tgUser.id}`;
      const cached = caches.stats.get(key);
      if (cached) return res.json({ ok: true, ...cached });

      const counts = { all: 0, images: 0, videos: 0, audio: 0, documents: 0, archives: 0, favorites: 0, trash: 0 };
      const all = await store.listFiles({ owner: req.tgUser.id, limit: Number.MAX_SAFE_INTEGER });
      for (const f of all.items) {
        counts[f.category] = (counts[f.category] || 0) + 1;
        if (f.isFavorite) counts.favorites++;
        if (f.isDeleted) counts.trash++;
        else counts.all++;
      }
      const payload = { counts, generatedAt: Date.now() };
      caches.stats.set(key, payload, 20_000);
      res.json({ ok: true, ...payload });
    })
  );

  /** Single file. */
  router.get(
    "/files/:id",
    requireUser,
    asyncRoute(async (req, res) => {
      const file = await getStore().getFileOwned(req.params.id, req.tgUser.id);
      if (!file) return res.status(404).json({ error: "File not found", code: "NOT_FOUND" });
      res.json({ ok: true, file });
    })
  );

  /** Rename / annotate / toggle flags / set expiry. */
  router.patch(
    "/files/:id",
    requireUser,
    asyncRoute(async (req, res) => {
      const store = getStore();
      const body = req.body || {};
      const file = await store.getFileOwned(req.params.id, req.tgUser.id);
      if (!file) return res.status(404).json({ error: "File not found", code: "NOT_FOUND" });

      const patch = {};
      if (typeof body.fileName === "string") {
        const name = body.fileName.trim();
        if (!name) return res.status(400).json({ error: "File name cannot be empty", code: "EMPTY_NAME" });
        patch.fileName = name.slice(0, 200);
      }
      if (typeof body.note === "string") patch.note = body.note.slice(0, 500);
      if (typeof body.isPrivate === "boolean") patch.isPrivate = body.isPrivate;
      if (typeof body.isFavorite === "boolean") patch.isFavorite = body.isFavorite;
      if (body.expiresAt !== undefined) {
        patch.expiresAt = body.expiresAt === null ? null : new Date(body.expiresAt);
      }
      if (typeof body.expireIn === "string") {
        patch.expiresAt = AUTO_EXPIRE[body.expireIn] ? new Date(Date.now() + AUTO_EXPIRE[body.expireIn]) : null;
      }

      const updated = await store.updateFile(req.params.id, patch);
      invalidateUser(req.tgUser.id);
      res.json({ ok: true, file: updated });
    })
  );

  /** ?hard=1 deletes forever, otherwise it is a soft delete (trash). */
  router.delete(
    "/files/:id",
    requireUser,
    asyncRoute(async (req, res) => {
      const hard = req.query.hard === "1" || req.query.hard === "true";
      const store = getStore();
      const n = hard
        ? await store.deleteForever([req.params.id], req.tgUser.id)
        : await store.setDeleted([req.params.id], req.tgUser.id, true);
      if (!n) return res.status(404).json({ error: "File not found", code: "NOT_FOUND" });
      invalidateUser(req.tgUser.id);
      res.json({ ok: true, deleted: n, hard });
    })
  );

  router.post(
    "/files/:id/restore",
    requireUser,
    asyncRoute(async (req, res) => {
      const n = await getStore().setDeleted([req.params.id], req.tgUser.id, false);
      if (!n) return res.status(404).json({ error: "File not found", code: "NOT_FOUND" });
      invalidateUser(req.tgUser.id);
      res.json({ ok: true, restored: n });
    })
  );

  /** Bulk actions: send | delete | restore | favorite | unfavorite */
  router.post(
    "/files/bulk",
    requireUser,
    asyncRoute(async (req, res) => {
      const { ids, action } = req.body || {};
      if (!Array.isArray(ids) || !ids.length) {
        return res.status(400).json({ error: "No files selected", code: "EMPTY_SELECTION" });
      }
      const list = ids.slice(0, 50).map(String);
      const store = getStore();
      const owner = req.tgUser.id;
      let done = 0;
      let failed = 0;

      if (action === "delete" || action === "restore" || action === "hardDelete") {
        if (action === "hardDelete") done = await store.deleteForever(list, owner);
        else done = await store.setDeleted(list, owner, action === "delete");
        invalidateUser(owner);
        return res.json({ ok: true, done, failed, action });
      }

      if (action === "favorite" || action === "unfavorite") {
        for (const id of list) {
          const f = await store.getFileOwned(id, owner);
          if (!f) {
            failed++;
            continue;
          }
          await store.updateFile(id, { isFavorite: action === "favorite" });
          done++;
        }
        invalidateUser(owner);
        return res.json({ ok: true, done, failed, action });
      }

      if (action === "send") {
        if (!isTelegramConfigured()) {
          // demo mode: pretend everything was delivered
          return res.json({ ok: true, done: list.length, failed: 0, demo: true, action });
        }
        for (const id of list) {
          const raw = await store.getFileOwned(id, owner);
          if (!raw) {
            failed++;
            continue;
          }
          try {
            await sendStoredFile({ chatId: owner, file: raw, caption: raw.note || raw.fileName });
            done++;
          } catch {
            failed++;
          }
          await new Promise(r => setTimeout(r, 60)); // stay under Telegram's flood limits
        }
        return res.json({ ok: true, done, failed, action });
      }

      return res.status(400).json({ error: "Unknown action", code: "BAD_ACTION" });
    })
  );

  /** Send a single file back to the user's Telegram chat. */
  router.post(
    "/files/:id/send",
    requireUser,
    asyncRoute(async (req, res) => {
      const limit = limiters.write.check(`send:${req.tgUser.id}`, { max: 40 });
      if (!limit.ok) return res.status(429).json({ error: "Too many requests", code: "RATE_LIMIT" });

      const store = getStore();
      const raw = await store.getFileOwned(req.params.id, req.tgUser.id);
      if (!raw) return res.status(404).json({ error: "File not found", code: "NOT_FOUND" });

      if (!isTelegramConfigured()) {
        return res.json({ ok: true, demo: true, messageId: null });
      }

      try {
        const result = await sendStoredFile({
          chatId: req.tgUser.id,
          file: raw,
          caption: raw.note || raw.fileName
        });
        res.json({ ok: true, messageId: result?.message_id ?? null });
      } catch (e) {
        res.status(502).json({
          error: e.code === "RATE_LIMIT" ? "Too many requests" : "Telegram rejected the file",
          detail: e.description || e.message,
          code: e.code || "TELEGRAM_ERROR"
        });
      }
    })
  );

  /** Storage summary (used by the settings screen). */
  router.get(
    "/stats",
    requireUser,
    asyncRoute(async (req, res) => {
      const store = getStore();
      const stats = await store.userStats(req.tgUser.id);
      res.json({ ok: true, stats });
    })
  );

  /** Force a language re-detect from Telegram's language_code. */
  router.post(
    "/me/detect-language",
    requireUser,
    asyncRoute(async (req, res) => {
      const lang = detectLanguage(req.tgUser.languageCode);
      await updateUserLanguage(req.tgUser.id, lang);
      setUserLanguageCache(req.tgUser.id, lang);
      invalidateUser(req.tgUser.id);
      res.json({ ok: true, language: lang });
    })
  );

  return router;
}

export { queryFiles, isPreviewable, canStreamThroughTelegram, categoryOf, guessMime, getUserLanguage };
