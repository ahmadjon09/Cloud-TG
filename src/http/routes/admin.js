// http/routes/admin.js — admin-only endpoints used by /admin
import express from "express";
import os from "os";
import { getStore, getDriver } from "../../db.js";
import { asyncRoute, requireAdmin } from "../middleware.js";
import { limiters } from "../../utils/rateLimit.js";
import { caches, invalidateAll, cacheStats, cacheSize, sweepAll as sweepCaches } from "../../utils/cache.js";
import { tgCall, isTelegramConfigured } from "../../tg.js";
import { clearVerifyCache, verifyCacheSize } from "../../authWebApp.js";
import { clearAssetStores, assetStats } from "../static.js";
import { getBuildHash } from "../pages.js";
import { version } from "../../../i.js";

const startedAt = Date.now();

/** Broadcast jobs live in memory — the admin polls them every 600 ms. */
const jobs = new Map();
const history = [];

let jobSeq = 0;

function newJob(total) {
  const id = `job_${Date.now().toString(36)}_${++jobSeq}`;
  const job = {
    id,
    total,
    sent: 0,
    failed: 0,
    blocked: 0,
    status: "running",
    startedAt: Date.now(),
    finishedAt: null,
    text: ""
  };
  jobs.set(id, job);
  return job;
}

async function runBroadcast(job, targets, text, sender) {
  for (const chatId of targets) {
    if (job.status === "cancelled") break;
    try {
      await tgCall("sendMessage", {
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true
      });
      job.sent++;
    } catch (e) {
      const code = Number(e?.code || 0);
      if (code === 403) job.blocked++;
      else job.failed++;
    }
    // ~25 msg/s keeps us well inside Telegram's limits
    await new Promise(r => setTimeout(r, 45));
  }
  job.status = job.status === "cancelled" ? "cancelled" : "done";
  job.finishedAt = Date.now();
  history.unshift({
    id: job.id,
    text,
    sent: job.sent,
    failed: job.failed,
    blocked: job.blocked,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    by: sender
  });
  history.length = Math.min(history.length, 10);
  setTimeout(() => jobs.delete(job.id), 5 * 60_000).unref?.();
}

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h ${m}m` : h ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
}

export function adminRouter() {
  const router = express.Router();
  router.use(requireAdmin);

  /** Everything the dashboard needs in one request (cached 20s). */
  router.get(
    "/overview",
    asyncRoute(async (_req, res) => {
      const cached = caches.admin.get("overview");
      if (cached) return res.json({ ok: true, cached: true, ...cached });

      const store = getStore();
      const overview = await store.adminOverview();
      const payload = { ...overview, generatedAt: Date.now() };
      caches.admin.set("overview", payload, 20_000);
      res.json({ ok: true, cached: false, ...payload });
    })
  );

  router.get(
    "/users",
    asyncRoute(async (req, res) => {
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
      const skip = Math.max(0, Number(req.query.skip) || 0);
      const { items, total } = await getStore().listUsers({
        q: String(req.query.q || ""),
        sort: String(req.query.sort || "newest"),
        limit,
        skip
      });
      res.json({ ok: true, items, total, skip, limit, hasMore: skip + items.length < total });
    })
  );

  router.get(
    "/users/:id",
    asyncRoute(async (req, res) => {
      const store = getStore();
      const user = await store.getUser(req.params.id);
      if (!user) return res.status(404).json({ error: "User not found", code: "NOT_FOUND" });
      const files = await store.listFiles({ owner: req.params.id, limit: 6 });
      res.json({ ok: true, user, files: files.items, fileTotal: files.total });
    })
  );

  router.delete(
    "/users/:id/files",
    asyncRoute(async (req, res) => {
      const n = await getStore().deleteUserFiles(req.params.id);
      caches.admin.del("overview");
      res.json({ ok: true, deleted: n });
    })
  );

  router.get(
    "/files",
    asyncRoute(async (req, res) => {
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 40));
      const skip = Math.max(0, Number(req.query.skip) || 0);
      const { items, total } = await getStore().adminListFiles({
        q: String(req.query.q || ""),
        kind: String(req.query.kind || ""),
        owner: String(req.query.owner || ""),
        sort: String(req.query.sort || "newest"),
        limit,
        skip
      });
      res.json({ ok: true, items, total, skip, limit, hasMore: skip + items.length < total });
    })
  );

  router.delete(
    "/files/:id",
    asyncRoute(async (req, res) => {
      const n = await getStore().deleteForever([req.params.id]);
      if (!n) return res.status(404).json({ error: "File not found", code: "NOT_FOUND" });
      caches.admin.del("overview");
      res.json({ ok: true, deleted: n });
    })
  );

  // ---------------- broadcast ----------------
  router.get(
    "/broadcasts",
    asyncRoute(async (_req, res) => {
      res.json({ ok: true, items: history });
    })
  );

  router.post(
    "/broadcast",
    asyncRoute(async (req, res) => {
      const text = String(req.body?.text || "").trim();
      if (!text) return res.status(400).json({ error: "Message is empty", code: "EMPTY_MESSAGE" });
      if (text.length > 4000) return res.status(400).json({ error: "Message is too long", code: "TOO_LONG" });

      const limit = limiters.admin.check(`bc:${req.tgUser.id}`, { max: 5, window: 10 * 60_000 });
      if (!limit.ok) return res.status(429).json({ error: "Too many broadcasts", code: "RATE_LIMIT" });

      const targets = await getStore().broadcastTargets();
      if (!isTelegramConfigured()) {
        return res.json({ ok: true, demo: true, jobId: null, total: targets.length });
      }

      const job = newJob(targets.length);
      job.text = text;
      runBroadcast(job, targets, text, req.tgUser.firstName || req.tgUser.username || req.tgUser.id);
      res.json({ ok: true, jobId: job.id, total: job.total });
    })
  );

  router.get(
    "/broadcast/:jobId",
    asyncRoute(async (req, res) => {
      const job = jobs.get(req.params.jobId);
      if (!job) return res.status(404).json({ error: "Job not found", code: "NOT_FOUND" });
      res.json({
        ok: true,
        status: job.status,
        sent: job.sent,
        failed: job.failed,
        blocked: job.blocked,
        total: job.total,
        finishedAt: job.finishedAt
      });
    })
  );

  router.post(
    "/broadcast/:jobId/cancel",
    asyncRoute(async (req, res) => {
      const job = jobs.get(req.params.jobId);
      if (!job) return res.status(404).json({ error: "Job not found", code: "NOT_FOUND" });
      job.status = "cancelled";
      res.json({ ok: true });
    })
  );

  // ---------------- system ----------------
  router.get(
    "/system",
    asyncRoute(async (_req, res) => {
      const mem = process.memoryUsage();
      res.json({
        ok: true,
        system: {
          version,
          build: getBuildHash(),
          node: process.version,
          platform: `${os.type()} ${os.release()} (${os.arch()})`,
          env: process.env.NODE_ENV || "development",
          uptime: formatUptime(Date.now() - startedAt),
          uptimeMs: Date.now() - startedAt,
          memoryMb: Math.round((mem.rss / 1024 / 1024) * 10) / 10,
          heapMb: Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10,
          database: getDriver(),
          telegram: isTelegramConfigured(),
          demo: process.env.DEMO_MODE === "true",
          caches: cacheStats(),
          cacheEntries: cacheSize(),
          rateLimitEntries: Object.values(limiters).reduce((n, l) => n + l.size, 0),
          initDataCache: verifyCacheSize(),
          assets: assetStats()
        }
      });
    })
  );

  router.post(
    "/cache/clear",
    asyncRoute(async (_req, res) => {
      const cleared = {
        app: invalidateAll(),
        initData: clearVerifyCache(),
        assets: clearAssetStores()
      };
      res.json({ ok: true, cleared });
    })
  );

  router.post(
    "/cleanup",
    asyncRoute(async (_req, res) => {
      const n = await getStore().cleanupExpired();
      caches.admin.del("overview");
      res.json({ ok: true, deleted: n });
    })
  );

  router.post(
    "/sweep",
    asyncRoute(async (_req, res) => {
      const swept = sweepCaches();
      res.json({ ok: true, swept });
    })
  );

  return router;
}
