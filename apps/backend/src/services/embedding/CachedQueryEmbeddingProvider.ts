import type { EmbeddingProvider } from "./EmbeddingProvider.js";

type CachedEmbedding = {
  embedding: number[];
  expiresAt: number;
};

export type CachedQueryEmbeddingProviderOptions = {
  ttlMs: number;
  maxEntries: number;
  now?: () => number;
};

function normalizeQuery(text: string): string {
  return text.trim().replace(/\s+/gu, " ");
}

export class CachedQueryEmbeddingProvider implements EmbeddingProvider {
  readonly id: string;
  readonly dimensions: number;
  private readonly cache = new Map<string, CachedEmbedding>();
  private readonly pending = new Map<string, Promise<number[]>>();
  private readonly now: () => number;

  constructor(
    private readonly delegate: EmbeddingProvider,
    private readonly options: CachedQueryEmbeddingProviderOptions,
  ) {
    if (!Number.isInteger(options.ttlMs) || options.ttlMs < 1) {
      throw new Error("Query embedding cache TTL must be a positive integer.");
    }
    if (!Number.isInteger(options.maxEntries) || options.maxEntries < 1) {
      throw new Error("Query embedding cache size must be a positive integer.");
    }
    this.id = delegate.id;
    this.dimensions = delegate.dimensions;
    this.now = options.now ?? Date.now;
  }

  embedDocuments(texts: string[], title?: string): Promise<number[][]> {
    return this.delegate.embedDocuments(texts, title);
  }

  embedDocument(text: string, title?: string): Promise<number[]> {
    return this.delegate.embedDocument(text, title);
  }

  embed(text: string): Promise<number[]> {
    return this.delegate.embed(text);
  }

  async embedQuery(text: string): Promise<number[]> {
    const key = normalizeQuery(text);
    const now = this.now();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > now) {
      // Mapの末尾へ移し、上限超過時に古いqueryから削除できるようにする。
      this.cache.delete(key);
      this.cache.set(key, cached);
      return [...cached.embedding];
    }
    if (cached) this.cache.delete(key);

    const inFlight = this.pending.get(key);
    if (inFlight) return [...(await inFlight)];

    const promise = this.delegate.embedQuery(text);
    this.pending.set(key, promise);
    try {
      const embedding = await promise;
      this.removeExpired(now);
      while (this.cache.size >= this.options.maxEntries) {
        const oldestKey = this.cache.keys().next().value as string | undefined;
        if (oldestKey === undefined) break;
        this.cache.delete(oldestKey);
      }
      this.cache.set(key, {
        embedding: [...embedding],
        expiresAt: this.now() + this.options.ttlMs,
      });
      return [...embedding];
    } finally {
      this.pending.delete(key);
    }
  }

  private removeExpired(now: number): void {
    for (const [key, value] of this.cache) {
      if (value.expiresAt <= now) this.cache.delete(key);
    }
  }
}
