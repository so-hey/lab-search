import { Buffer } from "node:buffer";
import { estimatedChunksForFile } from "./analyzeDrive.js";
import { chunkExtractedDocument } from "./chunkExtractedDocument.js";
import { createChunkPayload } from "./createChunkPayload.js";
import {
  deduplicateDocuments,
  type DuplicatePair,
} from "./deduplicateDocuments.js";
import {
  buildDeepDriveAnalysisReport,
  selectStratifiedSample,
} from "./deepAnalysisStatistics.js";
import type {
  DeepAnalysisFile,
  DeepDriveAnalysisReport,
} from "./deepAnalysisTypes.js";
import {
  EmptyDocumentError,
  type ExtractedDocument,
} from "./extractors/DocumentExtractor.js";
import type { ExtractorRegistry } from "./extractors/ExtractorRegistry.js";
import { formatCategory, isSupportedMimeType } from "./mimeTypes.js";
import type { DocumentSource, SourceFile } from "./source/types.js";
import {
  DriveAcquisitionError,
  type DriveAcquisitionErrorReason,
} from "./source/GoogleDriveDocumentSource.js";

const GIB = 1024 ** 3;

export type DeepAnalyzeDriveOptions = {
  embeddingDimensions?: number;
  capacityGiB?: number;
  concurrency?: number;
  sampleSize?: number;
  retryAttempts?: number;
  retryBaseDelayMs?: number;
  topLimit?: number;
};

export type DeepAnalyzeLogger = {
  log(message: string): void;
  error(message: string): void;
};

export type DeepAnalyzeDriveDependencies = {
  source: DocumentSource;
  extractorRegistry: ExtractorRegistry;
  logger?: DeepAnalyzeLogger;
};

function validatePositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
}

function baseFile(file: SourceFile): Omit<DeepAnalysisFile, "status" | "isDuplicate"> {
  return {
    driveFileId: file.id,
    name: file.name,
    mimeType: file.mimeType,
    category: formatCategory(file.mimeType),
    parentFolderId: file.parentIds[0] ?? null,
    ...(file.size === undefined ? {} : { sourceFileBytes: file.size }),
  };
}

function duplicateMap(pairs: DuplicatePair[]): Map<string, SourceFile> {
  return new Map(pairs.map((pair) => [pair.skipped.id, pair.preferred]));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const direct = (error as { status?: unknown }).status;
  if (typeof direct === "number") return direct;
  const response = (error as { response?: unknown }).response;
  if (typeof response !== "object" || response === null) return undefined;
  const status = (response as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

function isRetryableDownloadError(error: unknown): boolean {
  if (error instanceof DriveAcquisitionError && error.cause !== undefined) {
    return isRetryableDownloadError(error.cause);
  }
  const status = errorStatus(error);
  if (status === 429 || (status !== undefined && status >= 500)) return true;
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return (
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "EAI_AGAIN" ||
    code === "ENETUNREACH"
  );
}

function acquisitionFailure(error: DriveAcquisitionError): {
  status: DeepAnalysisFile["status"];
  reason: DriveAcquisitionErrorReason;
} {
  switch (error.reason) {
    case "cannotDownloadAbusiveFile":
      return { status: "skipped_abusive_file", reason: error.reason };
    case "insufficientFilePermissions":
      return { status: "permission_error", reason: error.reason };
    case "exportSizeLimitExceeded":
      return { status: "export_size_error", reason: error.reason };
    case "fileNotDownloadable":
      return { status: "file_not_downloadable", reason: error.reason };
    default:
      return { status: "extraction_failed", reason: error.reason };
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function downloadWithRetry(
  source: DocumentSource,
  file: SourceFile,
  attempts: number,
  baseDelayMs: number,
  logger: DeepAnalyzeLogger,
) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await source.getDocument(file);
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !isRetryableDownloadError(error)) throw error;
      const delay = baseDelayMs * 2 ** (attempt - 1);
      logger.log(
        `[retry ${attempt}/${attempts - 1}] ${file.name} in ${delay}ms: ${errorMessage(error)}`,
      );
      await sleep(delay);
    }
  }
  throw lastError;
}

