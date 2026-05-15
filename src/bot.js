// bot.js - Ultra-Fast Cloud Bot (English Only, Full Inline) — PRODUCTION FIXED
import { Telegraf, Markup, session } from "telegraf";
import { UserModel } from "./models/User.js";
import { FileModel } from "./models/File.js";
import { version } from "../i.js";
import crypto from "crypto";

// ==================== CONFIG ====================
const CONFIG = {
    CACHE_TTL: {
        USER: 300_000,    // 5 min
        STATS: 120_000,   // 2 min
        FILES: 60_000,    // 1 min
        ADMIN: 60_000     // 1 min
    },
    RATE_LIMIT: {
        window: 60_000,
        maxRequests: 25
    },
    FILE_LIMITS: {
        document: 50 * 1024 * 1024,
        video: 50 * 1024 * 1024,
        audio: 50 * 1024 * 1024,
        voice: 50 * 1024 * 1024,
        photo: 10 * 1024 * 1024
    }
};

// ==================== IN-MEMORY CACHE ====================
const cache = new Map();

const memoryCache = {
    set(key, value, ttl) {
        cache.set(key, { value, expires: Date.now() + ttl });
    },
    get(key) {
        const item = cache.get(key);
        if (!item) return null;
        if (Date.now() > item.expires) {
            cache.delete(key);
            return null;
        }
        return item.value;
    },
    del(key) { cache.delete(key); },
    delPattern(pattern) {
        const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*");
        const regex = new RegExp(`^${escaped}$`);
        for (const key of cache.keys()) {
            if (regex.test(key)) cache.delete(key);
        }
    },
    clear() { cache.clear(); }
};

// ==================== RATE LIMITER ====================
const rateLimitMap = new Map();

function checkRateLimit(userId) {
    const now = Date.now();
    if (!rateLimitMap.has(userId)) rateLimitMap.set(userId, []);
    const requests = rateLimitMap.get(userId);

    while (requests.length && now - requests[0] >= CONFIG.RATE_LIMIT.window) {
        requests.shift();
    }

    if (requests.length >= CONFIG.RATE_LIMIT.maxRequests) return false;
    requests.push(now);
    return true;
}

// ==================== UTILS ====================
const escapeHtml = (text) =>
    text ? String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;") : "";

const formatFileSize = (bytes) => {
    if (!bytes) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let i = 0, size = bytes;
    while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
    return `${size.toFixed(i ? 1 : 0)} ${units[i]}`;
};

const formatTime = (date) => {
    const diff = Date.now() - new Date(date);
    const m = Math.floor(diff / 60000), h = Math.floor(diff / 3600000), d = Math.floor(diff / 86400000);
    return d ? `${d}d ago` : h ? `${h}h ago` : m ? `${m}m ago` : "just now";
};

const formatError = (err) =>
    `❌ <b>Error</b>\n<code>${escapeHtml((err?.message || String(err)).slice(0, 400))}</code>`;

const isAdmin = (id) =>
    process.env.ADMIN_IDS?.split(",").map(s => s.trim()).includes(String(id));

const webAppUrl = () => {
    const base = process.env.BASE_URL;
    if (!base || !base.startsWith('https://')) return null;
    return `${base}/app`;
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const invalidateUser = (id) => {
    memoryCache.del(`user:${id}`);
    memoryCache.del(`stats:${id}`);
    memoryCache.delPattern(`files:${id}:*`);
};

// ==================== SESSION SAFE ====================
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
            disable_web_page_preview: true
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

// ==================== KEYBOARDS (ALL INLINE) ====================
const KB = {
    main: (uid) => {
        const appUrl = webAppUrl();
        return Markup.inlineKeyboard([
            ...(appUrl ? [[Markup.button.webApp("☁️ Open Cloud", appUrl)]] : []),
            [Markup.button.callback("📁 My Files", "MY_FILES"), Markup.button.callback("🔍 Search", "SEARCH_MAIN")],
            [Markup.button.callback("📂 Folders", "FOLDERS_MAIN"), Markup.button.callback("⏰ Expiring", "EXPIRING_MAIN")],
            [Markup.button.callback("🔗 Share", "SHARE_MAIN"), Markup.button.callback("⚙️ Settings", "SETTINGS_MAIN")],
            [Markup.button.callback("ℹ️ About", "ABOUT"), Markup.button.callback("🆘 Help", "HELP")]
        ]);
    },

    files: (fileId) => Markup.inlineKeyboard([
        [Markup.button.callback("📥 Download", `DL:${fileId}`), Markup.button.callback("🔗 Share", `SHARE_SELECT:${fileId}`)],
        [Markup.button.callback("✏️ Rename", `RENAME:${fileId}`), Markup.button.callback("🗑️ Delete", `DELETE:${fileId}`)],
        [Markup.button.callback("🔒 Toggle Private", `PRIV:${fileId}`), Markup.button.callback("⏰ Set Expiry", `EXP:${fileId}`)],
        [Markup.button.callback("📂 Move", `MOVE:${fileId}`), Markup.button.callback("🔙 Back", "MY_FILES")]
    ]),

    folders: () => Markup.inlineKeyboard([
        [Markup.button.callback("➕ New Folder", "FOLDER_CREATE")],
        [Markup.button.callback("📂 View All", "FOLDER_LIST")],
        [Markup.button.callback("🗂️ Move Files", "FOLDER_MOVE_SELECT")],
        [Markup.button.callback("🔙 Back", "MAIN")]
    ]),

    // ✅ FIX: switch_inline_query_current_chat now properly configured
    search: () => Markup.inlineKeyboard([
        [{ text: "🔍 Search files...", switch_inline_query_current_chat: "" }],
        [Markup.button.callback("📄 Docs", "SRCH:document"), Markup.button.callback("🖼 Photos", "SRCH:photo")],
        [Markup.button.callback("🎥 Video", "SRCH:video"), Markup.button.callback("🎵 Audio", "SRCH:audio")],
        [Markup.button.callback("🗑️ Clear Filter", "SRCH:CLEAR"), Markup.button.callback("🔙 Back", "MAIN")]
    ]),

    settings: (user) => {
        const notifOn = user?.settings?.notifications !== false;
        const privOn = user?.settings?.privateByDefault === true;
        return Markup.inlineKeyboard([
            [
                Markup.button.callback(`🔔 Notif: ${notifOn ? "ON" : "OFF"}`, `SET:NOTIF:${notifOn ? "off" : "on"}`),
                Markup.button.callback(`🔐 Private: ${privOn ? "ON" : "OFF"}`, "SET:PRIV:toggle")
            ],
            [Markup.button.callback("⏰ Auto-Expire", "SET:EXPIRE:menu")],
            [Markup.button.callback("🗑️ Clear My Cache", "SET:CACHE"), Markup.button.callback("📊 My Stats", "SET:STATS")],
            [Markup.button.callback("🔙 Back", "MAIN")]
        ]);
    },

    expireMenu: () => Markup.inlineKeyboard([
        [Markup.button.callback("24 hours", "EXPSET:24h"), Markup.button.callback("7 days", "EXPSET:7d")],
        [Markup.button.callback("30 days", "EXPSET:30d"), Markup.button.callback("90 days", "EXPSET:90d")],
        [Markup.button.callback("❌ Remove", "EXPSET:none"), Markup.button.callback("🔙 Cancel", "CANCEL_ACTION")]
    ]),

    expireMenuForFile: () => Markup.inlineKeyboard([
        [Markup.button.callback("24 hours", "FILE_EXPSET:24h"), Markup.button.callback("7 days", "FILE_EXPSET:7d")],
        [Markup.button.callback("30 days", "FILE_EXPSET:30d"), Markup.button.callback("90 days", "FILE_EXPSET:90d")],
        [Markup.button.callback("❌ Remove", "FILE_EXPSET:none"), Markup.button.callback("🔙 Cancel", "CANCEL_ACTION")]
    ]),

    confirm: (action, id) => Markup.inlineKeyboard([
        [Markup.button.callback(`✅ Yes`, `CONFIRM:${action}:${id}`)],
        [Markup.button.callback("❌ Cancel", `CANCEL_ACTION`)]
    ]),

    admin: () => Markup.inlineKeyboard([
        [Markup.button.callback("📊 Stats", "ADM:STATS"), Markup.button.callback("📢 Broadcast", "ADM:BROADCAST")],
        [Markup.button.callback("🧹 Cleanup", "ADM:CLEANUP"), Markup.button.callback("👥 Users", "ADM:USERS")],
        [Markup.button.callback("🗑️ Clear All Cache", "ADM:CACHE"), Markup.button.callback("🔙 Back", "MAIN")]
    ]),

    pagination: (page, hasMore, baseAction) => {
        const rows = [];
        const nav = [];
        if (page > 0) nav.push(Markup.button.callback("⏮ Prev", `${baseAction}:${page - 1}`));
        if (hasMore) nav.push(Markup.button.callback("⏭ Next", `${baseAction}:${page + 1}`));
        if (nav.length) rows.push(nav);
        rows.push([Markup.button.callback("🔙 Back", "MAIN")]);
        return Markup.inlineKeyboard(rows);
    }
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
            FileModel.collection.createIndex({ sharedWith: 1 })
        ]);
        console.log("✅ Indexes ready");
    } catch (e) { console.error("Index error:", e.message); }
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
        lastActiveAt: new Date()
    };

    if (memoryCache.get(key)) {
        UserModel.updateOne({ tgUserId: id }, { $set: fields }).catch(() => { });
        return id;
    }

    let user = await UserModel.findOne({ tgUserId: id }).lean();
    if (!user) {
        user = await UserModel.create({
            tgUserId: id, ...fields, startedAt: new Date(),
            storageUsed: 0, fileCount: 0, folderIds: [],
            settings: { notifications: true, privateByDefault: false, autoExpire: null }
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
                            { $project: { fileName: 1, kind: 1, fileSize: 1, createdAt: 1, isPrivate: 1 } }
                        ]
                    }
                }
            ])
        ]);

        if (!user) return null;
        const s = stats[0] || {};
        const result = {
            user,
            totalFiles: s.total?.[0]?.c || 0,
            totalSize: s.size?.[0]?.total || 0,
            byKind: s.byKind || [],
            recent: s.recent || []
        };
        memoryCache.set(key, result, CONFIG.CACHE_TTL.STATS);
        return result;
    } catch (e) {
        console.error("Stats error:", e.message);
        return null;
    }
}

