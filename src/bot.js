import { Telegraf, Markup } from "telegraf";
import { UserModel } from "./models/User.js";
import { FileModel } from "./models/File.js";

function isAdmin(userId) {
    const raw = process.env.ADMIN_IDS || "";
    const set = new Set(raw.split(",").map(s => s.trim()).filter(Boolean));
    return set.has(String(userId));
}

async function upsertUser(ctx) {
    const u = ctx.from || {};
    const tgUserId = String(u.id);
    await UserModel.updateOne(
        { tgUserId },
        {
            $set: {
                firstName: u.first_name || "",
                lastName: u.last_name || "",
                username: u.username || "",
                languageCode: u.language_code || "en"
            },
            $setOnInsert: { startedAt: new Date() }
        },
        { upsert: true }
    );
    return tgUserId;
}

function webAppUrl() {
    // /app is served by Express
    return `${process.env.BASE_URL}/app`;
}

function mainKeyboard() {
    return Markup.inlineKeyboard([
        [Markup.button.webApp("Open Cloud", webAppUrl())],
        [Markup.button.callback("My Files (count)", "MY_FILES_COUNT")],
        [Markup.button.callback("Limits", "LIMITS")]
    ]);
}

async function withLoading(ctx, fn) {
    const msg = await ctx.reply("Loading...");
    try {
        const out = await fn();
        // delete loading message after success
        await ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id).catch(() => { });
        return out;
    } catch (e) {
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `Error: ${e.message || e}`)
            .catch(() => { });
        throw e;
    }
}

export function startBot() {
    const bot = new Telegraf(process.env.BOT_TOKEN);

    bot.start(async (ctx) => {
        await upsertUser(ctx);
        await ctx.reply(
            "Cloud is ready.\nSend me files. Open the Cloud UI from the button below.",
            mainKeyboard()
        );
    });

    // “commandless” text handling (no slash)
    bot.hears(/^(menu|home)$/i, async (ctx) => {
        await upsertUser(ctx);
        await ctx.reply("Menu:", mainKeyboard());
    });

    // Save any file types
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
            else if (m.photo?.length) { kind = "photo"; obj = m.photo[m.photo.length - 1]; }

            const fileName = obj.file_name || (kind === "photo" ? "photo.jpg" : "");
            const mimeType = obj.mime_type || "";
            const fileSize = obj.file_size || 0;

            await FileModel.create({
                ownerTgUserId: userId,
                kind,
                tgFileId: obj.file_id,
                tgUniqueId: obj.file_unique_id || "",
                fileName,
                mimeType,
                fileSize,
                note: ""
            });

            await ctx.reply("Saved.", mainKeyboard());
        });
    });

    // Callbacks with editMessageText
    bot.action("MY_FILES_COUNT", async (ctx) => {
        await ctx.answerCbQuery();
        await withLoading(ctx, async () => {
            const userId = await upsertUser(ctx);
            const count = await FileModel.countDocuments({ ownerTgUserId: userId });
            await ctx.editMessageText(`You have ${count} saved files.`, mainKeyboard());
        });
    });

    bot.action("LIMITS", async (ctx) => {
        await ctx.answerCbQuery();
        // Keep it simple and honest in UI
        await ctx.editMessageText(
            "Limits depend on Bot API and file type.\nIf a file fails to upload or download, it is likely over the current Bot API limit.\nUse smaller files for best reliability.",
            mainKeyboard()
        );
    });

    // Admin broadcast (2-step: /broadcast then next message)
    const pendingBroadcast = new Set();

    bot.command("broadcast", async (ctx) => {
        if (!isAdmin(ctx.from?.id)) return;
        pendingBroadcast.add(String(ctx.from.id));
        await ctx.reply("Send the message you want to broadcast to all users.");
    });

    bot.on("text", async (ctx) => {
        const adminId = String(ctx.from?.id || "");
        if (!pendingBroadcast.has(adminId)) return;
        if (!isAdmin(adminId)) return;

        pendingBroadcast.delete(adminId);

        const text = ctx.message.text || "";
        const users = await UserModel.find().select({ tgUserId: 1 }).lean();

        const loading = await ctx.reply(`Broadcasting to ${users.length} users...`);
        let ok = 0, fail = 0;

        for (const u of users) {
            try {
                await ctx.telegram.sendMessage(u.tgUserId, text);
                ok++;
            } catch {
                fail++;
            }
        }

        await ctx.telegram.editMessageText(
            ctx.chat.id,
            loading.message_id,
            undefined,
            `Done. OK: ${ok}, Failed: ${fail}`
        ).catch(() => { });
    });

    bot.launch();
    console.log("Bot started");

    process.once("SIGINT", () => bot.stop("SIGINT"));
    process.once("SIGTERM", () => bot.stop("SIGTERM"));
}