// utils/rateLimit.js — sliding-window limiter with automatic cleanup
export class RateLimiter {
  constructor({ window = 60_000, max = 120, name = "default" } = {}) {
    this.name = name;
    this.window = window;
    this.max = max;
    this.map = new Map();
    this.blocked = 0;
  }

  get size() {
    return this.map.size;
  }

  /**
   * @returns {{ok:boolean, remaining:number, resetIn:number}}
   */
  check(key, { max = this.max, window = this.window } = {}) {
    const now = Date.now();
    let list = this.map.get(key);
    if (!list) {
      list = [];
      this.map.set(key, list);
    }
    while (list.length && now - list[0] >= window) list.shift();

    if (list.length >= max) {
      this.blocked++;
      return { ok: false, remaining: 0, resetIn: window - (now - list[0]) };
    }
    list.push(now);
    return { ok: true, remaining: max - list.length, resetIn: window };
  }

  peek(key) {
    const list = this.map.get(key);
    if (!list) return this.max;
    return Math.max(0, this.max - list.length);
  }

  reset(key) {
    this.map.delete(key);
  }

  clear() {
    const n = this.map.size;
    this.map.clear();
    return n;
  }

  sweep() {
    const now = Date.now();
    let n = 0;
    for (const [key, list] of this.map) {
      while (list.length && now - list[0] >= this.window) list.shift();
      if (!list.length) {
        this.map.delete(key);
        n++;
      }
    }
    return n;
  }

  stats() {
    return { name: this.name, size: this.map.size, blocked: this.blocked, window: this.window, max: this.max };
  }
}

export const limiters = {
  api: new RateLimiter({ name: "api", window: 60_000, max: 240 }),
  write: new RateLimiter({ name: "write", window: 60_000, max: 90 }),
  stream: new RateLimiter({ name: "stream", window: 60_000, max: 400 }),
  telegram: new RateLimiter({ name: "telegram", window: 60_000, max: 200 }),
  admin: new RateLimiter({ name: "admin", window: 60_000, max: 300 }),
  auth: new RateLimiter({ name: "auth", window: 5 * 60_000, max: 60 })
};

export function limitStats() {
  return Object.values(limiters).map(l => l.stats());
}

export function limitSize() {
  return Object.values(limiters).reduce((n, l) => n + l.size, 0);
}

export function sweepAll() {
  return Object.values(limiters).reduce((n, l) => n + l.sweep(), 0);
}
