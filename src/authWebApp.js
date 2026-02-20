import crypto from "crypto";

// Parse "a=1&b=2" into map
function parseInitData(initData) {
    const params = new URLSearchParams(initData);
    const obj = {};
    for (const [k, v] of params.entries()) obj[k] = v;
    return obj;
}

function checkHmac(initData, botToken) {
    const data = parseInitData(initData);
    const hash = data.hash;
    if (!hash) return { ok: false, reason: "No hash" };
    delete data.hash;

    // Build data_check_string
    const keys = Object.keys(data).sort();
    const dataCheckString = keys.map(k => `${k}=${data[k]}`).join("\n");

    // secret_key = HMAC_SHA256("WebAppData", botToken)
    const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();

    const calcHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
    if (calcHash !== hash) return { ok: false, reason: "Bad hash" };

    return { ok: true, data };
}

export function webAppAuthMiddleware(req, res, next) {
    const token = process.env.BOT_TOKEN;
    const initData = req.header("x-telegram-init-data") || req.query.initData || "";
    if (!initData) return res.status(401).json({ error: "Missing initData" });

    const v = checkHmac(initData, token);
    if (!v.ok) return res.status(401).json({ error: "Invalid initData", reason: v.reason });

    // Optional: freshness check (recommended)
    // auth_date is seconds
    const authDate = Number(v.data.auth_date || 0);
    if (!authDate) return res.status(401).json({ error: "Missing auth_date" });
    const ageSec = Math.floor(Date.now() / 1000) - authDate;
    if (ageSec > 60 * 60) return res.status(401).json({ error: "initData expired" });

    // user is JSON string
    const user = v.data.user ? JSON.parse(v.data.user) : null;
    if (!user?.id) return res.status(401).json({ error: "No user in initData" });

    req.webAppUser = {
        id: String(user.id),
        firstName: user.first_name || "",
        lastName: user.last_name || "",
        username: user.username || ""
    };

    next();
}