// ==================== FILE OPS ====================
// ✅ FIX: searchFiles — escape regex special chars, ensure tgFileId selected
async function searchFiles(uid, query, opts = {}) {
    const {
        kind,
        folderId,
        isPrivate,
        limit = 20,
        page = 0
    } = opts;

    // regex escape
    const escapedQuery = query.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
    );

    const match = {
        ownerTgUserId: String(uid),
        isDeleted: { $ne: true },
        fileName: {
            $regex: escapedQuery,
            $options: "i"
        }
    };

    if (kind) {
        match.kind = kind;
    }

    if (folderId !== undefined) {
        match.folderId = folderId || null;
    }

    if (isPrivate !== undefined) {
        match.isPrivate = isPrivate;
    }

    return FileModel.find(match)
        .sort({ createdAt: -1 })
        .skip(page * limit)
        .limit(limit)
        .select(`
            fileName
            kind
            fileSize
            createdAt
            isPrivate
            expiresAt
            folderId
            tgFileId
            tgUniqueId
        `)
        .lean();
}

// -------------------------------

// -------------------------------

async function handleInline(ctx) {
    const uid = String(ctx.from?.id);

    const query = (
        ctx.inlineQuery.query || ""
    ).trim();

    const offset =
        ctx.inlineQuery.offset || "0";

    const page =
        parseInt(offset, 10) || 0;

    if (!uid || query.length < 1) {
        return ctx.answerInlineQuery([], {
            cache_time: 30,
            is_personal: true
        });
    }

    try {
        const LIMIT = 50;

        const files = await searchFiles(
            uid,
            query,
            {
                limit: LIMIT,
                page
            }
        );

        const results = [];

        for (const [idx, f] of files.entries()) {

            // IMPORTANT
            // tgUniqueId ishlatmaymiz
            const fileId = f.tgFileId;

            if (
                !fileId ||
                typeof fileId !== "string"
            ) {
                continue;
            }

            const resultId =
                `f_${f._id}_${idx}`;

            const safeFileName =
                escapeHtml(
                    f.fileName || "Untitled"
                );

            const caption =
                `<b>${safeFileName}</b>

📦 ${formatFileSize(f.fileSize)}
🕐 ${formatTime(f.createdAt)}
📁 ${(f.kind || "file").toUpperCase()}`;

            const base = {
                id: resultId,
                caption,
                parse_mode: "HTML"
            };

            try {

                switch (f.kind) {

                    case "photo":
                        results.push({
                            ...base,
                            type: "photo",
                            photo_file_id: fileId
                        });
                        break;

                    case "video":
                        results.push({
                            ...base,
                            type: "video",
                            video_file_id: fileId,

                            title: (
                                f.fileName ||
                                "Video"
                            ).slice(0, 64),

                            description:
                                `VIDEO • ${formatFileSize(f.fileSize)}`
                        });
                        break;

                    case "audio":
                        results.push({
                            ...base,
                            type: "audio",
                            audio_file_id: fileId,

                            title: (
                                f.fileName ||
                                "Audio"
                            ).slice(0, 64),

                            caption,

                            parse_mode: "HTML"
                        });
                        break;

                    case "voice":
                        results.push({
                            ...base,
                            type: "voice",
                            voice_file_id: fileId
                        });
                        break;

                    default:
                        results.push({
                            ...base,

                            type: "document",

                            document_file_id: fileId,

                            title: (
                                f?.fileName ||
                                "File"
                            ).slice(0, 64),

                            description:
                                `${(f.kind || "FILE").toUpperCase()} • ${formatFileSize(f.fileSize)}`
                        });
                }

            } catch (err) {
                console.log(
                    "[INLINE RESULT ERROR]",
                    err.message
                );
            }
        }

        await ctx.answerInlineQuery(
            results,
            {
                cache_time: 60,
                is_personal: true,

                next_offset:
                    results.length >= LIMIT
                        ? String(page + 1)
                        : ""
            }
        );

    } catch (e) {

        console.error(
            `[INLINE ERROR] uid=${uid} query="${query}"`,
            e
        );

        try {
            await ctx.answerInlineQuery(
                [],
                {
                    cache_time: 1,
                    is_personal: true
                }
            );
        } catch { }
    }
}

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
                    createdAt: new Date()
                }
            }
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
const EXPIRY = { '24h': 86400000, '7d': 604800000, '30d': 2592000000, '90d': 7776000000 };

