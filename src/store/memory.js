// store/memory.js — zero-dependency in-memory store
// Used for DEMO_MODE / local UI development when MongoDB is not available.
// Nothing here is persistent: restarting the process resets the data.
import crypto from "crypto";
import { categoryOf, extensionOf, guessMime } from "../utils/fileType.js";

const now = () => new Date();

const id24 = () => crypto.randomBytes(12).toString("hex"); // looks like a Mongo ObjectId

const DEMO_NAMES = {
  images: [
    ["Sunset over the sea.jpg", 2_412_331],
    ["Family trip 2025.png", 4_902_112],
    ["Screenshot 2026-01-14.png", 812_004],
    ["Product sketch.webp", 1_120_455],
    ["Tashkent skyline.jpg", 3_204_881],
    ["Whiteboard notes.png", 1_845_002],
    ["Passport scan.jpg", 998_221],
    ["Logo draft.svg", 24_410],
    ["Birthday cake.jpg", 2_774_120],
    ["Mountain hike.gif", 6_120_900]
  ],
  videos: [
    ["Presentation recording.mp4", 48_211_004],
    ["Cat being dramatic.mp4", 12_004_112],
    ["Wedding highlights.mov", 39_884_001],
    ["How to deploy in 60s.webm", 8_120_442],
    ["Drone flight 4K.mp4", 47_998_120],
    ["Team intro.mkv", 22_100_004]
  ],
  audio: [
    ["Lo-fi study beat.mp3", 5_120_004],
    ["Voice memo — idea.m4a", 1_204_881],
    ["Podcast episode 12.mp3", 28_004_112],
    ["Guitar cover.ogg", 7_884_120],
    ["Meeting recording.wav", 33_120_004],
    ["Nightingale.flac", 18_004_991]
  ],
  documents: [
    ["Annual report 2025.pdf", 4_120_884],
    ["Contract — signed.pdf", 1_884_002],
    ["Budget Q3.xlsx", 288_410],
    ["Roadmap.pptx", 9_120_004],
    ["Meeting notes.docx", 122_884],
    ["Reading list.txt", 4_120],
    ["api-reference.md", 32_004],
    ["Invoice-2026-02.pdf", 240_112],
    ["CV — updated.pdf", 612_004]
  ],
  archives: [
    ["project-backup.zip", 41_220_004],
    ["photos-2025.rar", 38_004_112],
    ["node_modules.7z", 22_884_001],
    ["design-assets.tar.gz", 15_120_004],
    ["old-site.zip", 8_004_912]
  ]
};

const KIND_BY_CATEGORY = {
  images: "photo",
  videos: "video",
  audio: "audio",
  documents: "document",
  archives: "document"
};

const NOTES = [
  "",
  "",
  "",
  "Shared by the team",
  "Keep until the end of the quarter",
  "Important — do not delete",
  "Draft version",
  "Backup before the update"
];

function defaultSettings() {
  return {
    notifications: true,
    privateByDefault: false,
    autoExpire: null,
    theme: "auto",
    view: "grid",
    density: "comfortable",
    desktopMode: true,
    autoFullscreen: true,
    autoThumbnails: true
  };
}

