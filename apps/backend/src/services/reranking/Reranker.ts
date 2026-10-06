export type RerankResult = {
  index: number;
  score: number;
};

export interface Reranker {
  readonly id: string;
  rerank(
    query: string,
    documents: readonly string[],
    limit: number,
  ): Promise<RerankResult[]>;
}
