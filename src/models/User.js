import mongoose from "mongoose";

const UserSchema = new mongoose.Schema(
    {
        tgUserId: { type: String, required: true, unique: true, index: true },
        firstName: { type: String, default: "" },
        lastName: { type: String, default: "" },
        username: { type: String, default: "" },
        languageCode: { type: String, default: "en" },
        startedAt: { type: Date, default: Date.now }
    },
    { timestamps: true }
);

export const UserModel = mongoose.model("User", UserSchema);