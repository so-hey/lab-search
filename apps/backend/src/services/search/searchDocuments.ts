import type { SearchRequest, SearchResponse } from "@lab-search/shared";
import type { DocumentRepository } from "../../repositories/DocumentRepository.js";
import type { EmbeddingProvider } from "../embedding/EmbeddingProvider.js";

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;

export type SearchDocumentsDependencies = {
  embeddingProvider: EmbeddingProvider;
  documentRepository: DocumentRepository;
};

export async function searchDocuments(
  request: SearchRequest,
  dependencies: SearchDocumentsDependencies,
): Promise<SearchResponse> {
  const query = request.query.trim();
  const limit = request.limit ?? DEFAULT_LIMIT;

  if (!query) {
    throw new Error("Search query must not be empty.");
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new Error(`Search limit must be an integer from 1 to ${MAX_LIMIT}.`);
  }

  const queryEmbedding = await dependencies.embeddingProvider.embed(query);
  const matches = await dependencies.documentRepository.searchSimilar(
    queryEmbedding,
    limit,
  );

  return {
    results: matches.map(({ chunk, score }) => ({
      chunkId: chunk.id,
      documentId: chunk.documentId,
      documentName: chunk.documentName,
      content: chunk.content,
      score,
      ...(chunk.url ? { url: chunk.url } : {}),
    })),
  };
}
