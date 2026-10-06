import type { DocumentMetadataRepository, DocumentRecord } from "../../repositories/metadata/types.js";
import type { WritableDocumentRepository } from "../../repositories/DocumentRepository.js";
import { chunkExtractedDocument } from "./chunkExtractedDocument.js";
import { deduplicateDocuments, logDuplicates } from "./deduplicateDocuments.js";
import type { ExtractorRegistry } from "./extractors/ExtractorRegistry.js";
import { EmptyDocumentError } from "./extractors/DocumentExtractor.js";
import { isSupportedMimeType } from "./mimeTypes.js";
import type { DocumentSource, SourceFile } from "./source/types.js";
import { DriveAcquisitionError } from "./source/GoogleDriveDocumentSource.js";
import {
  EmbeddingQuotaError,
  type EmbeddingProvider,
} from "../embedding/EmbeddingProvider.js";
import type { IndexedChunk } from "./types.js";

export type DriveSyncSummary = {
  new: number;
  updated: number;
  skipped: number;
  duplicates: number;
  failed: number;
  removed: number;
  unsupported: number;
  skippedAbusiveFiles: number;
  skippedEmptyDocuments: number;
  permissionErrors: number;
  exportSizeErrors: number;
  fileNotDownloadableErrors: number;
  embeddingQuotaExhausted: boolean;
  deferred: number;
  embeddedChunks: number;
  reusedChunks: number;
  embeddingBatchAttempts: number;
  embeddingInputAttempts: number;
};

export type SyncDriveDependencies = {
  source: DocumentSource;
  extractorRegistry: ExtractorRegistry;
  embeddingProvider: EmbeddingProvider;
  documentRepository: WritableDocumentRepository;
  metadataRepository: DocumentMetadataRepository;
  embeddingBatchSize?: number;
};

const DEFAULT_EMBEDDING_BATCH_SIZE = 20;
const CHECKPOINT_SAVE_ATTEMPTS = 3;

async function persistCheckpoint(
  chunks: IndexedChunk[],
  repository: WritableDocumentRepository,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= CHECKPOINT_SAVE_ATTEMPTS; attempt += 1) {
    try {
      await repository.upsertDocumentChunks(chunks);
      return;
    } catch (error) {
      lastError = error;
      if (attempt === CHECKPOINT_SAVE_ATTEMPTS) break;
      console.warn(
        `  checkpoint save failed (${attempt}/${CHECKPOINT_SAVE_ATTEMPTS}); retrying without re-embedding`,
        error,
      );
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }
  throw lastError;
}

async function embedChunks(
  chunks: Omit<IndexedChunk, "embedding">[],
  provider: EmbeddingProvider,
  repository: WritableDocumentRepository,
  documentName: string,
  batchSize: number,
  summary: DriveSyncSummary,
): Promise<IndexedChunk[]> {
  const stored = await repository.getDocumentChunks(chunks[0].documentId);
  const storedById = new Map(stored.map((chunk) => [chunk.id, chunk]));
  const indexedById = new Map<string, IndexedChunk>();
  let documentReused = 0;
  let documentEmbedded = 0;

  for (const chunk of chunks) {
    const candidate = storedById.get(chunk.id);
    if (
      candidate !== undefined &&
      chunk.sourceModifiedTime !== undefined &&
      candidate.sourceModifiedTime === chunk.sourceModifiedTime &&
      candidate.content === chunk.content &&
      candidate.embedding.length === provider.dimensions
    ) {
      indexedById.set(chunk.id, { ...chunk, embedding: candidate.embedding });
      documentReused += 1;
      summary.reusedChunks += 1;
    }
  }

  for (let offset = 0; offset < chunks.length; offset += batchSize) {
    const batch = chunks.slice(offset, offset + batchSize);
    const missing = batch.filter((chunk) => !indexedById.has(chunk.id));
    if (missing.length > 0) {
      summary.embeddingBatchAttempts += 1;
      summary.embeddingInputAttempts += missing.length;
      const vectors = await provider.embedDocuments(
        missing.map((chunk) =>
          chunk.sectionTitle
            ? `${chunk.sectionTitle}\n${chunk.content}`
            : chunk.content,
        ),
        documentName,
      );
      const checkpoint = missing.map((chunk, index) => ({
        ...chunk,
        embedding: vectors[index],
      }));
      await persistCheckpoint(checkpoint, repository);
      for (const chunk of checkpoint) indexedById.set(chunk.id, chunk);
      documentEmbedded += checkpoint.length;
      summary.embeddedChunks += checkpoint.length;
    }
    console.log(
      `  embedding/checkpoint: ${indexedById.size}/${chunks.length} (new: ${documentEmbedded}, reused: ${documentReused})`,
    );
  }

  return chunks.map((chunk) => {
    const indexed = indexedById.get(chunk.id);
    if (!indexed) {
      throw new Error(`Embedding checkpoint is missing for chunk ${chunk.id}.`);
    }
    return indexed;
  });
}

