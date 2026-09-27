// db.js — picks the storage driver (MongoDB by default, in-memory for demo/dev)
import mongoose from "mongoose";
import { createMongoStore } from "./store/mongo.js";
import { createMemoryStore } from "./store/memory.js";

let store = null;
let driver = "none";

/**
 * @param {string} uri  MongoDB connection string
 * @param {{forceMemory?: boolean, demo?: boolean, demoUserId?: string}} opts
 */
export async function connectDB(uri, opts = {}) {
  mongoose.set("strictQuery", true);

  const useMemory = opts.forceMemory || !uri;

  if (useMemory) {
    store = createMemoryStore({ demoUserId: opts.demoUserId });
    driver = "memory";
    console.warn("");
    console.warn("⚠️  DEMO MODE — using the in-memory store. Data is NOT persisted.");
    console.warn("    Set MONGO_URI to use MongoDB in production.");
    console.warn("");
    return { driver, store };
  }

  try {
    await mongoose.connect(uri, {
      maxPoolSize: 20,
      minPoolSize: 2,
      serverSelectionTimeoutMS: 10_000,
      socketTimeoutMS: 45_000,
      retryWrites: true
    });
    driver = "mongodb";
    store = createMongoStore();
    console.log("✅ MongoDB connected");
    mongoose.connection.on("error", err => console.error("MongoDB error:", err.message));
    mongoose.connection.on("disconnected", () => console.warn("⚠️ MongoDB disconnected"));
  } catch (e) {
    if (opts.demo) {
      console.error("⚠️ MongoDB unavailable, falling back to the in-memory store:", e.message);
      store = createMemoryStore({ demoUserId: opts.demoUserId });
      driver = "memory";
    } else {
      console.error("❌ MongoDB connection failed:", e.message);
      throw e;
    }
  }

  return { driver, store };
}

export function getStore() {
  if (!store) throw new Error("Store not initialised — call connectDB() first");
  return store;
}

export function getDriver() {
  return driver;
}

export async function disconnectDB() {
  try {
    await mongoose.connection.close();
  } catch {
    /* already closed */
  }
}
