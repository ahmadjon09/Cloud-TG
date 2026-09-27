// i18n.js — loads /locales/<lang>.json and translates the UI
import { $, $$, store } from "./core.js";

const CACHE_KEY = "i18nCache";          // { [lang]: bundle }
const CACHE_VERSION_KEY = "i18nVersion";

let currentLang = "en";
let bundle = { nav: {}, action: {} };
let fallback = { nav: {}, action: {} };
let listeners = [];
let boot = readBoot();

function readBoot() {
  try {
    return JSON.parse(document.getElementById("boot")?.textContent || "{}");
  } catch {
    return {};
  }
}

export function bootConfig() {
  return boot;
}

function diskCache() {
  const version = store.get(CACHE_VERSION_KEY, "");
  if (version !== boot.build) {
    store.set(CACHE_VERSION_KEY, boot.build);
    store.set(CACHE_KEY, {});
    return {};
  }
  return store.get(CACHE_KEY, {}) || {};
}

function saveDiskCache(cache) {
  store.set(CACHE_KEY, cache);
}

function get(obj, path) {
  let cur = obj;
  for (const part of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[part];
  }
  return typeof cur === "string" ? cur : undefined;
}

function interpolate(str, vars) {
  if (!vars) return str;
  return str.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : `{${k}}`));
}

/** Translate a key, e.g. t("nav.images") */
export function t(key, vars) {
  let value = get(bundle, key);
  if (value === undefined) value = get(fallback, key);
  if (value === undefined) {
    // last resort: the key itself (so a missing string is obvious in review)
    return key;
  }
  return interpolate(value, vars);
}

export function lang() {
  return currentLang;
}

export function htmlLang() {
  return bundle.html || "en-US";
}

export function onChange(fn) {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter(f => f !== fn);
  };
}

async function fetchBundle(language) {
  const res = await fetch(`/locales/${language}.json`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Failed to load ${language} (${res.status})`);
  return res.json();
}

/**
 * Loads a language bundle (memory → localStorage → network).
 * Falls back to English if the request fails.
 */
export async function loadLanguage(language, { silent = false } = {}) {
  const target = language || "en";
  const cache = diskCache();

  if (!bundle || bundle.lang !== target) {
    // try cache first for instant switching
    if (cache[target]) bundle = cache[target];
  }
  if (bundle?.lang !== target) {
    try {
      bundle = await fetchBundle(target);
      cache[target] = bundle;
      saveDiskCache(cache);
    } catch {
      bundle = cache[target] || {};
    }
  }
  if (target !== "en") {
    if (cache.en) fallback = cache.en;
    else {
      try {
        fallback = await fetchBundle("en");
        cache.en = fallback;
        saveDiskCache(cache);
      } catch {
        fallback = fallback?.lang ? fallback : {};
      }
    }
  } else {
    fallback = bundle;
  }

  currentLang = target;
  document.documentElement.lang = target;
  document.documentElement.dir = bundle.dir || "ltr";
  if (!silent) applyStatic();
  listeners.forEach(fn => fn(target));
  return target;
}

/** Rewrites every [data-i18n] / [data-i18n-placeholder] / [data-i18n-title] node */
export function applyStatic(root = document) {
  $$("[data-i18n]", root).forEach(node => {
    node.textContent = t(node.dataset.i18n);
  });
  $$("[data-i18n-placeholder]", root).forEach(node => {
    node.placeholder = t(node.dataset.i18nPlaceholder);
  });
  $$("[data-i18n-title]", root).forEach(node => {
    const value = t(node.dataset.i18nTitle);
    node.setAttribute("title", value);
    node.setAttribute("aria-label", value);
  });
}

/** Language list for the picker (from the boot payload) */
export function languages() {
  return boot.languages || [{ code: "en", name: "English", flag: "🇬🇧" }];
}

/** Best guess before we know the account language */
export function guessLanguage() {
  const saved = store.get("lang");
  if (saved && languages().some(l => l.code === saved)) return saved;
  const tgLang = window.Telegram?.WebApp?.initDataUnsafe?.user?.language_code;
  if (tgLang) {
    const base = tgLang.toLowerCase().split("-")[0];
    if (base === "zh") return "ch";
    if (languages().some(l => l.code === base)) return base;
  }
  const nav = (navigator.language || "en").toLowerCase().split("-")[0];
  if (nav === "zh") return "ch";
  if (languages().some(l => l.code === nav)) return nav;
  return "en";
}

export function rememberLanguage(code) {
  store.set("lang", code);
}