function structuralCount(
  extracted: ExtractedDocument,
  type: "page" | "slide",
): number | undefined {
  const direct = type === "page" ? extracted.pageCount : extracted.slideCount;
  if (direct !== undefined) return direct;
  const values = extracted.sections.flatMap((section) => {
    const value = type === "page" ? section.page : section.slide;
    return value === undefined ? [] : [value];
  });
  return values.length === 0 ? undefined : new Set(values).size;
}

async function analyzeFile(
  file: SourceFile,
  dependencies: DeepAnalyzeDriveDependencies,
  options: Required<Pick<DeepAnalyzeDriveOptions, "retryAttempts" | "retryBaseDelayMs">>,
): Promise<DeepAnalysisFile> {
  const base = {
    ...baseFile(file),
    isDuplicate: false,
    metadataEstimatedChunks: estimatedChunksForFile(file.size, file.mimeType),
  };
  try {
    const sourceFile = await downloadWithRetry(
      dependencies.source,
      file,
      options.retryAttempts,
      options.retryBaseDelayMs,
      dependencies.logger ?? console,
    );
    const extracted = await dependencies.extractorRegistry.extract(sourceFile);
    const extractedCharacters = extracted.sections.reduce(
      (sum, section) => sum + section.text.length,
      0,
    );
    const extractedBytes = extracted.sections.reduce(
      (sum, section) => sum + Buffer.byteLength(section.text, "utf8"),
      0,
    );
    const chunks = chunkExtractedDocument({
      documentId: file.id,
      file,
      extracted,
    });
    if (extractedCharacters === 0 || chunks.length === 0) {
      return {
        ...base,
        status: "empty_document",
        extractedCharacters,
        extractedBytes,
        chunkCount: 0,
        error: "No chunks were generated from the extracted text.",
      };
    }
    let chunkTextPayloadBytes = 0;
    let chunkTextCharacters = 0;
    let metadataPayloadBytes = 0;
    for (const chunk of chunks) {
      const textBytes = Buffer.byteLength(chunk.content, "utf8");
      const serializedBytes = Buffer.byteLength(
        JSON.stringify(createChunkPayload(chunk)),
        "utf8",
      );
      chunkTextPayloadBytes += textBytes;
      chunkTextCharacters += chunk.content.length;
      metadataPayloadBytes += Math.max(0, serializedBytes - textBytes);
    }
    return {
      ...base,
      status: "success",
      ...(structuralCount(extracted, "page") === undefined
        ? {}
        : { pageCount: structuralCount(extracted, "page") }),
      ...(structuralCount(extracted, "slide") === undefined
        ? {}
        : { slideCount: structuralCount(extracted, "slide") }),
      extractedCharacters,
      extractedBytes,
      chunkCount: chunks.length,
      chunkTextCharacters,
      chunkTextPayloadBytes,
      metadataPayloadBytes,
    };
  } catch (error) {
    const empty = error instanceof EmptyDocumentError;
    const acquisition = error instanceof DriveAcquisitionError
      ? acquisitionFailure(error)
      : undefined;
    return {
      ...base,
      status: empty ? "empty_document" : acquisition?.status ?? "extraction_failed",
      ...(empty ? { chunkCount: 0 } : {}),
      ...(acquisition ? { driveErrorReason: acquisition.reason } : {}),
      error: errorMessage(error),
    };
  }
}

