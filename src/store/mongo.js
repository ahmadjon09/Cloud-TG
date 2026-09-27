// store/mongo.js — MongoDB (mongoose) implementation of the app store
import { FileModel } from "../models/File.js";
import { UserModel } from "../models/User.js";
import { categoryOf, extensionOf, guessMime } from "../utils/fileType.js";

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const USER_PUBLIC = "tgUserId firstName lastName username photoUrl language languageCode startedAt lastActiveAt storageUsed fileCount filesDeleted settings isBlocked";

function toPublicFile(doc) {
  if (!doc) return null;
  const d = typeof doc.toObject === "function" ? doc.toObject() : doc;
  return {
    id: String(d._id),
    ownerId: String(d.ownerTgUserId),
    kind: d.kind || "document",
    fileName: d.fileName || "",
    mimeType: d.mimeType || guessMime(d.fileName, d.kind),
    fileSize: d.fileSize || 0,
    note: d.note || "",
    ext: extensionOf(d.fileName),
    category: categoryOf(d.fileName, d.kind),
    isPrivate: !!d.isPrivate,
    isFavorite: !!d.isFavorite,
    isDeleted: !!d.isDeleted,
    folderId: d.folderId || null,
    sharedWith: d.sharedWith || [],
    expiresAt: d.expiresAt || null,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    deletedAt: d.deletedAt || null
  };
}

function toPublicUser(doc) {
  if (!doc) return null;
  const d = typeof doc.toObject === "function" ? doc.toObject() : doc;
  return {
    id: String(d.tgUserId),
    firstName: d.firstName || "",
    lastName: d.lastName || "",
    username: d.username || "",
    photoUrl: d.photoUrl || "",
    language: d.language || "en",
    languageCode: d.languageCode || "",
    startedAt: d.startedAt || d.createdAt,
    lastActiveAt: d.lastActiveAt || null,
    storageUsed: d.storageUsed || 0,
    fileCount: d.fileCount || 0,
    filesDeleted: d.filesDeleted || 0,
    isBlocked: !!d.isBlocked,
    settings: {
      notifications: d.settings?.notifications !== false,
      privateByDefault: !!d.settings?.privateByDefault,
      autoExpire: d.settings?.autoExpire ?? null,
      theme: d.settings?.theme || "auto",
      view: d.settings?.view || "grid",
      density: d.settings?.density || "comfortable",
      desktopMode: d.settings?.desktopMode !== false,
      autoFullscreen: d.settings?.autoFullscreen !== false,
      autoThumbnails: d.settings?.autoThumbnails !== false
    }
  };
}

const SORTS = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  nameAsc: { fileName: 1 },
  nameDesc: { fileName: -1 },
  largest: { fileSize: -1 },
  smallest: { fileSize: 1 }
};

