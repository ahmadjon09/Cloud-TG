import mongoose from "mongoose";
import { LANGUAGES, DEFAULT_LANG } from "../utils/i18n.js";

const UserSchema = new mongoose.Schema({
    tgUserId: { type: String, required: true, unique: true, index: true },
    firstName: { type: String, default: "" },
    lastName: { type: String, default: "" },
    username: { type: String, default: "" },
    languageCode: { type: String, default: "" }, // Telegram's language_code

    // App language preference (auto-detected or user-set)
    language: {
        type: String,
        enum: LANGUAGES,
        default: DEFAULT_LANG,
        index: true
    },

    startedAt: { type: Date, default: Date.now },

    // Stats
    storageUsed: { type: Number, default: 0 },
    fileCount: { type: Number, default: 0 },

    // Folders
    folderIds: [{
        _id: { type: String, required: true },
        name: String,
        parentId: String,
        fileCount: { type: Number, default: 0 },
        createdAt: { type: Date, default: Date.now }
    }],

    // Settings
    settings: {
        notifications: { type: Boolean, default: true },
        privateByDefault: { type: Boolean, default: false },
        autoExpire: { type: String, enum: [null, '24h', '7d', '30d', '90d'], default: null }
    },

    lastActiveAt: Date
}, { timestamps: true });

export const UserModel = mongoose.model("User", UserSchema);