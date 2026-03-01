import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { webAppAuthMiddleware } from "./authWebApp.js";
import { FileModel } from "./models/File.js";
import { tgGetFile, tgFileUrl } from "./tg.js";
import { UserModel } from "./models/User.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export function startServer() {
    const app = express();
    const TG_FILE_MAX = 50 * 1024 * 1024;
    const ORIGIN = "http://localhost:5173";
    app.use(express.json({ limit: "1mb" }));

    app.use((_, res, next) => {
        res.setHeader(
            "Content-Security-Policy",
            [
                "default-src 'self'",
                "script-src 'self' 'unsafe-inline' https://telegram.org https://cdn.jsdelivr.net",
                "script-src-elem 'self' 'unsafe-inline' https://telegram.org https://cdn.jsdelivr.net",
                "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; " +
                "font-src 'self' https://cdnjs.cloudflare.com; " +
                "connect-src 'self' https: wss:",
                "img-src 'self' data: blob:",
                "frame-ancestors https://web.telegram.org https://t.me",
            ].join("; ")
        );
        next();
    });
    app.get('/hello', (_, res) => res.send('Hello!'))
    // Static HTML (single big page)
    app.use("/public", express.static(path.join(__dirname, "..", "public"), {
        setHeaders(res) {
            res.setHeader("Cache-Control", "no-store");
        }
    }));

    // WebApp entry page
    app.get("/app", (req, res) => {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.sendFile(path.join(__dirname, "..", "public", "app.html"));
    });

    // WebApp: list files (auth required)
    app.get("/api/files", webAppAuthMiddleware, async (req, res) => {
        const owner = req.webAppUser.id;
        const items = await FileModel.find({ ownerTgUserId: owner })
            .sort({ createdAt: -1 })
            .limit(500)
            .lean();

        res.json(items.map(x => ({
            id: String(x._id),
            kind: x.kind,
            fileName: x.fileName,
            mimeType: x.mimeType,
            fileSize: x.fileSize,
            note: x.note,
            createdAt: x.createdAt
        })));
    });

    app.get("/api/files/:id/preview", webAppAuthMiddleware, async (req, res) => {
        const owner = req.webAppUser.id;
        const file = await FileModel.findOne({ _id: req.params.id, ownerTgUserId: owner }).lean();
        if (!file) return res.status(404).json({ error: "Not found" });

        // Only preview media
        if (!["photo", "video", "audio"].includes(file.kind)) {
            return res.status(400).json({ error: "PREVIEW_NOT_SUPPORTED" });
        }

        if ((file.fileSize || 0) > TG_FILE_MAX) {
            return res.status(413).json({ error: "FILE_TOO_BIG_FOR_PREVIEW" });
        }

        try {
            const token = process.env.BOT_TOKEN;
            const tgFile = await tgGetFile(token, file.tgFileId);
            const url = tgFileUrl(token, tgFile.file_path);

            const range = req.headers.range; // e.g. "bytes=0-"
            const headers = {};
            if (range) headers["Range"] = range;

            const r = await fetch(url, { headers });

            if (!r.ok || !r.body) {
                return res.status(502).json({ error: "Telegram fetch failed" });
            }

            // Important for <video> seeking: forward status and range headers when present
            res.status(r.status); // 200 or 206

            const ct = file.mimeType || r.headers.get("content-type") || "application/octet-stream";
            res.setHeader("Content-Type", ct);

            // inline preview (NOT attachment)
            res.setHeader("Content-Disposition", "inline");

            const cr = r.headers.get("content-range");
            const al = r.headers.get("accept-ranges");
            const cl = r.headers.get("content-length");

            if (cr) res.setHeader("Content-Range", cr);
            if (al) res.setHeader("Accept-Ranges", al);
            if (cl) res.setHeader("Content-Length", cl);

            const reader = r.body.getReader();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                res.write(Buffer.from(value));
            }
            res.end();
        } catch (e) {
            const msg = String(e?.message || e);
            if (msg.includes("file is too big")) {
                return res.status(413).json({ error: "FILE_TOO_BIG_FOR_PREVIEW" });
            }
            return res.status(500).json({ error: "Server error" });
        }
    });
    // WebApp: rename/edit metadata
    app.patch("/api/files/:id", webAppAuthMiddleware, async (req, res) => {
        const owner = req.webAppUser.id;
        const { fileName, note } = req.body || {};

        const file = await FileModel.findOne({ _id: req.params.id, ownerTgUserId: owner });
        if (!file) return res.status(404).json({ error: "Not found" });

        if (typeof fileName === "string") file.fileName = fileName.slice(0, 200);
        if (typeof note === "string") file.note = note.slice(0, 500);

        await file.save();
        res.json({ ok: true });
    });

    app.get("/api/files/:id/download", webAppAuthMiddleware, async (req, res) => {
        const owner = req.webAppUser.id;
        const file = await FileModel.findOne({ _id: req.params.id, ownerTgUserId: owner }).lean();
        if (!file) return res.status(404).json({ error: "Not found" });

        // If you already stored fileSize, handle early
        if ((file.fileSize || 0) > TG_FILE_MAX) {
            return res.status(413).json({
                error: "FILE_TOO_BIG_FOR_DOWNLOAD",
                detail: "Telegram Bot API cannot download files larger than 50MB. Use /send instead."
            });
        }

        try {
            const token = process.env.BOT_TOKEN;

            const tgFile = await tgGetFile(token, file.tgFileId); // can throw: file is too big
            const url = tgFileUrl(token, tgFile.file_path);

            const r = await fetch(url);
            if (!r.ok || !r.body) return res.status(502).json({ error: "Telegram fetch failed" });

            res.setHeader("Content-Type", file.mimeType || "application/octet-stream");
            const name = file.fileName || "file";
            res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);

            const reader = r.body.getReader();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                res.write(Buffer.from(value));
            }
            res.end();
        } catch (e) {
            const msg = String(e?.message || e);
            if (msg.includes("file is too big")) {
                return res.status(413).json({
                    error: "FILE_TOO_BIG_FOR_DOWNLOAD",
                    detail: "Telegram Bot API cannot download files larger than 50MB. Use /send instead."
                });
            }
            return res.status(500).json({ error: "Server error" });
        }
    });

    //  Web users
    app.post("/api/login/:id", async (req, res) => {
        const id = req.params.id;
        if (!id) return res.status(400).json({ error: "ID_REQUIRED" });
        try {
            const user = await UserModel.findOne({ refCode: id });
            if (!user) return res.status(404).json({ error: "User not found" });
            res.json({ ok: true, user: { id: user.tgUserId, firstName: user.firstName, refCode: user.refCode } });
        } catch (error) {
            res.status(500).json({ error: "Server error" });
        }
    });

    // SEND to Telegram (by file id). Telegram API is called from backend, so token is safe.
    function pickTelegramSend(kind) {
        if (kind === "photo") return { method: "sendPhoto", field: "photo" };
        if (kind === "video") return { method: "sendVideo", field: "video" };
        if (kind === "audio") return { method: "sendAudio", field: "audio" };
        if (kind === "voice") return { method: "sendVoice", field: "voice" };
        return { method: "sendDocument", field: "document" };
    }

    app.post("/api/files/:id/send", webAppAuthMiddleware, async (req, res) => {
        try {
            const owner = req.webAppUser.id;
            const file = await FileModel.findOne({ _id: req.params.id, ownerTgUserId: owner }).lean();
            if (!file) return res.status(404).json({ error: "Not found" });

            const token = process.env.BOT_TOKEN;
            const chatId = owner;

            const { method, field } = pickTelegramSend(file.kind);
            const caption = file.note ? String(file.note).slice(0, 1024) : undefined;

            const payload = { chat_id: chatId };
            payload[field] = file.tgFileId; // file_id
            if (caption) payload.caption = caption;

            const tgRes = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            }).then(r => r.json());

            if (!tgRes.ok) {
                return res.status(502).json({ error: "Telegram send failed", detail: tgRes.description });
            }

            res.json({ ok: true, messageId: tgRes.result?.message_id });
        } catch (e) {
            res.status(500).json({ error: "Server error" });
        }
    });

    const port = Number(process.env.PORT || 5000);
    app.listen(port, () => console.log("HTTP on", port));
}