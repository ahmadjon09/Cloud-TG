import mongoose from "mongoose";

const FileSchema = new mongoose.Schema(
  {
    ownerTgUserId: { type: String, required: true, index: true },
    kind: { type: String, required: true, default: "document" },
    tgFileId: { type: String, required: true },
    tgUniqueId: { type: String, default: "" },
    fileName: { type: String, default: "" },
    mimeType: { type: String, default: "" },
    fileSize: { type: Number, default: 0 },
    note: { type: String, maxlength: 500, default: "" },

    // Features
    isPrivate: { type: Boolean, default: false, index: true },
    isFavorite: { type: Boolean, default: false, index: true },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: Date,
    folderId: { type: String, default: null },
    expiresAt: { type: Date, default: null, index: { expireAfterSeconds: 0 } },
    sharedWith: { type: [String], default: [] }
  },
  { timestamps: true }
);

// Most used query: "files of a user, newest first, not deleted"
FileSchema.index({ ownerTgUserId: 1, isDeleted: 1, createdAt: -1 });
FileSchema.index({ ownerTgUserId: 1, fileName: "text" });
FileSchema.index({ ownerTgUserId: 1, isFavorite: 1, createdAt: -1 });
FileSchema.index({ createdAt: -1 });

export const FileModel = mongoose.model("File", FileSchema);