async function analyzeConcurrently(
  files: SourceFile[],
  dependencies: DeepAnalyzeDriveDependencies,
  options: Required<
    Pick<
      DeepAnalyzeDriveOptions,
      "concurrency" | "retryAttempts" | "retryBaseDelayMs"
    >
  >,
): Promise<Map<string, DeepAnalysisFile>> {
  const results = new Map<string, DeepAnalysisFile>();
  const logger = dependencies.logger ?? console;
  let nextIndex = 0;
  let completed = 0;
  const worker = async () => {
    while (nextIndex < files.length) {
      const index = nextIndex;
      nextIndex += 1;
      const file = files[index];
      const result = await analyzeFile(file, dependencies, options);
      results.set(file.id, result);
      completed += 1;
      if (result.status === "success") {
        const structure = result.pageCount
          ? `pages=${result.pageCount}`
          : result.slideCount
            ? `slides=${result.slideCount}`
            : "structure=n/a";
        logger.log(
          `[${completed}/${files.length}] ${file.name} ${structure} chars=${result.extractedCharacters} chunks=${result.chunkCount}`,
        );
      } else {
        logger.error(
          `[${completed}/${files.length}] ${file.name} ${result.status}: ${result.error ?? "unknown error"}`,
        );
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(options.concurrency, files.length) }, worker),
  );
  return results;
}

export async function deepAnalyzeDrive(
  dependencies: DeepAnalyzeDriveDependencies,
  options: DeepAnalyzeDriveOptions = {},
): Promise<DeepDriveAnalysisReport> {
  const embeddingDimensions = options.embeddingDimensions ?? 768;
  const capacityGiB = options.capacityGiB ?? 5;
  const concurrency = options.concurrency ?? 3;
  const retryAttempts = options.retryAttempts ?? 3;
  const retryBaseDelayMs = options.retryBaseDelayMs ?? 500;
  const topLimit = options.topLimit ?? 20;
  validatePositiveInteger("embeddingDimensions", embeddingDimensions);
  validatePositiveInteger("concurrency", concurrency);
  validatePositiveInteger("retryAttempts", retryAttempts);
  validatePositiveInteger("topLimit", topLimit);
  if (!Number.isFinite(capacityGiB) || capacityGiB <= 0) {
    throw new Error("capacityGiB must be a positive number.");
  }
  if (!Number.isInteger(retryBaseDelayMs) || retryBaseDelayMs < 0) {
    throw new Error("retryBaseDelayMs must be a non-negative integer.");
  }

  const allFiles = await dependencies.source.listDocuments();
  const supported = allFiles.filter((file) => isSupportedMimeType(file.mimeType));
  const deduplication = deduplicateDocuments(supported);
  const logger = dependencies.logger ?? console;
  for (const pair of deduplication.duplicates) {
    logger.log(
      `[dedup] preferred: ${pair.preferred.name} | skipped: ${pair.skipped.name}`,
    );
  }
  const selected = selectStratifiedSample(
    deduplication.filesToIndex,
    options.sampleSize,
  );
  const selectedIds = new Set(selected.map((file) => file.id));
  const duplicates = duplicateMap(deduplication.duplicates);
  const analyzed = await analyzeConcurrently(selected, dependencies, {
    concurrency,
    retryAttempts,
    retryBaseDelayMs,
  });

  const files: DeepAnalysisFile[] = allFiles.map((file) => {
    const duplicateOf = duplicates.get(file.id);
    if (duplicateOf) {
      return {
        ...baseFile(file),
        status: "duplicate_skipped",
        isDuplicate: true,
        duplicateOfDriveFileId: duplicateOf.id,
      };
    }
    if (!isSupportedMimeType(file.mimeType)) {
      return { ...baseFile(file), status: "unsupported", isDuplicate: false };
    }
    if (!selectedIds.has(file.id)) {
      return {
        ...baseFile(file),
        status: "not_sampled",
        isDuplicate: false,
        metadataEstimatedChunks: estimatedChunksForFile(file.size, file.mimeType),
      };
    }
    const result = analyzed.get(file.id);
    if (!result) {
      return {
        ...baseFile(file),
        status: "extraction_failed",
        isDuplicate: false,
        error: "Internal analysis result is missing.",
      };
    }
    return result;
  });

  return buildDeepDriveAnalysisReport({
    generatedAt: new Date().toISOString(),
    files,
    dimensions: embeddingDimensions,
    capacityBytes: capacityGiB * GIB,
    duplicatePairs: deduplication.duplicates.length,
    requestedSampleSize: options.sampleSize,
    topLimit,
  });
}
