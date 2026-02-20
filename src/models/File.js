import mongoose from "mongoose";

const FileSchema = new mongoose.Schema(
    {
        ownerTgUserId: { type: String, required: true, index: true },

        kind: { type: String, required: true },
        tgFileId: { type: String, required: true, index: true },
        tgUniqueId: { type: String, default: "" },

        fileName: { type: String, default: "" },
        mimeType: { type: String, default: "" },
        fileSize: { type: Number, default: 0 },

        note: { type: String, default: "" } // editable field
    },
    { timestamps: true }
);

FileSchema.index({ ownerTgUserId: 1, createdAt: -1 });

export const FileModel = mongoose.model("File", FileSchema);