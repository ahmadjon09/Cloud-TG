// bot.js - Ultra-Fast Cloud Bot — Full i18n v3
import { Telegraf, Markup, session } from "telegraf";
import { UserModel } from "./models/User.js";
import { FileModel } from "./models/File.js";
import { version } from "../i.js";
import crypto from "crypto";
import {
    t,
    detectLanguage,
    getLanguageName,
    getUserTranslator,
    getUserLanguage,
    updateUserLanguage,
    invalidateUserLang,
    preloadTranslations,
    LANGUAGES,
    DEFAULT_LANG,
} from "./utils/i18n.js";

// ==================== CONFIG ====================
const E = {
    cloud: "☁️", files: "📁", search: "🔍", folders: "🗂️", expire: "⏰",
    share: "🔗", settings: "⚙️", about: "ℹ️", help: "🆘", download: "📥",
    upload: "📤", rename: "✏️", delete: "🗑️", private: "🔒", unlock: "🔓",
    move: "📤", doc: "📄", photo: "🖼️", video: "🎬", audio: "🎵", voice: "🎙️",
    success: "✅", warning: "⚠️", error: "❌", back: "↩️", cancel: "🚫",
    loading: "🔄", stats: "📊", broadcast: "📢", cleanup: "🧹", users: "👥",
    cache: "💾", "24h": "🌙", "7d": "📅", "30d": "🗓️", "90d": "📆",
    none: "♾️", prev: "◀️", next: "▶️", folder: "📂", new: "➕", info: "ℹ️",
    crown: "👑", rocket: "🚀", save: "💾", check: "✅", trash: "🗑️",
    lock: "🔒", key: "🔑", pin: "📌", bell: "🔔", mute: "🔕", home: "🏠",
    chart: "📈",
};

// Premium emoji ID lar — faqat <tg-emoji> HTML tag ichida ishlaydi
const PEMOJI = {
    cloud: "5368324370624634888", files: "5368324370624634889",
    search: "5368324370624634890", folders: "5368324370624634891",
    expire: "5368324370624634892", share: "5368324370624634893",
    settings: "5368324370624634894", about: "5368324370624634895",
    help: "5368324370624634896", download: "5368324370624634897",
    upload: "5368324370624634898", rename: "5368324370624634899",
    delete: "5368324370624634900", private: "5368324370624634901",
    unlock: "5368324370624634902", move: "5368324370624634903",
    doc: "5368324370624634904", photo: "5368324370624634905",
    video: "5368324370624634906", audio: "5368324370624634907",
    voice: "5368324370624634908", success: "5368324370624634909",
    warning: "5368324370624634910", error: "5368324370624634911",
    back: "5368324370624634912", cancel: "5368324370624634913",
    loading: "5368324370624634914", stats: "5368324370624634915",
    broadcast: "5368324370624634916", cleanup: "5368324370624634917",
    users: "5368324370624634918", cache: "5368324370624634919",
    "24h": "5368324370624634920", "7d": "5368324370624634921",
    "30d": "5368324370624634922", "90d": "5368324370624634923",
    none: "5368324370624634924", prev: "5368324370624634925",
    next: "5368324370624634926",
};

const pe = (key, fallback) =>
    PEMOJI[key]
        ? `<tg-emoji emoji-id="${PEMOJI[key]}">${fallback || E[key] || "⭐"}</tg-emoji>`
        : (fallback || E[key] || "⭐");

const CONFIG = {
    CACHE_TTL: { USER: 300_000, STATS: 120_000, FILES: 60_000, ADMIN: 60_000 },
    RATE_LIMIT: { window: 60_000, maxRequests: 25 },
    FILE_LIMITS: {
        document: 50 * 1024 * 1024, video: 50 * 1024 * 1024,
        audio: 50 * 1024 * 1024, voice: 50 * 1024 * 1024, photo: 10 * 1024 * 1024,
    },
    MEDIA_GROUP_DEBOUNCE: 1500,
};

// ==================== IN-MEMORY CACHE ====================
const cache = new Map();

const memoryCache = {
    set(key, value, ttl) { cache.set(key, { value, expires: Date.now() + ttl }); },
    get(key) {
        const item = cache.get(key);
        if (!item) return null;
        if (Date.now() > item.expires) { cache.delete(key); return null; }
        return item.value;
    },
    del(key) { cache.delete(key); },
    delPattern(pattern) {
        const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*");
        const regex = new RegExp(`^${escaped}$`);
        for (const key of cache.keys()) { if (regex.test(key)) cache.delete(key); }
    },
    clear() { cache.clear(); },
};

// ==================== RATE LIMITER ====================
const rateLimitMap = new Map();

function checkRateLimit(userId) {
    const now = Date.now();
    if (!rateLimitMap.has(userId)) rateLimitMap.set(userId, []);
    const requests = rateLimitMap.get(userId);
    while (requests.length && now - requests[0] >= CONFIG.RATE_LIMIT.window) requests.shift();
    if (requests.length >= CONFIG.RATE_LIMIT.maxRequests) return false;
    requests.push(now);
    return true;
}

// ==================== MEDIA GROUP BATCH ====================
const mediaGroupMap = new Map();

function addToMediaGroup(uid, fileInfo, onFlush) {
    if (!mediaGroupMap.has(uid)) mediaGroupMap.set(uid, { timer: null, files: [] });
    const group = mediaGroupMap.get(uid);
    group.files.push(fileInfo);
    if (group.timer) clearTimeout(group.timer);
    group.timer = setTimeout(() => {
        const g = mediaGroupMap.get(uid);
        if (g) { mediaGroupMap.delete(uid); onFlush(g.files); }
    }, CONFIG.MEDIA_GROUP_DEBOUNCE);
}

// ==================== UTILS ====================
const escapeHtml = (text) =>
    text ? String(text)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
        : "";

const formatFileSize = (bytes) => {
    if (!bytes) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let i = 0, size = bytes;
    while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
    return `${size.toFixed(i ? 1 : 0)} ${units[i]}`;
};

const formatTime = (date) => {
    const diff = Date.now() - new Date(date);
    const m = Math.floor(diff / 60000);
    const h = Math.floor(diff / 3600000);
    const d = Math.floor(diff / 86400000);
    return d ? `${d}d ago` : h ? `${h}h ago` : m ? `${m}m ago` : "just now";
};

const formatError = (err) =>
    `${pe("error", "❌")} <b>Error</b>\n<code>${escapeHtml((err?.message || String(err)).slice(0, 400))}</code>`;

const isAdmin = (id) =>
    process.env.ADMIN_IDS?.split(",").map(s => s.trim()).includes(String(id));

const webAppUrl = () => {
    const base = process.env.BASE_URL;
    if (!base || !base.startsWith("https://")) return null;
    return `${base}`;
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const invalidateUser = (uid) => {
    memoryCache.del(`user:${uid}`);
    memoryCache.del(`stats:${uid}`);
    memoryCache.delPattern(`files:${uid}:*`);
    invalidateUserLang(uid);
};

// ==================== SESSION ====================
function ensureSession(ctx) {
    if (!ctx.session) ctx.session = {};
    return ctx.session;
}

// ==================== MESSAGE HELPERS ====================
async function safeEdit(ctx, text, keyboard) {
    try {
        const rm = keyboard?.reply_markup ?? keyboard;
        await ctx.editMessageText(text, {
            parse_mode: "HTML",
            reply_markup: rm,
            disable_web_page_preview: true,
        });
    } catch (e) {
        if (e?.code === 400 && e.description?.includes("not modified")) return;
        if (e?.code === 400 && e.description?.includes("not found")) {
            await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard?.reply_markup });
            return;
        }
        throw e;
    }
}

async function withLoading(ctx, fn, msg = "⏳ Processing...") {
    let loadMsg;
    try {
        loadMsg = await ctx.reply(msg);
        const res = await fn();
        await ctx.deleteMessage(loadMsg.message_id).catch(() => { });
        return res;
    } catch (err) {
        if (loadMsg) await ctx.deleteMessage(loadMsg.message_id).catch(() => { });
        console.error("Handler error:", err.message);
        await ctx.reply(formatError(err), { parse_mode: "HTML" }).catch(() => { });
    }
}

