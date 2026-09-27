// utils/languages.js — language constants (kept dependency-free so models can import them
// without creating a circular dependency with i18n.js)
export const LANGUAGES = ["en", "uz", "ru", "ch", "es", "fr"];
export const DEFAULT_LANG = "en";

export const LANG_NAMES = {
  en: "English",
  uz: "O'zbek",
  ru: "Русский",
  ch: "中文",
  es: "Español",
  fr: "Français"
};

export const LANG_FLAGS = {
  en: "🇬🇧",
  uz: "🇺🇿",
  ru: "🇷🇺",
  ch: "🇨🇳",
  es: "🇪🇸",
  fr: "🇫🇷"
};

// BCP-47 tags used for dates/numbers
export const LANG_HTML = {
  en: "en-US",
  uz: "uz-UZ",
  ru: "ru-RU",
  ch: "zh-CN",
  es: "es-ES",
  fr: "fr-FR"
};

export function isSupportedLang(code) {
  return typeof code === "string" && LANGUAGES.includes(code);
}

/** Accepts "en", "en-US", "EN", "zh-hans" … → "en" | fallback */
export function normalizeLang(code, fallback = DEFAULT_LANG) {
  if (!code || typeof code !== "string") return fallback;
  const raw = code.toLowerCase().replace(/_/g, "-");
  if (raw.startsWith("zh")) return "ch";
  const base = raw.split("-")[0].trim();
  return LANGUAGES.includes(base) ? base : fallback;
}
