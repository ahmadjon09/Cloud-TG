import mongoose from "mongoose";

const FileSchema = new mongoose.Schema({
    ownerTgUserId: { type: String, required: true, index: true },
    kind: { type: String, required: true },
    tgFileId: { type: String, required: true },
    tgUniqueId: { type: String, default: "" },
    fileName: { type: String, default: "" },
    mimeType: { type: String, default: "" },
    fileSize: { type: Number, default: 0 },
    note: { type: String, maxlength: 500, default: "" },

    // Features
    isPrivate: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },
    deletedAt: Date,
    folderId: String,
    expiresAt: { type: Date, index: { expireAfterSeconds: 0 } },
    sharedWith: [String],
    updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

// Optimized indexes
FileSchema.index({ ownerTgUserId: 1, createdAt: -1 });
FileSchema.index({ ownerTgUserId: 1, fileName: "text" });

export const FileModel = mongoose.model("File", FileSchema);