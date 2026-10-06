import type { SearchRequest, SearchResponse } from "@lab-search/shared";
import {
  isHybridSearchDocumentRepository,
  type DocumentRepository,
  type ScoredChunk,
} from "../../repositories/DocumentRepository.js";
import type {
  DocumentLocationRepository,
  SearchLogRepository,
} from "../../repositories/metadata/types.js";
import type { EmbeddingProvider } from "../embedding/EmbeddingProvider.js";
import type { Reranker } from "../reranking/Reranker.js";
import { groupSearchResults } from "./groupSearchResults.js";

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const MIN_CANDIDATE_LIMIT = 100;
const CANDIDATES_PER_RESULT = 20;
const MAX_CANDIDATE_LIMIT = 500;
const DEFAULT_RERANK_CANDIDATE_DOCUMENTS = 20;
const MAX_RERANK_CANDIDATE_DOCUMENTS = 50;

export type RetrievalMode = "dense" | "hybrid";

export type SearchDocumentsDependencies = {
  embeddingProvider: EmbeddingProvider;
  documentRepository: DocumentRepository;
  documentLocationRepository?: DocumentLocationRepository;
  searchLogRepository?: SearchLogRepository;
  retrievalMode?: RetrievalMode;
  reranker?: Reranker;
  rerankCandidateDocuments?: number;
};

function googleDriveFolderUrl(folderId: string): string {
  return `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`;
}

function rerankerDocument(result: SearchResponse["results"][number]): string {
  return [
    `文書名: ${result.documentName}`,
    result.sectionTitle ? `節: ${result.sectionTitle}` : undefined,
    result.page ? `ページ: ${result.page}` : undefined,
    result.slide ? `スライド: ${result.slide}` : undefined,
    result.content,
    ...(result.relatedChunks ?? []).slice(0, 2).map(
      (chunk, index) => `関連箇所${index + 1}:\n${chunk.content}`,
    ),
  ]
    .filter((value): value is string => value !== undefined)
    .join("\n");
}

async function retrieveChunks(
  repository: DocumentRepository,
  retrievalMode: RetrievalMode,
  queryEmbedding: number[],
  query: string,
  limit: number,
): Promise<ScoredChunk[]> {
  if (retrievalMode === "dense") {
    return repository.searchSimilar(queryEmbedding, limit);
  }
  if (!isHybridSearchDocumentRepository(repository)) {
    throw new Error(
      "Hybrid search requires a repository with BM25/dense hybrid support.",
    );
  }
  return repository.searchHybrid(queryEmbedding, query, limit);
}

export async function searchDocuments(
  request: SearchRequest,
  dependencies: SearchDocumentsDependencies,
  userId = "local-user",
): Promise<SearchResponse> {
  const query = request.query.trim();
  const limit = request.limit ?? DEFAULT_LIMIT;

  if (!query) {
    throw new Error("Search query must not be empty.");
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new Error(`Search limit must be an integer from 1 to ${MAX_LIMIT}.`);
  }

  const queryEmbedding = await dependencies.embeddingProvider.embedQuery(query);
  const retrievalMode = dependencies.retrievalMode ?? "dense";
  const rerankCandidateDocuments = dependencies.reranker
    ? (dependencies.rerankCandidateDocuments ??
      DEFAULT_RERANK_CANDIDATE_DOCUMENTS)
    : limit;
  if (
    !Number.isInteger(rerankCandidateDocuments) ||
    rerankCandidateDocuments < limit ||
    rerankCandidateDocuments > MAX_RERANK_CANDIDATE_DOCUMENTS
  ) {
    throw new Error(
      `Rerank candidate documents must be an integer from ${limit} to ${MAX_RERANK_CANDIDATE_DOCUMENTS}.`,
    );
  }
  const resultPoolLimit = rerankCandidateDocuments;
  let candidateLimit = Math.min(
    MAX_CANDIDATE_LIMIT,
    Math.max(
      MIN_CANDIDATE_LIMIT,
      resultPoolLimit * CANDIDATES_PER_RESULT,
    ),
  );
  let matches = await retrieveChunks(
    dependencies.documentRepository,
    retrievalMode,
    queryEmbedding,
    query,
    candidateLimit,
  );
  let results = groupSearchResults(matches, resultPoolLimit);

  while (
    results.length < resultPoolLimit &&
    matches.length >= candidateLimit &&
    candidateLimit < MAX_CANDIDATE_LIMIT
  ) {
    candidateLimit = Math.min(candidateLimit * 2, MAX_CANDIDATE_LIMIT);
    matches = await retrieveChunks(
      dependencies.documentRepository,
      retrievalMode,
      queryEmbedding,
      query,
      candidateLimit,
    );
    results = groupSearchResults(matches, resultPoolLimit);
  }

  results = results.map((result) => ({
    ...result,
    scoreType: retrievalMode === "hybrid" ? "rrf" : "cosine",
  }));
  if (dependencies.reranker && results.length > 0) {
    try {
      const reranked = await dependencies.reranker.rerank(
        query,
        results.map(rerankerDocument),
        Math.min(limit, results.length),
      );
      results = reranked.map(({ index, score }) => ({
        ...results[index],
        retrievalScore: results[index].score,
        score,
        scoreType: "reranker" as const,
      }));
    } catch (error) {
      console.error(
        `[reranker] ${dependencies.reranker.id} failed; using retrieval order`,
        error,
      );
      results = results.slice(0, limit);
    }
  } else {
    results = results.slice(0, limit);
  }

  if (dependencies.documentLocationRepository && results.length > 0) {
    try {
      const parentFolderIds =
        await dependencies.documentLocationRepository.getParentFolderIds(
          results.map((result) => result.documentId),
        );
      results = results.map((result) => {
        const parentFolderId = parentFolderIds.get(result.documentId);
        return parentFolderId
          ? { ...result, folderUrl: googleDriveFolderUrl(parentFolderId) }
          : result;
      });
    } catch (error) {
      console.error(
        "[document-location] failed; using the original document links",
        error,
      );
    }
  }

  let searchLogId: string | null = null;
  if (dependencies.searchLogRepository) {
    try {
      searchLogId = await dependencies.searchLogRepository.create({
        userId,
        source: request.source,
        query,
        resultCount: results.length,
      });
    } catch (error) {
      console.error("[search-log] failed", error);
    }
  }

  return {
    searchLogId,
    results,
  };
}
