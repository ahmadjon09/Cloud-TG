// utils/cache.js — tiny TTL cache with stats (used for file lists, stats, i18n…)
export class TTLCache {
  constructor({ defaultTTL = 30_000, max = 2000, name = "cache" } = {}) {
    this.name = name;
    this.defaultTTL = defaultTTL;
    this.max = max;
    this.store = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  get size() {
    return this.store.size;
  }

  get(key) {
    const item = this.store.get(key);
    if (!item) {
      this.misses++;
      return undefined;
    }
    if (Date.now() > item.expires) {
      this.store.delete(key);
      this.misses++;
      return undefined;
    }
    // refresh LRU position
    this.store.delete(key);
    this.store.set(key, item);
    this.hits++;
    return item.value;
  }

  set(key, value, ttl = this.defaultTTL) {
    if (this.store.size >= this.max) {
      // drop oldest (Map preserves insertion order)
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, { value, expires: Date.now() + ttl });
    return value;
  }

  del(key) {
    return this.store.delete(key);
  }

  /** Delete every key matching a prefix (e.g. `files:123:`) */
  delPrefix(prefix) {
    let n = 0;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
        n++;
      }
    }
    return n;
  }

  /** Delete every key matching a regex */
  delPattern(pattern) {
    const escaped = pattern
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\\\*/g, ".*");
    const re = new RegExp(`^${escaped}$`);
    let n = 0;
    for (const key of this.store.keys()) {
      if (re.test(key)) {
        this.store.delete(key);
        n++;
      }
    }
    return n;
  }

  clear() {
    const n = this.store.size;
    this.store.clear();
    return n;
  }

  /** Remove already-expired entries (called by a low-frequency timer). */
  sweep() {
    const now = Date.now();
    let n = 0;
    for (const [key, item] of this.store) {
      if (now > item.expires) {
        this.store.delete(key);
        n++;
      }
    }
    return n;
  }

  stats() {
    return {
      name: this.name,
      size: this.store.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hits + this.misses ? Math.round((this.hits / (this.hits + this.misses)) * 100) : 0
    };
  }
}

export const caches = {
  lists: new TTLCache({ name: "lists", defaultTTL: 20_000, max: 800 }),
  stats: new TTLCache({ name: "stats", defaultTTL: 30_000, max: 500 }),
  admin: new TTLCache({ name: "admin", defaultTTL: 30_000, max: 200 }),
  users: new TTLCache({ name: "users", defaultTTL: 60_000, max: 1000 }),
  telegram: new TTLCache({ name: "telegram", defaultTTL: 5 * 60_000, max: 500 })
};

export function invalidateUser(userId) {
  caches.lists.delPrefix(`files:${userId}:`);
  caches.stats.delPrefix(`stats:${userId}`);
  caches.users.del(`user:${userId}`);
}

export function invalidateAll() {
  caches.lists.clear();
  caches.stats.clear();
  caches.admin.clear();
  caches.users.clear();
  caches.telegram.clear();
}

export function sweepAll() {
  return Object.values(caches).reduce((n, c) => n + c.sweep(), 0);
}

export function cacheStats() {
  return Object.values(caches).map(c => c.stats());
}

export function cacheSize() {
  return Object.values(caches).reduce((n, c) => n + c.size, 0);
}
