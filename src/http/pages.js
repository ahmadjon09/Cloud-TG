// http/pages.js — renders the HTML shells with a boot payload inlined
// (saves a round-trip on first paint and lets us cache-bust assets properly)
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { LANGUAGES, LANG_NAMES, LANG_FLAGS } from "../utils/i18n.js";
import { getDriver } from "../db.js";
import { version } from "../../i.js";

let buildHash = "dev";
let publicDir = "";

/** Hash of the public assets — changes on every deploy, used as `?v=` */
export function computeBuildHash(dir) {
  publicDir = dir;
  const hash = crypto.createHash("sha1");
  const walk = d => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        const st = fs.statSync(full);
        hash.update(entry.name).update(String(st.mtimeMs)).update(String(st.size));
      }
    }
  };
  try {
    walk(dir);
    buildHash = hash.digest("hex").slice(0, 10);
  } catch {
    buildHash = "dev";
  }
  return buildHash;
}

export function getBuildHash() {
  return buildHash;
}

function bootPayload(req) {
  const demo = process.env.DEMO_MODE === "true" || req.tgAuth?.demo === true;
  return {
    version,
    build: buildHash,
    demo,
    driver: getDriver(),
    defaultLang: "en",
    languages: LANGUAGES.map(code => ({ code, name: LANG_NAMES[code], flag: LANG_FLAGS[code] })),
    localesBase: "/locales",
    maxBytes: 50 * 1024 * 1024,
    botUsername: process.env.BOT_USERNAME || "",
    telegram: Boolean(process.env.BOT_TOKEN)
  };
}

function render(template, tokens) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    tokens[key] !== undefined ? String(tokens[key]) : ""
  );
}

/**
 * HTML page renderer.
 * @param {string} file  absolute path to the HTML template
 * @param {object} opts  { extra: (req) => object, cacheControl }
 */
export function pageHandler(file, { extra, cacheControl = "no-cache", title } = {}) {
  const template = fs.readFileSync(file, "utf8");
  return function handler(req, res) {
    const boot = { ...bootPayload(req), ...(typeof extra === "function" ? extra(req) : {}) };
    const html = render(template, {
      VERSION: version,
      BUILD: buildHash,
      LANG: req.query.lang && LANGUAGES.includes(String(req.query.lang)) ? String(req.query.lang) : "en",
      BOOT: JSON.stringify(boot).replace(/</g, "\\u003c"),
      TITLE: title || "Cloud"
    });
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.setHeader("cache-control", cacheControl);
    res.setHeader("etag", `W/"${buildHash}-${title || "page"}"`);
    res.send(html);
  };
}

export function publicDirPath() {
  return publicDir;
}