function metadataInput(
  file: SourceFile,
  isIndexed: boolean,
  duplicateOf: string | null,
  embeddingProviderId: string,
  vectorStoreId: string,
) {
  return {
    driveFileId: file.id,
    name: file.name,
    mimeType: file.mimeType,
    parentFolderId: file.parentIds[0] ?? null,
    webViewLink: file.webViewLink ?? null,
    modifiedTime: file.modifiedTime,
    isIndexed,
    embeddingProviderId,
    vectorStoreId,
    duplicateOf,
    isActive: true,
  };
}

function hasCurrentIndex(
  document: DocumentRecord | undefined,
  file: SourceFile,
  dependencies: SyncDriveDependencies,
): boolean {
  const storedModifiedTime = document ? Date.parse(document.modifiedTime) : Number.NaN;
  const sourceModifiedTime = Date.parse(file.modifiedTime);
  const sameModifiedTime =
    Number.isFinite(storedModifiedTime) && Number.isFinite(sourceModifiedTime)
      ? storedModifiedTime === sourceModifiedTime
      : document?.modifiedTime === file.modifiedTime;
  return Boolean(
    document?.isIndexed &&
      sameModifiedTime &&
      document.embeddingProviderId === dependencies.embeddingProvider.id &&
      document.vectorStoreId === dependencies.documentRepository.indexId,
  );
}

async function markRemoved(
  existing: DocumentRecord[],
  currentFileIds: Set<string>,
  dependencies: SyncDriveDependencies,
  summary: DriveSyncSummary,
) {
  for (const document of existing) {
    if (currentFileIds.has(document.driveFileId)) continue;
    try {
      await dependencies.documentRepository.deleteDocument(document.id);
      await dependencies.metadataRepository.updateIndexState(document.id, {
        isIndexed: false,
        duplicateOf: null,
        isActive: false,
      });
      summary.removed += 1;
      console.log(`[removed] ${document.name}`);
    } catch (error) {
      summary.failed += 1;
      console.error(`[removed] failed: ${document.name}`, error);
    }
  }
}

