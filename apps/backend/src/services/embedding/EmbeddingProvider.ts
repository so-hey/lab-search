export interface EmbeddingProvider {
  readonly id: string;
  readonly dimensions: number;
  embedDocuments(texts: string[], title?: string): Promise<number[][]>;
  embedDocument(text: string, title?: string): Promise<number[]>;
  embedQuery(text: string): Promise<number[]>;
  /** Phase 1 compatibility. New code should use embedDocument/embedQuery. */
  embed(text: string): Promise<number[]>;
}

export class EmbeddingQuotaError extends Error {
  readonly scope: "daily" | "temporary";
  readonly retryAfterMs?: number;

  constructor(
    message: string,
    options: {
      scope: "daily" | "temporary";
      retryAfterMs?: number;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause });
    this.name = "EmbeddingQuotaError";
    this.scope = options.scope;
    this.retryAfterMs = options.retryAfterMs;
  }
}
