import type { DocumentChunk, IndexedChunk } from "./types.js";

export function createChunkPayload(
  chunk: DocumentChunk | IndexedChunk,
): Record<string, unknown> {
  const { id, ...payload } = chunk;
  const withoutEmbedding = { ...payload } as Partial<IndexedChunk>;
  delete withoutEmbedding.embedding;
  return { chunkId: id, ...withoutEmbedding };
}
