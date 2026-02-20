import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { webAppAuthMiddleware } from "./authWebApp.js";
import { FileModel } from "./models/File.js";
import { tgGetFile, tgFileUrl } from "./tg.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function startServer() {
    const app = express();
    app.use(express.json({ limit: "1mb" }));

    app.get('/hello', (_, res) => res.send('Hello!'))
    // Static HTML (single big page)
    app.use("/public", express.static(path.join(__dirname, "..", "public"), {
        setHeaders(res) {
            res.setHeader("Cache-Control", "no-store");
        }
    }));

    // WebApp entry page
    app.get("/app", (req, res) => {
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

    // WebApp: download (proxy stream). Token never leaks to frontend.
    app.get("/api/files/:id/download", webAppAuthMiddleware, async (req, res) => {
        const owner = req.webAppUser.id;
        const file = await FileModel.findOne({ _id: req.params.id, ownerTgUserId: owner }).lean();
        if (!file) return res.status(404).json({ error: "Not found" });

        const token = process.env.BOT_TOKEN;
        const tgFile = await tgGetFile(token, file.tgFileId);
        const url = tgFileUrl(token, tgFile.file_path);

        const r = await fetch(url);
        if (!r.ok || !r.body) return res.status(502).json({ error: "Telegram fetch failed" });

        res.setHeader("Content-Type", file.mimeType || "application/octet-stream");
        const name = file.fileName || "file";
        res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(name)}"`);

        // Node stream bridge
        const reader = r.body.getReader();
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(Buffer.from(value));
        }
        res.end();
    });

    const port = Number(process.env.PORT || 5000);
    app.listen(port, () => console.log("HTTP on", port));
}