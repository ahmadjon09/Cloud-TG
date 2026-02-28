// bot.js - Optimized Telegram Bot (No Redis, In-Memory Cache)
import { Telegraf, Markup, session } from "telegraf";
import { UserModel } from "./models/User.js";
import { FileModel } from "./models/File.js";
import { version } from "../i.js";
import crypto from "crypto";

// ==================== IN-MEMORY CACHE ====================

const cache = new Map();

const CACHE_TTL = {
    USER: 300_000,        // 5 minutes
    LEADERBOARD: 60_000,  // 1 minute
    STATS: 120_000,       // 2 minutes
    RANK: 60_000,         // 1 minute
    ADMIN: 60_000         // 1 minute
};

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
    del(key) {
        cache.delete(key);
    },
    delPattern(pattern) {
        // Escape regex special chars, then turn * into .*
        const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*");
        const regex = new RegExp(`^${escaped}$`);
        for (const key of cache.keys()) {
            if (regex.test(key)) cache.delete(key);
        }
    },
    clear() {
        cache.clear();
    }
};

// ==================== UTILITY FUNCTIONS ====================

function escapeHtml(text) {
    if (!text) return "";
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let size = bytes;
    let i = 0;
    while (size >= 1024 && i < units.length - 1) {
        size /= 1024;
        i++;
    }
    return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatError(error) {
    const msg = error?.message || String(error) || "Unknown error";
    return `❌ <b>Error:</b>\n<code>${escapeHtml(msg.substring(0, 300))}</code>`;
}

function isAdmin(userId) {
    if (!userId) return false;
    const raw = process.env.ADMIN_IDS || "";
    const adminSet = new Set(raw.split(",").map(s => s.trim()).filter(Boolean));
    return adminSet.has(String(userId));
}

function webAppUrl() {
    return `${process.env.BASE_URL}/app`;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function invalidateUserCache(userId) {
    memoryCache.del(`user:${userId}`);
    memoryCache.del(`stats:${userId}`);
    memoryCache.del(`rank:${userId}`);
}

// ==================== MESSAGE HELPERS ====================

async function safeEditMessage(ctx, text, keyboard, parseMode = "HTML") {
    try {
        await ctx.editMessageText(text, {
            parse_mode: parseMode,
            reply_markup: keyboard?.reply_markup,
            disable_web_page_preview: true
        });
    } catch (err) {
        // Silently ignore "not modified"  everything else re-throw
        if (err?.code === 400 && err?.description?.includes("message is not modified")) return;
        // If original message was deleted, fall back to a new reply
        if (err?.code === 400 && err?.description?.includes("message to edit not found")) {
            await ctx.reply(text, { parse_mode: parseMode, reply_markup: keyboard?.reply_markup });
            return;
        }
        throw err;
    }
}

async function withLoading(ctx, fn) {
    try {
        return await fn();
    } catch (error) {
        console.error("Handler error:", error.message);
        try {
            await ctx.reply(formatError(error), { parse_mode: "HTML" });
        } catch { /* ignore send errors */ }
    }
}

// ==================== KEYBOARDS ====================

function mainMenu(showBack = false) {
    const buttons = [
        [Markup.button.webApp("📂 Open Cloud", webAppUrl())],
        [
            Markup.button.callback("📊 My Files", "MY_FILES"),
            Markup.button.callback("📈 Limits", "LIMITS")
        ],
        [
            Markup.button.callback("👥 Referrals", "REFERRALS"),
            Markup.button.callback("🏆 Leaderboard", "LEADERBOARD")
        ],
        [
            Markup.button.callback("ℹ️ About", "ABOUT"),
            Markup.button.callback("🆘 Help", "HELP")
        ]
    ];
    if (showBack) {
        buttons.push([Markup.button.callback("🔙 Back to Main", "MAIN_MENU")]);
    }
    return Markup.inlineKeyboard(buttons);
}

function referralMenu() {
    return Markup.inlineKeyboard([
        [Markup.button.callback("📊 My Stats", "REFERRAL_STATS")],
        [Markup.button.callback("🏆 Leaderboard", "LEADERBOARD")],
        [Markup.button.callback("🎁 Claim Rewards", "CLAIM_REWARDS")],
        [Markup.button.callback("🔙 Back", "MAIN_MENU")]
    ]);
}

function leaderboardMenu() {
    return Markup.inlineKeyboard([
        [Markup.button.callback("📅 Weekly", "WEEKLY_LEADERBOARD")],
        [Markup.button.callback("📆 Monthly", "MONTHLY_LEADERBOARD")],
        [Markup.button.callback("👤 My Rank", "MY_RANK")],
        [Markup.button.callback("🔙 Back", "MAIN_MENU")]
    ]);
}

function adminMenu() {
    return Markup.inlineKeyboard([
        [Markup.button.callback("📊 Stats", "ADMIN_STATS")],
        [Markup.button.callback("📢 Broadcast", "ADMIN_BROADCAST")],
        [Markup.button.callback("🎁 Give Rewards", "ADMIN_GIVE_REWARDS")],
        [Markup.button.callback("🔙 Back to Main", "MAIN_MENU")]
    ]);
}

// ==================== DATABASE INDEXES ====================

async function ensureIndexes() {
    try {
        await Promise.all([
            UserModel.collection.createIndex({ tgUserId: 1 }, { unique: true }),
            UserModel.collection.createIndex({ refCode: 1 }, { unique: true, sparse: true }),
            UserModel.collection.createIndex({ referredBy: 1 }),
            UserModel.collection.createIndex({ weekScore: -1 }),
            UserModel.collection.createIndex({ monthScore: -1 }),
            UserModel.collection.createIndex({ createdAt: -1 }),
            UserModel.collection.createIndex({ lastActiveAt: -1 }),
            UserModel.collection.createIndex({ isBlocked: 1 }),
            FileModel.collection.createIndex({ ownerTgUserId: 1, createdAt: -1 }),
            FileModel.collection.createIndex({ tgUniqueId: 1 }, { unique: true, sparse: true }),
            FileModel.collection.createIndex({ kind: 1 })
        ]);
        console.log("✅ Database indexes created");
    } catch (err) {
        console.error("Index creation error:", err.message);
    }
}

// ==================== REFERRAL FUNCTIONS ====================

export async function generateReferralCode(tgUserId, firstName = "") {
    const namePart = firstName && typeof firstName === "string"
        ? firstName.slice(0, 3).toUpperCase().replace(/[^A-Z]/g, "X")
        : "USR";

    // Generate 5 candidates at once to minimise DB round-trips
    const candidates = Array.from({ length: 5 }, () =>
        `${namePart}${crypto.randomBytes(4).toString("hex").toUpperCase().slice(0, 6)}`.slice(0, 10)
    );

    const existing = await UserModel.find(
        { refCode: { $in: candidates } },
        { refCode: 1 }
    ).lean();

    const existingSet = new Set(existing.map(e => e.refCode));

    for (const candidate of candidates) {
        if (!existingSet.has(candidate)) return candidate;
    }

    // Fallback: timestamp guarantees uniqueness
    return `REF${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(2).toString("hex").toUpperCase()}`.slice(0, 14);
}

async function processReferral(newUserId, referralCode) {
    if (!referralCode) return null;
    try {
        const referrer = await UserModel.findOne(
            { refCode: referralCode },
            { tgUserId: 1 }
        ).lean();

        if (!referrer || referrer.tgUserId === newUserId) return null;

        await Promise.all([
            UserModel.updateOne({ tgUserId: newUserId }, { $set: { referredBy: referrer.tgUserId } }),
            UserModel.updateOne({ tgUserId: referrer.tgUserId }, { $inc: { refCount: 1 } })
        ]);

        invalidateUserCache(newUserId);
        invalidateUserCache(referrer.tgUserId);

        return referrer;
    } catch (err) {
        console.error("processReferral error:", err.message);
        return null;
    }
}

// ==================== LEADERBOARD FUNCTIONS ====================

// Shared aggregation pipeline builder (avoids code duplication)
function buildLeaderboardAggregate(dateFilter, scoreField, filesAlias, refsAlias) {
    return [
        {
            $lookup: {
                from: "files",
                let: { uid: "$tgUserId" },
                pipeline: [
                    {
                        $match: {
                            $expr: {
                                $and: [
                                    { $eq: ["$ownerTgUserId", "$$uid"] },
                                    { $gte: ["$createdAt", dateFilter] }
                                ]
                            }
                        }
                    },
                    { $count: "count" }
                ],
                as: "_files"
            }
        },
        {
            $lookup: {
                from: "users",
                let: { uid: "$tgUserId" },
                pipeline: [
                    {
                        $match: {
                            $expr: {
                                $and: [
                                    { $eq: ["$referredBy", "$$uid"] },
                                    { $gte: ["$createdAt", dateFilter] }
                                ]
                            }
                        }
                    },
                    { $count: "count" }
                ],
                as: "_refs"
            }
        },
        {
            $addFields: {
                [filesAlias]: { $ifNull: [{ $arrayElemAt: ["$_files.count", 0] }, 0] },
                [refsAlias]: { $ifNull: [{ $arrayElemAt: ["$_refs.count", 0] }, 0] }
            }
        },
        {
            $addFields: {
                [scoreField]: {
                    $add: [
                        { $multiply: [`$${filesAlias}`, 10] },
                        { $multiply: [`$${refsAlias}`, 50] }
                    ]
                }
            }
        },
        { $match: { [scoreField]: { $gt: 0 } } },
        { $sort: { [scoreField]: -1, [filesAlias]: -1 } }
    ];
}

async function calculateWeeklyLeaderboard(limit = 10) {
    const cacheKey = `leaderboard:weekly:${limit}`;
    const cached = memoryCache.get(cacheKey);
    if (cached) return cached;

    try {
        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        const leaderboard = await UserModel.aggregate([
            ...buildLeaderboardAggregate(weekAgo, "weekScore", "weeklyFiles", "weeklyReferrals"),
            { $limit: limit },
            {
                $project: {
                    tgUserId: 1, firstName: 1, lastName: 1, username: 1,
                    weekScore: 1, weeklyFiles: 1, weeklyReferrals: 1
                }
            }
        ]);

        if (leaderboard.length > 0) {
            UserModel.bulkWrite(
                leaderboard.map(u => ({
                    updateOne: {
                        filter: { tgUserId: u.tgUserId },
                        update: { $set: { weekScore: u.weekScore } }
                    }
                })),
                { ordered: false }
            ).catch(() => { });
        }

        memoryCache.set(cacheKey, leaderboard, CACHE_TTL.LEADERBOARD);
        return leaderboard;
    } catch (err) {
        console.error("calculateWeeklyLeaderboard error:", err.message);
        return [];
    }
}

async function calculateMonthlyLeaderboard(limit = 10) {
    const cacheKey = `leaderboard:monthly:${limit}`;
    const cached = memoryCache.get(cacheKey);
    if (cached) return cached;

    try {
        const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

        const leaderboard = await UserModel.aggregate([
            ...buildLeaderboardAggregate(monthAgo, "monthScore", "monthlyFiles", "monthlyReferrals"),
            { $limit: limit },
            {
                $project: {
                    tgUserId: 1, firstName: 1, lastName: 1, username: 1,
                    monthScore: 1, monthlyFiles: 1, monthlyReferrals: 1
                }
            }
        ]);

        if (leaderboard.length > 0) {
            UserModel.bulkWrite(
                leaderboard.map(u => ({
                    updateOne: {
                        filter: { tgUserId: u.tgUserId },
                        update: { $set: { monthScore: u.monthScore } }
                    }
                })),
                { ordered: false }
            ).catch(() => { });
        }

        memoryCache.set(cacheKey, leaderboard, CACHE_TTL.LEADERBOARD);
        return leaderboard;
    } catch (err) {
        console.error("calculateMonthlyLeaderboard error:", err.message);
        return [];
    }
}

async function getUserRank(tgUserId) {
    const cacheKey = `rank:${tgUserId}`;
    const cached = memoryCache.get(cacheKey);
    if (cached) return cached;

    try {
        const user = await UserModel.findOne({ tgUserId }, { weekScore: 1, monthScore: 1 }).lean();
        if (!user) return null;

        const [weeklyRank, monthlyRank, totalUsers] = await Promise.all([
            UserModel.countDocuments({ weekScore: { $gt: user.weekScore || 0 } }),
            UserModel.countDocuments({ monthScore: { $gt: user.monthScore || 0 } }),
            UserModel.estimatedDocumentCount()
        ]);

        const result = {
            weekly: weeklyRank + 1,
            monthly: monthlyRank + 1,
            totalUsers
        };

        memoryCache.set(cacheKey, result, CACHE_TTL.RANK);
        return result;
    } catch (err) {
        console.error("getUserRank error:", err.message);
        return null;
    }
}

async function getUserStats(tgUserId) {
    const cacheKey = `stats:${tgUserId}`;
    const cached = memoryCache.get(cacheKey);
    if (cached) return cached;

    try {
        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

        const [user, fileStats, referralStats] = await Promise.all([
            UserModel.findOne({ tgUserId }).lean(),
            FileModel.aggregate([
                { $match: { ownerTgUserId: tgUserId } },
                {
                    $facet: {
                        total: [{ $count: "count" }],
                        weekly: [{ $match: { createdAt: { $gte: weekAgo } } }, { $count: "count" }],
                        monthly: [{ $match: { createdAt: { $gte: monthAgo } } }, { $count: "count" }]
                    }
                }
            ]),
            UserModel.aggregate([
                { $match: { referredBy: tgUserId } },
                {
                    $facet: {
                        weekly: [{ $match: { createdAt: { $gte: weekAgo } } }, { $count: "count" }],
                        monthly: [{ $match: { createdAt: { $gte: monthAgo } } }, { $count: "count" }]
                    }
                }
            ])
        ]);

        if (!user) return null;

        const fd = fileStats[0] || {};
        const rd = referralStats[0] || {};

        const totalFiles = fd.total?.[0]?.count || 0;
        const weeklyFiles = fd.weekly?.[0]?.count || 0;
        const monthlyFiles = fd.monthly?.[0]?.count || 0;
        const weeklyReferrals = rd.weekly?.[0]?.count || 0;
        const monthlyReferrals = rd.monthly?.[0]?.count || 0;

        const weekScore = weeklyFiles * 10 + weeklyReferrals * 50;
        const monthScore = monthlyFiles * 10 + monthlyReferrals * 50;

        // Persist scores in background  don't block the response
        UserModel.updateOne({ tgUserId }, { $set: { weekScore, monthScore } }).catch(() => { });

        const result = {
            user,
            weeklyFiles, monthlyFiles,
            weeklyReferrals, monthlyReferrals,
            totalFiles,
            totalReferrals: user.refCount || 0,
            weekScore, monthScore,
            diamonds: user.diamonds || 0
        };

        memoryCache.set(cacheKey, result, CACHE_TTL.STATS);
        return result;
    } catch (err) {
        console.error("getUserStats error:", err.message);
        return null;
    }
}

// ==================== WEEKLY REWARDS ====================

const REWARD_TABLE = [
    { diamonds: 1000, title: "🥇 1st place", badge: "🏆" },
    { diamonds: 500, title: "🥈 2nd place", badge: "⭐️" },
    { diamonds: 250, title: "🥉 3rd place", badge: "🌟" },
    { diamonds: 100, title: "Top 5", badge: "💫" },
    { diamonds: 100, title: "Top 5", badge: "💫" },
    { diamonds: 50, title: "Top 10", badge: "✨" },
    { diamonds: 50, title: "Top 10", badge: "✨" },
    { diamonds: 50, title: "Top 10", badge: "✨" },
    { diamonds: 50, title: "Top 10", badge: "✨" },
    { diamonds: 50, title: "Top 10", badge: "✨" }
];

async function calculateWeeklyRewards() {
    const leaderboard = await calculateWeeklyLeaderboard(10);
    const results = [];
    const bulkOps = [];

    for (let i = 0; i < leaderboard.length; i++) {
        const user = leaderboard[i];
        const reward = REWARD_TABLE[i];
        if (!reward || !user?.tgUserId) continue;

        bulkOps.push({
            updateOne: {
                filter: { tgUserId: user.tgUserId },
                update: {
                    $inc: { diamonds: reward.diamonds },
                    $set: { refAwardedAt: new Date() }
                }
            }
        });
        results.push({ user, reward });
    }

    if (bulkOps.length > 0) {
        await UserModel.bulkWrite(bulkOps, { ordered: false });
        for (const { user } of results) invalidateUserCache(user.tgUserId);
        memoryCache.delPattern("leaderboard:*");
    }

    return results;
}

// ==================== USER UPSERT ====================

async function upsertUser(ctx, referralCode = null) {
    const u = ctx.from || {};
    const tgUserId = String(u.id);
    const cacheKey = `user:${tgUserId}`;

    const updateFields = {
        firstName: u.first_name || "",
        lastName: u.last_name || "",
        username: u.username || "",
        languageCode: u.language_code || "en",
        lastActiveAt: new Date()
    };

    // If cached → update DB in background and return immediately
    if (memoryCache.get(cacheKey)) {
        UserModel.updateOne({ tgUserId }, { $set: updateFields }).catch(() => { });
        return tgUserId;
    }

    let user = await UserModel.findOne({ tgUserId }).lean();

    if (!user) {
        const refCode = await generateReferralCode(tgUserId, u.first_name);

        user = await UserModel.create({
            tgUserId,
            ...updateFields,
            startedAt: new Date(),
            diamonds: 0,
            refCode,
            refCount: 0,
            weekScore: 0,
            monthScore: 0,
            referredBy: null,
            refAwardedAt: null
        });

        // Process referral in background  don't delay the welcome message
        if (referralCode) {
            processReferral(tgUserId, referralCode).catch(() => { });
        }
    } else {
        await UserModel.updateOne({ tgUserId }, { $set: updateFields });
    }

    const fresh = await UserModel.findOne({ tgUserId }).lean();
    memoryCache.set(cacheKey, fresh, CACHE_TTL.USER);

    return tgUserId;
}

// ==================== LEADERBOARD FORMATTER ====================

function formatLeaderboard(leaderboard, type = "weekly") {
    if (!leaderboard?.length) return "No data yet. Be the first!";

    return leaderboard.map((user, i) => {
        const rank = i + 1;
        const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `${rank}.`;
        const name = escapeHtml(user.firstName || user.username || "Anonymous");
        const score = type === "weekly" ? user.weekScore : user.monthScore;
        const files = type === "weekly" ? user.weeklyFiles : user.monthlyFiles;
        const refs = type === "weekly" ? user.weeklyReferrals : user.monthlyReferrals;
        return `${medal} <b>${name}</b>\n   📁 ${files} files | 👥 ${refs} refs | ⚡️ ${score} pts`;
    }).join("\n\n");
}

// ==================== BOT STARTUP ====================

export async function startBot() {
    if (!process.env.BOT_TOKEN) throw new Error("BOT_TOKEN env variable is missing!");
    if (!process.env.BASE_URL) throw new Error("BASE_URL env variable is missing!");

    const bot = new Telegraf(process.env.BOT_TOKEN);

    await ensureIndexes();

    bot.use(session());

    // Global error handler  prevents unhandled rejections from crashing the process
    bot.catch((err, ctx) => {
        console.error(`[${ctx?.updateType}] Global error:`, err.message);
        ctx?.reply?.(formatError(err), { parse_mode: "HTML" }).catch(() => { });
    });

    // ======================================================
    // /start
    // ======================================================

    bot.start(async (ctx) => {
        try {
            const rawText = ctx.message?.text || "";
            const startParam = (ctx.startPayload ?? rawText.split(" ")[1] ?? "").trim();

            const userId = await upsertUser(ctx, startParam || null);

            let user = await UserModel.findOne({ tgUserId: userId }).lean();
            if (!user) throw new Error("User not found after upsert");

            // Edge case: very old records that were created before refCode was added
            if (!user.refCode) {
                const newCode = await generateReferralCode(userId, user.firstName || ctx.from?.first_name || "");
                await UserModel.updateOne({ tgUserId: userId }, { $set: { refCode: newCode } });
                user = { ...user, refCode: newCode };
            }

            const botUsername = ctx.botInfo?.username;
            const referralLink = `https://t.me/${botUsername}?start=${user.refCode}`;

            let welcomeText = `
<b>👋 Welcome to Cloud Bot!</b>

I can help you store and manage your files securely in the cloud.

<b>📱 Features:</b>
• Send any file  it gets saved instantly
• Manage files via the Web App
• Edit file names and notes
• Download your files anytime, anywhere
`.trim();

            if (startParam) {
                const referrer = await UserModel.findOne(
                    { refCode: startParam },
                    { username: 1, firstName: 1 }
                ).lean();

                if (referrer) {
                    const inviter = referrer.username
                        ? `@${escapeHtml(referrer.username)}`
                        : escapeHtml(referrer.firstName || "a user");
                    welcomeText += `\n\n🎉 <b>You were invited by ${inviter}!</b>\nYou both earn bonus points!`;
                }
            }

            welcomeText += `\n\n<b>🔗 Your referral link:</b>\n<code>${referralLink}</code>`;

            await ctx.replyWithHTML(welcomeText, mainMenu());
        } catch (err) {
            console.error("/start error:", err.message);
            await ctx.reply(formatError(err), { parse_mode: "HTML" });
        }
    });

    // ======================================================
    // Text menu command
    // ======================================================

    bot.hears(/^(menu|home|main)$/i, async (ctx) => {
        try {
            await upsertUser(ctx);
            await ctx.replyWithHTML(`<b>📋 Main Menu</b>\n\nChoose an option:`, mainMenu());
        } catch (err) {
            console.error("menu command error:", err.message);
            await ctx.reply(formatError(err), { parse_mode: "HTML" });
        }
    });

    // ======================================================
    // REFERRALS
    // ======================================================

    bot.action("REFERRALS", async (ctx) => {
        await ctx.answerCbQuery();
        await withLoading(ctx, async () => {
            const userId = String(ctx.from.id);

            const [user, stats, rank] = await Promise.all([
                UserModel.findOne({ tgUserId: userId }, { refCode: 1 }).lean(),
                getUserStats(userId),
                getUserRank(userId)
            ]);

            if (!user?.refCode || !stats || !rank) throw new Error("User data not found");

            const botUsername = ctx.botInfo?.username;
            const referralLink = `https://t.me/${botUsername}?start=${user.refCode}`;

            const text = `
<b>👥 Referral Program</b>

<b>🔗 Your referral link:</b>
<code>${referralLink}</code>

<b>📊 Your Stats:</b>
• Total referrals: <b>${stats.totalReferrals}</b>
• This week: <b>${stats.weeklyReferrals}</b>
• This month: <b>${stats.monthlyReferrals}</b>

<b>💎 Your Diamonds:</b> <b>${stats.diamonds}</b> 💎

<b>🏆 Your Rank:</b>
• Weekly: #${rank.weekly} of ${rank.totalUsers}
• Monthly: #${rank.monthly} of ${rank.totalUsers}

<b>🎁 Weekly Rewards:</b>
• 🥇 1st  1000 💎 | 🥈 2nd  500 💎 | 🥉 3rd  250 💎
• Top 5  100 💎 | Top 10  50 💎

<b>📢 Share your link and start earning!</b>
      `.trim();

            await safeEditMessage(ctx, text, referralMenu());
        });
    });

    bot.action("REFERRAL_STATS", async (ctx) => {
        await ctx.answerCbQuery();
        await withLoading(ctx, async () => {
            const userId = String(ctx.from.id);
            const stats = await getUserStats(userId);
            if (!stats) throw new Error("User stats not found");

            const text = `
<b>📊 Detailed Statistics</b>

<b>📁 Files:</b>
• Total: <b>${stats.totalFiles}</b>
• This week: <b>${stats.weeklyFiles}</b> (+${stats.weeklyFiles * 10} pts)
• This month: <b>${stats.monthlyFiles}</b> (+${stats.monthlyFiles * 10} pts)

<b>👥 Referrals:</b>
• Total: <b>${stats.totalReferrals}</b>
• This week: <b>${stats.weeklyReferrals}</b> (+${stats.weeklyReferrals * 50} pts)
• This month: <b>${stats.monthlyReferrals}</b> (+${stats.monthlyReferrals * 50} pts)

<b>⚡️ Score:</b>
• Weekly: <b>${stats.weekScore} pts</b>
• Monthly: <b>${stats.monthScore} pts</b>

<b>💎 Diamond Balance:</b> <b>${stats.diamonds}</b> 💎
      `.trim();

            await safeEditMessage(ctx, text, referralMenu());
        });
    });

    // ======================================================
    // LEADERBOARD
    // ======================================================

    bot.action("LEADERBOARD", async (ctx) => {
        await ctx.answerCbQuery();
        await safeEditMessage(ctx, `<b>🏆 Leaderboard</b>\n\nChoose a type:`, leaderboardMenu());
    });

    bot.action("WEEKLY_LEADERBOARD", async (ctx) => {
        await ctx.answerCbQuery();
        await withLoading(ctx, async () => {
            const leaderboard = await calculateWeeklyLeaderboard(10);
            const text = `
<b>📅 Weekly Leaderboard</b>

${formatLeaderboard(leaderboard, "weekly")}

<b>⚡️ Scoring:</b>
• File upload: +10 pts
• Referral: +50 pts

<i>⏰ Resets every Monday</i>
      `.trim();
            await safeEditMessage(ctx, text, leaderboardMenu());
        });
    });

    bot.action("MONTHLY_LEADERBOARD", async (ctx) => {
        await ctx.answerCbQuery();
        await withLoading(ctx, async () => {
            const leaderboard = await calculateMonthlyLeaderboard(10);
            const text = `
<b>📆 Monthly Leaderboard</b>

${formatLeaderboard(leaderboard, "monthly")}

<b>⚡️ Scoring:</b>
• File upload: +10 pts
• Referral: +50 pts

<i>⏰ Resets on the 1st of each month</i>
      `.trim();
            await safeEditMessage(ctx, text, leaderboardMenu());
        });
    });

    bot.action("MY_RANK", async (ctx) => {
        await ctx.answerCbQuery();
        await withLoading(ctx, async () => {
            const userId = String(ctx.from.id);
            const [rank, stats] = await Promise.all([getUserRank(userId), getUserStats(userId)]);
            if (!rank || !stats) throw new Error("User data not found");

            const text = `
<b>👤 Your Rankings</b>

<b>📅 Weekly:</b>
• Rank: <b>#${rank.weekly}</b> of ${rank.totalUsers}
• Score: <b>${stats.weekScore} pts</b>

<b>📆 Monthly:</b>
• Rank: <b>#${rank.monthly}</b> of ${rank.totalUsers}
• Score: <b>${stats.monthScore} pts</b>

<b>💎 Diamonds:</b> <b>${stats.diamonds}</b> 💎

<b>📊 How to climb:</b>
• Upload files (+10 pts each)
• Invite friends (+50 pts each)
      `.trim();

            await safeEditMessage(ctx, text, leaderboardMenu());
        });
    });

    // ======================================================
    // CLAIM REWARDS
    // ======================================================

    bot.action("CLAIM_REWARDS", async (ctx) => {
        await ctx.answerCbQuery();
        await withLoading(ctx, async () => {
            const userId = String(ctx.from.id);
            const user = await UserModel.findOne({ tgUserId: userId }).lean();
            if (!user) throw new Error("User not found");

            const now = Date.now();
            const weekMs = 7 * 24 * 60 * 60 * 1000;

            if (user.refAwardedAt && user.refAwardedAt.getTime() > now - weekMs) {
                const nextClaim = user.refAwardedAt.getTime() + weekMs;
                const daysLeft = Math.ceil((nextClaim - now) / (24 * 60 * 60 * 1000));
                throw new Error(`You already claimed rewards this week. Next claim in ${daysLeft} day(s).`);
            }

            const weekly = await calculateWeeklyLeaderboard(10);
            const idx = weekly.findIndex(u => u.tgUserId === userId);
            const rewardRow = idx >= 0 ? REWARD_TABLE[idx] : null;

            if (rewardRow) {
                await UserModel.updateOne(
                    { tgUserId: userId },
                    { $inc: { diamonds: rewardRow.diamonds }, $set: { refAwardedAt: new Date() } }
                );
                invalidateUserCache(userId);
                memoryCache.delPattern("leaderboard:*");

                await safeEditMessage(ctx, `
<b>🎁 Reward Claimed!</b>

${rewardRow.badge} ${rewardRow.title}  <b>+${rewardRow.diamonds} 💎</b>

<b>New balance:</b> ${(user.diamonds || 0) + rewardRow.diamonds} 💎

Keep it up to earn more next week!
        `.trim(), referralMenu());
            } else {
                await safeEditMessage(ctx, `
<b>⚠️ No Reward Available</b>

You are not in the Top 10 this week.

Upload more files and invite friends to climb the leaderboard!
        `.trim(), referralMenu());
            }
        });
    });

    // ======================================================
    // INFO PAGES
    // ======================================================

    bot.action("ABOUT", async (ctx) => {
        await ctx.answerCbQuery();
        await safeEditMessage(ctx, `
<b>ℹ️ About Cloud Bot</b>

<b>Version:</b> ${version}
<b>Platform:</b> Telegram Web App

<b>✨ Features:</b>
• Web interface for file management
• Edit file names &amp; notes
• Download files anytime
• Dark / Light theme support
• File type icons &amp; download progress

<b>🔒 Privacy:</b>
• Files stored on Telegram servers
• Only you can access your files
• No third-party access
    `.trim(), mainMenu(true));
    });

    bot.action("HELP", async (ctx) => {
        await ctx.answerCbQuery();
        await safeEditMessage(ctx, `
<b>🆘 Help &amp; Support</b>

<b>How do I save files?</b>
Just send any file to the bot  it's saved automatically.

<b>What are the size limits?</b>
• Documents / Video / Audio / Voice: 50 MB
• Photos: 10 MB

<b>How do I earn points?</b>
• Upload a file →  +10 pts
• Invite a friend →  +50 pts

<b>How do I invite friends?</b>
Go to <b>Referrals</b> and share your personal link.

<b>When are rewards given?</b>
Weekly (every Monday) and monthly (1st of each month).

<b>Are my files private?</b>
Yes  stored on Telegram servers, accessible only by you.
    `.trim(), mainMenu(true));
    });

    bot.action("MY_FILES", async (ctx) => {
        await ctx.answerCbQuery();
        await withLoading(ctx, async () => {
            const userId = await upsertUser(ctx);

            const [totalFiles, sizeResult, kindStats] = await Promise.all([
                FileModel.countDocuments({ ownerTgUserId: userId }),
                FileModel.aggregate([
                    { $match: { ownerTgUserId: userId } },
                    { $group: { _id: null, total: { $sum: "$fileSize" } } }
                ]),
                FileModel.aggregate([
                    { $match: { ownerTgUserId: userId } },
                    { $group: { _id: "$kind", count: { $sum: 1 } } },
                    { $sort: { count: -1 } }
                ])
            ]);

            const size = sizeResult[0]?.total || 0;
            const kindText = kindStats.length
                ? kindStats.map(s => `• ${s._id}: ${s.count}`).join("\n")
                : "• No files yet";

            await safeEditMessage(ctx, `
<b>📊 Your File Statistics</b>

<b>Total files:</b> <code>${totalFiles}</code>
<b>Total size:</b>  <code>${formatFileSize(size)}</code>

<b>📁 By type:</b>
${kindText}
      `.trim(), mainMenu(true));
        });
    });

    bot.action("LIMITS", async (ctx) => {
        await ctx.answerCbQuery();
        await safeEditMessage(ctx, `
<b>📈 File Size Limits</b>

📄 <b>Documents</b>  max <code>50 MB</code>
🖼 <b>Photos</b>  max <code>10 MB</code>
🎥 <b>Videos</b>  max <code>50 MB</code>
🎵 <b>Audio</b>  max <code>50 MB</code>
🎤 <b>Voice</b>  max <code>50 MB</code>

<b>⚠️ Tips:</b>
• Split large files before uploading
• Compress when possible
• Use the Web App for the best experience
    `.trim(), mainMenu(true));
    });

    bot.action("MAIN_MENU", async (ctx) => {
        await ctx.answerCbQuery();
        await safeEditMessage(ctx, `<b>📋 Main Menu</b>`, mainMenu());
    });

    // ======================================================
    // ADMIN PANEL
    // ======================================================

    bot.command("admin", async (ctx) => {
        if (!isAdmin(ctx.from?.id)) return;
        await ctx.replyWithHTML(
            `<b>👑 Admin Panel</b>\n\nWelcome! Choose an action:`,
            adminMenu()
        );
    });

    bot.action("ADMIN_STATS", async (ctx) => {
        if (!isAdmin(ctx.from?.id)) return ctx.answerCbQuery("Access denied", { show_alert: true });
        await ctx.answerCbQuery();
        await withLoading(ctx, async () => {
            const cacheKey = "admin:stats";
            const cached = memoryCache.get(cacheKey);
            if (cached) return safeEditMessage(ctx, cached, adminMenu());

            const [totalUsers, activeToday, totalFiles, sizeResult, refResult] = await Promise.all([
                UserModel.estimatedDocumentCount(),
                UserModel.countDocuments({ lastActiveAt: { $gte: new Date(Date.now() - 86_400_000) } }),
                FileModel.estimatedDocumentCount(),
                FileModel.aggregate([{ $group: { _id: null, total: { $sum: "$fileSize" } } }]),
                UserModel.aggregate([{ $group: { _id: null, total: { $sum: "$refCount" } } }])
            ]);

            const size = sizeResult[0]?.total || 0;
            const refs = refResult[0]?.total || 0;

            const text = `
<b>📊 Admin Statistics</b>

<b>👥 Users:</b>
• Total: <code>${totalUsers}</code>
• Active today: <code>${activeToday}</code>

<b>📁 Files:</b>
• Total: <code>${totalFiles}</code>
• Total size: <code>${formatFileSize(size)}</code>
• Avg per user: <code>${totalUsers ? (totalFiles / totalUsers).toFixed(1) : 0}</code>

<b>🤝 Referrals:</b>
• Total: <code>${refs}</code>
• Avg per user: <code>${totalUsers ? (refs / totalUsers).toFixed(1) : 0}</code>
      `.trim();

            memoryCache.set(cacheKey, text, CACHE_TTL.ADMIN);
            await safeEditMessage(ctx, text, adminMenu());
        });
    });

    bot.action("ADMIN_GIVE_REWARDS", async (ctx) => {
        if (!isAdmin(ctx.from?.id)) return ctx.answerCbQuery("Access denied", { show_alert: true });
        await ctx.answerCbQuery();
        await withLoading(ctx, async () => {
            const results = await calculateWeeklyRewards();
            if (results.length === 0) throw new Error("No eligible users to reward");

            let text = "<b>🎁 Weekly Rewards Distributed!</b>\n\n";
            for (const { user, reward } of results) {
                const name = escapeHtml(user.firstName || user.username || "User");
                text += `${reward.badge} <b>${name}</b>: +${reward.diamonds} 💎 (${reward.title})\n`;
            }

            await safeEditMessage(ctx, text, adminMenu());
        });
    });

    bot.action("ADMIN_BROADCAST", async (ctx) => {
        if (!isAdmin(ctx.from?.id)) return ctx.answerCbQuery("Access denied", { show_alert: true });
        await ctx.answerCbQuery();

        ctx.session = ctx.session || {};
        ctx.session.broadcast = true;

        await safeEditMessage(ctx, `
<b>📢 Broadcast Message</b>

Type the message you want to send to all users.
HTML formatting is supported.

Send /cancel to abort.
    `.trim(), Markup.inlineKeyboard([
            [Markup.button.callback("❌ Cancel", "CANCEL_BROADCAST")]
        ]));
    });

    bot.action("CANCEL_BROADCAST", async (ctx) => {
        if (!isAdmin(ctx.from?.id)) return;
        await ctx.answerCbQuery("Broadcast cancelled");
        ctx.session = ctx.session || {};
        ctx.session.broadcast = false;
        await safeEditMessage(ctx, `<b>📋 Main Menu</b>`, mainMenu());
    });

    // ======================================================
    // TEXT HANDLER
    // ======================================================

    bot.on("text", async (ctx) => {
        try {
            const userId = String(ctx.from?.id || "");
            const msgText = ctx.message?.text || "";

            // ── Admin broadcast flow ──────────────────────────────
            if (isAdmin(userId) && ctx.session?.broadcast) {
                ctx.session.broadcast = false;

                if (msgText === "/cancel") {
                    return ctx.replyWithHTML("✅ Broadcast cancelled.", mainMenu());
                }

                const loadingMsg = await ctx.replyWithHTML("📤 Starting broadcast…");
                const pageSize = 100;
                let page = 0, sent = 0, failed = 0, blocked = 0;

                while (true) {
                    const users = await UserModel.find(
                        { isBlocked: { $ne: true } },
                        { tgUserId: 1 }
                    ).skip(page * pageSize).limit(pageSize).lean();

                    if (users.length === 0) break;

                    for (const u of users) {
                        try {
                            await ctx.telegram.sendMessage(u.tgUserId, msgText, { parse_mode: "HTML" });
                            sent++;
                        } catch (err) {
                            if (err?.code === 403) {
                                // User blocked the bot  mark and skip
                                UserModel.updateOne({ tgUserId: u.tgUserId }, { $set: { isBlocked: true } }).catch(() => { });
                                blocked++;
                            } else {
                                failed++;
                            }
                        }
                        await sleep(50); // ~20 msg/s  within Telegram rate limits
                    }

                    page++;

                    // Update progress every 5 pages (~500 users)
                    if (page % 5 === 0) {
                        ctx.telegram.editMessageText(
                            ctx.chat.id, loadingMsg.message_id, undefined,
                            `📤 Sending… ✅ ${sent} | ❌ ${failed} | 🚫 ${blocked}`,
                            { parse_mode: "HTML" }
                        ).catch(() => { });
                    }
                }

                return ctx.telegram.editMessageText(
                    ctx.chat.id, loadingMsg.message_id, undefined,
                    `<b>📢 Broadcast Complete</b>\n\n✅ Sent: <code>${sent}</code>\n❌ Failed: <code>${failed}</code>\n🚫 Blocked: <code>${blocked}</code>`,
                    { parse_mode: "HTML" }
                ).catch(() => { });
            }

            // ── Regular users ─────────────────────────────────────
            await ctx.replyWithHTML("Please use the menu buttons below:", mainMenu());
        } catch (err) {
            console.error("text handler error:", err.message);
            await ctx.reply(formatError(err), { parse_mode: "HTML" });
        }
    });

    // ======================================================
    // FILE HANDLER
    // ======================================================

    const FILE_LIMITS = {
        document: 50 * 1024 * 1024,
        video: 50 * 1024 * 1024,
        audio: 50 * 1024 * 1024,
        voice: 50 * 1024 * 1024,
        photo: 10 * 1024 * 1024
    };

    const DEFAULT_NAMES = {
        photo: () => `photo_${Date.now()}.jpg`,
        video: () => `video_${Date.now()}.mp4`,
        audio: () => `audio_${Date.now()}.mp3`,
        voice: () => `voice_${Date.now()}.ogg`
    };

    bot.on(["document", "photo", "video", "audio", "voice"], async (ctx) => {
        await withLoading(ctx, async () => {
            const userId = await upsertUser(ctx);
            const m = ctx.message;

            let kind, obj;
            if (m.document) { kind = "document"; obj = m.document; }
            else if (m.video) { kind = "video"; obj = m.video; }
            else if (m.audio) { kind = "audio"; obj = m.audio; }
            else if (m.voice) { kind = "voice"; obj = m.voice; }
            else if (m.photo?.length) {
                kind = "photo";
                obj = m.photo[m.photo.length - 1]; // largest available size
            }

            if (!obj) throw new Error("Could not identify file type");

            const fileSize = obj.file_size || 0;
            const maxSize = FILE_LIMITS[kind] ?? 50 * 1024 * 1024;

            if (fileSize > maxSize) {
                throw new Error(`File too large. Maximum allowed: ${formatFileSize(maxSize)}`);
            }

            const fileName = obj.file_name
                ?? (DEFAULT_NAMES[kind] ? DEFAULT_NAMES[kind]() : `${kind}_${Date.now()}`);

            const file = await FileModel.create({
                ownerTgUserId: userId,
                kind,
                tgFileId: obj.file_id,
                tgUniqueId: obj.file_unique_id || "",
                fileName,
                mimeType: obj.mime_type || "",
                fileSize,
                note: "",
                createdAt: new Date()
            });

            // Invalidate stats & leaderboard caches
            memoryCache.del(`stats:${userId}`);
            memoryCache.delPattern("leaderboard:*");

            await ctx.replyWithHTML(`
✅ <b>File saved successfully!</b>

📄 <b>Name:</b> <code>${escapeHtml(fileName)}</code>
📁 <b>Type:</b> ${kind}
💾 <b>Size:</b> ${formatFileSize(fileSize)}
⚡️ <b>Points earned:</b> +10 pts
🆔 <b>ID:</b> <code>${file._id}</code>

Open the Cloud to manage, rename, or download your files.
Earn more points by inviting friends!
      `.trim(), mainMenu());
        });
    });

    // Catch-all for unhandled callback queries  prevents spinner from hanging
    bot.on("callback_query", async (ctx) => {
        await ctx.answerCbQuery().catch(() => { });
    });

    // ======================================================
    // LAUNCH
    // ======================================================

    await bot.launch();
    console.log("✅ Bot started  Referral & Leaderboard system active (Optimized, No Redis)");

    // Graceful shutdown
    const shutdown = (signal) => () => {
        console.log(`\n${signal} received  shutting down…`);
        bot.stop(signal);
        memoryCache.clear();
        process.exit(0);
    };

    process.once("SIGINT", shutdown("SIGINT"));
    process.once("SIGTERM", shutdown("SIGTERM"));

    return bot;
}