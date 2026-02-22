import { Telegraf, Markup, session } from "telegraf";
import { message } from 'telegraf/filters';

// Konfiguratsiyani yagona obyektga jamlash
const config = {
    botToken: process.env.BOT_TOKEN_SUP,
    adminIds: parseAdminIds(),
    maxMessageLength: 3500,
    sessionTimeout: 3600000 // 1 soat
};

function parseAdminIds() {
    const raw = process.env.ADMIN_IDS || "";
    return raw
        .split(",")
        .map(s => s.trim())
        .filter(Boolean);
}

function isAdmin(ctx) {
    const id = String(ctx.from?.id || "");
    return config.adminIds.includes(id);
}

// Xavfsiz HTML escape
function escapeHtml(text) {
    if (!text) return "";
    const htmlEscapes = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    };
    return String(text).replace(/[&<>"']/g, char => htmlEscapes[char]);
}

// Menyularni yaratuvchi funksiyalar
const createMenu = {
    main: () => Markup.inlineKeyboard([
        [Markup.button.callback("🆘 Contact Support", "support:start")],
        [Markup.button.callback("ℹ️ Info", "support:info")],
        [Markup.button.callback("📋 Status", "support:status")]
    ]),

    cancel: () => Markup.inlineKeyboard([
        [Markup.button.callback("❌ Cancel", "support:cancel")]
    ]),

    admin: () => Markup.inlineKeyboard([
        [Markup.button.callback("📥 Inbox", "admin:inbox")],
        [Markup.button.callback("📌 Rules", "admin:rules")],
        [Markup.button.callback("📊 Stats", "admin:stats")]
    ]),

    ticketActions: (userId) => Markup.inlineKeyboard([
        [
            Markup.button.callback("✅ Solved", `ticket:solved:${userId}`),
            Markup.button.callback("⏳ Pending", `ticket:pending:${userId}`)
        ],
        [Markup.button.callback("👤 User Info", `ticket:info:${userId}`)]
    ])
};

// Matn formatlash
const formatters = {
    userLine: (user) => {
        const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim() || "User";
        const username = user.username ? `@${user.username}` : "no_username";
        return `${escapeHtml(name)} (${escapeHtml(username)})`;
    },

    supportIntro: () => (
        `<b>🆘 Support Center</b>\n\n` +
        `Write your message and admins will respond as soon as possible.\n\n` +
        `<b>Tips:</b>\n` +
        `• Be specific about your issue\n` +
        `• Include error messages or screenshots\n` +
        `• One issue per message for better tracking\n\n` +
        `<i>Click Cancel to exit support mode</i>`
    ),

    ticketHeader: (user) => {
        return (
            `<b>📬 New Support Ticket</b>\n` +
            `<b>User:</b> ${formatters.userLine(user)}\n` +
            `<b>User ID:</b> <code>${escapeHtml(String(user.id))}</code>\n` +
            `<b>Time:</b> ${new Date().toLocaleString()}\n\n`
        );
    },

    adminReplyHeader: (user, admin) => {
        return (
            `<b>💬 Admin Response</b>\n` +
            `<b>To:</b> ${formatters.userLine(user)}\n` +
            `<b>From:</b> ${formatters.userLine(admin)}\n` +
            `<b>Time:</b> ${new Date().toLocaleString()}\n\n`
        );
    },

    ticketStats: (stats) => {
        return (
            `<b>📊 Support Statistics</b>\n\n` +
            `Open tickets: ${stats.open}\n` +
            `Resolved today: ${stats.resolvedToday}\n` +
            `Total tickets: ${stats.total}`
        );
    }
};

// Botni yaratish
export const bot = new Telegraf(config.botToken);

// Bot contextini kengaytirish
bot.context.ticketMap = new Map();
bot.context.userSessions = new Map();

// Session middleware
bot.use(session());

// Logger middleware
bot.use(async (ctx, next) => {
    const start = Date.now();
    await next();
    const ms = Date.now() - start;
    console.log(`${ctx.updateType} processed in ${ms}ms`);
});

// Global error handler
bot.catch((err, ctx) => {
    console.error("Bot error:", err);
    const errorMessage = "❌ An error occurred. Please try again later.";
    
    try {
        if (ctx?.callbackQuery) {
            ctx.answerCbQuery(errorMessage, { show_alert: true });
        } else if (ctx?.chat) {
            ctx.reply(errorMessage, { parse_mode: "HTML" });
        }
    } catch (_) {}
});

// Commands
bot.command("start", async (ctx) => {
    ctx.session = ctx.session || {};
    
    if (isAdmin(ctx)) {
        await ctx.reply(
            `<b>✅ Admin Panel Active</b>\n\nYou have administrator privileges.`,
            { parse_mode: "HTML", reply_markup: createMenu.admin().reply_markup }
        );
        return;
    }

    await ctx.reply(
        `<b>👋 Welcome to Support Bot</b>\n\n` +
        `This bot helps you contact support team.`,
        { parse_mode: "HTML", reply_markup: createMenu.main().reply_markup }
    );
});

bot.command("support", async (ctx) => {
    if (isAdmin(ctx)) {
        await ctx.reply("Admins use the admin panel instead.", { reply_markup: createMenu.admin().reply_markup });
        return;
    }

    ctx.session = ctx.session || {};
    ctx.session.supportMode = true;
    ctx.session.supportStartTime = Date.now();

    await ctx.reply(formatters.supportIntro(), {
        parse_mode: "HTML",
        reply_markup: createMenu.cancel().reply_markup
    });
});

// Callback handlers
const actionHandlers = {
    'support:start': async (ctx) => {
        await ctx.answerCbQuery();
        ctx.session = ctx.session || {};
        ctx.session.supportMode = true;
        
        await ctx.editMessageText(formatters.supportIntro(), {
            parse_mode: "HTML",
            reply_markup: createMenu.cancel().reply_markup
        });
    },

    'support:info': async (ctx) => {
        await ctx.answerCbQuery();
        await ctx.editMessageText(
            `<b>ℹ️ About Support</b>\n\n` +
            `Response time: Usually within 24 hours\n` +
            `Available: 24/7\n` +
            `Languages: English, Russian, Uzbek\n\n` +
            `Use /support to create a ticket.`,
            { parse_mode: "HTML", reply_markup: createMenu.main().reply_markup }
        );
    },

    'support:status': async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from.id;
        const userTickets = Array.from(ctx.ticketMap.entries())
            .filter(([_, uid]) => uid === String(userId))
            .length;

        await ctx.editMessageText(
            `<b>📋 Your Tickets</b>\n\n` +
            `Total tickets: ${userTickets}\n` +
            `Last ticket: ${userTickets > 0 ? 'Active' : 'None'}`,
            { parse_mode: "HTML", reply_markup: createMenu.main().reply_markup }
        );
    },

    'support:cancel': async (ctx) => {
        await ctx.answerCbQuery("Support mode cancelled");
        ctx.session = ctx.session || {};
        ctx.session.supportMode = false;

        await ctx.editMessageText(
            `<b>✅ Support Mode Cancelled</b>\n\nUse /support to start again.`,
            { parse_mode: "HTML", reply_markup: createMenu.main().reply_markup }
        );
    },

    'admin:inbox': async (ctx) => {
        if (!isAdmin(ctx)) return;
        await ctx.answerCbQuery();
        await ctx.reply(
            `<b>📥 Admin Inbox</b>\n\n` +
            `Tickets appear here automatically.\n` +
            `Reply to any ticket message to respond.`,
            { parse_mode: "HTML" }
        );
    },

    'admin:rules': async (ctx) => {
        if (!isAdmin(ctx)) return;
        await ctx.answerCbQuery();
        await ctx.reply(
            `<b>📌 Admin Guidelines</b>\n\n` +
            `• Respond within 24 hours\n` +
            `• Be professional and helpful\n` +
            `• Ask for details when needed\n` +
            `• Mark tickets as solved when done`,
            { parse_mode: "HTML" }
        );
    },

    'admin:stats': async (ctx) => {
        if (!isAdmin(ctx)) return;
        await ctx.answerCbQuery();
        
        const stats = {
            open: Math.floor(Math.random() * 10),
            resolvedToday: Math.floor(Math.random() * 5),
            total: Math.floor(Math.random() * 100)
        };
        
        await ctx.reply(formatters.ticketStats(stats), { parse_mode: "HTML" });
    }
};

