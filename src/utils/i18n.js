// utils/i18n.js — single source of truth for bot + web app translations
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { LANGUAGES, DEFAULT_LANG, LANG_NAMES, LANG_FLAGS, LANG_HTML, normalizeLang } from "./languages.js";
import { getStore } from "../db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = path.join(__dirname, "..", "locales");

export {
  LANGUAGES,
  DEFAULT_LANG,
  LANG_NAMES,
  LANG_FLAGS,
  LANG_HTML,
  normalizeLang
} from "./languages.js";

export function getLanguageName(lang) {
  return LANG_NAMES[lang] || LANG_NAMES[DEFAULT_LANG];
}

/**
 * Detect language from Telegram's `language_code`.
 * `zh-hans` → "ch" so Chinese users are matched too.
 */
export function detectLanguage(languageCode) {
  return normalizeLang(languageCode, DEFAULT_LANG);
}

// ==================== LOADING ====================
// Files are tiny (a few KB each) so we read them once, synchronously, at boot.
const translations = new Map();

function readLocale(lang) {
  try {
    const raw = fs.readFileSync(path.join(LOCALES_DIR, `${lang}.json`), "utf8");
    return JSON.parse(raw);
  } catch (e) {
    console.error(`[i18n] Failed to read locale "${lang}":`, e.message);
    return null;
  }
}

export function preloadTranslations() {
  let ok = 0;
  for (const lang of LANGUAGES) {
    const data = readLocale(lang);
    if (data) {
      translations.set(lang, data);
      ok++;
    }
  }
  console.log(`🌐 Translations loaded: ${ok}/${LANGUAGES.length} (${LANGUAGES.join(", ")})`);
  return ok;
}

function bundle(lang) {
  if (!translations.size) preloadTranslations();
  return translations.get(lang) || translations.get(DEFAULT_LANG) || {};
}

function getNested(obj, key) {
  let cur = obj;
  for (const part of key.split(".")) {
    if (cur == null || typeof cur !== "object") return null;
    cur = cur[part];
  }
  return typeof cur === "string" ? cur : null;
}

function interpolate(template, vars = {}) {
  if (!template) return "";
  if (!vars || !Object.keys(vars).length) return template;
  return template.replace(/\{(\w+)\}/g, (_, key) =>
    vars[key] !== undefined && vars[key] !== null ? String(vars[key]) : `{${key}}`
  );
}

// ==================== TRANSLATE ====================
const missingReported = new Set();

/** Synchronous translate — safe to call anywhere after `preloadTranslations()`. */
export function translate(lang, key, vars = {}) {
  const safeLang = LANGUAGES.includes(lang) ? lang : DEFAULT_LANG;
  let value = getNested(bundle(safeLang), key);

  if (value === null && safeLang !== DEFAULT_LANG) {
    value = getNested(bundle(DEFAULT_LANG), key);
  }
  if (value === null) {
    if (!missingReported.has(key)) {
      missingReported.add(key);
      console.warn(`[i18n] Missing key: "${key}" (lang: ${safeLang})`);
    }
    return key;
  }
  return interpolate(value, vars);
}

/** Async translate (kept for backwards compatibility). */
export async function t(lang, key, vars = {}) {
  return translate(lang, key, vars);
}

/**
 * Web bundle served to the browser: only the keys the UI needs.
 * Everything else (bot commands, admin copy for Telegram…) stays server-side.
 */
export function webBundle(lang) {
  const safeLang = LANGUAGES.includes(lang) ? lang : DEFAULT_LANG;
  const data = bundle(safeLang);
  return {
    lang: safeLang,
    dir: "ltr",
    names: LANG_NAMES,
    flags: LANG_FLAGS,
    html: LANG_HTML[safeLang] || LANG_HTML.en,
    ...(data.web || {}),
    common: data.common || {},
    langs: data.langs || {},
    expiry: {
      none: data.expiry?.none,
      "24h": data.expiry?.["24h"],
      "7d": data.expiry?.["7d"],
      "30d": data.expiry?.["30d"],
      "90d": data.expiry?.["90d"]
    }
  };
}

// ==================== USER LANGUAGE ====================
const userLangCache = new Map(); // uid -> { lang, at }
const USER_LANG_TTL = 5 * 60 * 1000;

/**
 * Reads the language through the active store driver, so it works with both
 * MongoDB and the in-memory demo store.
 */
export async function getUserLanguage(uid) {
  const key = String(uid);
  const hit = userLangCache.get(key);
  if (hit && Date.now() - hit.at < USER_LANG_TTL) return hit.lang;
  try {
    const user = await getStore().getUser(key);
    const lang = normalizeLang(user?.language, DEFAULT_LANG);
    userLangCache.set(key, { lang, at: Date.now() });
    return lang;
  } catch (e) {
    console.error("[i18n] getUserLanguage failed:", e.message);
    return DEFAULT_LANG;
  }
}

export function setUserLanguageCache(uid, lang) {
  userLangCache.set(String(uid), { lang, at: Date.now() });
}

export async function updateUserLanguage(uid, lang) {
  const safe = normalizeLang(lang, null);
  if (!safe) return null;
  await getStore().updateUser(String(uid), { language: safe });
  setUserLanguageCache(uid, safe);
  return safe;
}

export function invalidateUserLang(uid) {
  userLangCache.delete(String(uid));
}

export async function clearLangCache() {
  const size = userLangCache.size;
  userLangCache.clear();
  return size;
}

// ==================== TRANSLATOR FACTORY ====================
/** Bound translator: `await tr("menu.myFiles", { count: 3 })` */
export async function getUserTranslator(uid) {
  const lang = await getUserLanguage(uid);
  return (key, vars = {}) => translate(lang, key, vars);
}
