import { MIME } from "./mimeTypes.js";
import type { SourceFile } from "./source/types.js";
import type { ExtractedDocument } from "./extractors/DocumentExtractor.js";
import { chunkDocument } from "./chunkDocument.js";
import type { DocumentChunk } from "./types.js";

export type ChunkExtractedInput = {
  documentId: string;
  file: SourceFile;
  extracted: ExtractedDocument;
};

function strategy(mimeType: string) {
  if (mimeType === MIME.pptx || mimeType === MIME.googleSlides) {
    return { chunkSize: 1500, overlap: 100 };
  }
  if (mimeType === MIME.pdf) return { chunkSize: 900, overlap: 120 };
  return { chunkSize: 900, overlap: 100 };
}

export function chunkExtractedDocument(input: ChunkExtractedInput): DocumentChunk[] {
  const options = strategy(input.file.mimeType);
  const result: DocumentChunk[] = [];

  for (const section of input.extracted.sections) {
    const chunks = chunkDocument(
      {
        id: input.documentId,
        name: input.file.name,
        content: section.text,
        sourceModifiedTime: input.file.modifiedTime,
        driveFileId: input.file.id,
        mimeType: input.file.mimeType,
        ...(section.page ? { page: section.page } : {}),
        ...(section.slide ? { slide: section.slide } : {}),
        ...(section.title ? { sectionTitle: section.title } : {}),
        ...(input.file.webViewLink ? { url: input.file.webViewLink } : {}),
      },
      options,
    );
    for (const chunk of chunks) {
      const chunkIndex = result.length;
      result.push({ ...chunk, id: `${input.documentId}:${chunkIndex}`, chunkIndex });
    }
  }
  return result;
}
