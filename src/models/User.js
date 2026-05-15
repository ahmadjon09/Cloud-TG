import mongoose from "mongoose";

const UserSchema = new mongoose.Schema({
    tgUserId: { type: String, required: true, unique: true, index: true },
    firstName: { type: String, default: "" },
    lastName: { type: String, default: "" },
    username: { type: String, default: "" },
    startedAt: { type: Date, default: Date.now },

    // Stats
    language: { type: String, default: 'en' }, // English only
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