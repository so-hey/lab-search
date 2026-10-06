import { strFromU8, unzipSync } from "fflate";
import { MIME } from "../mimeTypes.js";
import type { SourceFileContent } from "../source/types.js";
import {
  EmptyDocumentError,
  type DocumentExtractor,
  type ExtractedDocument,
  type ExtractedSection,
} from "./DocumentExtractor.js";
import { decodeXml, xmlTextValues } from "./xml.js";

export class DocxDocumentExtractor implements DocumentExtractor {
  supports(mimeType: string): boolean {
    return mimeType === MIME.docx;
  }

  async extract(source: SourceFileContent): Promise<ExtractedDocument> {
    const archive = unzipSync(source.data);
    const document = archive["word/document.xml"];
    if (!document) throw new Error("DOCX has no word/document.xml.");
    const xml = strFromU8(document);
    const paragraphs = [...xml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/gu)];
    const sections: ExtractedSection[] = [];
    let currentTitle: string | undefined;
    let currentParagraphs: string[] = [];

    const flush = () => {
      const text = currentParagraphs.join("\n").trim();
      if (text) sections.push({ text, ...(currentTitle ? { title: currentTitle } : {}) });
      currentParagraphs = [];
    };

    for (const paragraph of paragraphs) {
      const body = paragraph[1];
      const text = xmlTextValues(body, "w:t").join("").trim();
      if (!text) continue;
      const style = body.match(/<w:pStyle[^>]*w:val="([^"]+)"[^>]*\/?\s*>/u)?.[1];
      if (style && /^(?:Heading|見出し)\d*/iu.test(decodeXml(style))) {
        flush();
        currentTitle = text;
      } else {
        currentParagraphs.push(text);
      }
    }
    flush();
    if (sections.length === 0 && currentTitle) sections.push({ text: currentTitle, title: currentTitle });
    if (sections.length === 0) {
      throw new EmptyDocumentError("DOCX contains no extractable text.");
    }
    return { sections };
  }
}
