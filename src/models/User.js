import mongoose from "mongoose";

const UserSchema = new mongoose.Schema(
    {
        tgUserId: { type: String, required: true, unique: true, index: true },
        firstName: { type: String, default: "" },
        lastName: { type: String, default: "" },
        username: { type: String, default: "" },
        languageCode: { type: String, default: "en" },
        startedAt: { type: Date, default: Date.now },
        // User fields (add these)
        diamonds: { type: Number, default: 0 },
        referredBy: { type: String, default: null }, // tgUserId
        refCode: {
            type: String,
            unique: true,
            index: true
        },
        refCount: { type: Number, default: 0 },

        // for leaderboards
        weekScore: { type: Number, default: 0 },
        monthScore: { type: Number, default: 0 },

        // optional anti-fraud / analytics
        refAwardedAt: { type: Date, default: null },
    },
    { timestamps: true }
);

export const UserModel = mongoose.model("User", UserSchema);