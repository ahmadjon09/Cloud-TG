// support.js — optional second bot for user ↔ admin support tickets
//
// IMPORTANT: this module used to build the Telegraf instance at import time,
// which crashed the whole app when BOT_TOKEN_SUP was missing.
// The bot is now created lazily inside startSupportBot().
import { Telegraf, Markup, session } from "telegraf";
import { message } from "telegraf/filters";
import { translate, detectLanguage, getUserLanguage } from "./utils/i18n.js";

const config = {
  botToken: process.env.BOT_TOKEN_SUP || "",
  adminIds: (process.env.ADMIN_IDS || "").split(",").map(s => s.trim()).filter(Boolean),
  maxMessageLength: 3500,
  sessionTimeout: 60 * 60 * 1000 // 1 hour
};

function isAdmin(ctx) {
  return config.adminIds.includes(String(ctx.from?.id || ""));
}

function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

/** Per-user translator (falls back to Telegram's language_code). */
async function tr(ctx) {
  const lang = await getUserLanguage(ctx.from?.id).catch(() => "en");
  return (key, vars = {}) => translate(lang, key, vars);
}

const userLine = user => {
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim() || "User";
  const username = user.username ? `@${user.username}` : "no_username";
  return `${escapeHtml(name)} (${escapeHtml(username)})`;
};

const createMenu = {
  main: t => Markup.inlineKeyboard([
    [Markup.button.callback(`🆘 ${t("support.menuContact")}`, "support:start")],
    [
      Markup.button.callback(`ℹ️ ${t("support.menuInfo")}`, "support:info"),
      Markup.button.callback(`📋 ${t("support.menuStatus")}`, "support:status")
    ]
  ]),
  cancel: t => Markup.inlineKeyboard([[Markup.button.callback(`❌ ${t("expiry.cancel")}`, "support:cancel")]]),
  admin: t => Markup.inlineKeyboard([
    [
      Markup.button.callback(`📥 ${t("support.inbox")}`, "admin:inbox"),
      Markup.button.callback(`📌 ${t("support.rules")}`, "admin:rules")
    ],
    [Markup.button.callback(`📊 ${t("admin.stats")}`, "admin:stats")]
  ]),
  ticketActions: (userId, t) => Markup.inlineKeyboard([
    [
      Markup.button.callback(`✅ ${t("common.yes")}`, `ticket:solved:${userId}`),
      Markup.button.callback(`⏳ ${t("support.pending")}`, `ticket:pending:${userId}`)
    ],
    [Markup.button.callback(`👤 ${t("support.userInfo")}`, `ticket:info:${userId}`)]
  ])
};

let bot = null;

async function notifyAdmins(ctx, content, type = "text", extra = {}, replyMarkup = null) {
  const results = [];
  for (const adminId of config.adminIds) {
    try {
      let result;
      if ((type === "copy" || type === "forward") && extra.messageId) {
        result =
          type === "copy"
            ? await ctx.telegram.copyMessage(adminId, ctx.chat.id, extra.messageId)
            : await ctx.telegram.forwardMessage(adminId, ctx.chat.id, extra.messageId);
      } else {
        result = await ctx.telegram.sendMessage(adminId, content, {
          parse_mode: "HTML",
          disable_web_page_preview: true,
          ...extra
        });
      }
      if (result) {
        // remember which user this admin-side message belongs to
        ctx.ticketMap?.set(String(result.message_id), String(ctx.from.id));
        if (replyMarkup) {
          await ctx.telegram
            .editMessageReplyMarkup(adminId, result.message_id, undefined, replyMarkup)
            .catch(() => {});
        }
        results.push({ adminId, messageId: result.message_id });
      }
    } catch (error) {
      console.error(`Failed to notify admin ${adminId}:`, error.message);
    }
  }
  return results;
}