// Register action handlers
bot.action(/^support:.+/, async (ctx) => {
    const handler = actionHandlers[ctx.match[0]];
    if (handler) await handler(ctx);
});

bot.action(/^admin:.+/, async (ctx) => {
    if (!isAdmin(ctx)) {
        await ctx.answerCbQuery("Unauthorized", { show_alert: true });
        return;
    }
    const handler = actionHandlers[ctx.match[0]];
    if (handler) await handler(ctx);
});

// Ticket action handlers
bot.action(/ticket:(solved|pending|info):(.+)/, async (ctx) => {
    if (!isAdmin(ctx)) {
        await ctx.answerCbQuery("Admin only", { show_alert: true });
        return;
    }

    const [action, userId] = [ctx.match[1], ctx.match[2]];
    await ctx.answerCbQuery(`Ticket marked as ${action}`);

    try {
        let message = "";
        switch(action) {
            case 'solved':
                message = "<b>✅ Your ticket has been marked as solved</b>\n\nIf you need further assistance, create a new ticket with /support";
                break;
            case 'pending':
                message = "<b>⏳ Your ticket is being processed</b>\n\nAn admin will respond shortly.";
                break;
            case 'info':
                const user = await ctx.telegram.getChat(userId);
                message = `<b>👤 User Information</b>\n\n` +
                         `ID: <code>${userId}</code>\n` +
                         `Name: ${escapeHtml(user.first_name)} ${escapeHtml(user.last_name || '')}\n` +
                         `Username: ${user.username ? '@' + user.username : 'None'}\n` +
                         `Language: ${user.language_code || 'Unknown'}`;
                await ctx.reply(message, { parse_mode: "HTML" });
                return;
        }
        
        if (message) {
            await ctx.telegram.sendMessage(userId, message, { parse_mode: "HTML" });
        }
    } catch (error) {
        console.error("Error handling ticket action:", error);
        await ctx.reply("Failed to process action. User might have blocked the bot.");
    }
});

