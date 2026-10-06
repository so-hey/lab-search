import type { IndexedChunk } from "../services/documents/types.js";

export type ScoredChunk = {
  chunk: IndexedChunk;
  score: number;
};

export interface DocumentRepository {
  searchSimilar(queryEmbedding: number[], limit: number): Promise<ScoredChunk[]>;
}

export interface HybridSearchDocumentRepository extends DocumentRepository {
  searchHybrid(
    queryEmbedding: number[],
    queryText: string,
    limit: number,
  ): Promise<ScoredChunk[]>;
}

export function isHybridSearchDocumentRepository(
  repository: DocumentRepository,
): repository is HybridSearchDocumentRepository {
  return (
    typeof (repository as Partial<HybridSearchDocumentRepository>).searchHybrid ===
    "function"
  );
}

export interface WritableDocumentRepository {
  readonly indexId: string;
  ensureCollection(): Promise<void>;
  getDocumentChunks(documentId: string): Promise<IndexedChunk[]>;
  upsertDocumentChunks(chunks: IndexedChunk[]): Promise<void>;
  finalizeDocumentChunks(
    documentId: string,
    expectedChunkIds: ReadonlySet<string>,
  ): Promise<void>;
  deleteDocument(documentId: string): Promise<void>;
}

export type RemoteDocumentRepository = DocumentRepository & WritableDocumentRepository;

export function isWritableDocumentRepository(
  repository: DocumentRepository,
): repository is RemoteDocumentRepository {
  const candidate = repository as Partial<WritableDocumentRepository>;
  return (
    typeof candidate.indexId === "string" &&
    typeof candidate.ensureCollection === "function" &&
    typeof candidate.getDocumentChunks === "function" &&
    typeof candidate.upsertDocumentChunks === "function" &&
    typeof candidate.finalizeDocumentChunks === "function" &&
    typeof candidate.deleteDocument === "function"
  );
}