// ==================== KEYBOARDS ====================
const KB = {
    // 🏠 MAIN MENU
    main: async (uid) => {
        const appUrl = webAppUrl();
        const tr = await getUserTranslator(uid);
        return Markup.inlineKeyboard([
            ...(appUrl ? [[
                Markup.button.webApp(`🌐 ${await tr("menu.myFiles")}`, `${appUrl}/app`),
                Markup.button.webApp(`🌌 Gallery`, `${appUrl}/gallery`)
            ]] : []),
            [
                Markup.button.callback(`📁 ${await tr("menu.myFiles")}`, "MY_FILES"),
                Markup.button.callback(`🔍 ${await tr("menu.search")}`, "SEARCH_MAIN"),
            ],
            [
                Markup.button.callback(`🗂️ ${await tr("menu.folders")}`, "FOLDERS_MAIN"),
                Markup.button.callback(`⏰ ${await tr("menu.expiring")}`, "EXPIRING_MAIN"),
            ],
            [
                Markup.button.callback(`🔗 ${await tr("menu.share")}`, "SHARE_MAIN"),
                Markup.button.callback(`⚙️ ${await tr("menu.settings")}`, "SETTINGS_MAIN"),
            ],
            [
                Markup.button.callback(`ℹ️ ${await tr("menu.about")}`, "ABOUT"),
                Markup.button.callback(`🆘 ${await tr("menu.help")}`, "HELP"),
            ],
        ]);
    },

    // 📁 FILE ACTIONS — translated
    files: async (fileId, uid) => {
        const tr = uid ? await getUserTranslator(uid) : async (k) => k;
        return Markup.inlineKeyboard([
            [
                Markup.button.callback(`📥 ${await tr("files.download")}`, `DL:${fileId}`),
                Markup.button.callback(`🔗 ${await tr("menu.share")}`, `SHARE_SELECT:${fileId}`),
            ],
            [
                Markup.button.callback(`✏️ ${await tr("files.rename")}`, `RENAME:${fileId}`),
                Markup.button.callback(`🗑️ ⚠️ ${await tr("files.delete")}`, `DELETE:${fileId}`),
            ],
            [
                Markup.button.callback(`🔒 ${await tr("files.togglePrivate")}`, `PRIV:${fileId}`),
                Markup.button.callback(`⏰ ${await tr("files.setExpiry")}`, `EXP:${fileId}`),
            ],
            [
                Markup.button.callback(`📂 ${await tr("files.move")}`, `MOVE:${fileId}`),
                Markup.button.callback(`↩️ ${await tr("files.back")}`, "MY_FILES"),
            ],
        ]);
    },

    // 🗂️ FOLDERS — translated
    folders: async (uid) => {
        const tr = uid ? await getUserTranslator(uid) : async (k) => k;
        return Markup.inlineKeyboard([
            [Markup.button.callback(`➕ ${await tr("folders.newFolder")}`, "FOLDER_CREATE")],
            [Markup.button.callback(`📂 ${await tr("folders.viewAll")}`, "FOLDER_LIST")],
            [Markup.button.callback(`📤 ${await tr("folders.moveFiles")}`, "FOLDER_MOVE_SELECT")],
            [Markup.button.callback(`↩️ ${await tr("files.back")}`, "MAIN")],
        ]);
    },

    // 🔍 SEARCH — translated
    search: async (uid) => {
        const tr = uid ? await getUserTranslator(uid) : async (k) => k;
        return Markup.inlineKeyboard([
            [{ text: `🔍 ${await tr("menu.search")}...`, switch_inline_query_current_chat: "" }],
            [
                Markup.button.callback(`📄 ${await tr("search.docs")}`, "SRCH:document"),
                Markup.button.callback(`🖼️ ${await tr("search.photos")}`, "SRCH:photo"),
            ],
            [
                Markup.button.callback(`🎬 ${await tr("search.video")}`, "SRCH:video"),
                Markup.button.callback(`🎵 ${await tr("search.audio")}`, "SRCH:audio"),
            ],
            [
                Markup.button.callback(`🔄 ${await tr("search.clearFilter")}`, "SRCH:CLEAR"),
                Markup.button.callback(`↩️ ${await tr("files.back")}`, "MAIN"),
            ],
        ]);
    },

    // ⚙️ SETTINGS — translated
    settings: async (user, uid) => {
        const tr = await getUserTranslator(uid || user?.tgUserId || "0");
        const notifOn = user?.settings?.notifications !== false;
        const privOn = user?.settings?.privateByDefault === true;
        const langName = getLanguageName(user?.language || DEFAULT_LANG);
        return Markup.inlineKeyboard([
            [
                Markup.button.callback(
                    await tr("settings.notifications", { icon: notifOn ? "🔔" : "🔕", status: notifOn ? await tr("common.on") : await tr("common.off") }),
                    `SET:NOTIF:${notifOn ? "off" : "on"}`
                ),
                Markup.button.callback(
                    await tr("settings.privateDefault", { icon: privOn ? "🔒" : "🔓", status: privOn ? await tr("common.on") : await tr("common.off") }),
                    "SET:PRIV:toggle"
                ),
            ],
            [Markup.button.callback(`⏰ ${await tr("settings.autoExpire")}`, "SET:EXPIRE:menu")],
            [Markup.button.callback(`🌐 ${await tr("settings.language", { lang: langName })}`, "SET:LANG:menu")],
            [
                Markup.button.callback(`💾 ${await tr("settings.clearCache")}`, "SET:CACHE"),
                Markup.button.callback(`📊 ${await tr("settings.myStats")}`, "SET:STATS"),
            ],
            [Markup.button.callback(`↩️ ${await tr("files.back")}`, "MAIN")],
        ]);
    },

    // 🌐 LANGUAGE MENU
    languageMenu: async (uid) => {
        const tr = await getUserTranslator(uid);
        return Markup.inlineKeyboard([
            [
                Markup.button.callback("🇬🇧 English", "LANG:en"),
                Markup.button.callback("🇺🇿 O'zbek", "LANG:uz"),
                Markup.button.callback("🇷🇺 Русский", "LANG:ru"),

            ],
            [
                Markup.button.callback("🇨🇳 中文", "LANG:ch"),
                Markup.button.callback("🇪🇸 Español", "LANG:es"),
                Markup.button.callback("🇫🇷 Français", "LANG:fr")
            ],
            [Markup.button.callback(`↩️ ${await tr("files.back")}`, "SETTINGS_MAIN")],
        ]);
    },

    // ⏰ EXPIRY — Global — translated
    expireMenu: async (uid) => {
        const tr = uid ? await getUserTranslator(uid) : async (k) => k;
        return Markup.inlineKeyboard([
            [
                Markup.button.callback(`🌙 ${await tr("expiry.24h")}`, "EXPSET:24h"),
                Markup.button.callback(`📅 ${await tr("expiry.7d")}`, "EXPSET:7d"),
            ],
            [
                Markup.button.callback(`🗓️ ${await tr("expiry.30d")}`, "EXPSET:30d"),
                Markup.button.callback(`📆 ${await tr("expiry.90d")}`, "EXPSET:90d"),
            ],
            [
                Markup.button.callback(`♾️ ${await tr("expiry.none")}`, "EXPSET:none"),
                Markup.button.callback(`🚫 ${await tr("expiry.cancel")}`, "CANCEL_ACTION"),
            ],
        ]);
    },

    // ⏰ EXPIRY — Per File — translated
    expireMenuForFile: async (uid) => {
        const tr = uid ? await getUserTranslator(uid) : async (k) => k;
        return Markup.inlineKeyboard([
            [
                Markup.button.callback(`🌙 ${await tr("expiry.24h")}`, "FILE_EXPSET:24h"),
                Markup.button.callback(`📅 ${await tr("expiry.7d")}`, "FILE_EXPSET:7d"),
            ],
            [
                Markup.button.callback(`🗓️ ${await tr("expiry.30d")}`, "FILE_EXPSET:30d"),
                Markup.button.callback(`📆 ${await tr("expiry.90d")}`, "FILE_EXPSET:90d"),
            ],
            [
                Markup.button.callback(`♾️ ${await tr("expiry.none")}`, "FILE_EXPSET:none"),
                Markup.button.callback(`🚫 ${await tr("expiry.cancel")}`, "CANCEL_ACTION"),
            ],
        ]);
    },

    // ✅ CONFIRM — translated
    confirm: async (action, id, uid) => {
        const tr = uid ? await getUserTranslator(uid) : async (k) => k;
        return Markup.inlineKeyboard([
            [Markup.button.callback(`✅ ${await tr("common.confirm")}`, `CONFIRM:${action}:${id}`)],
            [Markup.button.callback(`🚫 ${await tr("expiry.cancel")}`, "CANCEL_ACTION")],
        ]);
    },

    // 🗑️ DELETE CONFIRM — danger style
    deleteConfirm: async (fileId, uid) => {
        const tr = uid ? await getUserTranslator(uid) : async (k) => k;
        return Markup.inlineKeyboard([
            [Markup.button.callback(`🗑️ ⚠️ Ha, o'chirilsin!`, `CONFIRM:delete:${fileId}`)],
            [Markup.button.callback(`🚫 Yo'q, bekor qil`, "CANCEL_ACTION")],
        ]);
    },

    // 👑 ADMIN — translated
    admin: async (uid) => {
        const tr = uid ? await getUserTranslator(uid) : async (k) => k;
        return Markup.inlineKeyboard([
            [
                Markup.button.callback(`📊 ${await tr("admin.stats")}`, "ADM:STATS"),
                Markup.button.callback(`📢 ${await tr("admin.broadcast")}`, "ADM:BROADCAST"),
            ],
            [
                Markup.button.callback(`🧹 ${await tr("admin.cleanup")}`, "ADM:CLEANUP"),
                Markup.button.callback(`👥 ${await tr("admin.users")}`, "ADM:USERS"),
            ],
            [
                Markup.button.callback(`💾 ${await tr("admin.cache")}`, "ADM:CACHE"),
                Markup.button.callback(`↩️ ${await tr("files.back")}`, "MAIN"),
            ],
        ]);
    },

    // 📄 PAGINATION — translated
    pagination: async (page, hasMore, baseAction, uid) => {
        const tr = uid ? await getUserTranslator(uid) : async (k) => k;
        const nav = [];
        if (page > 0) nav.push(Markup.button.callback(`◀️ ${await tr("common.prev")}`, `${baseAction}:${page - 1}`));
        if (hasMore) nav.push(Markup.button.callback(`▶️ ${await tr("common.next")}`, `${baseAction}:${page + 1}`));
        const rows = [];
        if (nav.length) rows.push(nav);
        rows.push([Markup.button.callback(`↩️ ${await tr("files.back")}`, "MAIN")]);
        return Markup.inlineKeyboard(rows);
    },
};

// ==================== DB INDEXES ====================
async function ensureIndexes() {
    try {
        await Promise.all([
            UserModel.collection.createIndex({ tgUserId: 1 }, { unique: true }),
            UserModel.collection.createIndex({ lastActiveAt: -1 }),
            UserModel.collection.createIndex({ username: 1 }, { sparse: true }),
            FileModel.collection.createIndex({ ownerTgUserId: 1, createdAt: -1 }),
            FileModel.collection.createIndex({ ownerTgUserId: 1, fileName: "text" }),
            FileModel.collection.createIndex({ tgFileId: 1 }, { unique: true }),
            FileModel.collection.createIndex({ tgUniqueId: 1 }, { unique: true, sparse: true }),
            FileModel.collection.createIndex({ kind: 1 }),
            FileModel.collection.createIndex({ folderId: 1 }),
            FileModel.collection.createIndex({ isPrivate: 1 }),
            FileModel.collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
            FileModel.collection.createIndex({ sharedWith: 1 }),
        ]);
        console.log("✅ Indexes ready");
    } catch (e) {
        console.error("Index error:", e.message);
    }
}