// Helper function to send to admins
async function notifyAdmins(ctx, content, type = 'text', extra = {}) {
    const results = [];
    
    for (const adminId of config.adminIds) {
        try {
            let result;
            if (type === 'copy' && extra.messageId) {
                result = await ctx.telegram.copyMessage(adminId, ctx.chat.id, extra.messageId);
            } else if (type === 'forward' && extra.messageId) {
                result = await ctx.telegram.forwardMessage(adminId, ctx.chat.id, extra.messageId);
            } else {
                result = await ctx.telegram.sendMessage(adminId, content, {
                    parse_mode: "HTML",
                    disable_web_page_preview: true,
                    ...extra
                });
            }
            
            if (result) {
                ctx.ticketMap.set(String(result.message_id), String(ctx.from.id));
                results.push(result);
            }
        } catch (error) {
            console.error(`Failed to notify admin ${adminId}:`, error);
        }
    }
    
    return results;
}

// Handle support messages
async function handleSupportMessage(ctx) {
    const from = ctx.from;
    const message = ctx.message;
    
    // Check session timeout
    if (ctx.session?.supportStartTime && Date.now() - ctx.session.supportStartTime > config.sessionTimeout) {
        ctx.session.supportMode = false;
        await ctx.reply(
            "<b>⏰ Session expired</b>\n\nPlease start again with /support",
            { parse_mode: "HTML" }
        );
        return;
    }

    const header = formatters.ticketHeader(from);
    let adminMessage;

    try {
        if (message.text) {
            const content = header + `<b>Message:</b>\n${escapeHtml(message.text).slice(0, config.maxMessageLength)}`;
            adminMessage = await notifyAdmins(ctx, content, 'text', {
                reply_markup: createMenu.ticketActions(from.id).reply_markup
            });
            
            await ctx.reply(
                `<b>✅ Message Sent</b>\n\n` +
                `Your message has been delivered to support.\n` +
                `You'll receive a reply here shortly.`,
                { parse_mode: "HTML", reply_markup: createMenu.main().reply_markup }
            );
        } 
        else if (message.photo || message.document || message.video || message.audio || message.voice) {
            // Send header first
            await notifyAdmins(ctx, header + `<i>Media attachment:</i>`, 'text');
            
            // Forward/copy media
            const mediaMessage = await notifyAdmins(ctx, null, 'copy', {
                messageId: message.message_id
            });
            
            // Add action buttons to media messages
            for (const msg of mediaMessage) {
                await ctx.telegram.editMessageReplyMarkup(
                    adminId,
                    msg.message_id,
                    null,
                    createMenu.ticketActions(from.id).reply_markup
                ).catch(() => {});
            }
            
            await ctx.reply(
                `<b>✅ File Sent</b>\n\n` +
                `Your file has been delivered to support.`,
                { parse_mode: "HTML", reply_markup: createMenu.main().reply_markup }
            );
        }
        
        // Clear support mode
        ctx.session.supportMode = false;
        
    } catch (error) {
        console.error("Error handling support message:", error);
        await ctx.reply(
            "<b>❌ Failed to send message</b>\n\nPlease try again later.",
            { parse_mode: "HTML" }
        );
    }
}

