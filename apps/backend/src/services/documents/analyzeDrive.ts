import { deduplicateDocuments, logDuplicates } from "./deduplicateDocuments.js";
import { formatCategory, isSupportedMimeType, MIME } from "./mimeTypes.js";
import type { DocumentSource } from "./source/types.js";

export type DriveAnalysis = {
  counts: Record<string, number>;
  supportedFiles: number;
  duplicates: number;
  estimatedChunks: number;
  estimatedVectorBytes: number;
};

export function estimatedChunksForFile(
  size: number | undefined,
  mimeType: string,
): number {
  if (size === undefined) return 1;
  if (mimeType === MIME.pptx || mimeType === MIME.googleSlides) {
    return Math.max(1, Math.ceil(size / 80_000));
  }
  const estimatedTextCharacters = size / 3;
  return Math.max(1, Math.ceil(estimatedTextCharacters / 800));
}

export async function analyzeDrive(
  source: DocumentSource,
  embeddingDimensions: number,
): Promise<DriveAnalysis> {
  const files = await source.listDocuments();
  const counts: Record<string, number> = {
    PDF: 0,
    PPTX: 0,
    "Google Slides": 0,
    DOCX: 0,
    "Google Docs": 0,
    Other: 0,
  };
  for (const file of files) counts[formatCategory(file.mimeType)] += 1;
  const supported = files.filter((file) => isSupportedMimeType(file.mimeType));
  const deduplication = deduplicateDocuments(supported);
  logDuplicates(deduplication.duplicates);
  const estimatedChunks = deduplication.filesToIndex.reduce(
    (sum, file) => sum + estimatedChunksForFile(file.size, file.mimeType),
    0,
  );
  return {
    counts,
    supportedFiles: supported.length,
    duplicates: deduplication.duplicates.length,
    estimatedChunks,
    estimatedVectorBytes: estimatedChunks * embeddingDimensions * 4,
  };
}
