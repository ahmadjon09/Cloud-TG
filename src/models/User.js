import mongoose from "mongoose";
import { LANGUAGES, DEFAULT_LANG } from "../utils/languages.js";

const UserSchema = new mongoose.Schema(
  {
    tgUserId: { type: String, required: true, unique: true, index: true },
    firstName: { type: String, default: "" },
    lastName: { type: String, default: "" },
    username: { type: String, default: "", index: true },
    photoUrl: { type: String, default: "" },
    languageCode: { type: String, default: "" }, // Telegram's language_code

    // App language preference (auto-detected or user-set)
    language: {
      type: String,
      enum: LANGUAGES,
      default: DEFAULT_LANG,
      index: true
    },

    startedAt: { type: Date, default: Date.now },
    lastActiveAt: { type: Date, default: Date.now, index: true },

    // Stats
    storageUsed: { type: Number, default: 0 },
    fileCount: { type: Number, default: 0 },
    filesDeleted: { type: Number, default: 0 },

    // Folders
    folderIds: [
      {
        _id: { type: String, required: true },
        name: String,
        parentId: String,
        fileCount: { type: Number, default: 0 },
        createdAt: { type: Date, default: Date.now }
      }
    ],

    // Settings (also used by the web app)
    settings: {
      notifications: { type: Boolean, default: true },
      privateByDefault: { type: Boolean, default: false },
      // "24h" | "7d" | "30d" | "90d" | null — validated in code
      autoExpire: { type: String, default: null },
      theme: { type: String, enum: ["auto", "light", "dark"], default: "auto" },
      view: { type: String, enum: ["grid", "list"], default: "grid" },
      density: { type: String, enum: ["compact", "comfortable"], default: "comfortable" },
      desktopMode: { type: Boolean, default: true },
      autoFullscreen: { type: Boolean, default: true },
      autoThumbnails: { type: Boolean, default: true }
    },

    // Moderation
    isBlocked: { type: Boolean, default: false }
  },
  { timestamps: true }
);

UserSchema.index({ lastActiveAt: -1 });
UserSchema.index({ createdAt: -1 });

/** Full display name with sensible fallbacks */
UserSchema.virtual("displayName").get(function () {
  return (
    [this.firstName, this.lastName].filter(Boolean).join(" ").trim() ||
    (this.username ? `@${this.username}` : "") ||
    `#${this.tgUserId}`
  );
});

export const UserModel = mongoose.model("User", UserSchema);
