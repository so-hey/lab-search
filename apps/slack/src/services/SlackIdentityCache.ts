import type { SlackIdentity } from "./BackendClient.js";

type CacheEntry = {
  identity: SlackIdentity;
  expiresAt: number;
};

export class SlackIdentityCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly pending = new Map<string, Promise<SlackIdentity>>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
    private readonly now: () => number = Date.now,
  ) {
    if (!Number.isInteger(ttlMs) || ttlMs < 1) {
      throw new Error("Slack identity cache TTL must be a positive integer.");
    }
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new Error("Slack identity cache size must be a positive integer.");
    }
  }

  async getOrLoad(
    teamId: string,
    userId: string,
    load: () => Promise<SlackIdentity>,
  ): Promise<SlackIdentity> {
    const key = `${teamId}:${userId}`;
    const now = this.now();
    const cached = this.entries.get(key);
    if (cached && cached.expiresAt > now) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached.identity;
    }
    if (cached) this.entries.delete(key);

    const inFlight = this.pending.get(key);
    if (inFlight) return inFlight;

    const promise = load();
    this.pending.set(key, promise);
    try {
      const identity = await promise;
      this.removeExpired(now);
      while (this.entries.size >= this.maxEntries) {
        const oldestKey = this.entries.keys().next().value as string | undefined;
        if (oldestKey === undefined) break;
        this.entries.delete(oldestKey);
      }
      this.entries.set(key, {
        identity,
        expiresAt: this.now() + this.ttlMs,
      });
      return identity;
    } finally {
      this.pending.delete(key);
    }
  }

  private removeExpired(now: number): void {
    for (const [key, value] of this.entries) {
      if (value.expiresAt <= now) this.entries.delete(key);
    }
  }
}