// Handle user messages in support mode
bot.on(message('text'), async (ctx, next) => {
    if (isAdmin(ctx)) return next();
    
    if (ctx.session?.supportMode) {
        await handleSupportMessage(ctx);
        return;
    }
    
    return next();
});

// Handle media messages in support mode
bot.on(['photo', 'document', 'video', 'audio', 'voice'], async (ctx, next) => {
    if (isAdmin(ctx)) return next();
    
    if (ctx.session?.supportMode) {
        await handleSupportMessage(ctx);
        return;
    }
    
    return next();
});

// Handle admin replies
bot.on(message('text'), async (ctx, next) => {
    if (!isAdmin(ctx)) return next();
    
    const replyTo = ctx.message.reply_to_message;
    if (!replyTo) return next();

    // Try to get user from ticket map
    let targetUserId = ctx.ticketMap.get(String(replyTo.message_id));
    
    // If not found, try to extract from message text
    if (!targetUserId) {
        const text = replyTo.text || replyTo.caption || '';
        const match = text.match(/User ID:<\/b> <code>(\d+)<\/code>/);
        targetUserId = match ? match[1] : null;
    }

    if (!targetUserId) {
        await ctx.reply("❌ Could not identify the user. Make sure you're replying to a ticket message.");
        return;
    }

    try {
        const header = formatters.adminReplyHeader(
            { id: targetUserId, ...ctx.message.from },
            ctx.from
        );

        if (ctx.message.text) {
            await ctx.telegram.sendMessage(
                targetUserId,
                header + `<b>Message:</b>\n${escapeHtml(ctx.message.text).slice(0, config.maxMessageLength)}`,
                { parse_mode: "HTML" }
            );
        } else if (ctx.message.photo || ctx.message.document) {
            await ctx.telegram.sendMessage(
                targetUserId,
                header + `<i>Admin sent media:</i>`,
                { parse_mode: "HTML" }
            );
            await ctx.telegram.copyMessage(targetUserId, ctx.chat.id, ctx.message.message_id);
        }

        await ctx.reply("✅ Reply delivered to user", { parse_mode: "HTML" });
    } catch (error) {
        console.error("Error sending admin reply:", error);
        await ctx.reply(
            "❌ Failed to deliver reply. User might have blocked the bot.",
            { parse_mode: "HTML" }
        );
    }
});

// Fallback for non-support messages
bot.on('message', async (ctx) => {
    if (isAdmin(ctx)) return;
    
    await ctx.reply(
        `<b>ℹ️ Support Bot</b>\n\n` +
        `Use /support to contact support team.`,
        { parse_mode: "HTML", reply_markup: createMenu.main().reply_markup }
    );
});

// Launch bot
export function startSupportBot() {
    if (!config.botToken) throw new Error("BOT_TOKEN_SUP is required");
    if (config.adminIds.length === 0) throw new Error("At least one ADMIN_ID is required");

    bot.launch()
        .then(() => {
            console.log("✅ Support bot started successfully");
            console.log(`👥 Admins: ${config.adminIds.length}`);
        })
        .catch(err => {
            console.error("❌ Failed to start bot:", err);
            process.exit(1);
        });

    // Graceful shutdown
    const shutdown = (signal) => {
        console.log(`\n${signal} received, stopping bot...`);
        bot.stop(signal);
        process.exit(0);
    };

    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));

    return bot;
}