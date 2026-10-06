import { PDFParse } from "pdf-parse";
import { MIME } from "../mimeTypes.js";
import type { SourceFileContent } from "../source/types.js";
import {
  EmptyDocumentError,
  type DocumentExtractor,
  type ExtractedDocument,
} from "./DocumentExtractor.js";

export async function extractPdfSections(data: Uint8Array): Promise<ExtractedDocument> {
  const parser = new PDFParse({ data });
  try {
    const result = await parser.getText();
    const sections = result.pages
      .map((page) => ({
        text: page.text.normalize("NFKC").replace(/\r\n?/g, "\n").trim(),
        page: page.num,
      }))
      .filter((section) => section.text.length > 0);
    if (sections.length === 0) {
      throw new EmptyDocumentError("PDF contains no extractable text.");
    }
    return { sections, pageCount: result.pages.length };
  } finally {
    await parser.destroy();
  }
}

export class PdfDocumentExtractor implements DocumentExtractor {
  supports(mimeType: string): boolean {
    return mimeType === MIME.pdf;
  }

  async extract(source: SourceFileContent): Promise<ExtractedDocument> {
    return extractPdfSections(source.data);
  }
}