// ==================== USER OPS ====================
async function upsertUser(ctx) {
    const u = ctx.from || {};
    const id = String(u.id);
    const key = `user:${id}`;

    const fields = {
        firstName: u.first_name || "",
        lastName: u.last_name || "",
        username: (u.username || "").toLowerCase(),
        lastActiveAt: new Date(),
    };

    if (memoryCache.get(key)) {
        UserModel.updateOne({ tgUserId: id }, { $set: fields }).catch(() => { });
        return id;
    }

    let user = await UserModel.findOne({ tgUserId: id }).lean();
    if (!user) {
        // Auto-detect language from Telegram language_code on first start
        const detectedLang = detectLanguage(u.language_code);
        user = await UserModel.create({
            tgUserId: id, ...fields,
            language: detectedLang,
            startedAt: new Date(),
            storageUsed: 0,
            fileCount: 0,
            folderIds: [],
            settings: { notifications: true, privateByDefault: false, autoExpire: null },
        });
    } else {
        await UserModel.updateOne({ tgUserId: id }, { $set: fields });
    }

    const fresh = await UserModel.findOne({ tgUserId: id }).lean();
    memoryCache.set(key, fresh, CONFIG.CACHE_TTL.USER);
    return id;
}

async function getUserStats(uid) {
    const key = `stats:${uid}`;
    const cached = memoryCache.get(key);
    if (cached) return cached;

    try {
        const [user, stats] = await Promise.all([
            UserModel.findOne({ tgUserId: uid }).lean(),
            FileModel.aggregate([
                { $match: { ownerTgUserId: uid, isDeleted: { $ne: true } } },
                {
                    $facet: {
                        total: [{ $count: "c" }],
                        size: [{ $group: { _id: null, total: { $sum: "$fileSize" } } }],
                        byKind: [{ $group: { _id: "$kind", count: { $sum: 1 }, size: { $sum: "$fileSize" } } }],
                        recent: [
                            { $sort: { createdAt: -1 } },
                            { $limit: 5 },
                            { $project: { fileName: 1, kind: 1, fileSize: 1, createdAt: 1, isPrivate: 1 } },
                        ],
                    },
                },
            ]),
        ]);

        if (!user) return null;
        const s = stats[0] || {};
        const result = {
            user,
            totalFiles: s.total?.[0]?.c || 0,
            totalSize: s.size?.[0]?.total || 0,
            byKind: s.byKind || [],
            recent: s.recent || [],
        };
        memoryCache.set(key, result, CONFIG.CACHE_TTL.STATS);
        return result;
    } catch (e) {
        console.error("Stats error:", e.message);
        return null;
    }
}

// ==================== FILE OPS ====================
async function searchFiles(uid, query, opts = {}) {
    const { kind, folderId, isPrivate, limit = 20, page = 0 } = opts;
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = {
        ownerTgUserId: String(uid),
        isDeleted: { $ne: true },
        fileName: { $regex: escapedQuery, $options: "i" },
    };
    if (kind) match.kind = kind;
    if (folderId !== undefined) match.folderId = folderId || null;
    if (isPrivate !== undefined) match.isPrivate = isPrivate;

    return FileModel.find(match)
        .sort({ createdAt: -1 })
        .skip(page * limit)
        .limit(limit)
        .select("fileName kind fileSize createdAt isPrivate expiresAt folderId tgFileId tgUniqueId")
        .lean();
}

// ==================== INLINE HANDLER ====================
async function handleInline(ctx) {
    const uid = String(ctx.from?.id);
    const query = (ctx.inlineQuery.query || "").trim();
    const page = parseInt(ctx.inlineQuery.offset || "0", 10) || 0;

    if (!uid || query.length < 1) {
        return ctx.answerInlineQuery([], { cache_time: 30, is_personal: true });
    }

    try {
        const LIMIT = 50;
        const files = await searchFiles(uid, query, { limit: LIMIT, page });
        const results = [];

        for (const [idx, f] of files.entries()) {
            const fileId = f.tgFileId;
            if (!fileId || typeof fileId !== "string") continue;

            const resultId = `f_${f._id}_${idx}`;
            const safeFileName = escapeHtml(f.fileName || "Untitled");
            const caption = `<b>${safeFileName}</b>\n\n📦 ${formatFileSize(f.fileSize)}\n🕐 ${formatTime(f.createdAt)}\n📁 ${(f.kind || "file").toUpperCase()}`;
            const base = { id: resultId, caption, parse_mode: "HTML" };

            try {
                switch (f.kind) {
                    case "photo":
                        results.push({ ...base, type: "photo", photo_file_id: fileId }); break;
                    case "video":
                        results.push({
                            ...base, type: "video", video_file_id: fileId,
                            title: (f.fileName || "Video").slice(0, 64),
                            description: `VIDEO • ${formatFileSize(f.fileSize)}`,
                        }); break;
                    case "audio":
                        results.push({
                            ...base, type: "audio", audio_file_id: fileId,
                            title: (f.fileName || "Audio").slice(0, 64),
                        }); break;
                    case "voice":
                        results.push({ ...base, type: "voice", voice_file_id: fileId }); break;
                    default:
                        results.push({
                            ...base, type: "document", document_file_id: fileId,
                            title: (f.fileName || "File").slice(0, 64),
                            description: `${(f.kind || "FILE").toUpperCase()} • ${formatFileSize(f.fileSize)}`,
                        });
                }
            } catch (err) {
                console.log("[INLINE RESULT ERROR]", err.message);
            }
        }

        await ctx.answerInlineQuery(results, {
            cache_time: 60, is_personal: true,
            next_offset: results.length >= LIMIT ? String(page + 1) : "",
        });
    } catch (e) {
        console.error(`[INLINE ERROR] uid=${uid} query="${query}"`, e);
        await ctx.answerInlineQuery([], { cache_time: 1, is_personal: true }).catch(() => { });
    }
}

// ==================== FILE UPDATE / DELETE ====================
async function updateFile(uid, fid, updates) {
    const res = await FileModel.findOneAndUpdate(
        { _id: fid, ownerTgUserId: uid, isDeleted: { $ne: true } },
        { $set: { ...updates, updatedAt: new Date() } },
        { new: true, runValidators: true }
    );
    if (res) memoryCache.delPattern(`files:${uid}:*`);
    return res;
}

async function softDelete(uid, fid) {
    const file = await FileModel.findOne({ _id: fid, ownerTgUserId: uid, isDeleted: { $ne: true } }).lean();
    if (!file) return null;
    const res = await FileModel.findOneAndUpdate(
        { _id: fid, ownerTgUserId: uid },
        { $set: { isDeleted: true, deletedAt: new Date() } }
    );
    if (res) {
        await UserModel.updateOne(
            { tgUserId: uid },
            { $inc: { storageUsed: -(file.fileSize || 0), fileCount: -1 } }
        ).catch(() => { });
        invalidateUser(uid);
        setTimeout(() => FileModel.deleteOne({ _id: fid }).catch(() => { }), 30 * 86400000);
    }
    return res;
}

// ==================== FOLDER OPS ====================
async function createFolder(uid, name, parent = null) {
    const fid = crypto.randomUUID();
    const folder = await UserModel.findOneAndUpdate(
        { tgUserId: uid },
        {
            $push: {
                folderIds: {
                    _id: fid,
                    name: escapeHtml(name.slice(0, 50)),
                    parentId: parent,
                    fileCount: 0,
                    createdAt: new Date(),
                },
            },
        },
        { new: true }
    );
    if (folder) {
        invalidateUser(uid);
        return folder.folderIds.find(f => f._id === fid);
    }
    return null;
}

async function moveFiles(uid, fileIds, folderId) {
    const res = await FileModel.updateMany(
        { _id: { $in: fileIds }, ownerTgUserId: uid },
        { $set: { folderId: folderId || null, updatedAt: new Date() } }
    );
    if (res.modifiedCount && folderId) {
        await UserModel.updateOne(
            { tgUserId: uid, "folderIds._id": folderId },
            { $inc: { "folderIds.$.fileCount": res.modifiedCount } }
        );
    }
    if (res.modifiedCount) invalidateUser(uid);
    return res;
}

// ==================== EXPIRY ====================
const EXPIRY = { "24h": 86_400_000, "7d": 604_800_000, "30d": 2_592_000_000, "90d": 7_776_000_000 };

async function setExpiry(uid, fid, dur) {
    if (dur === "none") return updateFile(uid, fid, { expiresAt: null });
    const ms = EXPIRY[dur];
    if (!ms) return null;
    return updateFile(uid, fid, { expiresAt: new Date(Date.now() + ms) });
}

// ==================== SAVE ONE FILE ====================
async function saveOneFile(ctx, uid, obj, kind, caption) {
    const user = await UserModel.findOne({ tgUserId: uid }).lean();
    const isPriv = user?.settings?.privateByDefault || false;
    const autoExp = user?.settings?.autoExpire;

    const name = obj.file_name
        || `${kind}_${Date.now()}.${kind === "photo" ? "jpg"
            : kind === "video" ? "mp4"
                : kind === "audio" ? "mp3" : "bin"}`;

    const existing = await FileModel.findOne({ tgFileId: obj.file_id }).lean();
    if (existing && existing.ownerTgUserId === uid) return { file: existing, duplicate: true };

    const file = await FileModel.create({
        ownerTgUserId: uid, kind,
        tgFileId: obj.file_id,
        tgUniqueId: obj.file_unique_id || "",
        fileName: name.slice(0, 200),
        mimeType: obj.mime_type || "",
        fileSize: obj.file_size || 0,
        note: (caption || "").slice(0, 500),
        isPrivate: isPriv,
        expiresAt: autoExp && EXPIRY[autoExp] ? new Date(Date.now() + EXPIRY[autoExp]) : null,
        folderId: null,
    });

    await UserModel.updateOne(
        { tgUserId: uid },
        { $inc: { storageUsed: obj.file_size || 0, fileCount: 1 } }
    );

    return { file, duplicate: false, name, isPriv };
}