async function handleSupportMessage(ctx) {
  const t = await tr(ctx);
  const from = ctx.from;
  const msg = ctx.message;

  if (ctx.session?.supportStartTime && Date.now() - ctx.session.supportStartTime > config.sessionTimeout) {
    ctx.session.supportMode = false;
    return ctx.reply(t("support.sessionExpired", { cmd: "/support" }), { parse_mode: "HTML" });
  }

  const time = new Date().toLocaleString();
  const header = t("support.ticketFrom", { user: userLine(from), id: from.id, time });
  const markup = createMenu.ticketActions(from.id, t).reply_markup;

  try {
    if (msg.text) {
      await notifyAdmins(ctx, `${header}\n<b>${t("support.messageLabel")}</b>\n${escapeHtml(msg.text).slice(0, config.maxMessageLength)}`, "text", {}, markup);
      await ctx.reply(t("support.sent"), { parse_mode: "HTML", reply_markup: createMenu.main(t).reply_markup });
    } else if (msg.photo || msg.document || msg.video || msg.audio || msg.voice || msg.sticker) {
      await notifyAdmins(ctx, `${header}\n<i>${t("support.messageLabel")}</i>`, "text", {}, markup);
      await notifyAdmins(ctx, null, "copy", { messageId: msg.message_id });
      await ctx.reply(t("support.fileSent"), { parse_mode: "HTML", reply_markup: createMenu.main(t).reply_markup });
    }
    ctx.session.supportMode = false;
  } catch (error) {
    console.error("Error handling support message:", error);
    await ctx.reply(t("support.failed"), { parse_mode: "HTML" });
  }
}

