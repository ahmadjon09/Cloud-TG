// index.js — process entry point
import "dotenv/config";
import axios from "axios";

import { connectDB, disconnectDB } from "./db.js";
import { startServer } from "./server.js";
import { preloadTranslations } from "./utils/i18n.js";
import { version } from "../i.js";

const log = (...a) => console.log(...a);

/** Keeps free-tier hosts awake (only when BASE_URL is configured). */
function keepServerAlive() {
  const base = process.env.BASE_URL;
  const interval = Number(process.env.PING_INTERVAL_MS || 10 * 60 * 1000);
  if (!base || process.env.DISABLE_PING === "true") return null;

  const ping = () =>
    axios
      .get(`${base.replace(/\/$/, "")}/hello`, { timeout: 15_000 })
      .then(() => log("🔄 Keep-alive ping OK"))
      .catch(err => log("⚠️ Keep-alive ping failed:", err.message));

  const timer = setInterval(ping, interval);
  timer.unref?.();
  ping();
  return timer;
}

async function main() {
  log(`☁️  Cloud-TG v${version} starting…`);
  log(`   node ${process.version} · ${process.env.NODE_ENV || "development"}`);

  // 1. Translations have to be ready before anything renders a message
  preloadTranslations();

  // 2. Database (falls back to the in-memory store when DEMO_MODE=true)
  const demo = process.env.DEMO_MODE === "true";
  await connectDB(process.env.MONGO_URI, { demo, forceMemory: demo && !process.env.MONGO_URI });

  // 3. HTTP
  const { server } = startServer();

  // 4. Bots are optional — the web app works without them (demo/dev)
  let bot = null;
  if (process.env.BOT_TOKEN) {
    try {
      const { startBot } = await import("./bot.js");
      bot = await startBot();
    } catch (e) {
      console.error("❌ Bot failed to start:", e.message);
    }
  } else {
    log("ℹ️  BOT_TOKEN not set — the Telegram bot is disabled");
  }

  let supportBot = null;
  if (process.env.BOT_TOKEN_SUP) {
    try {
      const { startSupportBot } = await import("./support.js");
      supportBot = startSupportBot();
    } catch (e) {
      console.error("❌ Support bot failed to start:", e.message);
    }
  }

  const ping = keepServerAlive();
  if (ping) {
    log(`🔔 Keep-alive ON → pings ${process.env.BASE_URL} every ${Math.round((Number(process.env.PING_INTERVAL_MS || 10 * 60 * 1000) / 60_000))} min`);
  } else if (process.env.BASE_URL && process.env.DISABLE_PING === "true") {
    log("🔕 Keep-alive OFF — DISABLE_PING=true. Free-tier hosts (Render/Free Fly) will sleep and cold-start on every open.");
  } else {
    log("🔕 Keep-alive OFF — BASE_URL not set. On free-tier hosts the instance will sleep after inactivity.");
  }

  const shutdown = async signal => {
    log(`\n${signal} received — shutting down…`);
    try {
      bot?.stop?.(signal);
      supportBot?.stop?.(signal);
    } catch {
      /* ignore */
    }
    server.close();
    await disconnectDB();
    setTimeout(() => process.exit(0), 300).unref?.();
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.on("unhandledRejection", err => console.error("unhandledRejection:", err?.message || err));
  process.on("uncaughtException", err => console.error("uncaughtException:", err?.message || err));
}

main().catch(err => {
  console.error("💥 Fatal error:", err);
  process.exit(1);
});