export async function syncDrive(
  dependencies: SyncDriveDependencies,
): Promise<DriveSyncSummary> {
  const summary: DriveSyncSummary = {
    new: 0,
    updated: 0,
    skipped: 0,
    duplicates: 0,
    failed: 0,
    removed: 0,
    unsupported: 0,
    skippedAbusiveFiles: 0,
    skippedEmptyDocuments: 0,
    permissionErrors: 0,
    exportSizeErrors: 0,
    fileNotDownloadableErrors: 0,
    embeddingQuotaExhausted: false,
    deferred: 0,
    embeddedChunks: 0,
    reusedChunks: 0,
    embeddingBatchAttempts: 0,
    embeddingInputAttempts: 0,
  };
  const embeddingBatchSize =
    dependencies.embeddingBatchSize ?? DEFAULT_EMBEDDING_BATCH_SIZE;
  if (!Number.isInteger(embeddingBatchSize) || embeddingBatchSize < 1 || embeddingBatchSize > 100) {
    throw new Error("embeddingBatchSize must be an integer from 1 to 100.");
  }
  const files = await dependencies.source.listDocuments();
  const existing = await dependencies.metadataRepository.listActive();
  const existingByDriveId = new Map(existing.map((record) => [record.driveFileId, record]));
  const supported = files.filter((file) => isSupportedMimeType(file.mimeType));
  summary.unsupported = files.length - supported.length;
  const deduplication = deduplicateDocuments(supported);
  const indexTargetCount = deduplication.filesToIndex.length;
  summary.duplicates = deduplication.duplicates.length;
  logDuplicates(deduplication.duplicates);
  await dependencies.documentRepository.ensureCollection();

  const recordsByDriveId = new Map<string, DocumentRecord>();
  for (let fileIndex = 0; fileIndex < deduplication.filesToIndex.length; fileIndex += 1) {
    const file = deduplication.filesToIndex[fileIndex];
    const progress = `[${fileIndex + 1}/${indexTargetCount}]`;
    try {
      const previous = existingByDriveId.get(file.id);
      const unchanged = hasCurrentIndex(previous, file, dependencies);
      const record = await dependencies.metadataRepository.upsert(
        metadataInput(
          file,
          unchanged,
          null,
          dependencies.embeddingProvider.id,
          dependencies.documentRepository.indexId,
        ),
      );
      recordsByDriveId.set(file.id, record);
    } catch (error) {
      summary.failed += 1;
      console.error(`${progress} [metadata] failed: ${file.name}`, error);
    }
  }

  for (const pair of deduplication.duplicates) {
    try {
      const preferred = recordsByDriveId.get(pair.preferred.id);
      if (!preferred) throw new Error("Preferred PPTX metadata is unavailable.");
      const duplicate = await dependencies.metadataRepository.upsert(
        metadataInput(
          pair.skipped,
          false,
          preferred.id,
          dependencies.embeddingProvider.id,
          dependencies.documentRepository.indexId,
        ),
      );
      await dependencies.documentRepository.deleteDocument(duplicate.id);
      await dependencies.metadataRepository.updateIndexState(duplicate.id, {
        isIndexed: false,
        duplicateOf: preferred.id,
        isActive: true,
      });
    } catch (error) {
      summary.failed += 1;
      console.error(`[dedup] failed: ${pair.skipped.name}`, error);
    }
  }

  for (let fileIndex = 0; fileIndex < deduplication.filesToIndex.length; fileIndex += 1) {
    const file = deduplication.filesToIndex[fileIndex];
    const progress = `[${fileIndex + 1}/${indexTargetCount}]`;
    const record = recordsByDriveId.get(file.id);
    if (!record) continue;
    const previous = existingByDriveId.get(file.id);
    if (hasCurrentIndex(previous, file, dependencies)) {
      summary.skipped += 1;
      console.log(`${progress} [skipped] ${file.name}`);
      continue;
    }
    const kind = previous ? "updated" : "new";
    console.log(`${progress} [${kind}] ${file.name}`);
    try {
      const source = await dependencies.source.getDocument(file);
      const extracted = await dependencies.extractorRegistry.extract(source);
      const chunks = chunkExtractedDocument({ documentId: record.id, file, extracted });
      if (chunks.length === 0) {
        throw new EmptyDocumentError("No chunks were generated from the extracted text.");
      }
      console.log(`  chunks: ${chunks.length}`);
      const indexed = await embedChunks(
        chunks,
        dependencies.embeddingProvider,
        dependencies.documentRepository,
        file.name,
        embeddingBatchSize,
        summary,
      );
      await dependencies.documentRepository.finalizeDocumentChunks(
        record.id,
        new Set(indexed.map((chunk) => chunk.id)),
      );
      await dependencies.metadataRepository.updateIndexState(record.id, {
        isIndexed: true,
        duplicateOf: null,
        isActive: true,
      });
      summary[kind] += 1;
    } catch (error) {
      if (error instanceof EmptyDocumentError) {
        try {
          await dependencies.documentRepository.deleteDocument(record.id);
          await dependencies.metadataRepository.updateIndexState(record.id, {
            isIndexed: false,
            duplicateOf: null,
            isActive: true,
          });
        } catch (cleanupError) {
          summary.failed += 1;
          console.error(
            `${progress} [${kind}] failed to clear empty document: ${file.name}`,
            cleanupError,
          );
          continue;
        }
        summary.skippedEmptyDocuments += 1;
        console.warn(`${progress} [${kind}] skipped empty document: ${file.name}`);
        continue;
      }
      if (error instanceof EmbeddingQuotaError && error.scope === "daily") {
        summary.failed += 1;
        summary.embeddingQuotaExhausted = true;
        summary.deferred = deduplication.filesToIndex
          .slice(fileIndex)
          .filter((remainingFile) => {
            const remainingRecord = recordsByDriveId.get(remainingFile.id);
            if (!remainingRecord) return false;
            const remainingPrevious = existingByDriveId.get(remainingFile.id);
            return !hasCurrentIndex(remainingPrevious, remainingFile, dependencies);
          }).length;
        console.error(
          `${progress} [embedding] daily quota exhausted; deferred documents: ${summary.deferred}. Re-run sync:drive after quota reset.`,
          error,
        );
        break;
      }
      if (error instanceof DriveAcquisitionError && error.reason !== "unknown") {
        try {
          await dependencies.documentRepository.deleteDocument(record.id);
          await dependencies.metadataRepository.updateIndexState(record.id, {
            isIndexed: false,
            duplicateOf: null,
            isActive: true,
          });
        } catch (cleanupError) {
          summary.failed += 1;
          console.error(`${progress} [${kind}] failed to clear unavailable document: ${file.name}`, cleanupError);
        }
        switch (error.reason) {
          case "cannotDownloadAbusiveFile":
            summary.skippedAbusiveFiles += 1;
            console.warn(`${progress} [${kind}] skipped abusive file: ${file.name}`);
            continue;
          case "insufficientFilePermissions":
            summary.permissionErrors += 1;
            break;
          case "exportSizeLimitExceeded":
            summary.exportSizeErrors += 1;
            break;
          case "fileNotDownloadable":
            summary.fileNotDownloadableErrors += 1;
            break;
          default:
            break;
        }
      }
      summary.failed += 1;
      console.error(`${progress} [${kind}] failed: ${file.name}`, error);
    }
  }

  await markRemoved(existing, new Set(files.map((file) => file.id)), dependencies, summary);
  return summary;
}
