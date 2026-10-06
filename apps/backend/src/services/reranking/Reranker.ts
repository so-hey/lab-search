export type RerankResult = {
  index: number;
  score: number;
};

export class RerankerRateLimitError extends Error {
  readonly retryAfterMs: number;

  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = "RerankerRateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

export interface Reranker {
  readonly id: string;
  rerank(
    query: string,
    documents: readonly string[],
    limit: number,
  ): Promise<RerankResult[]>;
}