export function createMemoryStore({ seed = true, demoUserId = "100000001" } = {}) {
  const users = new Map(); // tgUserId -> user
  const files = new Map(); // id -> file
  const broadcasts = [];

  function publicUser(u) {
    if (!u) return null;
    return {
      id: u.tgUserId,
      firstName: u.firstName,
      lastName: u.lastName,
      username: u.username,
      photoUrl: u.photoUrl,
      language: u.language,
      languageCode: u.languageCode,
      startedAt: u.startedAt,
      lastActiveAt: u.lastActiveAt,
      storageUsed: u.storageUsed,
      fileCount: u.fileCount,
      filesDeleted: u.filesDeleted,
      isBlocked: !!u.isBlocked,
      settings: { ...defaultSettings(), ...(u.settings || {}) }
    };
  }

  function publicFile(f) {
    if (!f) return null;
    return {
      id: f.id,
      ownerId: f.ownerTgUserId,
      kind: f.kind,
      fileName: f.fileName,
      mimeType: f.mimeType || guessMime(f.fileName, f.kind),
      fileSize: f.fileSize,
      note: f.note,
      ext: extensionOf(f.fileName),
      category: categoryOf(f.fileName, f.kind),
      isPrivate: !!f.isPrivate,
      isFavorite: !!f.isFavorite,
      isDeleted: !!f.isDeleted,
      folderId: f.folderId || null,
      sharedWith: f.sharedWith || [],
      expiresAt: f.expiresAt || null,
      createdAt: f.createdAt,
      updatedAt: f.updatedAt,
      deletedAt: f.deletedAt || null,
      demo: true
    };
  }

  // ---------------- seed ----------------
  function seedData() {
    const ownerId = demoUserId;
    const user = {
      tgUserId: ownerId,
      firstName: "Demo",
      lastName: "User",
      username: "demo_user",
      photoUrl: "",
      language: "en",
      languageCode: "en",
      startedAt: new Date(Date.now() - 96 * 86_400_000),
      lastActiveAt: now(),
      storageUsed: 0,
      fileCount: 0,
      filesDeleted: 0,
      isBlocked: false,
      settings: defaultSettings()
    };
    users.set(ownerId, user);

    // a few extra users so the admin panel has something to show
    const extras = [
      ["100000002", "Alisher", "Karimov", "alisher", "uz"],
      ["100000003", "Maria", "Ivanova", "maria_i", "ru"],
      ["100000004", "Chen", "Wei", "chenwei", "ch"],
      ["100000005", "Carlos", "Mendoza", "carlos_m", "es"],
      ["100000006", "Julie", "Moreau", "julie", "fr"],
      ["100000007", "John", "Smith", "john", "en"]
    ];
    extras.forEach(([id, first, last, username, lang], i) => {
      users.set(id, {
        tgUserId: id,
        firstName: first,
        lastName: last,
        username,
        photoUrl: "",
        language: lang,
        languageCode: lang,
        startedAt: new Date(Date.now() - (80 - i * 7) * 86_400_000),
        lastActiveAt: new Date(Date.now() - i * 3_600_000),
        storageUsed: 0,
        fileCount: 0,
        filesDeleted: 0,
        isBlocked: false,
        settings: defaultSettings()
      });
    });

    let index = 0;
    for (const [category, list] of Object.entries(DEMO_NAMES)) {
      for (const [name, size] of list) {
        index++;
        // spread across the last 75 days
        const created = new Date(Date.now() - (index * 1.7) * 86_400_000 - (index % 5) * 3_600_000);
        // the first 3 images and 1 video of the owner are favorites
        const isFavorite = (category === "images" && index <= 3) || (category === "videos" && index === 11);
        const owner = index % 7 === 0 ? extras[index % extras.length][0] : ownerId;
        const file = {
          id: id24(),
          ownerTgUserId: owner,
          kind: KIND_BY_CATEGORY[category],
          tgFileId: `demo_${index}`,
          tgUniqueId: `demo_unique_${index}`,
          fileName: name,
          mimeType: guessMime(name, KIND_BY_CATEGORY[category]),
          fileSize: size,
          note: NOTES[index % NOTES.length],
          isPrivate: index % 6 === 0,
          isFavorite: owner === ownerId && isFavorite,
          isDeleted: false,
          deletedAt: null,
          folderId: null,
          expiresAt: index % 9 === 0 ? new Date(Date.now() + 12 * 86_400_000) : null,
          sharedWith: [],
          createdAt: created,
          updatedAt: created
        };
        files.set(file.id, file);
        const u = users.get(owner);
        if (u && !file.isDeleted) {
          u.fileCount++;
          u.storageUsed += size;
        }
      }
    }

    // one file already in the trash
    const trashed = {
      id: id24(),
      ownerTgUserId: ownerId,
      kind: "document",
      tgFileId: "demo_trashed",
      tgUniqueId: "demo_unique_trashed",
      fileName: "old-resume.pdf",
      mimeType: "application/pdf",
      fileSize: 320_004,
      note: "",
      isPrivate: false,
      isFavorite: false,
      isDeleted: true,
      deletedAt: new Date(Date.now() - 2 * 86_400_000),
      folderId: null,
      expiresAt: null,
      sharedWith: [],
      createdAt: new Date(Date.now() - 40 * 86_400_000),
      updatedAt: new Date(Date.now() - 2 * 86_400_000)
    };
    files.set(trashed.id, trashed);
  }

  if (seed) seedData();

  // ---------------- users ----------------
  async function getUser(id) {
    return publicUser(users.get(String(id)));
  }

  async function ensureUser(profile) {
    const id = String(profile.id);
    let u = users.get(id);
    if (!u) {
      u = {
        tgUserId: id,
        firstName: profile.firstName || "",
        lastName: profile.lastName || "",
        username: (profile.username || "").toLowerCase(),
        photoUrl: profile.photoUrl || "",
        language: profile.language || "en",
        languageCode: profile.languageCode || "",
        startedAt: now(),
        lastActiveAt: now(),
        storageUsed: 0,
        fileCount: 0,
        filesDeleted: 0,
        isBlocked: false,
        settings: defaultSettings()
      };
      users.set(id, u);
    } else {
      if (profile.firstName) u.firstName = profile.firstName;
      if (profile.lastName) u.lastName = profile.lastName;
      if (profile.username) u.username = profile.username.toLowerCase();
      if (profile.photoUrl) u.photoUrl = profile.photoUrl;
      u.lastActiveAt = now();
    }
    return publicUser(u);
  }

  async function updateUser(id, patch) {
    const u = users.get(String(id));
    if (!u) return null;
    for (const key of ["firstName", "lastName", "username", "photoUrl", "language", "languageCode", "isBlocked"]) {
      if (patch[key] !== undefined) u[key] = patch[key];
    }
    if (patch.settings) Object.assign(u.settings, patch.settings);
    return publicUser(u);
  }

  async function listUsers({ q = "", sort = "newest", limit = 30, skip = 0 } = {}) {
    let list = [...users.values()];
    if (q) {
      const needle = q.toLowerCase();
      list = list.filter(u =>
        `${u.firstName} ${u.lastName} ${u.username} ${u.tgUserId}`.toLowerCase().includes(needle)
      );
    }
    const cmp = {
      newest: (a, b) => (b.lastActiveAt || 0) - (a.lastActiveAt || 0),
      oldest: (a, b) => (a.lastActiveAt || 0) - (b.lastActiveAt || 0),
      files: (a, b) => b.fileCount - a.fileCount,
      size: (a, b) => b.storageUsed - a.storageUsed
    }[sort] || ((a, b) => (b.lastActiveAt || 0) - (a.lastActiveAt || 0));
    list.sort(cmp);
    return { items: list.slice(skip, skip + limit).map(publicUser), total: list.length };
  }

  async function countUsers({ q = "" } = {}) {
    return (await listUsers({ q, limit: Number.MAX_SAFE_INTEGER })).total;
  }

  // ---------------- files ----------------
  function matchFile(f, opts) {
    if (opts.owner && String(f.ownerTgUserId) !== String(opts.owner)) return false;
    if (opts.q && !f.fileName.toLowerCase().includes(String(opts.q).toLowerCase())) return false;
    if (opts.kind && f.kind !== opts.kind) return false;
    if (opts.category && categoryOf(f.fileName, f.kind) !== opts.category) return false;
    if (opts.trash === true && !f.isDeleted) return false;
    if ((opts.trash === false || opts.trash === undefined) && f.isDeleted) return false;
    if (opts.favorite === true && !f.isFavorite) return false;
    if (opts.private === true && !f.isPrivate) return false;
    if (opts.private === false && f.isPrivate) return false;
    if (opts.expiresBefore && (!f.expiresAt || f.expiresAt > new Date(opts.expiresBefore))) return false;
    return true;
  }

  const SORT_FN = {
    newest: (a, b) => b.createdAt - a.createdAt,
    oldest: (a, b) => a.createdAt - b.createdAt,
    nameAsc: (a, b) => a.fileName.localeCompare(b.fileName),
    nameDesc: (a, b) => b.fileName.localeCompare(a.fileName),
    largest: (a, b) => b.fileSize - a.fileSize,
    smallest: (a, b) => a.fileSize - b.fileSize
  };

  async function listFiles(opts = {}) {
    const { limit = 40, skip = 0, sort = "newest" } = opts;
    const matched = [...files.values()].filter(f => matchFile(f, opts));
    matched.sort(SORT_FN[sort] || SORT_FN.newest);
    return { items: matched.slice(skip, skip + limit).map(publicFile), total: matched.length };
  }

  async function getFile(id) {
    return publicFile(files.get(String(id)));
  }

  async function getFileOwned(id, owner) {
    const f = files.get(String(id));
    if (!f || String(f.ownerTgUserId) !== String(owner)) return null;
    return publicFile(f);
  }

  async function createFile(data) {
    const file = {
      id: id24(),
      ownerTgUserId: String(data.ownerId),
      kind: data.kind || "document",
      tgFileId: data.tgFileId || `mem_${id24()}`,
      tgUniqueId: data.tgUniqueId || "",
      fileName: (data.fileName || "").slice(0, 200),
      mimeType: data.mimeType || guessMime(data.fileName, data.kind),
      fileSize: data.fileSize || 0,
      note: (data.note || "").slice(0, 500),
      isPrivate: !!data.isPrivate,
      isFavorite: !!data.isFavorite,
      isDeleted: false,
      deletedAt: null,
      folderId: data.folderId || null,
      expiresAt: data.expiresAt || null,
      sharedWith: data.sharedWith || [],
      createdAt: now(),
      updatedAt: now()
    };
    files.set(file.id, file);
    const u = users.get(file.ownerTgUserId);
    if (u) {
      u.fileCount++;
      u.storageUsed += file.fileSize;
    }
    return publicFile(file);
  }

  async function updateFile(id, patch) {
    const f = files.get(String(id));
    if (!f) return null;
    for (const key of ["fileName", "note", "isPrivate", "isFavorite", "folderId", "expiresAt", "sharedWith"]) {
      if (patch[key] !== undefined) f[key] = patch[key];
    }
    f.updatedAt = now();
    return publicFile(f);
  }

  async function setDeleted(ids, owner, deleted) {
    const list = Array.isArray(ids) ? ids : [ids];
    let n = 0;
    for (const id of list) {
      const f = files.get(String(id));
      if (!f) continue;
      if (owner && String(f.ownerTgUserId) !== String(owner)) continue;
      const wasDeleted = !!f.isDeleted;
      f.isDeleted = !!deleted;
      f.deletedAt = deleted ? now() : null;
      f.updatedAt = now();
      const u = users.get(f.ownerTgUserId);
      if (u && wasDeleted !== !!deleted) {
        u.storageUsed += deleted ? -f.fileSize : f.fileSize;
        u.fileCount += deleted ? -1 : 1;
        if (deleted) u.filesDeleted++;
      }
      n++;
    }
    return n;
  }

  async function deleteForever(ids, owner) {
    const list = Array.isArray(ids) ? ids : [ids];
    let n = 0;
    for (const id of list) {
      const f = files.get(String(id));
      if (!f) continue;
      if (owner && String(f.ownerTgUserId) !== String(owner)) continue;
      files.delete(String(id));
      const u = users.get(f.ownerTgUserId);
      if (u && !f.isDeleted) {
        u.fileCount = Math.max(0, u.fileCount - 1);
        u.storageUsed = Math.max(0, u.storageUsed - f.fileSize);
      }
      n++;
    }
    return n;
  }

  async function emptyTrash(owner) {
    let n = 0;
    for (const [id, f] of files) {
      if (f.isDeleted && (!owner || String(f.ownerTgUserId) === String(owner))) {
        files.delete(id);
        n++;
      }
    }
    return n;
  }

  async function deleteUserFiles(owner) {
    let n = 0;
    for (const [id, f] of files) {
      if (String(f.ownerTgUserId) === String(owner)) {
        files.delete(id);
        n++;
      }
    }
    const u = users.get(String(owner));
    if (u) {
      u.fileCount = 0;
      u.storageUsed = 0;
    }
    return n;
  }

  async function userStats(owner) {
    let files2 = 0;
    let size = 0;
    for (const f of files.values()) {
      if (String(f.ownerTgUserId) === String(owner) && !f.isDeleted) {
        files2++;
        size += f.fileSize;
      }
    }
    return { files: files2, size };
  }

  // ---------------- admin ----------------
  async function adminOverview() {
    const allUsers = [...users.values()];
    const live = [...files.values()].filter(f => !f.isDeleted);
    const byKindMap = new Map();
    const uploadsMap = new Map();
    const sinceToday = Date.now() - 86_400_000;
    const since7d = Date.now() - 7 * 86_400_000;
    const since14d = Date.now() - 14 * 86_400_000;

    for (let d = 14; d >= 0; d--) {
      const key = new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);
      uploadsMap.set(key, { _id: key, count: 0, size: 0 });
    }
    for (const f of live) {
      const k = byKindMap.get(f.kind) || { kind: f.kind, count: 0, size: 0 };
      k.count++;
      k.size += f.fileSize;
      byKindMap.set(f.kind, k);

      if (f.createdAt.getTime() >= since14d) {
        const key = f.createdAt.toISOString().slice(0, 10);
        const e = uploadsMap.get(key);
        if (e) {
          e.count++;
          e.size += f.fileSize;
        }
      }
    }

    return {
      users: allUsers.length,
      files: live.length,
      size: live.reduce((a, f) => a + f.fileSize, 0),
      activeToday: allUsers.filter(u => (u.lastActiveAt?.getTime?.() || 0) >= sinceToday).length,
      new7d: allUsers.filter(u => (u.startedAt?.getTime?.() || 0) >= since7d).length,
      avg: allUsers.length ? Math.round((live.length / allUsers.length) * 10) / 10 : 0,
      byKind: [...byKindMap.values()],
      uploads: [...uploadsMap.values()],
      topUsers: allUsers
        .slice()
        .sort((a, b) => b.fileCount - a.fileCount)
        .slice(0, 8)
        .map(u => ({
          id: u.tgUserId,
          name: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.username || `#${u.tgUserId}`,
          username: u.username || "",
          fileCount: u.fileCount || 0,
          storageUsed: u.storageUsed || 0
        }))
    };
  }

  async function adminListFiles({ q = "", kind = "", owner = "", limit = 40, skip = 0, sort = "newest" } = {}) {
    let list = [...files.values()].filter(f => !f.isDeleted);
    if (q) list = list.filter(f => f.fileName.toLowerCase().includes(q.toLowerCase()));
    if (kind) list = list.filter(f => f.kind === kind);
    if (owner) list = list.filter(f => String(f.ownerTgUserId) === String(owner));
    list.sort(SORT_FN[sort] || SORT_FN.newest);
    const owners = new Map([...users.values()].map(u => [u.tgUserId, [u.firstName, u.lastName].filter(Boolean).join(" ") || u.username || `#${u.tgUserId}`]));
    return {
      items: list.slice(skip, skip + limit).map(f => ({ ...publicFile(f), ownerName: owners.get(f.ownerTgUserId) || f.ownerTgUserId })),
      total: list.length
    };
  }

  async function broadcastTargets() {
    return [...users.values()].filter(u => !u.isBlocked).map(u => u.tgUserId);
  }

  async function cleanupExpired() {
    const nowTs = Date.now();
    let n = 0;
    for (const [id, f] of files) {
      if (f.expiresAt && f.expiresAt.getTime() < nowTs) {
        files.delete(id);
        n++;
      }
    }
    return n;
  }

  async function ping() {
    return true;
  }

  return {
    driver: "memory",
    getUser,
    ensureUser,
    updateUser,
    listUsers,
    countUsers,
    listFiles,
    getFile,
    getFileOwned,
    createFile,
    updateFile,
    setDeleted,
    deleteForever,
    emptyTrash,
    deleteUserFiles,
    userStats,
    adminOverview,
    adminListFiles,
    broadcastTargets,
    cleanupExpired,
    ping,
    // demo-only helpers
    _logBroadcast(entry) {
      broadcasts.unshift(entry);
      broadcasts.length = Math.min(broadcasts.length, 10);
    },
    _broadcasts() {
      return broadcasts;
    }
  };
}
