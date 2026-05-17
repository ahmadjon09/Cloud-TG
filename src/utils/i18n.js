// utils/i18n.js — Full i18n utility for Cloud Bot
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { UserModel } from "../models/User.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const LANGUAGES = ["en", "uz", "ru", "ch", "es", "fr"];
export const DEFAULT_LANG = "en";

const LANG_NAMES = {
    en: "English",
    uz: "O'zbek",
    ru: "Русский",
    ch: "中文",
    es: "Español",
    fr: "Français"
};

export function getLanguageName(lang) {
    return LANG_NAMES[lang] || LANG_NAMES[DEFAULT_LANG];
}

// ==================== TRANSLATIONS CACHE ====================
const translationsCache = new Map();

export async function preloadTranslations() {
    for (const lang of LANGUAGES) {
        await loadTranslation(lang);
    }
    console.log(`✅ Translations preloaded: ${LANGUAGES.join(", ")}`);
}

async function loadTranslation(lang) {
    if (translationsCache.has(lang)) return translationsCache.get(lang);
    try {
        const filePath = path.join(__dirname, `../locales/${lang}.json`);
        const raw = fs.readFileSync(filePath, "utf-8");
        const data = JSON.parse(raw);
        translationsCache.set(lang, data);
        return data;
    } catch (e) {
        console.warn(`⚠️ Translation file not found for: ${lang}, falling back to en`);
        if (lang !== DEFAULT_LANG) return loadTranslation(DEFAULT_LANG);
        return {};
    }
}

// ==================== GET NESTED KEY ====================
function getNestedValue(obj, key) {
    return key.split(".").reduce((o, k) => (o && o[k] !== undefined ? o[k] : null), obj);
}

// ==================== INTERPOLATE ====================
function interpolate(template, vars = {}) {
    if (!template) return "";
    return template.replace(/\{(\w+)\}/g, (_, key) =>
        vars[key] !== undefined ? String(vars[key]) : `{${key}}`
    );
}

// ==================== TRANSLATE ====================
export async function t(lang, key, vars = {}) {
    const safeL = LANGUAGES.includes(lang) ? lang : DEFAULT_LANG;
    const data = await loadTranslation(safeL);
    let value = getNestedValue(data, key);

    // Fallback to English
    if (value === null && safeL !== DEFAULT_LANG) {
        const fallback = await loadTranslation(DEFAULT_LANG);
        value = getNestedValue(fallback, key);
    }

    if (value === null) {
        console.warn(`[i18n] Missing key: "${key}" for lang: "${lang}"`);
        return key;
    }

    return interpolate(String(value), vars);
}

// ==================== USER LANGUAGE ====================
const userLangCache = new Map(); // uid -> lang

export async function getUserLanguage(uid) {
    if (userLangCache.has(uid)) return userLangCache.get(uid);
    try {
        const user = await UserModel.findOne({ tgUserId: String(uid) }, { language: 1 }).lean();
        const lang = user?.language || DEFAULT_LANG;
        userLangCache.set(uid, lang);
        return lang;
    } catch {
        return DEFAULT_LANG;
    }
}

export async function updateUserLanguage(uid, lang) {
    if (!LANGUAGES.includes(lang)) return;
    await UserModel.updateOne({ tgUserId: String(uid) }, { $set: { language: lang } });
    userLangCache.set(uid, lang);
}

export function invalidateUserLang(uid) {
    userLangCache.delete(uid);
}

// ==================== TRANSLATOR FACTORY ====================
// Returns a bound translator for a specific user/lang
export async function getUserTranslator(uid) {
    const lang = await getUserLanguage(uid);
    return async function tr(key, vars = {}) {
        return t(lang, key, vars);
    };
}

// ==================== DETECT LANGUAGE ====================
// Auto-detect from Telegram language_code
export function detectLanguage(languageCode) {
    if (!languageCode) return DEFAULT_LANG;
    const code = languageCode.toLowerCase().split("-")[0];
    if (LANGUAGES.includes(code)) return code;
    return DEFAULT_LANG;
}