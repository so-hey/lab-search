import { strFromU8, unzipSync } from "fflate";
import { MIME } from "../mimeTypes.js";
import type { SourceFileContent } from "../source/types.js";
import {
  EmptyDocumentError,
  type DocumentExtractor,
  type ExtractedDocument,
} from "./DocumentExtractor.js";
import { xmlTextValues } from "./xml.js";

function slideNumber(path: string): number {
  return Number(path.match(/slide(\d+)\.xml$/u)?.[1] ?? Number.MAX_SAFE_INTEGER);
}

export class PptxDocumentExtractor implements DocumentExtractor {
  supports(mimeType: string): boolean {
    return mimeType === MIME.pptx;
  }

  async extract(source: SourceFileContent): Promise<ExtractedDocument> {
    const archive = unzipSync(source.data);
    const slidePaths = Object.keys(archive)
      .filter((path) => /^ppt\/slides\/slide\d+\.xml$/u.test(path))
      .sort((a, b) => slideNumber(a) - slideNumber(b));
    const sections = slidePaths.flatMap((path) => {
      const values = xmlTextValues(strFromU8(archive[path]), "a:t");
      if (values.length === 0) return [];
      return [{
        text: values.join("\n"),
        slide: slideNumber(path),
        ...(values[0] ? { title: values[0] } : {}),
      }];
    });
    if (sections.length === 0) {
      throw new EmptyDocumentError("PPTX contains no extractable text.");
    }
    return { sections, slideCount: slidePaths.length };
  }
}