export function createMongoStore() {
  // ---------- users ----------
  async function getUser(id) {
    return toPublicUser(await UserModel.findOne({ tgUserId: String(id) }).lean());
  }

  async function ensureUser(profile) {
    const id = String(profile.id);
    const now = new Date();
    const fields = {
      firstName: profile.firstName || "",
      lastName: profile.lastName || "",
      username: (profile.username || "").toLowerCase(),
      photoUrl: profile.photoUrl || "",
      languageCode: profile.languageCode || "",
      lastActiveAt: now
    };
    const existing = await UserModel.findOne({ tgUserId: id });
    if (existing) {
      await UserModel.updateOne({ tgUserId: id }, { $set: fields });
      return getUser(id);
    }
    try {
      await UserModel.create({
        tgUserId: id,
        ...fields,
        language: profile.language || "en",
        startedAt: now,
        storageUsed: 0,
        fileCount: 0,
        folderIds: [],
        settings: {}
      });
    } catch (e) {
      // race: created between find and create
      if (!String(e.message).includes("duplicate")) throw e;
      await UserModel.updateOne({ tgUserId: id }, { $set: fields });
    }
    return getUser(id);
  }

  async function updateUser(id, patch) {
    const allowed = {};
    for (const key of ["firstName", "lastName", "username", "photoUrl", "language", "languageCode", "isBlocked", "lastActiveAt"]) {
      if (patch[key] !== undefined) allowed[key] = patch[key];
    }
    if (patch.settings && typeof patch.settings === "object") {
      for (const [k, v] of Object.entries(patch.settings)) allowed[`settings.${k}`] = v;
    }
    if (!Object.keys(allowed).length) return getUser(id);
    await UserModel.updateOne({ tgUserId: String(id) }, { $set: allowed });
    return getUser(id);
  }

  function userFilter(q) {
    const filter = {};
    if (q) {
      const rx = new RegExp(escapeRegex(q), "i");
      filter.$or = [{ firstName: rx }, { lastName: rx }, { username: rx }, { tgUserId: rx }];
    }
    return filter;
  }

  async function listUsers({ q = "", sort = "newest", limit = 30, skip = 0 } = {}) {
    const filter = userFilter(q);
    const sortSpec =
      sort === "oldest" ? { lastActiveAt: 1 }
        : sort === "files" ? { fileCount: -1 }
          : sort === "size" ? { storageUsed: -1 }
            : { lastActiveAt: -1 };
    const [items, total] = await Promise.all([
      UserModel.find(filter).sort(sortSpec).skip(skip).limit(limit).select(USER_PUBLIC).lean(),
      UserModel.countDocuments(filter)
    ]);
    return { items: items.map(toPublicUser), total };
  }

  async function countUsers({ q = "" } = {}) {
    return UserModel.countDocuments(userFilter(q));
  }

  // ---------- files ----------
  function fileFilter(opts) {
    const filter = {};
    if (opts.owner) filter.ownerTgUserId = String(opts.owner);
    if (opts.q) filter.fileName = new RegExp(escapeRegex(opts.q), "i");
    if (opts.kind) filter.kind = opts.kind;
    if (opts.trash === true) filter.isDeleted = true;
    else if (opts.trash === false || opts.trash === undefined) filter.isDeleted = { $ne: true };
    if (opts.favorite === true) filter.isFavorite = true;
    if (opts.private === true) filter.isPrivate = true;
    else if (opts.private === false) filter.isPrivate = false;
    if (opts.folderId !== undefined) filter.folderId = opts.folderId;
    if (opts.expiresBefore) filter.expiresAt = { $ne: null, $lt: new Date(opts.expiresBefore) };
    return filter;
  }

  async function listFiles(opts = {}) {
    const { limit = 40, skip = 0, sort = "newest" } = opts;
    const filter = fileFilter(opts);
    const total = await FileModel.countDocuments(filter);

    // limit === 0 → count-only (used by the counters): never pull whole collections
    if (limit === 0) return { items: [], total };

    // category is derived (kind + extension) — filter in memory for correctness
    if (opts.category) {
      const all = await FileModel.find(filter).sort(SORTS[sort] || SORTS.newest).lean();
      const matched = all.filter(f => categoryOf(f.fileName, f.kind) === opts.category);
      return { items: matched.slice(skip, skip + limit).map(toPublicFile), total: matched.length };
    }

    const items = await FileModel.find(filter)
      .sort(SORTS[sort] || SORTS.newest)
      .skip(skip)
      .limit(limit)
      .lean();
    return { items: items.map(toPublicFile), total };
  }

  /** Single-pass counters for the sidebar badges (`/api/me`, `/api/files/counts`). */
  async function countByCategory(owner) {
    const rows = await FileModel.find({ ownerTgUserId: String(owner) })
      .select("fileName kind isFavorite isDeleted")
      .lean();
    const counts = { all: 0, images: 0, videos: 0, audio: 0, documents: 0, archives: 0, favorites: 0, trash: 0 };
    for (const f of rows) {
      if (f.isDeleted) {
        counts.trash++;
        continue;
      }
      counts.all++;
      counts[categoryOf(f.fileName, f.kind)] = (counts[categoryOf(f.fileName, f.kind)] || 0) + 1;
      if (f.isFavorite) counts.favorites++;
    }
    return counts;
  }

  async function getFile(id) {
    if (!String(id).match(/^[a-f\d]{24}$/i)) return null;
    return toPublicFile(await FileModel.findById(id).lean());
  }

  async function getFileOwned(id, owner) {
    if (!String(id).match(/^[a-f\d]{24}$/i)) return null;
    return toPublicFile(await FileModel.findOne({ _id: id, ownerTgUserId: String(owner) }).lean());
  }

  // Server-only lookup: never include Telegram identifiers in public API JSON.
  async function getFileForTransfer(id, owner) {
    if (!String(id).match(/^[a-f\d]{24}$/i)) return null;
    const doc = await FileModel.findOne({ _id: id, ownerTgUserId: String(owner) }).lean();
    return doc ? { ...toPublicFile(doc), tgFileId: doc.tgFileId } : null;
  }

  async function createFile(data) {
    const doc = await FileModel.create({
      ownerTgUserId: String(data.ownerId),
      kind: data.kind || "document",
      tgFileId: data.tgFileId,
      tgUniqueId: data.tgUniqueId || "",
      fileName: (data.fileName || "").slice(0, 200),
      mimeType: data.mimeType || guessMime(data.fileName, data.kind),
      fileSize: data.fileSize || 0,
      note: (data.note || "").slice(0, 500),
      isPrivate: !!data.isPrivate,
      isFavorite: !!data.isFavorite,
      expiresAt: data.expiresAt || null,
      folderId: data.folderId || null,
      sharedWith: data.sharedWith || []
    });
    await UserModel.updateOne(
      { tgUserId: String(data.ownerId) },
      { $inc: { storageUsed: data.fileSize || 0, fileCount: 1 } }
    );
    return toPublicFile(doc.toObject());
  }

  async function updateFile(id, patch) {
    const allowed = {};
    for (const key of ["fileName", "note", "isPrivate", "isFavorite", "folderId", "expiresAt", "sharedWith"]) {
      if (patch[key] !== undefined) allowed[key] = patch[key];
    }
    if (!Object.keys(allowed).length) return getFile(id);
    const doc = await FileModel.findOneAndUpdate({ _id: id }, { $set: allowed }, { new: true }).lean();
    return toPublicFile(doc);
  }

  async function setDeleted(ids, owner, deleted) {
    const list = Array.isArray(ids) ? ids : [ids];
    const filter = { _id: { $in: list } };
    if (owner) filter.ownerTgUserId = String(owner);
    const docs = await FileModel.find(filter).lean();
    if (!docs.length) return 0;
    await FileModel.updateMany(filter, {
      $set: { isDeleted: !!deleted, deletedAt: deleted ? new Date() : null }
    });
    if (owner) {
      const delta = docs.reduce((a, d) => a + (d.fileSize || 0), 0) * (deleted ? -1 : 1);
      await UserModel.updateOne(
        { tgUserId: String(owner) },
        { $inc: { storageUsed: delta, fileCount: (deleted ? -1 : 1) * docs.length, filesDeleted: deleted ? docs.length : 0 } }
      );
    }
    return docs.length;
  }

  async function deleteForever(ids, owner) {
    const list = Array.isArray(ids) ? ids : [ids];
    const filter = { _id: { $in: list } };
    if (owner) filter.ownerTgUserId = String(owner);
    const docs = await FileModel.find(filter).lean();
    if (!docs.length) return 0;
    await FileModel.deleteMany(filter);
    if (owner) {
      const notDeleted = docs.filter(d => !d.isDeleted).length;
      const size = docs.filter(d => !d.isDeleted).reduce((a, d) => a + (d.fileSize || 0), 0);
      await UserModel.updateOne(
        { tgUserId: String(owner) },
        { $inc: { storageUsed: -size, fileCount: -notDeleted } }
      );
    }
    return docs.length;
  }

  async function emptyTrash(owner) {
    const docs = await FileModel.find({ ownerTgUserId: String(owner), isDeleted: true }).lean();
    if (!docs.length) return 0;
    await FileModel.deleteMany({ _id: { $in: docs.map(d => d._id) } });
    return docs.length;
  }

  async function deleteUserFiles(owner) {
    const r = await FileModel.deleteMany({ ownerTgUserId: String(owner) });
    await UserModel.updateOne({ tgUserId: String(owner) }, { $set: { storageUsed: 0, fileCount: 0 } });
    return r.deletedCount || 0;
  }

  async function userStats(owner) {
    const agg = await FileModel.aggregate([
      { $match: { ownerTgUserId: String(owner), isDeleted: { $ne: true } } },
      {
        $group: {
          _id: null,
          files: { $sum: 1 },
          size: { $sum: "$fileSize" }
        }
      }
    ]);
    return {
      files: agg[0]?.files || 0,
      size: agg[0]?.size || 0
    };
  }

  // ---------- admin ----------
  async function adminOverview() {
    const sinceToday = new Date(Date.now() - 86_400_000);
    const since7d = new Date(Date.now() - 7 * 86_400_000);
    const since14d = new Date(Date.now() - 14 * 86_400_000);

    const [users, files, sizeAgg, activeToday, new7d, byKind, uploads, topUsers] = await Promise.all([
      UserModel.countDocuments({}),
      FileModel.countDocuments({ isDeleted: { $ne: true } }),
      FileModel.aggregate([
        { $match: { isDeleted: { $ne: true } } },
        { $group: { _id: null, total: { $sum: "$fileSize" } } }
      ]),
      UserModel.countDocuments({ lastActiveAt: { $gte: sinceToday } }),
      UserModel.countDocuments({ startedAt: { $gte: since7d } }),
      FileModel.aggregate([
        { $match: { isDeleted: { $ne: true } } },
        { $group: { _id: "$kind", count: { $sum: 1 }, size: { $sum: "$fileSize" } } },
        { $sort: { count: -1 } }
      ]),
      FileModel.aggregate([
        { $match: { createdAt: { $gte: since14d } } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            count: { $sum: 1 },
            size: { $sum: "$fileSize" }
          }
        },
        { $sort: { _id: 1 } }
      ]),
      UserModel.find({}).sort({ fileCount: -1 }).limit(8).select(USER_PUBLIC).lean()
    ]);

    return {
      users,
      files,
      size: sizeAgg[0]?.total || 0,
      activeToday,
      new7d,
      avg: users ? Math.round((files / users) * 10) / 10 : 0,
      byKind: byKind.map(k => ({ kind: k._id || "document", count: k.count, size: k.size })),
      uploads,
      topUsers: topUsers.map(u => ({
        id: u.tgUserId,
        name: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.username || `#${u.tgUserId}`,
        username: u.username || "",
        fileCount: u.fileCount || 0,
        storageUsed: u.storageUsed || 0
      }))
    };
  }

  async function adminListFiles({ q = "", kind = "", owner = "", limit = 40, skip = 0, sort = "newest" } = {}) {
    const filter = { isDeleted: { $ne: true } };
    if (q) filter.fileName = new RegExp(escapeRegex(q), "i");
    if (kind) filter.kind = kind;
    if (owner) filter.ownerTgUserId = String(owner);
    const [items, total] = await Promise.all([
      FileModel.find(filter).sort(SORTS[sort] || SORTS.newest).skip(skip).limit(limit).lean(),
      FileModel.countDocuments(filter)
    ]);
    // attach owner names
    const ids = [...new Set(items.map(f => f.ownerTgUserId))];
    const owners = await UserModel.find({ tgUserId: { $in: ids } }).select("tgUserId firstName lastName username").lean();
    const map = new Map(owners.map(o => [o.tgUserId, [o.firstName, o.lastName].filter(Boolean).join(" ") || o.username || `#${o.tgUserId}`]));
    return {
      items: items.map(f => ({ ...toPublicFile(f), ownerName: map.get(f.ownerTgUserId) || f.ownerTgUserId })),
      total
    };
  }

  async function broadcastTargets() {
    return UserModel.find({ isBlocked: { $ne: true } }).select("tgUserId").lean().then(r => r.map(u => u.tgUserId));
  }

  async function cleanupExpired() {
    const now = new Date();
    const r = await FileModel.deleteMany({ expiresAt: { $ne: null, $lt: now } });
    return r.deletedCount || 0;
  }

  async function ping() {
    await UserModel.estimatedDocumentCount();
    return true;
  }

  return {
    driver: "mongodb",
    getUser,
    ensureUser,
    updateUser,
    listUsers,
    countUsers,
    listFiles,
    countByCategory,
    getFile,
    getFileOwned,
    getFileForTransfer,
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
    ping
  };
}
