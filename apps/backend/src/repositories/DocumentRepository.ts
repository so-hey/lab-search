import type { IndexedChunk } from "../services/documents/types.js";

export type ScoredChunk = {
  chunk: IndexedChunk;
  score: number;
};

export interface DocumentRepository {
  searchSimilar(queryEmbedding: number[], limit: number): Promise<ScoredChunk[]>;
}
