import type { SourceFileContent } from "../source/types.js";

export type ExtractedSection = {
  text: string;
  page?: number;
  slide?: number;
  title?: string;
};

export type ExtractedDocument = {
  sections: ExtractedSection[];
  pageCount?: number;
  slideCount?: number;
};

export class EmptyDocumentError extends Error {}

export interface DocumentExtractor {
  supports(mimeType: string): boolean;
  extract(source: SourceFileContent): Promise<ExtractedDocument>;
}
