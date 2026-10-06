import { MIME } from "../mimeTypes.js";
import type { SourceFileContent } from "../source/types.js";
import {
  EmptyDocumentError,
  type DocumentExtractor,
  type ExtractedDocument,
} from "./DocumentExtractor.js";

type GoogleSlidesTextElement = {
  textRun?: { content?: string };
  autoText?: { content?: string };
};

type GoogleSlidesShape = {
  placeholder?: { type?: string };
  text?: { textElements?: GoogleSlidesTextElement[] };
};

type GoogleSlidesPageElement = {
  shape?: GoogleSlidesShape;
};

export type GoogleSlidesPresentation = {
  presentationId?: string;
  title?: string;
  slides?: Array<{
    objectId?: string;
    pageElements?: GoogleSlidesPageElement[];
  }>;
};

function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\r\n?/gu, "\n")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function shapeText(shape: GoogleSlidesShape): string {
  const text = (shape.text?.textElements ?? [])
    .map((element) => element.textRun?.content ?? element.autoText?.content ?? "")
    .join("");
  return normalizeText(text);
}

function isTitlePlaceholder(type: string | undefined): boolean {
  return type === "TITLE" || type === "CENTERED_TITLE";
}

export function extractGoogleSlidesPresentation(
  presentation: GoogleSlidesPresentation,
): ExtractedDocument {
  const slides = presentation.slides ?? [];
  const sections = slides.flatMap((slide, index) => {
    const shapes = (slide.pageElements ?? []).flatMap((element) =>
      element.shape ? [element.shape] : [],
    );
    const values = shapes.map(shapeText).filter((text) => text.length > 0);
    if (values.length === 0) return [];
    const title = shapes
      .filter((shape) => isTitlePlaceholder(shape.placeholder?.type))
      .map(shapeText)
      .find((text) => text.length > 0);
    return [{
      text: values.join("\n"),
      slide: index + 1,
      ...(title ? { title } : {}),
    }];
  });
  if (sections.length === 0) {
    throw new EmptyDocumentError("Google Slides presentation contains no extractable text.");
  }
  return { sections, slideCount: slides.length };
}

export class GoogleSlidesDocumentExtractor implements DocumentExtractor {
  supports(mimeType: string): boolean {
    return mimeType === MIME.googleSlides;
  }

  async extract(source: SourceFileContent): Promise<ExtractedDocument> {
    let presentation: GoogleSlidesPresentation;
    try {
      presentation = JSON.parse(new TextDecoder().decode(source.data)) as GoogleSlidesPresentation;
    } catch (cause) {
      throw new Error("Google Slides API returned invalid presentation JSON.", { cause });
    }
    return extractGoogleSlidesPresentation(presentation);
  }
}
