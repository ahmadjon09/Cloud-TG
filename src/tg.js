export async function tgGetFile(token, file_id) {
    const r = await fetch(`https://api.telegram.org/bot${token}/getFile`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ file_id })
    });
    const data = await r.json();
    if (!data.ok) throw new Error(data.description || "getFile failed");
    return data.result; // { file_path }
}

export function tgFileUrl(token, file_path) {
    return `https://api.telegram.org/file/bot${token}/${file_path}`;
}