async function setExpiry(uid, fid, dur) {
    if (dur === 'none') return updateFile(uid, fid, { expiresAt: null });
    const ms = EXPIRY[dur];
    if (!ms) return null;
    return updateFile(uid, fid, { expiresAt: new Date(Date.now() + ms) });
}

// ==================== BOT START ====================
export async function startBot() {
    if (!process.env.BOT_TOKEN || !process.env.BASE_URL) throw new Error("Missing env vars: BOT_TOKEN, BASE_URL");

    const bot = new Telegraf(process.env.BOT_TOKEN);

    // ✅ FIX: Set inline query placeholder for better UX (requires BotFather setup)
    try {
        await bot.telegram.setMyCommands([
            { command: "start", description: "🚀 Start bot" },
            { command: "help", description: "🆘 Get help" },
            { command: "admin", description: "👑 Admin panel" }
        ]);
        // Optional: Set inline query placeholder if bot supports it
        // This requires calling setMyShortDescription or using BotFather
    } catch (e) {
        console.warn("⚠️ Could not set bot commands:", e.message);
    }

    await ensureIndexes();
    bot.use(session());

    // Middleware: rate limit + session ensure + user upsert
    bot.use(async (ctx, next) => {
        const uid = ctx.from?.id;
        if (uid && !isAdmin(uid) && !checkRateLimit(uid)) {
            return ctx.reply("⚠️ Too fast! Please wait ~1 min.").catch(() => { });
        }
        ensureSession(ctx);
        if (ctx.from) await upsertUser(ctx).catch(e => console.error("upsertUser error:", e.message));
        await next();
    });

    // Global error handler
    bot.catch((err, ctx) => {
        console.error(`[${ctx?.updateType}] Global error:`, err.message);
        ctx?.reply?.(formatError(err), { parse_mode: "HTML" }).catch(() => { });
    });

    // ========== /start ==========
    bot.start(async (ctx) => {
        const uid = await upsertUser(ctx);
        const stats = await getUserStats(uid);
        const text = `
<b>☁️ Cloud Bot v${version}</b>

<b>Features:</b>
• 📤 Auto-save any file
• 📁 Folder organization
• 🔍 Inline search anywhere
• 🔗 Share with users
• ⏰ Auto-expiry dates
• 🔐 Private files
• 📊 Usage stats

<b>Your Storage:</b>
• Files: <code>${stats?.totalFiles || 0}</code>
• Used: <code>${formatFileSize(stats?.totalSize || 0)}</code>

👇 <b>Tap a button:</b>`.trim();
        await ctx.replyWithHTML(text, KB.main(uid));
    });

    // ========== /help ==========
    bot.command("help", async (ctx) => {
        const me = ctx.me || (await bot.telegram.getMe()).username;
        await ctx.replyWithHTML(`
<b>🆘 Quick Guide</b>

<b>Save:</b> Send any file → auto-saved
<b>Find:</b> Use 🔍 Search or @${me} in any chat
<b>Organize:</b> Folders → Create/Move files
<b>Share:</b> Select file → Share → @username
<b>Expiry:</b> Set 24h/7d/30d/90d auto-delete
<b>Private:</b> Toggle 🔒 for extra security

<b>Limits:</b> 50MB docs/video/audio, 10MB photos
<b>Tip:</b> Use descriptive names for better search!
        `.trim(), KB.main(ctx.from.id));
    });

    // ========== INLINE — REGISTER HANDLER ==========
    // ✅ FIX: Ensure this is registered BEFORE text handlers to avoid conflicts
    bot.on('inline_query', handleInline);

    // ========== MAIN NAVIGATION ==========
    bot.action("MAIN", async (ctx) => {
        await ctx.answerCbQuery();
        await safeEdit(ctx, "<b>📋 Main Menu</b>", KB.main(ctx.from.id));
    });

    bot.action("MY_FILES", async (ctx) => {
        await ctx.answerCbQuery();
        await withLoading(ctx, async () => {
            const uid = String(ctx.from.id);
            const stats = await getUserStats(uid);

            if (!stats || stats.totalFiles === 0) {
                return safeEdit(ctx, "📭 <b>No files yet</b>\n\nSend any file to save it!\n\n💡 Forward from other chats too.", KB.main(uid));
            }

            const list = stats.recent.map(f =>
                `• <code>${escapeHtml(f.fileName)}</code>\n  ${f.kind.toUpperCase()} • ${formatFileSize(f.fileSize)} • ${formatTime(f.createdAt)}${f.isPrivate ? ' 🔒' : ''}`
            ).join('\n');

            await safeEdit(ctx, `<b>📁 Recent Files</b> (${stats.totalFiles} total)\n\n${list}\n\n<b>💾 Used:</b> <code>${formatFileSize(stats.totalSize)}</code>\n\n👇 Actions:`, KB.main(uid));
        });
    });

    // ========== SEARCH ==========
    bot.action("SEARCH_MAIN", async (ctx) => {
        await ctx.answerCbQuery();
        const sess = ensureSession(ctx);
        sess.searchMode = true;
        sess.searchFilter = null;
        await safeEdit(ctx, "🔍 <b>Search Files</b>\n\n• Type keyword below\n• Or use inline: @bot query\n\n<b>Filter by type:</b>", KB.search());
    });

    bot.action(/^SRCH:(.+)$/, async (ctx) => {
        await ctx.answerCbQuery();
        const filter = ctx.match[1];
        const sess = ensureSession(ctx);
        if (filter === "CLEAR") {
            sess.searchFilter = null;
            sess.searchMode = false;
            return safeEdit(ctx, "🔍 <b>Search Files</b>\n\n• Type keyword below\n• Or use inline: @bot query\n\n<b>Filter by type:</b>", KB.search());
        }
        sess.searchFilter = filter;
        sess.searchMode = true;
        await ctx.reply(`🔍 Filter set: <b>${filter}</b>\n\nNow type your search keyword:`, { parse_mode: "HTML" });
    });

    // ========== FOLDERS ==========
    bot.action("FOLDERS_MAIN", async (ctx) => {
        await ctx.answerCbQuery();
        const uid = String(ctx.from.id);
        const user = await UserModel.findOne({ tgUserId: uid }, { folderIds: 1 }).lean();
        const folders = user?.folderIds || [];
        const list = folders.length
            ? folders.map(f => `📁 <b>${escapeHtml(f.name)}</b> (${f.fileCount} files)`).join('\n')
            : "No folders yet. Create one!";
        await safeEdit(ctx, `<b>📂 Your Folders</b>\n\n${list}\n\n👇 Manage:`, KB.folders());
    });

    bot.action("FOLDER_CREATE", async (ctx) => {
        await ctx.answerCbQuery();
        ensureSession(ctx).pendingAction = { type: "folder_create" };
        await ctx.editMessageText("📁 <b>New Folder</b>\n\nSend folder name:", {
            parse_mode: "HTML",
            reply_markup: Markup.inlineKeyboard([[Markup.button.callback("❌ Cancel", "CANCEL_ACTION")]]).reply_markup
        });
    });

    bot.action("FOLDER_LIST", async (ctx) => {
        await ctx.answerCbQuery();
        const uid = String(ctx.from.id);
        const user = await UserModel.findOne({ tgUserId: uid }, { folderIds: 1 }).lean();
        if (!user?.folderIds?.length) return ctx.answerCbQuery("No folders yet", { show_alert: true });

        const kb = Markup.inlineKeyboard([
            ...user.folderIds.slice(0, 10).map(f => [Markup.button.callback(`📁 ${f.name}`, `FOLDER_OPEN:${f._id}`)]),
            [Markup.button.callback("🔙 Back", "FOLDERS_MAIN")]
        ]);
        await ctx.editMessageText("<b>📂 Select Folder:</b>", { parse_mode: "HTML", reply_markup: kb.reply_markup });
    });

    bot.action(/^FOLDER_OPEN:(.+)$/, async (ctx) => {
        await ctx.answerCbQuery();
        const uid = String(ctx.from.id);
        const fid = ctx.match[1];
        const files = await FileModel.find({ ownerTgUserId: uid, folderId: fid, isDeleted: { $ne: true } })
            .sort({ createdAt: -1 }).limit(10).lean();

        if (!files.length) return ctx.editMessageText("📭 Empty folder", { reply_markup: KB.folders().reply_markup });

        const list = files.map(f =>
            `• <code>${escapeHtml(f.fileName)}</code>\n  ${formatFileSize(f.fileSize)} • ${formatTime(f.createdAt)}`
        ).join('\n');
        await ctx.editMessageText(`<b>📁 Folder Contents</b>\n\n${list}`, {
            parse_mode: "HTML",
            reply_markup: KB.folders().reply_markup
        });
    });

    bot.action("FOLDER_MOVE_SELECT", async (ctx) => {
        await ctx.answerCbQuery();
        const uid = String(ctx.from.id);
        const files = await FileModel.find({ ownerTgUserId: uid, folderId: null, isDeleted: { $ne: true } })
            .limit(10).select('_id fileName').lean();
        if (!files.length) return ctx.answerCbQuery("No files to move", { show_alert: true });

        const kb = Markup.inlineKeyboard([
            ...files.slice(0, 8).map(f => [Markup.button.callback(`📄 ${f.fileName.slice(0, 30)}`, `MOVE_SELECT:${f._id}`)]),
            [Markup.button.callback("🔙 Back", "FOLDERS_MAIN")]
        ]);
        await ctx.editMessageText("<b>🗂️ Select file to move:</b>", { parse_mode: "HTML", reply_markup: kb.reply_markup });
    });

    bot.action(/^MOVE_SELECT:(.+)$/, async (ctx) => {
        await ctx.answerCbQuery();
        const uid = String(ctx.from.id);
        const fid = ctx.match[1];
        const user = await UserModel.findOne({ tgUserId: uid }, { folderIds: 1 }).lean();
        if (!user?.folderIds?.length) return ctx.answerCbQuery("Create a folder first", { show_alert: true });

        const kb = Markup.inlineKeyboard([
            ...user.folderIds.map(f => [Markup.button.callback(`📁 ${f.name}`, `MOVE_EXEC:${fid}:${f._id}`)]),
            [Markup.button.callback("🏠 Root (no folder)", `MOVE_EXEC:${fid}:null`)],
            [Markup.button.callback("❌ Cancel", "CANCEL_ACTION")]
        ]);
        await ctx.editMessageText("<b>📂 Move to:</b>", { parse_mode: "HTML", reply_markup: kb.reply_markup });
    });

    bot.action(/^MOVE_EXEC:([^:]+):(.+)$/, async (ctx) => {
        await ctx.answerCbQuery("🔄 Moving...");
        const uid = String(ctx.from.id);
        const fileId = ctx.match[1];
        const folderId = ctx.match[2] === 'null' ? null : ctx.match[2];
        await moveFiles(uid, [fileId], folderId);
        await ctx.editMessageText("✅ Moved!", { reply_markup: KB.folders().reply_markup });
    });

    // ========== EXPIRING ==========
    bot.action("EXPIRING_MAIN", async (ctx) => {
        await ctx.answerCbQuery();
        const uid = String(ctx.from.id);
        const exp = await FileModel.find({
            ownerTgUserId: uid,
            expiresAt: { $gt: new Date() },
            isDeleted: { $ne: true }
        }).sort({ expiresAt: 1 }).limit(10).select('fileName expiresAt').lean();

        const text = exp.length
            ? `⏰ <b>Expiring Soon</b>\n\n` + exp.map(f =>
                `• <code>${escapeHtml(f.fileName)}</code>\n  📅 ${new Date(f.expiresAt).toLocaleString()}`
            ).join('\n')
            : "✅ <b>No expiring files</b>\n\nSet expiry on files to auto-delete.";

        await safeEdit(ctx, text, KB.main(uid));
    });

    // ========== SHARE ==========
    bot.action("SHARE_MAIN", async (ctx) => {
        await ctx.answerCbQuery();
        const uid = String(ctx.from.id);

        const appUrl2 = webAppUrl();
        await safeEdit(ctx, "🔗 <b>Share File</b>\n\n1. Select a file below\n2. Enter @username to share with" + (appUrl2 ? "\n\nOr use Web App:" : ""), Markup.inlineKeyboard([
            ...(appUrl2 ? [[Markup.button.webApp("🌐 Web App", appUrl2)]] : []),
            [Markup.button.callback("🔙 Back", "MAIN")]
        ]));

        const files = await FileModel.find({ ownerTgUserId: uid, isDeleted: { $ne: true } })
            .limit(10).select('_id fileName').lean();
        if (!files.length) return;

        const kb = Markup.inlineKeyboard([
            ...files.map(f => [Markup.button.callback(`📄 ${f.fileName.slice(0, 35)}`, `SHARE_SELECT:${f._id}`)]),
            [Markup.button.callback("❌ Cancel", "CANCEL_ACTION")]
        ]);
        await ctx.reply("<b>Select file to share:</b>", { parse_mode: "HTML", reply_markup: kb.reply_markup });
    });

    bot.action(/^SHARE_SELECT:(.+)$/, async (ctx) => {
        await ctx.answerCbQuery();
        ensureSession(ctx).pendingAction = { type: "share", fileId: ctx.match[1] };
        await ctx.editMessageText("🔗 <b>Share With:</b>\n\nEnter @username:", {
            parse_mode: "HTML",
            reply_markup: Markup.inlineKeyboard([[Markup.button.callback("❌ Cancel", "CANCEL_ACTION")]]).reply_markup
        });
    });

    // ========== SETTINGS ==========
    bot.action("SETTINGS_MAIN", async (ctx) => {
        await ctx.answerCbQuery();
        const uid = String(ctx.from.id);
        const user = await UserModel.findOne({ tgUserId: uid }, { settings: 1 }).lean();
        await safeEdit(ctx, "⚙️ <b>Settings</b>", KB.settings(user));
    });

    bot.action(/^SET:NOTIF:(on|off)$/, async (ctx) => {
        const newVal = ctx.match[1] === "on";
        const uid = String(ctx.from.id);
        await UserModel.updateOne({ tgUserId: uid }, { $set: { "settings.notifications": newVal } });
        invalidateUser(uid);
        await ctx.answerCbQuery(`🔔 Notifications ${newVal ? "ON" : "OFF"}`, { show_alert: true });
        const user = await UserModel.findOne({ tgUserId: uid }, { settings: 1 }).lean();
        await ctx.editMessageText("⚙️ <b>Settings</b>", {
            parse_mode: "HTML",
            reply_markup: KB.settings(user).reply_markup
        });
    });

    bot.action("SET:PRIV:toggle", async (ctx) => {
        const uid = String(ctx.from.id);
        const user = await UserModel.findOne({ tgUserId: uid }, { settings: 1 }).lean();
        const newVal = !user?.settings?.privateByDefault;
        await UserModel.updateOne({ tgUserId: uid }, { $set: { "settings.privateByDefault": newVal } });
        invalidateUser(uid);
        await ctx.answerCbQuery(`🔐 Private default: ${newVal ? 'ON' : 'OFF'}`, { show_alert: true });
        const updated = await UserModel.findOne({ tgUserId: uid }, { settings: 1 }).lean();
        await ctx.editMessageText("⚙️ <b>Settings</b>", {
            parse_mode: "HTML",
            reply_markup: KB.settings(updated).reply_markup
        });
    });

    bot.action("SET:EXPIRE:menu", async (ctx) => {
        await ctx.answerCbQuery();
        await ctx.editMessageText("⏰ <b>Auto-Expire Default</b>\n\nNew files will auto-delete after:", {
            parse_mode: "HTML",
            reply_markup: KB.expireMenu().reply_markup
        });
    });

    bot.action(/^EXPSET:(.+)$/, async (ctx) => {
        const dur = ctx.match[1];
        const uid = String(ctx.from.id);
        await UserModel.updateOne({ tgUserId: uid }, { $set: { "settings.autoExpire": dur === 'none' ? null : dur } });
        invalidateUser(uid);
        await ctx.answerCbQuery(`✅ Auto-expire: ${dur === 'none' ? 'disabled' : dur}`, { show_alert: true });
        const user = await UserModel.findOne({ tgUserId: uid }, { settings: 1 }).lean();
        await ctx.editMessageText("⚙️ <b>Settings</b>", {
            parse_mode: "HTML",
            reply_markup: KB.settings(user).reply_markup
        });
    });

    bot.action("SET:CACHE", async (ctx) => {
        const uid = String(ctx.from.id);
        invalidateUser(uid);
        await ctx.answerCbQuery("✅ Your cache cleared!", { show_alert: true });
    });

    bot.action("SET:STATS", async (ctx) => {
        await ctx.answerCbQuery();
        const uid = String(ctx.from.id);
        const stats = await getUserStats(uid);
        if (!stats) return ctx.answerCbQuery("Error loading stats", { show_alert: true });

        const kindText = stats.byKind.map(k =>
            `• ${k._id}: ${k.count} file(s) • ${formatFileSize(k.size)}`
        ).join('\n') || "• No files yet";

        await ctx.replyWithHTML(`
<b>📊 Your Stats</b>

<b>Files:</b> ${stats.totalFiles}
<b>Storage:</b> ${formatFileSize(stats.totalSize)}

<b>By Type:</b>
${kindText}

<b>Recent:</b>
${stats.recent.slice(0, 3).map(f => `• <code>${escapeHtml(f.fileName)}</code> • ${formatFileSize(f.fileSize)}`).join('\n') || "• None"}
        `.trim(), KB.main(uid));
    });

    // ========== FILE ACTIONS ==========
    bot.action(/^DL:(.+)$/, async (ctx) => {
        await ctx.answerCbQuery("📥 Sending...");
        const uid = String(ctx.from.id);
        const file = await FileModel.findOne({ _id: ctx.match[1], ownerTgUserId: uid }).lean();
        if (!file) return ctx.reply("❌ File not found or access denied.");
        try {
            if (file.kind === 'photo') {
                await ctx.replyWithPhoto(file.tgFileId, {
                    caption: `<b>${escapeHtml(file.fileName)}</b>`,
                    parse_mode: "HTML"
                });
            } else {
                await ctx.replyWithDocument(file.tgFileId, {
                    caption: `<b>${escapeHtml(file.fileName)}</b>`,
                    parse_mode: "HTML"
                });
            }
        } catch (e) {
            console.error("Download error:", e.message);
            await ctx.reply("❌ Could not send file. It may have been deleted from Telegram.");
        }
    });

    bot.action(/^RENAME:(.+)$/, async (ctx) => {
        await ctx.answerCbQuery();
        ensureSession(ctx).pendingAction = { type: "rename", fileId: ctx.match[1] };
        await ctx.editMessageText("✏️ <b>Rename File</b>\n\nSend the new name:", {
            parse_mode: "HTML",
            reply_markup: Markup.inlineKeyboard([[Markup.button.callback("❌ Cancel", "CANCEL_ACTION")]]).reply_markup
        });
    });

    bot.action(/^DELETE:(.+)$/, async (ctx) => {
        await ctx.answerCbQuery();
        const file = await FileModel.findById(ctx.match[1]).lean();
        await safeEdit(
            ctx,
            `🗑️ <b>Delete File?</b>\n\n<code>${escapeHtml(file?.fileName || "Unknown")}</code>\n\n⚠️ Moves to trash (30 days).`,
            KB.confirm("delete", ctx.match[1])
        );
    });

    bot.action(/^CONFIRM:delete:(.+)$/, async (ctx) => {
        await ctx.answerCbQuery("🗑️ Deleting...");
        const uid = String(ctx.from.id);
        const res = await softDelete(uid, ctx.match[1]);
        if (!res) return ctx.editMessageText("❌ File not found or already deleted.", { reply_markup: KB.main(uid).reply_markup });
        await ctx.editMessageText("✅ Moved to trash. Will be permanently deleted in 30 days.", {
            reply_markup: KB.main(uid).reply_markup
        });
    });

    bot.action(/^PRIV:(.+)$/, async (ctx) => {
        await ctx.answerCbQuery();
        const uid = String(ctx.from.id);
        const file = await FileModel.findOne({ _id: ctx.match[1], ownerTgUserId: uid }).lean();
        if (!file) return ctx.answerCbQuery("File not found", { show_alert: true });
        await updateFile(uid, ctx.match[1], { isPrivate: !file.isPrivate });
        await ctx.answerCbQuery(`🔒 Private: ${!file.isPrivate ? 'ON' : 'OFF'}`, { show_alert: true });
        await ctx.editMessageReplyMarkup(KB.files(ctx.match[1]).reply_markup);
    });

    bot.action(/^EXP:(.+)$/, async (ctx) => {
        await ctx.answerCbQuery();
        ensureSession(ctx).pendingAction = { type: "set_expiry", fileId: ctx.match[1] };
        await ctx.editMessageText("⏰ <b>Set File Expiry</b>\n\nChoose duration:", {
            parse_mode: "HTML",
            reply_markup: KB.expireMenuForFile().reply_markup
        });
    });

    bot.action(/^FILE_EXPSET:(.+)$/, async (ctx) => {
        const sess = ensureSession(ctx);
        if (sess.pendingAction?.type !== "set_expiry") {
            return ctx.answerCbQuery("Session expired. Please try again.", { show_alert: true });
        }
        await ctx.answerCbQuery("⏳ Setting...");
        const dur = ctx.match[1];
        const fileId = sess.pendingAction.fileId;
        const uid = String(ctx.from.id);
        sess.pendingAction = null;

        const res = await setExpiry(uid, fileId, dur);
        const msg = res
            ? `✅ Expiry set: ${dur === 'none' ? 'removed' : dur}`
            : "❌ Failed to set expiry. File not found.";
        await ctx.editMessageText(msg, { reply_markup: KB.files(fileId).reply_markup });
    });

    bot.action(/^MOVE:(.+)$/, async (ctx) => {
        await ctx.answerCbQuery();
        const uid = String(ctx.from.id);
        const user = await UserModel.findOne({ tgUserId: uid }, { folderIds: 1 }).lean();
        if (!user?.folderIds?.length) return ctx.answerCbQuery("Create a folder first!", { show_alert: true });

        const kb = Markup.inlineKeyboard([
            ...user.folderIds.map(f => [Markup.button.callback(`📁 ${f.name}`, `MOVE_EXEC:${ctx.match[1]}:${f._id}`)]),
            [Markup.button.callback("🏠 Root", `MOVE_EXEC:${ctx.match[1]}:null`)],
            [Markup.button.callback("❌ Cancel", "CANCEL_ACTION")]
        ]);
        await ctx.editMessageText("<b>📂 Move File To:</b>", { parse_mode: "HTML", reply_markup: kb.reply_markup });
    });

    // ========== CANCEL ==========
    bot.action(/^CANCEL:.+$/, async (ctx) => {
        await ctx.answerCbQuery("Cancelled");
        const sess = ensureSession(ctx);
        sess.pendingAction = null;
        sess.searchMode = false;
        sess.searchFilter = null;
        await ctx.editMessageText("📋 <b>Main Menu</b>", {
            parse_mode: "HTML",
            reply_markup: KB.main(ctx.from.id).reply_markup
        });
    });

    bot.action("CANCEL_ACTION", async (ctx) => {
        await ctx.answerCbQuery("Cancelled");
        const sess = ensureSession(ctx);
        sess.pendingAction = null;
        sess.searchMode = false;
        sess.searchFilter = null;
        await ctx.editMessageText("📋 <b>Main Menu</b>", {
            parse_mode: "HTML",
            reply_markup: KB.main(ctx.from.id).reply_markup
        });
    });

    // ========== INFO ==========
    bot.action("ABOUT", async (ctx) => {
        await ctx.answerCbQuery();
        await safeEdit(ctx, `
<b>ℹ️ Cloud Bot v${version}</b>

<b>Features:</b>
• 🔍 Inline search anywhere
• 📁 Folder organization  
• 🔗 Share with @username
• ⏰ Auto-expiry (24h–90d)
• 🔐 Private file mode
• 📊 Usage statistics

<b>Security:</b>
• Files on Telegram CDN
• Access control per user
• Optional auto-delete
        `.trim(), KB.main(ctx.from.id));
    });

    bot.action("HELP", async (ctx) => {
        await ctx.answerCbQuery();
        const me = ctx.me || (await bot.telegram.getMe()).username;
        await ctx.replyWithHTML(`
<b>🆘 Quick Help</b>

<b>❓ FAQ:</b>
<b>Q:</b> How to save files?
<b>A:</b> Send any file — auto-saved!

<b>Q:</b> How to find files?
<b>A:</b> Use 🔍 or @${me} anywhere

<b>Q:</b> Can I share?
<b>A:</b> Yes! File → Share → @username

<b>Q:</b> Are files private?
<b>A:</b> Yes by default. Toggle 🔒 for extra.

<b>Q:</b> Size limits?
<b>A:</b> 50MB docs/video/audio, 10MB photos

<b>💡 Tips:</b>
• Descriptive names = better search
• Use folders for projects
• Set expiry for temp files
        `.trim(), KB.main(ctx.from.id));
    });

    // ========== ADMIN PANEL ==========
    bot.command("admin", async (ctx) => {
        if (!isAdmin(ctx.from?.id)) return;
        await ctx.replyWithHTML("<b>👑 Admin Panel</b>", KB.admin());
    });

    bot.action("ADM:STATS", async (ctx) => {
        if (!isAdmin(ctx.from?.id)) return ctx.answerCbQuery("⛔ Access denied", { show_alert: true });
        await ctx.answerCbQuery();

        try {
            const [users, active, files, sizeAgg] = await Promise.all([
                UserModel.estimatedDocumentCount(),
                UserModel.countDocuments({ lastActiveAt: { $gte: new Date(Date.now() - 86400000) } }),
                FileModel.estimatedDocumentCount(),
                FileModel.aggregate([{ $group: { _id: null, total: { $sum: "$fileSize" } } }])
            ]);

            const text = `
<b>📊 Admin Stats</b>

<b>👥 Users:</b> ${users} total • ${active} active today
<b>📁 Files:</b> ${files} • ${formatFileSize(sizeAgg[0]?.total || 0)}
<b>📈 Avg:</b> ${users ? (files / users).toFixed(1) : 0} files/user
<b>💾 Cache:</b> ${cache.size} entries
<b>🔄 Rate limit entries:</b> ${rateLimitMap.size}
            `.trim();

            await safeEdit(ctx, text, KB.admin());
        } catch (e) {
            await ctx.answerCbQuery("DB error: " + e.message, { show_alert: true });
        }
    });

    bot.action("ADM:CLEANUP", async (ctx) => {
        if (!isAdmin(ctx.from?.id)) return ctx.answerCbQuery("⛔ Access denied", { show_alert: true });
        await ctx.answerCbQuery("🧹 Cleaning...");

        try {
            const [expired, cacheCleared] = await Promise.all([
                FileModel.deleteMany({ expiresAt: { $lt: new Date() }, isDeleted: { $ne: true } }),
                Promise.resolve().then(() => {
                    const now = Date.now();
                    let cleared = 0;
                    for (const [k, v] of cache) {
                        if (now > v.expires) { cache.delete(k); cleared++; }
                    }
                    return cleared;
                })
            ]);

            await safeEdit(ctx, `
<b>🧹 Cleanup Done</b>

• Expired files deleted: ${expired.deletedCount}
• Cache entries cleared: ${cacheCleared}
            `.trim(), KB.admin());
        } catch (e) {
            await ctx.reply("❌ Cleanup error: " + e.message);
        }
    });

    bot.action("ADM:BROADCAST", async (ctx) => {
        if (!isAdmin(ctx.from?.id)) return ctx.answerCbQuery("⛔ Access denied", { show_alert: true });
        await ctx.answerCbQuery();
        ensureSession(ctx).broadcast = true;
        await ctx.editMessageText(
            "📢 <b>Broadcast</b>\n\nSend your message (HTML supported).\nType /cancel to abort.",
            {
                parse_mode: "HTML",
                reply_markup: Markup.inlineKeyboard([[Markup.button.callback("❌ Cancel", "ADM:CANCEL_BROADCAST")]]).reply_markup
            }
        );
    });

    bot.action("ADM:CANCEL_BROADCAST", async (ctx) => {
        if (!isAdmin(ctx.from?.id)) return ctx.answerCbQuery("⛔ Access denied", { show_alert: true });
        await ctx.answerCbQuery("Cancelled");
        ensureSession(ctx).broadcast = false;
        await ctx.editMessageText("<b>👑 Admin Panel</b>", { parse_mode: "HTML", reply_markup: KB.admin().reply_markup });
    });

    bot.action("ADM:USERS", async (ctx) => {
        if (!isAdmin(ctx.from?.id)) return ctx.answerCbQuery("⛔ Access denied", { show_alert: true });
        await ctx.answerCbQuery();

        try {
            const [total, active7d, blocked, topUsers] = await Promise.all([
                UserModel.countDocuments(),
                UserModel.countDocuments({ lastActiveAt: { $gte: new Date(Date.now() - 7 * 86400000) } }),
                UserModel.countDocuments({ isBlocked: true }),
                UserModel.find({}, { firstName: 1, username: 1, fileCount: 1, storageUsed: 1 })
                    .sort({ fileCount: -1 }).limit(5).lean()
            ]);

            const topList = topUsers.map(u =>
                `• ${u.username ? `@${u.username}` : escapeHtml(u.firstName || "Unknown")} — ${u.fileCount} files • ${formatFileSize(u.storageUsed)}`
            ).join('\n') || "No users";

            await safeEdit(ctx, `
<b>👥 User Stats</b>

<b>Total:</b> ${total}
<b>Active (7d):</b> ${active7d}
<b>Blocked:</b> ${blocked}

<b>Top by files:</b>
${topList}
            `.trim(), KB.admin());
        } catch (e) {
            await ctx.reply("❌ Error: " + e.message);
        }
    });

    bot.action("ADM:CACHE", async (ctx) => {
        if (!isAdmin(ctx.from?.id)) return ctx.answerCbQuery("⛔ Access denied", { show_alert: true });
        const before = cache.size;
        memoryCache.clear();
        rateLimitMap.clear();
        await ctx.answerCbQuery(`✅ Cleared ${before} cache entries + rate limits`, { show_alert: true });
        await safeEdit(ctx, "<b>👑 Admin Panel</b>\n\n✅ All cache cleared.", KB.admin());
    });

    // ========== TEXT HANDLER ==========
    bot.on("text", async (ctx) => {
        const sess = ensureSession(ctx);
        const uid = String(ctx.from.id);
        const txt = ctx.message.text.trim();

        // --- ADMIN BROADCAST ---
        if (isAdmin(ctx.from?.id) && sess.broadcast) {
            sess.broadcast = false;
            if (txt === "/cancel") {
                return ctx.replyWithHTML("✅ Broadcast cancelled.", KB.admin());
            }

            const loading = await ctx.reply("📤 Sending broadcast...");
            let sent = 0, failed = 0, blocked = 0, page = 0;
            const limit = 100;

            while (true) {
                const users = await UserModel.find(
                    { isBlocked: { $ne: true } },
                    { tgUserId: 1 }
                ).skip(page * limit).limit(limit).lean();
                if (!users.length) break;

                for (const u of users) {
                    try {
                        await ctx.telegram.sendMessage(u.tgUserId, txt, { parse_mode: "HTML" });
                        sent++;
                    } catch (e) {
                        if (e?.code === 403) {
                            UserModel.updateOne({ tgUserId: u.tgUserId }, { $set: { isBlocked: true } }).catch(() => { });
                            blocked++;
                        } else {
                            failed++;
                        }
                    }
                    await sleep(40);
                }
                page++;

                if (page % 5 === 0) {
                    ctx.telegram.editMessageText(
                        ctx.chat.id, loading.message_id, undefined,
                        `📤 Progress: ${sent}✅ ${failed}❌ ${blocked}🚫`,
                        { parse_mode: "HTML" }
                    ).catch(() => { });
                }
            }

            return ctx.telegram.editMessageText(
                ctx.chat.id, loading.message_id, undefined,
                `<b>✅ Broadcast Done</b>\n\nSent: ${sent}\nFailed: ${failed}\nBlocked: ${blocked}`,
                { parse_mode: "HTML" }
            ).catch(() => { });
        }

        // --- SEARCH MODE ---
        if (sess.searchMode && txt && !txt.startsWith('/')) {
            sess.searchMode = false;
            const filter = sess.searchFilter;
            sess.searchFilter = null;

            await ctx.reply(`🔍 Searching: <code>${escapeHtml(txt)}</code>${filter ? ` [${filter}]` : ""}`, { parse_mode: "HTML" });
            const files = await searchFiles(uid, txt, { kind: filter || undefined, limit: 10 });

            if (!files.length) return ctx.reply("🔍 No results found. Try different keywords.");

            const res = files.map(f =>
                `📄 <code>${escapeHtml(f.fileName)}</code>\n${f.kind.toUpperCase()} • ${formatFileSize(f.fileSize)} • ${formatTime(f.createdAt)}`
            ).join('\n\n');
            return ctx.replyWithHTML(`<b>📋 Results (${files.length}):</b>\n\n${res}`, KB.main(uid));
        }

        // --- PENDING ACTIONS ---
        if (sess.pendingAction) {
            const { type, fileId } = sess.pendingAction;
            sess.pendingAction = null;

            if (type === "rename" && fileId) {
                const res = await updateFile(uid, fileId, { fileName: txt.slice(0, 200) });
                return ctx.replyWithHTML(
                    res ? `✅ Renamed to: <code>${escapeHtml(txt)}</code>` : "❌ Rename failed. File not found.",
                    KB.main(uid)
                );
            }

            if (type === "folder_create") {
                if (!txt || txt.length < 1) return ctx.reply("❌ Folder name cannot be empty.");
                const f = await createFolder(uid, txt);
                return ctx.replyWithHTML(
                    f ? `✅ Folder created: <code>${escapeHtml(f.name)}</code>` : "❌ Failed to create folder.",
                    KB.folders()
                );
            }

            if (type === "share" && fileId) {
                const username = txt.replace('@', '').toLowerCase().trim();
                if (!username) return ctx.reply("❌ Invalid username. Use @username format.");
                const target = await UserModel.findOne({ username }).lean();
                if (!target) return ctx.reply("❌ User not found. They must have started the bot first.");
                if (target.tgUserId === uid) return ctx.reply("❌ You cannot share a file with yourself.");

                const sharedFile = await FileModel.findOneAndUpdate(
                    { _id: fileId, ownerTgUserId: uid },
                    { $addToSet: { sharedWith: target.tgUserId } },
                    { new: true }
                );
                if (!sharedFile) return ctx.reply("❌ File not found or access denied.");
                invalidateUser(uid);

                const senderName = escapeHtml(ctx.from.first_name || ctx.from.username || "Someone");
                const caption = `📤 <b>${senderName}</b> shared a file with you:\n\n<code>${escapeHtml(sharedFile.fileName)}</code>\n📦 ${formatFileSize(sharedFile.fileSize)} • ${sharedFile.kind.toUpperCase()}`;
                try {
                    if (sharedFile.kind === 'photo') {
                        await ctx.telegram.sendPhoto(target.tgUserId, sharedFile.tgFileId, { caption, parse_mode: "HTML" });
                    } else {
                        await ctx.telegram.sendDocument(target.tgUserId, sharedFile.tgFileId, { caption, parse_mode: "HTML" });
                    }
                    return ctx.replyWithHTML(`✅ File shared with @${escapeHtml(target.username)} and delivered! 📬`, KB.main(uid));
                } catch (e) {
                    console.error("Share delivery error:", e.message);
                    return ctx.replyWithHTML(
                        `✅ Shared with @${escapeHtml(target.username)}\n⚠️ Could not deliver — they may not have started the bot.`,
                        KB.main(uid)
                    );
                }
            }
        }

        // --- DEFAULT ---
        await ctx.reply("👆 Use the buttons below:", { reply_markup: KB.main(uid).reply_markup });
    });

    // ========== FILE HANDLER ==========
    bot.on(["document", "photo", "video", "audio", "voice"], async (ctx) => {
        await withLoading(ctx, async () => {
            const uid = await upsertUser(ctx);
            const m = ctx.message;

            let kind, obj;
            if (m.document) { kind = "document"; obj = m.document; }
            else if (m.video) { kind = "video"; obj = m.video; }
            else if (m.audio) { kind = "audio"; obj = m.audio; }
            else if (m.voice) { kind = "voice"; obj = m.voice; }
            else if (m.photo?.length) { kind = "photo"; obj = m.photo[m.photo.length - 1]; }

            if (!obj) throw new Error("Unknown file type");

            const max = CONFIG.FILE_LIMITS[kind] || 52428800;
            if ((obj.file_size || 0) > max) throw new Error(`File too large. Max allowed: ${formatFileSize(max)}`);

            const name = obj.file_name
                || `${kind}_${Date.now()}.${kind === 'photo' ? 'jpg' : kind === 'video' ? 'mp4' : kind === 'audio' ? 'mp3' : 'bin'}`;

            const user = await UserModel.findOne({ tgUserId: uid }).lean();
            const isPriv = user?.settings?.privateByDefault || false;
            const autoExp = user?.settings?.autoExpire;

            const existing = await FileModel.findOne({ tgFileId: obj.file_id }).lean();
            if (existing && existing.ownerTgUserId === uid) {
                return ctx.replyWithHTML(
                    `⚠️ <b>Already saved!</b>\n\n<code>${escapeHtml(existing.fileName)}</code>`,
                    KB.files(existing._id.toString())
                );
            }

            const file = await FileModel.create({
                ownerTgUserId: uid, kind,
                tgFileId: obj.file_id,
                tgUniqueId: obj.file_unique_id || "",
                fileName: name.slice(0, 200),
                mimeType: obj.mime_type || "",
                fileSize: obj.file_size || 0,
                note: (m.caption || "").slice(0, 500),
                isPrivate: isPriv,
                expiresAt: autoExp && EXPIRY[autoExp] ? new Date(Date.now() + EXPIRY[autoExp]) : null,
                folderId: ensureSession(ctx).currentFolder || null
            });

            await UserModel.updateOne(
                { tgUserId: uid },
                { $inc: { storageUsed: obj.file_size || 0, fileCount: 1 } }
            );
            invalidateUser(uid);

            await ctx.replyWithHTML(`
✅ <b>File Saved!</b>

📄 <code>${escapeHtml(name)}</code>
📦 ${formatFileSize(obj.file_size || 0)} • <b>${kind.toUpperCase()}</b>
🔐 ${isPriv ? 'Private 🔒' : 'Public'}${file.expiresAt ? `\n⏰ Expires: ${new Date(file.expiresAt).toLocaleString()}` : ''}

👇 Actions:
            `.trim(), KB.files(file._id.toString()));
        }, "💾 Uploading...");
    });

    // Catch-all callback
    bot.on("callback_query", async (ctx) => {
        await ctx.answerCbQuery("⚠️ Unknown action").catch(() => { });
    });

    // ========== LAUNCH ==========
    await bot.launch();
    console.log(`✅ Bot v${version} online | @${bot.botInfo?.username} | Ready`);

    // Log inline mode status for debugging
    try {
        const botInfo = await bot.telegram.getMe();
        console.log(`🔍 Inline mode: ${botInfo.can_join_groups ? 'Enabled' : 'Check BotFather'}`);
    } catch (e) {
        console.warn("⚠️ Could not fetch bot info:", e.message);
    }

    const shutdown = (sig) => async () => {
        console.log(`\n${sig} received — shutting down gracefully...`);
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