// ==================== BOT START ====================
export async function startBot() {
    if (!process.env.BOT_TOKEN || !process.env.BASE_URL)
        throw new Error("Missing env vars: BOT_TOKEN, BASE_URL");

    // Preload all translations at startup
    await preloadTranslations();

    const bot = new Telegraf(process.env.BOT_TOKEN);

    try {
        await bot.telegram.setMyCommands([
            { command: "start", description: "🚀 Botni ishga tushirish" },
            { command: "help", description: "🆘 Yordam olish" },
            { command: "f", description: "📤 Faylni yuborish: /f fayl_nomi" },
            { command: "d", description: "🗑️ Faylni o'chirish: /d fayl_nomi" },
        ]);
    } catch (e) {
        console.warn("⚠️ Could not set bot commands:", e.message);
    }

    await ensureIndexes();
    bot.use(session());

    // Middleware
    bot.use(async (ctx, next) => {
        const uid = ctx.from?.id;
        if (uid && !isAdmin(uid) && !checkRateLimit(uid)) {
            const tr = await getUserTranslator(String(uid)).catch(() => async (k) => k);
            return ctx.reply(await tr("common.tooFast")).catch(() => { });
        }
        ensureSession(ctx);
        if (ctx.from) await upsertUser(ctx).catch(e => console.error("upsertUser error:", e.message));
        await next();
    });

    bot.catch((err, ctx) => {
        console.error(`[${ctx?.updateType}] Global error:`, err.message);
        ctx?.reply?.(formatError(err), { parse_mode: "HTML" }).catch(() => { });
    });

    // ========== /start ==========
    bot.start(async (ctx) => {
        const uid = await upsertUser(ctx);
        const tr = await getUserTranslator(uid);
        const stats = await getUserStats(uid);

        const text = `
${await tr("bot.welcome", { version })}

<b>${await tr("bot.features")}</b>
• ${await tr("help.save")}
• ${await tr("help.organize")}
• ${await tr("help.find", { bot: ctx.me })}
• ${await tr("help.shareGuide")}
• ${await tr("help.expiryGuide")}
• ${await tr("help.privateGuide")}
• ${await tr("help.stats", {})}

<b>${await tr("bot.yourStorage")}</b>
• ${await tr("bot.files")}: <code>${stats?.totalFiles || 0}</code>
• ${await tr("bot.used")}: <code>${formatFileSize(stats?.totalSize || 0)}</code>

${await tr("bot.tapButton")}`.trim();

        await ctx.replyWithHTML(text, await KB.main(uid));
    });

    // ========== /help ==========
    bot.command("help", async (ctx) => {
        const uid = String(ctx.from.id);
        const tr = await getUserTranslator(uid);
        const me = ctx.me || (await bot.telegram.getMe()).username;

        await ctx.replyWithHTML(`
${pe("help", "🆘")} ${await tr("help.title")}

${await tr("help.save")}
${await tr("help.find", { bot: me })}
${await tr("help.organize")}
${await tr("help.shareGuide")}
${await tr("help.expiryGuide")}
${await tr("help.privateGuide")}

${await tr("help.limits")}
${await tr("help.tip")}
        `.trim(), await KB.main(uid));
    });

    // ========== INLINE ==========
    bot.on("inline_query", handleInline);

    // ========== /f — FAYLNI YUBORISH ==========
    bot.command("f", async (ctx) => {
        const uid = String(ctx.from.id);
        const tr = await getUserTranslator(uid);
        const args = ctx.message.text.slice(3).trim(); // "/f " ni olib tashlash

        if (!args) {
            return ctx.replyWithHTML(
                `📤 <b>Fayl yuborish</b>\n\nIshlatish: <code>/f fayl_nomi</code>\n\nMisol: <code>/f mening_hujjatim.pdf</code>`,
                await KB.main(uid)
            );
        }

        await withLoading(ctx, async () => {
            const files = await searchFiles(uid, args, { limit: 5 });
            if (!files.length) {
                return ctx.replyWithHTML(
                    `🔍 <b>"${escapeHtml(args)}"</b> — fayl topilmadi\n\n💡 To'liq fayl nomini yozing`,
                    await KB.main(uid)
                );
            }

            // Eng mos faylni topish (to'liq mos bo'lsa birinchi)
            const exact = files.find(f => f.fileName.toLowerCase() === args.toLowerCase()) || files[0];

            try {
                const caption = `📤 <b>${escapeHtml(exact.fileName)}</b>\n\n📦 ${formatFileSize(exact.fileSize)} • ${exact.kind.toUpperCase()}\n🕐 ${formatTime(exact.createdAt)}`;
                if (exact.kind === "photo") {
                    await ctx.replyWithPhoto(exact.tgFileId, { caption, parse_mode: "HTML" });
                } else {
                    await ctx.replyWithDocument(exact.tgFileId, { caption, parse_mode: "HTML" });
                }

                // Agar bir nechta natija bo'lsa, qolganlarini ham ko'rsatish
                if (files.length > 1) {
                    const others = files.slice(1).map(f => {
                        const kindEmoji = f.kind === "photo" ? "🖼️" : f.kind === "video" ? "🎬" : f.kind === "audio" ? "🎵" : "📄";
                        return `${kindEmoji} <code>/f ${escapeHtml(f.fileName)}</code>`;
                    }).join("\n");
                    await ctx.replyWithHTML(`🔍 <b>Boshqa mos fayllar:</b>\n\n${others}`);
                }
            } catch (e) {
                console.error("Send file error:", e.message);
                await ctx.reply(await tr("common.notModified"));
            }
        }, "📤 Fayl qidirilmoqda...");
    });

    // ========== /d — FAYLNI O'CHIRISH ==========
    bot.command("d", async (ctx) => {
        const uid = String(ctx.from.id);
        const tr = await getUserTranslator(uid);
        const args = ctx.message.text.slice(3).trim(); // "/d " ni olib tashlash

        if (!args) {
            return ctx.replyWithHTML(
                `🗑️ <b>Fayl o'chirish</b>\n\nIshlatish: <code>/d fayl_nomi</code>\n\nMisol: <code>/d eski_fayl.pdf</code>`,
                await KB.main(uid)
            );
        }

        await withLoading(ctx, async () => {
            const files = await searchFiles(uid, args, { limit: 5 });
            if (!files.length) {
                return ctx.replyWithHTML(
                    `🔍 <b>"${escapeHtml(args)}"</b> — fayl topilmadi\n\n💡 To'liq fayl nomini yozing`,
                    await KB.main(uid)
                );
            }

            const exact = files.find(f => f.fileName.toLowerCase() === args.toLowerCase()) || files[0];
            const kindEmoji = exact.kind === "photo" ? "🖼️" : exact.kind === "video" ? "🎬" : exact.kind === "audio" ? "🎵" : "📄";

            await ctx.replyWithHTML(
                `⚠️ <b>O'chirishni tasdiqlang!</b>\n\n${kindEmoji} Fayl: <code>${escapeHtml(exact.fileName)}</code>\n📦 ${formatFileSize(exact.fileSize)} • ${exact.kind.toUpperCase()}\n🕐 ${formatTime(exact.createdAt)}\n\n<i>⚠️ Bu amalni bekor qilib bo'lmaydi!</i>`,
                await KB.deleteConfirm(exact._id.toString(), uid)
            );
        }, "🔍 Fayl qidirilmoqda...");
    });

    // ========== MAIN NAV ==========
    bot.action("MAIN", async (ctx) => {
        await ctx.answerCbQuery();
        const uid = String(ctx.from.id);
        const tr = await getUserTranslator(uid);
        await safeEdit(ctx, `${pe("cloud", "☁️")} ${await tr("menu.main")}`, await KB.main(uid));
    });

    // ========== MY FILES ==========
    bot.action("MY_FILES", async (ctx) => {
        await ctx.answerCbQuery();
        const uid = String(ctx.from.id);
        const tr = await getUserTranslator(uid);

        await withLoading(ctx, async () => {
            const stats = await getUserStats(uid);
            if (!stats || stats.totalFiles === 0) {
                return safeEdit(ctx, await tr("files.noFiles"), await KB.main(uid));
            }

            const list = stats.recent
                .map(f =>
                    `• <code>${escapeHtml(f.fileName)}</code>\n  ${f.kind.toUpperCase()} • ${formatFileSize(f.fileSize)} • ${formatTime(f.createdAt)}${f.isPrivate ? " 🔒" : ""}`
                )
                .join("\n");

            await safeEdit(
                ctx,
                `${await tr("files.recentFiles", { total: stats.totalFiles })}\n\n${list}\n\n<b>💾 ${await tr("bot.used")}:</b> <code>${formatFileSize(stats.totalSize)}</code>\n\n👇`,
                await KB.main(uid)
            );
        }, await tr("common.processing"));
    });

    // ========== SEARCH ==========
    bot.action("SEARCH_MAIN", async (ctx) => {
        await ctx.answerCbQuery();
        const uid = String(ctx.from.id);
        const tr = await getUserTranslator(uid);
        const sess = ensureSession(ctx);
        sess.searchMode = true;
        sess.searchFilter = null;
        await safeEdit(
            ctx,
            `${pe("search", "🔍")} ${await tr("search.title")}\n\n${await tr("search.typeKeyword", { bot: ctx.me })}\n\n${await tr("search.filterByType")}`,
            await KB.search(uid)
        );
    });

    bot.action(/^SRCH:(.+)$/, async (ctx) => {
        await ctx.answerCbQuery();
        const uid = String(ctx.from.id);
        const tr = await getUserTranslator(uid);
        const filter = ctx.match[1];
        const sess = ensureSession(ctx);

        if (filter === "CLEAR") {
            sess.searchFilter = null;
            sess.searchMode = false;
            return safeEdit(
                ctx,
                `${pe("search", "🔍")} ${await tr("search.title")}\n\n${await tr("search.typeKeyword", { bot: ctx.me })}\n\n${await tr("search.filterByType")}`,
                await KB.search(uid)
            );
        }

        sess.searchFilter = filter;
        sess.searchMode = true;
        await ctx.reply(
            `${pe("search", "🔍")} <b>Filter set:</b> ${filter}\n\n${await tr("search.typeKeyword", { bot: ctx.me })}`,
            { parse_mode: "HTML" }
        );
    });

    // ========== FOLDERS ==========
    bot.action("FOLDERS_MAIN", async (ctx) => {
        await ctx.answerCbQuery();
        const uid = String(ctx.from.id);
        const tr = await getUserTranslator(uid);
        const user = await UserModel.findOne({ tgUserId: uid }, { folderIds: 1 }).lean();
        const folders = user?.folderIds || [];
        const list = folders.length
            ? folders.map(f => `📁 <b>${escapeHtml(f.name)}</b> (${f.fileCount} files)`).join("\n")
            : await tr("folders.noFolders");
        await safeEdit(ctx, `${pe("folders", "🗂️")} ${await tr("folders.title")}\n\n${list}\n\n👇`, await KB.folders(uid));
    });

    bot.action("FOLDER_CREATE", async (ctx) => {
        await ctx.answerCbQuery();
        const uid = String(ctx.from.id);
        const tr = await getUserTranslator(uid);
        ensureSession(ctx).pendingAction = { type: "folder_create" };
        await ctx.editMessageText(await tr("folders.createPrompt"), {
            parse_mode: "HTML",
            reply_markup: Markup.inlineKeyboard([[Markup.button.callback(await tr("expiry.cancel"), "CANCEL_ACTION")]]).reply_markup,
        });
    });

    bot.action("FOLDER_LIST", async (ctx) => {
        await ctx.answerCbQuery();
        const uid = String(ctx.from.id);
        const tr = await getUserTranslator(uid);
        const user = await UserModel.findOne({ tgUserId: uid }, { folderIds: 1 }).lean();
        if (!user?.folderIds?.length) return ctx.answerCbQuery(await tr("folders.noFolders"), { show_alert: true });

        const kb = Markup.inlineKeyboard([
            ...user.folderIds.slice(0, 10).map(f => [Markup.button.callback(`📁 ${f.name}`, `FOLDER_OPEN:${f._id}`)]),
            [Markup.button.callback(`${E.back} ${await tr("files.back")}`, "FOLDERS_MAIN")],
        ]);
        await ctx.editMessageText(await tr("folders.selectFolder"), { parse_mode: "HTML", reply_markup: kb.reply_markup });
    });

    bot.action(/^FOLDER_OPEN:(.+)$/, async (ctx) => {
        await ctx.answerCbQuery();
        const uid = String(ctx.from.id);
        const tr = await getUserTranslator(uid);
        const fid = ctx.match[1];
        const files = await FileModel.find({ ownerTgUserId: uid, folderId: fid, isDeleted: { $ne: true } })
            .sort({ createdAt: -1 }).limit(10).lean();

        if (!files.length) return ctx.editMessageText(await tr("folders.emptyFolder"), { reply_markup: (await KB.folders(uid)).reply_markup });

        const list = files
            .map(f => `• <code>${escapeHtml(f.fileName)}</code>\n  ${formatFileSize(f.fileSize)} • ${formatTime(f.createdAt)}`)
            .join("\n");
        await ctx.editMessageText(`📁 <b>Folder Contents</b>\n\n${list}`, {
            parse_mode: "HTML",
            reply_markup: (await KB.folders(uid)).reply_markup,
        });
    });

    bot.action("FOLDER_MOVE_SELECT", async (ctx) => {
        await ctx.answerCbQuery();
        const uid = String(ctx.from.id);
        const tr = await getUserTranslator(uid);
        const files = await FileModel.find({ ownerTgUserId: uid, folderId: null, isDeleted: { $ne: true } })
            .limit(10).select("_id fileName").lean();
        if (!files.length) return ctx.answerCbQuery(await tr("folders.noFilesToMove"), { show_alert: true });

        const kb = Markup.inlineKeyboard([
            ...files.slice(0, 8).map(f => [Markup.button.callback(`📄 ${f.fileName.slice(0, 30)}`, `MOVE_SELECT:${f._id}`)]),
            [Markup.button.callback(`${E.back} ${await tr("files.back")}`, "FOLDERS_MAIN")],
        ]);
        await ctx.editMessageText(`🗂️ <b>Select file to move:</b>`, { parse_mode: "HTML", reply_markup: kb.reply_markup });
    });

    bot.action(/^MOVE_SELECT:(.+)$/, async (ctx) => {
        await ctx.answerCbQuery();
        const uid = String(ctx.from.id);
        const tr = await getUserTranslator(uid);
        const fid = ctx.match[1];
        const user = await UserModel.findOne({ tgUserId: uid }, { folderIds: 1 }).lean();
        if (!user?.folderIds?.length) return ctx.answerCbQuery(await tr("folders.createFirst"), { show_alert: true });

        const kb = Markup.inlineKeyboard([
            ...user.folderIds.map(f => [Markup.button.callback(`📁 ${f.name}`, `MOVE_EXEC:${fid}:${f._id}`)]),
            [Markup.button.callback(`${E.home} Root (no folder)`, `MOVE_EXEC:${fid}:null`)],
            [Markup.button.callback(await tr("expiry.cancel"), "CANCEL_ACTION")],
        ]);
        await ctx.editMessageText(await tr("folders.moveTo"), { parse_mode: "HTML", reply_markup: kb.reply_markup });
    });

    bot.action(/^MOVE_EXEC:([^:]+):(.+)$/, async (ctx) => {
        await ctx.answerCbQuery(await t(await getUserLanguage(String(ctx.from.id)), "common.moving"));
        const uid = String(ctx.from.id);
        const tr = await getUserTranslator(uid);
        const fileId = ctx.match[1];
        const folderId = ctx.match[2] === "null" ? null : ctx.match[2];
        await moveFiles(uid, [fileId], folderId);
        await ctx.editMessageText(await tr("folders.moved"), { reply_markup: (await KB.folders(uid)).reply_markup });
    });

    // ========== EXPIRING ==========
    bot.action("EXPIRING_MAIN", async (ctx) => {
        await ctx.answerCbQuery();
        const uid = String(ctx.from.id);
        const tr = await getUserTranslator(uid);
        const exp = await FileModel.find({
            ownerTgUserId: uid,
            expiresAt: { $gt: new Date() },
            isDeleted: { $ne: true },
        }).sort({ expiresAt: 1 }).limit(10).select("fileName expiresAt").lean();

        const text = exp.length
            ? `${pe("expire", "⏰")} ${await tr("expiry.title")}\n\n`
            + exp.map(f => `• <code>${escapeHtml(f.fileName)}</code>\n  📅 ${new Date(f.expiresAt).toLocaleString()}`).join("\n")
            : `${pe("success", "✅")} ${await tr("expiry.noExpiring")}`;

        await safeEdit(ctx, text, await KB.main(uid));
    });

    // ========== SHARE ==========
    bot.action("SHARE_MAIN", async (ctx) => {
        await ctx.answerCbQuery();
        const uid = String(ctx.from.id);
        const tr = await getUserTranslator(uid);
        const appUrl2 = webAppUrl();
        await safeEdit(
            ctx,
            `${pe("share", "🔗")} ${await tr("share.title")}\n\n${await tr("share.instructions", { webApp: appUrl2 ? "\n\nOr use Web App:" : "" })}`,
            Markup.inlineKeyboard([
                ...(appUrl2 ? [[Markup.button.webApp("🌐 Web App", appUrl2)]] : []),
                [Markup.button.callback(`${E.back} ${await tr("files.back")}`, "MAIN")],
            ])
        );

        const files = await FileModel.find({ ownerTgUserId: uid, isDeleted: { $ne: true } })
            .limit(10).select("_id fileName").lean();
        if (!files.length) return;

        const kb = Markup.inlineKeyboard([
            ...files.map(f => [Markup.button.callback(`📄 ${f.fileName.slice(0, 35)}`, `SHARE_SELECT:${f._id}`)]),
            [Markup.button.callback(await tr("expiry.cancel"), "CANCEL_ACTION")],
        ]);
        await ctx.reply(await tr("share.selectFile"), { parse_mode: "HTML", reply_markup: kb.reply_markup });
    });

    bot.action(/^SHARE_SELECT:(.+)$/, async (ctx) => {
        await ctx.answerCbQuery();
        const uid = String(ctx.from.id);
        const tr = await getUserTranslator(uid);
        ensureSession(ctx).pendingAction = { type: "share", fileId: ctx.match[1] };
        await ctx.editMessageText(await tr("share.shareWith"), {
            parse_mode: "HTML",
            reply_markup: Markup.inlineKeyboard([[Markup.button.callback(await tr("expiry.cancel"), "CANCEL_ACTION")]]).reply_markup,
        });
    });

    // ========== SETTINGS ==========
    bot.action("SETTINGS_MAIN", async (ctx) => {
        await ctx.answerCbQuery();
        const uid = String(ctx.from.id);
        const tr = await getUserTranslator(uid);
        const user = await UserModel.findOne({ tgUserId: uid }, { settings: 1, language: 1 }).lean();
        await safeEdit(ctx, await tr("settings.title"), await KB.settings(user, uid));
    });

    // ========== LANGUAGE ==========
    bot.action("SET:LANG:menu", async (ctx) => {
        await ctx.answerCbQuery();
        const uid = String(ctx.from.id);
        const tr = await getUserTranslator(uid);
        await ctx.editMessageText(await tr("settings.selectLanguage"), {
            parse_mode: "HTML",
            reply_markup: (await KB.languageMenu(uid)).reply_markup,
        });
    });

    bot.action(/^LANG:(.+)$/, async (ctx) => {
        const uid = String(ctx.from.id);
        const newLang = ctx.match[1];

        if (!LANGUAGES.includes(newLang)) {
            return ctx.answerCbQuery("❌ Invalid language", { show_alert: true });
        }

        await updateUserLanguage(uid, newLang);
        const tr = await getUserTranslator(uid);
        await ctx.answerCbQuery(await tr("settings.languageChanged", { lang: getLanguageName(newLang) }), { show_alert: true });

        const user = await UserModel.findOne({ tgUserId: uid }, { settings: 1, language: 1 }).lean();
        await ctx.editMessageText(await tr("settings.title"), {
            parse_mode: "HTML",
            reply_markup: (await KB.settings(user, uid)).reply_markup,
        });
    });

    // ========== SETTINGS ACTIONS ==========
    bot.action(/^SET:NOTIF:(on|off)$/, async (ctx) => {
        const newVal = ctx.match[1] === "on";
        const uid = String(ctx.from.id);
        const tr = await getUserTranslator(uid);
        await UserModel.updateOne({ tgUserId: uid }, { $set: { "settings.notifications": newVal } });
        invalidateUser(uid);
        await ctx.answerCbQuery(`🔔 ${await tr("settings.notifications", { icon: newVal ? E.bell : E.mute, status: newVal ? await tr("common.on") : await tr("common.off") })}`, { show_alert: true });
        const user = await UserModel.findOne({ tgUserId: uid }, { settings: 1, language: 1 }).lean();
        await ctx.editMessageText(await tr("settings.title"), {
            parse_mode: "HTML",
            reply_markup: (await KB.settings(user, uid)).reply_markup,
        });
    });

    bot.action("SET:PRIV:toggle", async (ctx) => {
        const uid = String(ctx.from.id);
        const tr = await getUserTranslator(uid);
        const user = await UserModel.findOne({ tgUserId: uid }, { settings: 1 }).lean();
        const newVal = !user?.settings?.privateByDefault;
        await UserModel.updateOne({ tgUserId: uid }, { $set: { "settings.privateByDefault": newVal } });
        invalidateUser(uid);
        await ctx.answerCbQuery(await tr("common.privateToggle", { status: newVal ? await tr("common.on") : await tr("common.off") }), { show_alert: true });
        const updated = await UserModel.findOne({ tgUserId: uid }, { settings: 1, language: 1 }).lean();
        await ctx.editMessageText(await tr("settings.title"), {
            parse_mode: "HTML",
            reply_markup: (await KB.settings(updated, uid)).reply_markup,
        });
    });

    bot.action("SET:EXPIRE:menu", async (ctx) => {
        await ctx.answerCbQuery();
        const uid = String(ctx.from.id);
        const tr = await getUserTranslator(uid);
        await ctx.editMessageText(
            `${pe("expire", "⏰")} ${await tr("expiry.autoExpireTitle")}\n\n${await tr("expiry.autoExpireDesc")}`,
            { parse_mode: "HTML", reply_markup: (await KB.expireMenu(uid)).reply_markup }
        );
    });

    bot.action(/^EXPSET:(.+)$/, async (ctx) => {
        const dur = ctx.match[1];
        const uid = String(ctx.from.id);
        const tr = await getUserTranslator(uid);
        await UserModel.updateOne(
            { tgUserId: uid },
            { $set: { "settings.autoExpire": dur === "none" ? null : dur } }
        );
        invalidateUser(uid);
        await ctx.answerCbQuery(await tr("expiry.set", { value: dur === "none" ? "disabled" : dur }), { show_alert: true });
        const user = await UserModel.findOne({ tgUserId: uid }, { settings: 1, language: 1 }).lean();
        await ctx.editMessageText(await tr("settings.title"), {
            parse_mode: "HTML",
            reply_markup: (await KB.settings(user, uid)).reply_markup,
        });
    });

    bot.action("SET:CACHE", async (ctx) => {
        const uid = String(ctx.from.id);
        const tr = await getUserTranslator(uid);
        invalidateUser(uid);
        await ctx.answerCbQuery(await tr("settings.cacheCleared"), { show_alert: true });
    });

    bot.action("SET:STATS", async (ctx) => {
        await ctx.answerCbQuery();
        const uid = String(ctx.from.id);
        const tr = await getUserTranslator(uid);
        const stats = await getUserStats(uid);
        if (!stats) return ctx.answerCbQuery("Error loading stats", { show_alert: true });

        const kindText =
            stats.byKind.map(k => `• ${k._id}: ${k.count} file(s) • ${formatFileSize(k.size)}`).join("\n")
            || `• ${await tr("stats.none")}`;

        await ctx.replyWithHTML(
            `${pe("stats", "📊")} ${await tr("stats.title")}\n\n<b>${await tr("stats.files")}:</b> ${stats.totalFiles}\n<b>${await tr("stats.storage")}:</b> ${formatFileSize(stats.totalSize)}\n\n<b>${await tr("stats.byType")}:</b>\n${kindText}\n\n<b>${await tr("stats.recent")}:</b>\n${stats.recent.slice(0, 3).map(f => `• <code>${escapeHtml(f.fileName)}</code> • ${formatFileSize(f.fileSize)}`).join("\n") || `• ${await tr("stats.none")}`}`,
            await KB.main(uid)
        );
    });

    // ========== FILE ACTIONS ==========
    bot.action(/^DL:(.+)$/, async (ctx) => {
        const uid = String(ctx.from.id);
        const tr = await getUserTranslator(uid);
        await ctx.answerCbQuery(await tr("common.sending"));
        const file = await FileModel.findOne({ _id: ctx.match[1], ownerTgUserId: uid }).lean();
        if (!file) return ctx.reply(await tr("common.notFound"));
        try {
            if (file.kind === "photo") {
                await ctx.replyWithPhoto(file.tgFileId, { caption: `<b>${escapeHtml(file.fileName)}</b>`, parse_mode: "HTML" });
            } else {
                await ctx.replyWithDocument(file.tgFileId, { caption: `<b>${escapeHtml(file.fileName)}</b>`, parse_mode: "HTML" });
            }
        } catch (e) {
            console.error("Download error:", e.message);
            await ctx.reply(await tr("common.notModified"));
        }
    });

    bot.action(/^RENAME:(.+)$/, async (ctx) => {
        await ctx.answerCbQuery();
        const uid = String(ctx.from.id);
        const tr = await getUserTranslator(uid);
        ensureSession(ctx).pendingAction = { type: "rename", fileId: ctx.match[1] };
        await ctx.editMessageText(`${pe("rename", "✏️")} <b>${await tr("files.rename")}</b>\n\nSend the new name:`, {
            parse_mode: "HTML",
            reply_markup: Markup.inlineKeyboard([[Markup.button.callback(await tr("expiry.cancel"), "CANCEL_ACTION")]]).reply_markup,
        });
    });

    bot.action(/^DELETE:(.+)$/, async (ctx) => {
        await ctx.answerCbQuery();
        const uid = String(ctx.from.id);
        const tr = await getUserTranslator(uid);
        const file = await FileModel.findById(ctx.match[1]).lean();
        await safeEdit(
            ctx,
            `⚠️ <b>Diqqat! O'chirishni tasdiqlang</b>\n\n🗑️ Fayl: <code>${escapeHtml(file?.fileName || "Unknown")}</code>\n\n<i>Bu amalni bekor qilib bo'lmaydi!</i>`,
            await KB.deleteConfirm(ctx.match[1], uid)
        );
    });

    bot.action(/^CONFIRM:delete:(.+)$/, async (ctx) => {
        const uid = String(ctx.from.id);
        const tr = await getUserTranslator(uid);
        await ctx.answerCbQuery(await tr("common.deleting"));
        const res = await softDelete(uid, ctx.match[1]);
        if (!res) return ctx.editMessageText(await tr("common.alreadyDeleted"), { reply_markup: (await KB.main(uid)).reply_markup });
        await ctx.editMessageText(await tr("common.deleted"), { reply_markup: (await KB.main(uid)).reply_markup });
    });

    bot.action(/^PRIV:(.+)$/, async (ctx) => {
        const uid = String(ctx.from.id);
        const tr = await getUserTranslator(uid);
        const file = await FileModel.findOne({ _id: ctx.match[1], ownerTgUserId: uid }).lean();
        if (!file) return ctx.answerCbQuery(await tr("common.notFound"), { show_alert: true });
        await updateFile(uid, ctx.match[1], { isPrivate: !file.isPrivate });
        await ctx.answerCbQuery(await tr("common.privateToggle", { status: !file.isPrivate ? await tr("common.on") : await tr("common.off") }), { show_alert: true });
        await ctx.editMessageReplyMarkup((await KB.files(ctx.match[1], uid)).reply_markup);
    });

    bot.action(/^EXP:(.+)$/, async (ctx) => {
        await ctx.answerCbQuery();
        const uid = String(ctx.from.id);
        const tr = await getUserTranslator(uid);
        ensureSession(ctx).pendingAction = { type: "set_expiry", fileId: ctx.match[1] };
        await ctx.editMessageText(await tr("expiry.setFileExpiry"), {
            parse_mode: "HTML",
            reply_markup: (await KB.expireMenuForFile(uid)).reply_markup,
        });
    });

    bot.action(/^FILE_EXPSET:(.+)$/, async (ctx) => {
        const sess = ensureSession(ctx);
        const uid = String(ctx.from.id);
        const tr = await getUserTranslator(uid);
        if (sess.pendingAction?.type !== "set_expiry") {
            return ctx.answerCbQuery("Session expired. Please try again.", { show_alert: true });
        }
        await ctx.answerCbQuery(await tr("common.setting"));
        const dur = ctx.match[1];
        const fileId = sess.pendingAction.fileId;
        sess.pendingAction = null;

        const res = await setExpiry(uid, fileId, dur);
        const msg = res
            ? `✅ ${await tr("expiry.set", { value: dur === "none" ? "removed" : dur })}`
            : `❌ ${await tr("common.notFound")}`;
        await ctx.editMessageText(msg, { reply_markup: (await KB.files(fileId, uid)).reply_markup });
    });

    bot.action(/^MOVE:(.+)$/, async (ctx) => {
        await ctx.answerCbQuery();
        const uid = String(ctx.from.id);
        const tr = await getUserTranslator(uid);
        const user = await UserModel.findOne({ tgUserId: uid }, { folderIds: 1 }).lean();
        if (!user?.folderIds?.length) return ctx.answerCbQuery(await tr("folders.createFirst"), { show_alert: true });

        const kb = Markup.inlineKeyboard([
            ...user.folderIds.map(f => [Markup.button.callback(`📁 ${f.name}`, `MOVE_EXEC:${ctx.match[1]}:${f._id}`)]),
            [Markup.button.callback(`${E.home} Root`, `MOVE_EXEC:${ctx.match[1]}:null`)],
            [Markup.button.callback(await tr("expiry.cancel"), "CANCEL_ACTION")],
        ]);
        await ctx.editMessageText(await tr("folders.moveTo"), { parse_mode: "HTML", reply_markup: kb.reply_markup });
    });

    // ========== CANCEL ==========
    const cancelHandler = async (ctx) => {
        const uid = String(ctx.from.id);
        const tr = await getUserTranslator(uid);
        await ctx.answerCbQuery(await tr("common.cancelled"));
        const sess = ensureSession(ctx);
        sess.pendingAction = null;
        sess.searchMode = false;
        sess.searchFilter = null;
        await ctx.editMessageText(await tr("menu.main"), {
            parse_mode: "HTML",
            reply_markup: (await KB.main(uid)).reply_markup,
        });
    };

    bot.action(/^CANCEL:.+$/, cancelHandler);
    bot.action("CANCEL_ACTION", cancelHandler);

    // ========== INFO ==========
    bot.action("ABOUT", async (ctx) => {
        await ctx.answerCbQuery();
        const uid = String(ctx.from.id);
        const tr = await getUserTranslator(uid);
        await safeEdit(
            ctx,
            `${pe("about", "ℹ️")} ${await tr("about.title", { version })}

${await tr("about.features")}
${await tr("about.featureSearch")}
${await tr("about.featureFolders")}
${await tr("about.featureShare")}
${await tr("about.featureExpiry")}
${await tr("about.featurePrivate")}
${await tr("about.featureStats")}

${await tr("about.security")}
${await tr("about.secCdn")}
${await tr("about.secAccess")}
${await tr("about.secDelete")}`,
            await KB.main(uid)
        );
    });

    bot.action("HELP", async (ctx) => {
        await ctx.answerCbQuery();
        const uid = String(ctx.from.id);
        const tr = await getUserTranslator(uid);
        const me = ctx.me || (await bot.telegram.getMe()).username;
        await ctx.replyWithHTML(
            `${pe("help", "🆘")} ${await tr("help.title")}

${await tr("help.faq")}
${await tr("help.qSave")}
${await tr("help.aSave")}

${await tr("help.qFind")}
${await tr("help.aFind", { bot: me })}

${await tr("help.qShare")}
${await tr("help.aShare")}

${await tr("help.qPrivate")}
${await tr("help.aPrivate")}

${await tr("help.qLimits")}
${await tr("help.aLimits")}

${await tr("help.tips")}
${await tr("help.tipNames")}
${await tr("help.tipFolders")}
${await tr("help.tipTemp")}`,
            await KB.main(uid)
        );
    });

    // ========== ADMIN PANEL ==========
    bot.command("admin", async (ctx) => {
        if (!isAdmin(ctx.from?.id)) return;
        const uid = String(ctx.from.id);
        const tr = await getUserTranslator(uid);
        await ctx.replyWithHTML(`${pe("crown", "👑")} ${await tr("admin.title")}`, await KB.admin(uid));
    });

    bot.action("ADM:STATS", async (ctx) => {
        if (!isAdmin(ctx.from?.id)) return ctx.answerCbQuery(await t(DEFAULT_LANG, "admin.accessDenied"), { show_alert: true });
        await ctx.answerCbQuery();
        const uid = String(ctx.from.id);
        const tr = await getUserTranslator(uid);
        try {
            const [users, active, files, sizeAgg] = await Promise.all([
                UserModel.estimatedDocumentCount(),
                UserModel.countDocuments({ lastActiveAt: { $gte: new Date(Date.now() - 86400000) } }),
                FileModel.estimatedDocumentCount(),
                FileModel.aggregate([{ $group: { _id: null, total: { $sum: "$fileSize" } } }]),
            ]);

            await safeEdit(ctx,
                `${pe("stats", "📊")} ${await tr("admin.adminStats")}

${await tr("admin.usersTotal", { total: users, active })}
${await tr("admin.filesTotal", { files, size: formatFileSize(sizeAgg[0]?.total || 0) })}
${await tr("admin.avgFiles", { avg: users ? (files / users).toFixed(1) : 0 })}
${await tr("admin.cacheEntries", { count: cache.size })}
${await tr("admin.rateLimitEntries", { count: rateLimitMap.size })}`,
                await KB.admin(uid)
            );
        } catch (e) {
            await ctx.answerCbQuery("DB error: " + e.message, { show_alert: true });
        }
    });

    bot.action("ADM:CLEANUP", async (ctx) => {
        if (!isAdmin(ctx.from?.id)) return ctx.answerCbQuery(await t(DEFAULT_LANG, "admin.accessDenied"), { show_alert: true });
        const uid = String(ctx.from.id);
        const tr = await getUserTranslator(uid);
        await ctx.answerCbQuery(await tr("admin.cleanup"));
        try {
            const [expired, cacheCleared] = await Promise.all([
                FileModel.deleteMany({ expiresAt: { $lt: new Date() }, isDeleted: { $ne: true } }),
                Promise.resolve().then(() => {
                    const now = Date.now(); let cleared = 0;
                    for (const [k, v] of cache) { if (now > v.expires) { cache.delete(k); cleared++; } }
                    return cleared;
                }),
            ]);

            await safeEdit(ctx,
                `${pe("cleanup", "🧹")} ${await tr("admin.cleanupDone")}

${await tr("admin.expiredDeleted", { count: expired.deletedCount })}
${await tr("admin.cacheCleared", { count: cacheCleared })}`,
                await KB.admin(uid)
            );
        } catch (e) {
            await ctx.reply("❌ Cleanup error: " + e.message);
        }
    });

    bot.action("ADM:BROADCAST", async (ctx) => {
        if (!isAdmin(ctx.from?.id)) return ctx.answerCbQuery(await t(DEFAULT_LANG, "admin.accessDenied"), { show_alert: true });
        await ctx.answerCbQuery();
        const uid = String(ctx.from.id);
        const tr = await getUserTranslator(uid);
        ensureSession(ctx).broadcast = true;
        await ctx.editMessageText(await tr("admin.broadcastPrompt"), {
            parse_mode: "HTML",
            reply_markup: Markup.inlineKeyboard([[Markup.button.callback(await tr("expiry.cancel"), "ADM:CANCEL_BROADCAST")]]).reply_markup,
        });
    });

    bot.action("ADM:CANCEL_BROADCAST", async (ctx) => {
        if (!isAdmin(ctx.from?.id)) return ctx.answerCbQuery(await t(DEFAULT_LANG, "admin.accessDenied"), { show_alert: true });
        const uid = String(ctx.from.id);
        const tr = await getUserTranslator(uid);
        await ctx.answerCbQuery(await tr("common.cancelled"));
        ensureSession(ctx).broadcast = false;
        await ctx.editMessageText(await tr("admin.title"), {
            parse_mode: "HTML",
            reply_markup: (await KB.admin(uid)).reply_markup,
        });
    });

    bot.action("ADM:USERS", async (ctx) => {
        if (!isAdmin(ctx.from?.id)) return ctx.answerCbQuery(await t(DEFAULT_LANG, "admin.accessDenied"), { show_alert: true });
        await ctx.answerCbQuery();
        const uid = String(ctx.from.id);
        const tr = await getUserTranslator(uid);
        try {
            const [total, active7d, blocked, topUsers] = await Promise.all([
                UserModel.countDocuments(),
                UserModel.countDocuments({ lastActiveAt: { $gte: new Date(Date.now() - 7 * 86400000) } }),
                UserModel.countDocuments({ isBlocked: true }),
                UserModel.find({}, { firstName: 1, username: 1, fileCount: 1, storageUsed: 1 })
                    .sort({ fileCount: -1 }).limit(5).lean(),
            ]);

            const topList = topUsers
                .map(u => `• ${u.username ? `@${u.username}` : escapeHtml(u.firstName || "Unknown")} — ${u.fileCount} files • ${formatFileSize(u.storageUsed)}`)
                .join("\n") || `• ${await tr("stats.none")}`;

            await safeEdit(ctx,
                `${pe("users", "👥")} ${await tr("admin.userStats")}

${await tr("admin.total", { count: total })}
${await tr("admin.active7d", { count: active7d })}
${await tr("admin.blocked", { count: blocked })}

${await tr("admin.topByFiles")}
${topList}`,
                await KB.admin(uid)
            );
        } catch (e) {
            await ctx.reply("❌ Error: " + e.message);
        }
    });

    bot.action("ADM:CACHE", async (ctx) => {
        if (!isAdmin(ctx.from?.id)) return ctx.answerCbQuery(await t(DEFAULT_LANG, "admin.accessDenied"), { show_alert: true });
        const uid = String(ctx.from.id);
        const tr = await getUserTranslator(uid);
        const before = cache.size;
        memoryCache.clear();
        rateLimitMap.clear();
        await ctx.answerCbQuery(`✅ Cleared ${before} cache entries + rate limits`, { show_alert: true });
        await safeEdit(ctx, `${pe("crown", "👑")} ${await tr("admin.title")}\n\n${await tr("admin.allCacheCleared")}`, await KB.admin(uid));
    });

    // ========== TEXT HANDLER ==========
    bot.on("text", async (ctx) => {
        const sess = ensureSession(ctx);
        const uid = String(ctx.from.id);
        const tr = await getUserTranslator(uid);
        const txt = ctx.message.text.trim();

        // --- ADMIN BROADCAST ---
        if (isAdmin(ctx.from?.id) && sess.broadcast) {
            sess.broadcast = false;
            if (txt === "/cancel") return ctx.replyWithHTML(await tr("admin.broadcastCancelled"), await KB.admin(uid));

            const loading = await ctx.reply("📤 Sending broadcast...");
            let sent = 0, failed = 0, blocked = 0, page = 0;
            const limit = 100;

            while (true) {
                const users = await UserModel.find({ isBlocked: { $ne: true } }, { tgUserId: 1 })
                    .skip(page * limit).limit(limit).lean();
                if (!users.length) break;

                for (const u of users) {
                    try {
                        await ctx.telegram.sendMessage(u.tgUserId, txt, { parse_mode: "HTML" });
                        sent++;
                    } catch (e) {
                        if (e?.code === 403) {
                            UserModel.updateOne({ tgUserId: u.tgUserId }, { $set: { isBlocked: true } }).catch(() => { });
                            blocked++;
                        } else { failed++; }
                    }
                    await sleep(40);
                }
                page++;

                if (page % 5 === 0) {
                    ctx.telegram.editMessageText(
                        ctx.chat.id, loading.message_id, undefined,
                        await tr("admin.broadcastProgress", { sent, failed, blocked }),
                        { parse_mode: "HTML" }
                    ).catch(() => { });
                }
            }

            return ctx.telegram.editMessageText(
                ctx.chat.id, loading.message_id, undefined,
                await tr("admin.broadcastDone", { sent, failed, blocked }),
                { parse_mode: "HTML" }
            ).catch(() => { });
        }

        // --- SEARCH MODE ---
        if (sess.searchMode && txt && !txt.startsWith("/")) {
            sess.searchMode = false;
            const filter = sess.searchFilter;
            sess.searchFilter = null;

            await ctx.reply(
                `🔍 ${await tr("search.title")}: <code>${escapeHtml(txt)}</code>${filter ? ` [${filter}]` : ""}`,
                { parse_mode: "HTML" }
            );
            const files = await searchFiles(uid, txt, { kind: filter || undefined, limit: 10 });
            if (!files.length) return ctx.reply(await tr("search.noResults"));

            const res = files
                .map(f => {
                    const kindEmoji = f.kind === "photo" ? "🖼️"
                        : f.kind === "video" ? "🎬"
                            : f.kind === "audio" ? "🎵"
                                : f.kind === "voice" ? "🎙️"
                                    : "📄";
                    return `${kindEmoji} <code>${escapeHtml(f.fileName)}</code>\n` +
                        `   ${f.kind.toUpperCase()} • ${formatFileSize(f.fileSize)} • ${formatTime(f.createdAt)}\n` +
                        `   📤 <code>/f ${escapeHtml(f.fileName)}</code>  🗑️ <code>/d ${escapeHtml(f.fileName)}</code>`;
                })
                .join("\n\n");
            return ctx.replyWithHTML(`${await tr("search.results", { count: files.length })}\n\n${res}\n\n💡 <i>Faylni olish uchun /f, o'chirish uchun /d yozing</i>`, await KB.main(uid));
        }

        // --- PENDING ACTIONS ---
        if (sess.pendingAction) {
            const { type, fileId } = sess.pendingAction;
            sess.pendingAction = null;

            if (type === "rename" && fileId) {
                const res = await updateFile(uid, fileId, { fileName: txt.slice(0, 200) });
                return ctx.replyWithHTML(
                    res ? `✅ ${await tr("files.rename")}: <code>${escapeHtml(txt)}</code>` : await tr("common.renameFailed"),
                    await KB.main(uid)
                );
            }

            if (type === "folder_create") {
                if (!txt || txt.length < 1) return ctx.reply(await tr("common.emptyName"));
                const f = await createFolder(uid, txt);
                return ctx.replyWithHTML(
                    f ? await tr("folders.created", { name: escapeHtml(f.name) }) : `❌ ${await tr("common.error")}`,
                    await KB.folders(uid)
                );
            }

            if (type === "share" && fileId) {
                const username = txt.replace("@", "").toLowerCase().trim();
                if (!username) return ctx.reply(await tr("share.invalidUsername"));
                const target = await UserModel.findOne({ username }).lean();
                if (!target) return ctx.reply(await tr("share.userNotFound"));
                if (target.tgUserId === uid) return ctx.reply(await tr("share.selfShare"));

                const sharedFile = await FileModel.findOneAndUpdate(
                    { _id: fileId, ownerTgUserId: uid },
                    { $addToSet: { sharedWith: target.tgUserId } },
                    { new: true }
                );
                if (!sharedFile) return ctx.reply(await tr("common.notFound"));
                invalidateUser(uid);

                const senderName = escapeHtml(ctx.from.first_name || ctx.from.username || "Someone");
                const caption = `📤 <b>${senderName}</b> shared a file with you:\n\n<code>${escapeHtml(sharedFile.fileName)}</code>\n📦 ${formatFileSize(sharedFile.fileSize)} • ${sharedFile.kind.toUpperCase()}`;
                try {
                    if (sharedFile.kind === "photo") {
                        await ctx.telegram.sendPhoto(target.tgUserId, sharedFile.tgFileId, { caption, parse_mode: "HTML" });
                    } else {
                        await ctx.telegram.sendDocument(target.tgUserId, sharedFile.tgFileId, { caption, parse_mode: "HTML" });
                    }
                    return ctx.replyWithHTML(await tr("share.shared", { username: escapeHtml(target.username) }), await KB.main(uid));
                } catch (e) {
                    console.error("Share delivery error:", e.message);
                    return ctx.replyWithHTML(await tr("share.notDelivered", { username: escapeHtml(target.username) }), await KB.main(uid));
                }
            }
        }

        // --- DEFAULT ---
        await ctx.reply("👆 Use the buttons below:", { reply_markup: (await KB.main(uid)).reply_markup });
    });

    // ==================== FILE HANDLER ====================
    async function handleFileMessage(ctx) {
        const uid = await upsertUser(ctx);
        const tr = await getUserTranslator(uid);
        const m = ctx.message;

        let kind, obj;
        if (m.document) { kind = "document"; obj = m.document; }
        else if (m.video) { kind = "video"; obj = m.video; }
        else if (m.audio) { kind = "audio"; obj = m.audio; }
        else if (m.voice) { kind = "voice"; obj = m.voice; }
        else if (m.photo?.length) { kind = "photo"; obj = m.photo[m.photo.length - 1]; }
        if (!obj) return;

        const max = CONFIG.FILE_LIMITS[kind] || 52428800;
        if ((obj.file_size || 0) > max) {
            return ctx.reply(await tr("common.fileTooLarge", { size: formatFileSize(max) }));
        }

        const groupKey = m.media_group_id || uid;

        addToMediaGroup(groupKey, { uid, ctx, obj, kind, caption: m.caption || "" }, async (batch) => {
            if (batch.length === 1) {
                const { uid, ctx, obj, kind, caption } = batch[0];
                const batchTr = await getUserTranslator(uid);
                try {
                    const { file, duplicate, name, isPriv } = await saveOneFile(ctx, uid, obj, kind, caption);
                    if (duplicate) {
                        return ctx.replyWithHTML(
                            `${await batchTr("files.alreadySaved")}\n\n<code>${escapeHtml(file.fileName)}</code>`,
                            await KB.files(file._id.toString(), uid)
                        );
                    }
                    invalidateUser(uid);
                    await ctx.replyWithHTML(
                        `${pe("success", "✅")} ${await batchTr("files.fileSaved")}

📄 <code>${escapeHtml(name)}</code>
📦 ${formatFileSize(obj.file_size || 0)} • <b>${kind.toUpperCase()}</b>
🔐 ${isPriv ? `Private 🔒` : "Public"}${file.expiresAt ? `\n⏰ Expires: ${new Date(file.expiresAt).toLocaleString()}` : ""}

👇`,
                        await KB.files(file._id.toString(), uid)
                    );
                } catch (err) {
                    console.error("Save file error:", err.message);
                    await ctx.reply(formatError(err), { parse_mode: "HTML" }).catch(() => { });
                }
                return;
            }

            // Multiple files batch
            const firstCtx = batch[0].ctx;
            const bUid = batch[0].uid;
            const batchTr = await getUserTranslator(bUid);
            let saved = 0, duplicates = 0, errors = 0;
            const savedFiles = [];

            for (const item of batch) {
                try {
                    const { file, duplicate, name } = await saveOneFile(item.ctx, item.uid, item.obj, item.kind, item.caption);
                    if (duplicate) { duplicates++; }
                    else { saved++; savedFiles.push({ file, name, kind: item.kind, size: item.obj.file_size || 0 }); }
                } catch (err) { errors++; console.error("Batch save error:", err.message); }
            }

            invalidateUser(bUid);

            let text = `${pe("success", "✅")} <b>${saved} file${saved !== 1 ? "s" : ""} saved!</b>\n\n`;
            if (savedFiles.length) {
                text += savedFiles.map(f => `📄 <code>${escapeHtml(f.name)}</code> — ${formatFileSize(f.size)}`).join("\n");
                text += "\n";
            }
            if (duplicates) text += `\n${await batchTr("files.alreadySaved")} (${duplicates} skipped)`;
            if (errors) text += `\n❌ ${errors} failed to save`;
            text += `\n\n💾 Total: ${saved}`;

            await firstCtx.replyWithHTML(text, await KB.main(bUid));
        });
    }

    bot.on(["document", "photo", "video", "audio", "voice"], handleFileMessage);

    // Catch-all callback
    bot.on("callback_query", async (ctx) => {
        await ctx.answerCbQuery("⚠️ Unknown action").catch(() => { });
    });

    // ========== LAUNCH ==========
    await bot.launch();
    console.log(`✅ Bot v${version} online | @${bot.botInfo?.username} | Ready`);

    try {
        const botInfo = await bot.telegram.getMe();
        console.log(`🔍 Inline mode: ${botInfo.can_join_groups ? "Groups enabled" : "Check BotFather"}`);
    } catch (e) {
        console.warn("⚠️ Could not fetch bot info:", e.message);
    }

    const shutdown = (sig) => async () => {
        console.log(`\n${sig} received — shutting down...`);
        bot.stop(sig);
        memoryCache.clear();
        rateLimitMap.clear();
        await sleep(1000);
        process.exit(0);
    };
    process.once("SIGINT", shutdown("SIGINT"));
    process.once("SIGTERM", shutdown("SIGTERM"));

    return bot;
}