import type { SearchResult } from "@lab-search/shared";
import type { ScoredChunk } from "../../repositories/DocumentRepository.js";

function toRelatedChunk(match: ScoredChunk) {
  return {
    chunkId: match.chunk.id,
    content: match.chunk.content,
    score: match.score,
    ...(match.chunk.page ? { page: match.chunk.page } : {}),
    ...(match.chunk.slide ? { slide: match.chunk.slide } : {}),
    ...(match.chunk.sectionTitle ? { sectionTitle: match.chunk.sectionTitle } : {}),
  };
}

export function groupSearchResults(
  matches: ScoredChunk[],
  limit: number,
): SearchResult[] {
  const groups = new Map<string, ScoredChunk[]>();
  for (const match of matches) {
    const group = groups.get(match.chunk.documentId) ?? [];
    group.push(match);
    groups.set(match.chunk.documentId, group);
  }

  return [...groups.values()]
    .map((group) => group.sort((a, b) => b.score - a.score))
    .sort((a, b) => b[0].score - a[0].score)
    .slice(0, limit)
    .map(([best, ...related]) => ({
      chunkId: best.chunk.id,
      documentId: best.chunk.documentId,
      documentName: best.chunk.documentName,
      ...(best.chunk.mimeType ? { mimeType: best.chunk.mimeType } : {}),
      content: best.chunk.content,
      score: best.score,
      ...(best.chunk.page ? { page: best.chunk.page } : {}),
      ...(best.chunk.slide ? { slide: best.chunk.slide } : {}),
      ...(best.chunk.sectionTitle ? { sectionTitle: best.chunk.sectionTitle } : {}),
      ...(best.chunk.url ? { url: best.chunk.url } : {}),
      ...(related.length > 0 ? { relatedChunks: related.map(toRelatedChunk) } : {}),
    }));
}
