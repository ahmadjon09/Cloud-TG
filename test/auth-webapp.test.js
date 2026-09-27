import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import { once } from "node:events";
import { clearVerifyCache, webAppAuthMiddleware } from "../src/authWebApp.js";

function initData(token, { id = "42", authDate = Math.floor(Date.now() / 1000) } = {}) {
  const params = new URLSearchParams({
    auth_date: String(authDate),
    user: JSON.stringify({ id, first_name: "Test", username: "test_user" })
  });
  const data = [...params]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(token).digest();
  params.set("hash", crypto.createHmac("sha256", secret).update(data).digest("hex"));
  return params.toString();
}

test("verified Telegram initData creates a same-user session bridge", async t => {
  const old = {
    token: process.env.BOT_TOKEN,
    initTtl: process.env.INIT_DATA_TTL,
    sessionTtl: process.env.WEB_SESSION_TTL,
    nodeEnv: process.env.NODE_ENV
  };
  process.env.BOT_TOKEN = "session-test-token";
  // Invalid zero values used to make every auth payload immediately expire.
  process.env.INIT_DATA_TTL = "0";
  process.env.WEB_SESSION_TTL = "3600";
  process.env.NODE_ENV = "production";
  clearVerifyCache();
  t.after(() => {
    clearVerifyCache();
    for (const [name, value] of Object.entries({
      BOT_TOKEN: old.token,
      INIT_DATA_TTL: old.initTtl,
      WEB_SESSION_TTL: old.sessionTtl,
      NODE_ENV: old.nodeEnv
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  const app = express();
  app.get("/whoami", webAppAuthMiddleware, (req, res) => {
    res.json({ id: req.tgUser.id, source: req.tgAuth.source });
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  const first = await fetch(`${base}/whoami`, {
    headers: { "x-telegram-init-data": initData(process.env.BOT_TOKEN, { authDate: Math.floor(Date.now() / 1000) - 120 }) }
  });
  assert.equal(first.status, 200, "INIT_DATA_TTL=0 falls back to the safe default");
  assert.deepEqual(await first.json(), { id: "42", source: "telegram" });
  const setCookie = first.headers.get("set-cookie");
  assert.match(setCookie || "", /cloud_tg_session=/);
  assert.match(setCookie || "", /HttpOnly/i);
  assert.match(setCookie || "", /Secure/i);
  assert.match(setCookie || "", /Partitioned/i);
  assert.match(setCookie || "", /SameSite=None/i);
  const cookie = String(setCookie).split(";", 1)[0];

  // The browser can continue with its signed session after Telegram's one-day
  // payload expires, as long as the signed stale payload is for the same user.
  const stale = initData(process.env.BOT_TOKEN, { authDate: Math.floor(Date.now() / 1000) - 2 * 24 * 60 * 60 });
  const bridged = await fetch(`${base}/whoami`, {
    headers: {
      cookie,
      "x-cloud-session": "1",
      "x-telegram-init-data": stale
    }
  });
  assert.equal(bridged.status, 200);
  assert.deepEqual(await bridged.json(), { id: "42", source: "session" });

  const csrfAttempt = await fetch(`${base}/whoami`, { headers: { cookie } });
  assert.equal(csrfAttempt.status, 401, "cookie fallback requires the app's custom request header");

  // A stale payload from a different Telegram account must never unlock the
  // signed browser session belonging to the first account.
  const otherUser = await fetch(`${base}/whoami`, {
    headers: {
      cookie,
      "x-cloud-session": "1",
      "x-telegram-init-data": initData(process.env.BOT_TOKEN, {
        id: "99",
        authDate: Math.floor(Date.now() / 1000) - 2 * 24 * 60 * 60
      })
    }
  });
  assert.equal(otherUser.status, 401);
  assert.equal((await otherUser.json()).code, "INIT_DATA_EXPIRED");
});
