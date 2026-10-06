import type { DocumentChunk } from "./types.js";

const DEFAULT_CHUNK_SIZE = 700;
const DEFAULT_OVERLAP = 100;
const BOUNDARY_LOOKBACK = 160;

export type SourceDocument = {
  id: string;
  name: string;
  content: string;
  sourceModifiedTime?: string;
  driveFileId?: string;
  mimeType?: string;
  page?: number;
  slide?: number;
  sectionTitle?: string;
  url?: string;
};

export type ChunkOptions = {
  chunkSize?: number;
  overlap?: number;
};

function findLastBoundary(
  text: string,
  start: number,
  end: number,
  pattern: RegExp,
): number | undefined {
  const segment = text.slice(start, end);
  let boundary: number | undefined;

  for (const match of segment.matchAll(pattern)) {
    boundary = start + (match.index ?? 0) + match[0].length;
  }

  return boundary;
}

function chooseChunkEnd(
  text: string,
  start: number,
  targetEnd: number,
): number {
  if (targetEnd === text.length) {
    return targetEnd;
  }

  const searchStart = Math.max(start + 1, targetEnd - BOUNDARY_LOOKBACK);
  const boundaryPatterns = [
    /\n\s*\n/gu,
    /\n/gu,
    /[.!?。！？]["'”’）)]*\s*/gu,
    /\s+/gu,
  ];

  for (const pattern of boundaryPatterns) {
    const boundary = findLastBoundary(text, searchStart, targetEnd, pattern);
    if (boundary !== undefined) {
      return boundary;
    }
  }

  return targetEnd;
}

function chooseNextStart(
  text: string,
  currentStart: number,
  end: number,
  overlap: number,
): number {
  if (overlap === 0) {
    return end;
  }

  const desiredStart = Math.max(currentStart + 1, end - overlap);
  const searchStart = Math.max(currentStart + 1, desiredStart - 40);
  const naturalStart = findLastBoundary(
    text,
    searchStart,
    desiredStart,
    /\s+/gu,
  );

  return naturalStart ?? desiredStart;
}

export function chunkDocument(
  document: SourceDocument,
  options: ChunkOptions = {},
): DocumentChunk[] {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const overlap = options.overlap ?? DEFAULT_OVERLAP;

  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new Error("chunkSize must be a positive integer.");
  }

  if (!Number.isInteger(overlap) || overlap < 0 || overlap >= chunkSize) {
    throw new Error("overlap must be an integer from 0 to chunkSize - 1.");
  }

  const text = document.content.replace(/\r\n?/g, "\n").trim();
  if (!text) {
    return [];
  }

  const chunks: DocumentChunk[] = [];
  let start = 0;

  while (start < text.length) {
    const targetEnd = Math.min(start + chunkSize, text.length);
    const end = chooseChunkEnd(text, start, targetEnd);
    const content = text.slice(start, end).trim();

    if (content) {
      const chunkIndex = chunks.length;
      chunks.push({
        id: `${document.id}:${chunkIndex}`,
        documentId: document.id,
        ...(document.sourceModifiedTime
          ? { sourceModifiedTime: document.sourceModifiedTime }
          : {}),
        ...(document.driveFileId ? { driveFileId: document.driveFileId } : {}),
        documentName: document.name,
        ...(document.mimeType ? { mimeType: document.mimeType } : {}),
        chunkIndex,
        content,
        ...(document.page ? { page: document.page } : {}),
        ...(document.slide ? { slide: document.slide } : {}),
        ...(document.sectionTitle
          ? { sectionTitle: document.sectionTitle }
          : {}),
        ...(document.url ? { url: document.url } : {}),
      });
    }

    if (end >= text.length) {
      break;
    }

    start = chooseNextStart(text, start, end, overlap);
  }

  return chunks;
}