export function startSupportBot() {
  if (!config.botToken) throw new Error("BOT_TOKEN_SUP is required");
  if (!config.adminIds.length) throw new Error("At least one ADMIN_ID is required");

  bot = new Telegraf(config.botToken);

  bot.context.ticketMap = new Map();
  bot.use(session());

  bot.use(async (ctx, next) => {
    const start = Date.now();
    try {
      await next();
    } finally {
      const ms = Date.now() - start;
      if (ms > 1500) console.log(`[support] ${ctx.updateType} took ${ms}ms`);
    }
  });

  bot.catch(err => console.error("[support] error:", err?.message || err));

  bot.command("start", async ctx => {
    const t = await tr(ctx);
    ctx.session = ctx.session || {};
    if (isAdmin(ctx)) {
      return ctx.reply(t("support.welcomeAdmin"), {
        parse_mode: "HTML",
        reply_markup: createMenu.admin(t).reply_markup
      });
    }
    await ctx.reply(t("support.welcomeUser"), {
      parse_mode: "HTML",
      reply_markup: createMenu.main(t).reply_markup
    });
  });

  bot.command("support", async ctx => {
    const t = await tr(ctx);
    ctx.session = ctx.session || {};
    if (isAdmin(ctx)) {
      return ctx.reply(t("support.adminOnly"), { reply_markup: createMenu.admin(t).reply_markup });
    }
    ctx.session.supportMode = true;
    ctx.session.supportStartTime = Date.now();
    const tips = [t("support.tip1"), t("support.tip2"), t("support.tip3"), t("support.tipCancel")].join("\n");
    await ctx.reply(t("support.intro", { tips }), {
      parse_mode: "HTML",
      reply_markup: createMenu.cancel(t).reply_markup
    });
  });

  bot.action("support:start", async ctx => {
    const t = await tr(ctx);
    await ctx.answerCbQuery();
    ctx.session = ctx.session || {};
    ctx.session.supportMode = true;
    ctx.session.supportStartTime = Date.now();
    const tips = [t("support.tip1"), t("support.tip2"), t("support.tip3"), t("support.tipCancel")].join("\n");
    await ctx.editMessageText(t("support.intro", { tips }), {
      parse_mode: "HTML",
      reply_markup: createMenu.cancel(t).reply_markup
    });
  });

  bot.action("support:info", async ctx => {
    const t = await tr(ctx);
    await ctx.answerCbQuery();
    await ctx.editMessageText(t("support.about", { cmd: "/support" }), {
      parse_mode: "HTML",
      reply_markup: createMenu.main(t).reply_markup
    });
  });

  bot.action("support:status", async ctx => {
    const t = await tr(ctx);
    await ctx.answerCbQuery();
    const total = [...(ctx.ticketMap?.values() || [])].filter(uid => uid === String(ctx.from.id)).length;
    await ctx.editMessageText(
      t("support.yourTickets", { total, last: total > 0 ? t("support.active") : t("support.none") }),
      { parse_mode: "HTML", reply_markup: createMenu.main(t).reply_markup }
    );
  });

  bot.action("support:cancel", async ctx => {
    const t = await tr(ctx);
    await ctx.answerCbQuery(t("common.cancelled"));
    ctx.session = ctx.session || {};
    ctx.session.supportMode = false;
    await ctx.editMessageText(t("support.cancelled", { cmd: "/support" }), {
      parse_mode: "HTML",
      reply_markup: createMenu.main(t).reply_markup
    });
  });

  bot.action("admin:inbox", async ctx => {
    const t = await tr(ctx);
    if (!isAdmin(ctx)) return ctx.answerCbQuery(t("support.adminOnly"), { show_alert: true });
    await ctx.answerCbQuery();
    await ctx.reply(t("support.inbox"), { parse_mode: "HTML" });
  });

  bot.action("admin:rules", async ctx => {
    const t = await tr(ctx);
    if (!isAdmin(ctx)) return ctx.answerCbQuery(t("support.adminOnly"), { show_alert: true });
    await ctx.answerCbQuery();
    await ctx.reply(t("support.rules"), { parse_mode: "HTML" });
  });

  bot.action("admin:stats", async ctx => {
    const t = await tr(ctx);
    if (!isAdmin(ctx)) return ctx.answerCbQuery(t("support.adminOnly"), { show_alert: true });
    await ctx.answerCbQuery();
    const open = [...(ctx.ticketMap?.values() || [])].length;
    await ctx.reply(t("support.stats", { open, resolved: 0, total: ctx.ticketMap?.size || 0 }), { parse_mode: "HTML" });
  });

  bot.action(/ticket:(solved|pending|info):(.+)/, async ctx => {
    const t = await tr(ctx);
    if (!isAdmin(ctx)) return ctx.answerCbQuery(t("support.adminOnly"), { show_alert: true });

    const action = ctx.match[1];
    const userId = ctx.match[2];
    await ctx.answerCbQuery();

    try {
      if (action === "info") {
        const user = await ctx.telegram.getChat(userId).catch(() => null);
        await ctx.reply(
          t("support.userInfo", {
            id: userId,
            name: escapeHtml([user?.first_name, user?.last_name].filter(Boolean).join(" ")) || "—",
            username: user?.username ? `@${user.username}` : "—",
            lang: detectLanguage(user?.language_code) || "—"
          }),
          { parse_mode: "HTML" }
        );
        return;
      }
      await ctx.telegram.sendMessage(userId, action === "solved" ? t("support.solved", { cmd: "/support" }) : t("support.pending"), {
        parse_mode: "HTML"
      });
    } catch (error) {
      console.error("Error handling ticket action:", error.message);
      await ctx.reply(t("support.replyFailed"), { parse_mode: "HTML" });
    }
  });

  bot.on(message("text"), async (ctx, next) => {
    if (isAdmin(ctx)) return next();
    ctx.session = ctx.session || {};
    if (ctx.session.supportMode) return handleSupportMessage(ctx);
    return next();
  });

  bot.on(["photo", "document", "video", "audio", "voice", "sticker"], async (ctx, next) => {
    if (isAdmin(ctx)) return next();
    ctx.session = ctx.session || {};
    if (ctx.session.supportMode) return handleSupportMessage(ctx);
    return next();
  });

  // Admin replies to a ticket message
  bot.on(message("text"), async (ctx, next) => {
    if (!isAdmin(ctx)) return next();
    const t = await tr(ctx);
    const replyTo = ctx.message.reply_to_message;
    if (!replyTo) return next();

    let targetUserId = ctx.ticketMap?.get(String(replyTo.message_id));
    if (!targetUserId) {
      const text = replyTo.text || replyTo.caption || "";
      const match = text.match(/<code>(\d+)<\/code>/);
      targetUserId = match ? match[1] : null;
    }
    if (!targetUserId) return ctx.reply(t("support.cannotIdentify"));

    try {
      await ctx.telegram.sendMessage(targetUserId, escapeHtml(ctx.message.text).slice(0, config.maxMessageLength), {
        parse_mode: "HTML"
      });
      await ctx.reply(t("support.replyDelivered"), { parse_mode: "HTML" });
    } catch (error) {
      console.error("Error sending admin reply:", error.message);
      await ctx.reply(t("support.replyFailed"), { parse_mode: "HTML" });
    }
  });

  bot.on("message", async ctx => {
    if (isAdmin(ctx)) return;
    const t = await tr(ctx);
    await ctx.reply(t("support.fallback", { cmd: "/support" }), {
      parse_mode: "HTML",
      reply_markup: createMenu.main(t).reply_markup
    });
  });

  bot.launch()
    .then(() => {
      console.log("✅ Support bot started");
      console.log(`👥 Support admins: ${config.adminIds.length}`);
    })
    .catch(err => {
      console.error("❌ Failed to start support bot:", err.message);
    });

  process.once("SIGINT", () => bot?.stop("SIGINT"));
  process.once("SIGTERM", () => bot?.stop("SIGTERM"));

  return bot;
}

export function getSupportBot() {
  return bot;
}
