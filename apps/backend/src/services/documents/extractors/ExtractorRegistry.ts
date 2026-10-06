import type { SourceFileContent } from "../source/types.js";
import { DocxDocumentExtractor } from "./DocxDocumentExtractor.js";
import type { DocumentExtractor, ExtractedDocument } from "./DocumentExtractor.js";
import { GoogleSlidesDocumentExtractor } from "./GoogleSlidesDocumentExtractor.js";
import { PdfDocumentExtractor } from "./PdfDocumentExtractor.js";
import { PptxDocumentExtractor } from "./PptxDocumentExtractor.js";

export class ExtractorRegistry {
  constructor(
    private readonly extractors: DocumentExtractor[] = [
      new PdfDocumentExtractor(),
      new PptxDocumentExtractor(),
      new GoogleSlidesDocumentExtractor(),
      new DocxDocumentExtractor(),
    ],
  ) {}

  async extract(source: SourceFileContent): Promise<ExtractedDocument> {
    const extractor = this.extractors.find((item) => item.supports(source.contentMimeType));
    if (!extractor) throw new Error(`Unsupported MIME type: ${source.contentMimeType}`);
    return extractor.extract(source);
  }
}
