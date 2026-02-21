import { Telegraf, Markup, Scenes, session } from "telegraf";
import { UserModel } from "./models/User.js";
import { FileModel } from "./models/File.js";

// Admin IDs ni tekshirish
function isAdmin(userId) {
    if (!userId) return false;
    const raw = process.env.ADMIN_IDS || "";
    const set = new Set(raw.split(",").map(s => s.trim()).filter(Boolean));
    return set.has(String(userId));
}

// Foydalanuvchini bazaga qo'shish yoki yangilash
async function upsertUser(ctx) {
    try {
        const u = ctx.from || {};
        const tgUserId = String(u.id);

        await UserModel.updateOne(
            { tgUserId },
            {
                $set: {
                    firstName: u.first_name || "",
                    lastName: u.last_name || "",
                    username: u.username || "",
                    languageCode: u.language_code || "en",
                    lastActiveAt: new Date()
                },
                $setOnInsert: {
                    startedAt: new Date(),
                    isBlocked: false
                }
            },
            { upsert: true }
        );

        return tgUserId;
    } catch (error) {
        console.error("Error upserting user:", error);
        throw error;
    }
}

// Web App URL
function webAppUrl() {
    return `${process.env.BASE_URL}/app`;
}

// Asosiy menyu (inline keyboard)
function mainMenu(showBack = false) {
    const buttons = [
        [Markup.button.webApp("📂 Open Cloud", webAppUrl())],
        [
            Markup.button.callback("📊 My Files", "MY_FILES"),
            Markup.button.callback("📈 Limits", "LIMITS")
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

// Admin menyusi
function adminMenu() {
    return Markup.inlineKeyboard([
        [Markup.button.callback("📊 Stats", "ADMIN_STATS")],
        [Markup.button.callback("📢 Broadcast", "ADMIN_BROADCAST")],
        [Markup.button.callback("👥 Users List", "ADMIN_USERS")],
        [Markup.button.callback("🔙 Back to Main", "MAIN_MENU")]
    ]);
}

// Xatolarni chiroyli ko'rsatish
function formatError(error) {
    const errorMsg = error?.message || String(error) || "Unknown error";
    return `❌ <b>Error:</b>\n<code>${escapeHtml(errorMsg.substring(0, 200))}</code>`;
}

// HTML dan qochish
function escapeHtml(text) {
    if (!text) return text;
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

// Loading message bilan ishlash
async function withLoading(ctx, fn, loadingText = "⏳ Loading...") {
    let msg;
    try {
        msg = await ctx.reply(loadingText, { parse_mode: "HTML" });
        const result = await fn();

        // Loading message ni o'chirish
        try {
            await ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id);
        } catch (e) {
            // Xatolikni ignore qilish
        }

        return result;
    } catch (error) {
        console.error("Error in withLoading:", error);

        // Xatolikni ko'rsatish
        try {
            if (msg) {
                await ctx.telegram.editMessageText(
                    ctx.chat.id,
                    msg.message_id,
                    undefined,
                    formatError(error),
                    { parse_mode: "HTML" }
                );
            } else {
                await ctx.reply(formatError(error), { parse_mode: "HTML" });
            }
        } catch (e) {
            // Xatolikni ignore qilish
        }

        throw error;
    }
}

// Safe edit message (agar menu bir xil bo'lsa xatolik chiqarmaydi)
async function safeEditMessage(ctx, text, keyboard, parseMode = "HTML") {
    try {
        await ctx.editMessageText(text, {
            parse_mode: parseMode,
            reply_markup: keyboard?.reply_markup,
            disable_web_page_preview: true
        });
    } catch (error) {
        // Agar xato "message is not modified" bo'lsa, ignore qilish
        if (error?.code === 400 && error?.description?.includes("message is not modified")) {
            return;
        }
        throw error;
    }
}

// Botni ishga tushirish
export function startBot() {
    const bot = new Telegraf(process.env.BOT_TOKEN);

    // Session middleware
    bot.use(session());

    // Global error handler
    bot.catch((err, ctx) => {
        console.error("Bot global error:", err);

        // Foydalanuvchiga xatolik haqida xabar berish
        ctx.reply(formatError(err), { parse_mode: "HTML" }).catch(() => { });
    });

    // Start komandasi
    bot.start(async (ctx) => {
        try {
            const userId = await upsertUser(ctx);

            const welcomeText = `
<b>👋 Welcome to Cloud Bot!</b>

I can help you store and manage your files in the cloud.

<b>📱 Features:</b>
• Send any file to save it
• Open Web App to manage files
• Edit file names and notes
• Download anytime

<b>🎯 How to use:</b>
1. Send me any file (document, photo, video, audio)
2. Open Cloud Web App
3. Manage your files easily

<b>⚡️ Quick actions:</b>
• Send a file to get started
• Click "Open Cloud" to open web app
• Check limits for file size restrictions
            `;

            await ctx.replyWithHTML(welcomeText, mainMenu());
        } catch (error) {
            console.error("Error in start:", error);
            await ctx.reply(formatError(error), { parse_mode: "HTML" });
        }
    });

    // Menu komandalari
    bot.hears(/^(menu|home|main|start)$/i, async (ctx) => {
        try {
            await upsertUser(ctx);

            const menuText = `
<b>📋 Main Menu</b>

Choose an option below to continue:
• 📂 Open Cloud - Open web interface
• 📊 My Files - View your files count
• 📈 Limits - Check file limits
• ℹ️ About - Information about bot
• 🆘 Help - Get help
            `;

            await ctx.replyWithHTML(menuText, mainMenu());
        } catch (error) {
            console.error("Error in menu:", error);
            await ctx.reply(formatError(error), { parse_mode: "HTML" });
        }
    });

    // About page
    bot.action("ABOUT", async (ctx) => {
        try {
            await ctx.answerCbQuery();
            await upsertUser(ctx);

            const aboutText = `
<b>ℹ️ About Cloud Bot</b>

<b>Version:</b> 1.0.0
<b>Developer:</b> @wxkow
<b>Platform:</b> Telegram Web App

<b>✨ Features:</b>
• File storage in Telegram cloud
• Web interface for management
• Edit file names and notes
• Download files anytime
• Dark/Light theme support
• File type icons
• Download progress tracking

<b>🔒 Privacy:</b>
• Files are stored securely in Telegram
• Only you can access your files
• No third-party access


            `;

            await safeEditMessage(ctx, aboutText, mainMenu(true));
        } catch (error) {
            console.error("Error in about:", error);
            await ctx.reply(formatError(error), { parse_mode: "HTML" });
        }
    });

    // Help page
    bot.action("HELP", async (ctx) => {
        try {
            await ctx.answerCbQuery();
            await upsertUser(ctx);

            const helpText = `
<b>🆘 Help & Support</b>

<b>❓ Frequently Asked Questions:</b>

<b>Q: How to save files?</b>
A: Simply send any file to the bot. It will be automatically saved.

<b>Q: File size limits?</b>
A: Telegram Bot API has limits:
• Documents: 50 MB
• Photos: 10 MB
• Videos: 50 MB
• Audio: 50 MB

<b>Q: How to edit files?</b>
A: Open Cloud Web App, click on file, edit name or note.

<b>Q: Files are safe?</b>
A: Yes, only you can access your files via Telegram.

<b>Q: Lost files?</b>
A: Check "My Files" to see your saved files.


<b>💡 Tips:</b>
• Use Web App for better management
• Add notes to remember file contents
• Check limits before uploading
            `;

            await safeEditMessage(ctx, helpText, mainMenu(true));
        } catch (error) {
            console.error("Error in help:", error);
            await ctx.reply(formatError(error), { parse_mode: "HTML" });
        }
    });

    // My Files
    bot.action("MY_FILES", async (ctx) => {
        await ctx.answerCbQuery();

        await withLoading(ctx, async () => {
            const userId = await upsertUser(ctx);

            const totalFiles = await FileModel.countDocuments({ ownerTgUserId: userId });
            const totalSize = await FileModel.aggregate([
                { $match: { ownerTgUserId: userId } },
                { $group: { _id: null, total: { $sum: "$fileSize" } } }
            ]);

            const size = totalSize[0]?.total || 0;

            // File turlari bo'yicha statistik
            const stats = await FileModel.aggregate([
                { $match: { ownerTgUserId: userId } },
                { $group: { _id: "$kind", count: { $sum: 1 } } }
            ]);

            const statsText = stats.map(s => `• ${s._id}: ${s.count}`).join("\n") || "• No files yet";

            const text = `
<b>📊 Your Files Statistics</b>

<b>Total Files:</b> <code>${totalFiles}</code>
<b>Total Size:</b> <code>${formatFileSize(size)}</code>

<b>📁 By Type:</b>
${statsText}

<b>💡 Actions:</b>
• Open Cloud to manage files
• Send new files to add
• Click Download button on each file
            `;

            await safeEditMessage(ctx, text, mainMenu(true));
        });
    });

    // Limits
    bot.action("LIMITS", async (ctx) => {
        await ctx.answerCbQuery();

        const limitsText = `
<b>📈 File Size Limits</b>

<b>Telegram Bot API Limits:</b>

📄 <b>Documents:</b>
• Max size: <code>50 MB</code>
• All formats supported

🖼 <b>Photos:</b>
• Max size: <code>10 MB</code>
• Formats: JPG, PNG, GIF

🎥 <b>Videos:</b>
• Max size: <code>50 MB</code>
• Formats: MP4, AVI, MOV

🎵 <b>Audio:</b>
• Max size: <code>50 MB</code>
• Formats: MP3, WAV, OGG

🎤 <b>Voice:</b>
• Max size: <code>50 MB</code>
• Formats: OGG, OPUS

<b>⚠️ Recommendations:</b>
• Split large files into parts
• Compress before uploading
• Use Web App for better experience

<b>📱 Web App:</b>
No additional limits in the web interface
            `;

        try {
            await safeEditMessage(ctx, limitsText, mainMenu(true));
        } catch (error) {
            console.error("Error in limits:", error);
            await ctx.reply(formatError(error), { parse_mode: "HTML" });
        }
    });

    // Main Menu action
    bot.action("MAIN_MENU", async (ctx) => {
        await ctx.answerCbQuery();

        const menuText = `
<b>📋 Main Menu</b>

Choose an option below:
        `;

        try {
            await safeEditMessage(ctx, menuText, mainMenu());
        } catch (error) {
            console.error("Error in main menu:", error);
            await ctx.reply(formatError(error), { parse_mode: "HTML" });
        }
    });

    // Admin commands
    bot.command("admin", async (ctx) => {
        if (!isAdmin(ctx.from?.id)) return;

        const adminText = `
<b>👑 Admin Panel</b>

Welcome to admin panel. Choose an option:
        `;

        try {
            await ctx.replyWithHTML(adminText, adminMenu());
        } catch (error) {
            console.error("Error in admin:", error);
            await ctx.reply(formatError(error), { parse_mode: "HTML" });
        }
    });

    // Admin stats
    bot.action("ADMIN_STATS", async (ctx) => {
        if (!isAdmin(ctx.from?.id)) {
            await ctx.answerCbQuery("You are not admin", { show_alert: true });
            return;
        }

        await ctx.answerCbQuery();

        await withLoading(ctx, async () => {
            const totalUsers = await UserModel.countDocuments();
            const activeToday = await UserModel.countDocuments({
                lastActiveAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
            });
            const totalFiles = await FileModel.countDocuments();
            const totalSize = await FileModel.aggregate([
                { $group: { _id: null, total: { $sum: "$fileSize" } } }
            ]);

            const size = totalSize[0]?.total || 0;

            const text = `
<b>📊 Admin Statistics</b>

<b>👥 Users:</b>
• Total: <code>${totalUsers}</code>
• Active today: <code>${activeToday}</code>

<b>📁 Files:</b>
• Total files: <code>${totalFiles}</code>
• Total size: <code>${formatFileSize(size)}</code>
• Average per user: <code>${(totalFiles / totalUsers).toFixed(1)}</code>

<b>📈 Growth:</b>
• New users (7d): <code>calculating...</code>
• New files (7d): <code>calculating...</code>
            `;

            await safeEditMessage(ctx, text, adminMenu());
        });
    });

    // Admin broadcast
    bot.action("ADMIN_BROADCAST", async (ctx) => {
        if (!isAdmin(ctx.from?.id)) {
            await ctx.answerCbQuery("You are not admin", { show_alert: true });
            return;
        }

        await ctx.answerCbQuery();

        ctx.session = ctx.session || {};
        ctx.session.awaitingBroadcast = true;

        const text = `
<b>📢 Broadcast Message</b>

Send the message you want to broadcast to all users.

<b>Supported formatting:</b>
• HTML tags
• Emojis
• Links

Type <code>/cancel</code> to cancel.
        `;

        try {
            await safeEditMessage(ctx, text, Markup.inlineKeyboard([
                [Markup.button.callback("❌ Cancel", "CANCEL_BROADCAST")]
            ]));
        } catch (error) {
            console.error("Error in broadcast:", error);
            await ctx.reply(formatError(error), { parse_mode: "HTML" });
        }
    });

    // Cancel broadcast
    bot.action("CANCEL_BROADCAST", async (ctx) => {
        if (!isAdmin(ctx.from?.id)) return;

        ctx.session = ctx.session || {};
        ctx.session.awaitingBroadcast = false;

        await ctx.answerCbQuery("Broadcast cancelled");

        const text = `
<b>📋 Main Menu</b>

Broadcast cancelled. Choose an option:
        `;

        try {
            await safeEditMessage(ctx, text, mainMenu());
        } catch (error) {
            console.error("Error in cancel:", error);
            await ctx.reply(formatError(error), { parse_mode: "HTML" });
        }
    });

    // Handle broadcast message
    bot.on("text", async (ctx) => {
        try {
            const userId = String(ctx.from?.id || "");

            // Check if admin and awaiting broadcast
            if (isAdmin(userId) && ctx.session?.awaitingBroadcast) {
                if (ctx.message.text === "/cancel") {
                    ctx.session.awaitingBroadcast = false;
                    await ctx.replyWithHTML("✅ Broadcast cancelled.", mainMenu());
                    return;
                }

                ctx.session.awaitingBroadcast = false;

                const text = ctx.message.text || "";

                // Get all users
                const users = await UserModel.find({ isBlocked: { $ne: true } })
                    .select({ tgUserId: 1 })
                    .lean();

                const loading = await ctx.replyWithHTML(
                    `📤 Sending broadcast to <code>${users.length}</code> users...`
                );

                let sent = 0;
                let failed = 0;
                let blocked = 0;

                for (const user of users) {
                    try {
                        await ctx.telegram.sendMessage(user.tgUserId, text, { parse_mode: "HTML" });
                        sent++;
                    } catch (error) {
                        failed++;

                        // If user blocked the bot
                        if (error?.code === 403) {
                            await UserModel.updateOne(
                                { tgUserId: user.tgUserId },
                                { $set: { isBlocked: true } }
                            );
                            blocked++;
                        }
                    }

                    // Small delay to avoid rate limiting
                    if (sent % 10 === 0) {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                }

                const result = `
<b>📢 Broadcast Complete</b>

✅ Sent: <code>${sent}</code>
❌ Failed: <code>${failed}</code>
🚫 Blocked: <code>${blocked}</code>
👥 Total: <code>${users.length}</code>
                `;

                await ctx.telegram.editMessageText(
                    ctx.chat.id,
                    loading.message_id,
                    undefined,
                    result,
                    { parse_mode: "HTML" }
                );

                return;
            }

            // Normal text handling (non-broadcast)
            await ctx.replyWithHTML(
                "Please use the menu buttons below:",
                mainMenu()
            );

        } catch (error) {
            console.error("Error in text handler:", error);
            await ctx.reply(formatError(error), { parse_mode: "HTML" });
        }
    });

    // File handlers
    bot.on(["document", "photo", "video", "audio", "voice"], async (ctx) => {
        await withLoading(ctx, async () => {
            const userId = await upsertUser(ctx);

            const m = ctx.message;
            let kind = "";
            let obj = null;

            if (m.document) { kind = "document"; obj = m.document; }
            else if (m.video) { kind = "video"; obj = m.video; }
            else if (m.audio) { kind = "audio"; obj = m.audio; }
            else if (m.voice) { kind = "voice"; obj = m.voice; }
            else if (m.photo?.length) {
                kind = "photo";
                obj = m.photo[m.photo.length - 1];
            }

            const fileName = obj.file_name ||
                (kind === "photo" ? `photo_${Date.now()}.jpg` :
                    kind === "video" ? `video_${Date.now()}.mp4` :
                        kind === "audio" ? `audio_${Date.now()}.mp3` :
                            kind === "voice" ? `voice_${Date.now()}.ogg` :
                                `${kind}_${Date.now()}`);

            const mimeType = obj.mime_type || "";
            const fileSize = obj.file_size || 0;

            // Check file size limits
            const limits = {
                document: 50 * 1024 * 1024,
                video: 50 * 1024 * 1024,
                audio: 50 * 1024 * 1024,
                voice: 50 * 1024 * 1024,
                photo: 10 * 1024 * 1024
            };

            if (fileSize > (limits[kind] || 50 * 1024 * 1024)) {
                throw new Error(`File too large. Max size: ${formatFileSize(limits[kind])}`);
            }

            const file = await FileModel.create({
                ownerTgUserId: userId,
                kind,
                tgFileId: obj.file_id,
                tgUniqueId: obj.file_unique_id || "",
                fileName,
                mimeType,
                fileSize,
                note: "",
                createdAt: new Date()
            });

            const successText = `
✅ <b>File saved successfully!</b>

📄 <b>Name:</b> <code>${escapeHtml(fileName)}</code>
📁 <b>Type:</b> ${kind}
💾 <b>Size:</b> ${formatFileSize(fileSize)}
🆔 <b>ID:</b> <code>${file._id}</code>

You can now:
• Open Cloud to manage
• Add notes to this file
• Download anytime
            `;

            await ctx.replyWithHTML(successText, mainMenu());
        });
    });

    // Handle callback queries that are not handled
    bot.on("callback_query", async (ctx) => {
        await ctx.answerCbQuery();
    });

    // Error handler for polling errors
    bot.launch().catch((err) => {
        console.error("Failed to launch bot:", err);
    });

    console.log("✅ Bot started successfully");

    // Enable graceful stop
    process.once("SIGINT", () => bot.stop("SIGINT"));
    process.once("SIGTERM", () => bot.stop("SIGTERM"));

    return bot;
}

// Helper: format file size
function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }
    return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}