import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MIME } from "../mimeTypes.js";
import type { SourceFileContent } from "../source/types.js";
import {
  extractGoogleSlidesPresentation,
  GoogleSlidesDocumentExtractor,
} from "./GoogleSlidesDocumentExtractor.js";

const presentation = {
  presentationId: "presentation-1",
  title: "研究発表",
  slides: [
    {
      objectId: "slide-1",
      pageElements: [
        {
          shape: {
            placeholder: { type: "TITLE" },
            text: {
              textElements: [{ textRun: { content: "モデルマージ\n" } }],
            },
          },
        },
        {
          shape: {
            placeholder: { type: "BODY" },
            text: {
              textElements: [
                { textRun: { content: "破滅的忘却を抑制する。\n" } },
                { autoText: { content: "1" } },
              ],
            },
          },
        },
      ],
    },
    { objectId: "slide-2", pageElements: [{ shape: {} }] },
  ],
};

describe("GoogleSlidesDocumentExtractor", () => {
  it("slide順にtitleとshape textを共通ExtractedDocumentへ変換する", () => {
    const extracted = extractGoogleSlidesPresentation(presentation);
    assert.equal(extracted.slideCount, 2);
    assert.deepEqual(extracted.sections, [
      {
        slide: 1,
        title: "モデルマージ",
        text: "モデルマージ\n破滅的忘却を抑制する。\n1",
      },
    ]);
  });

  it("Slides APIのJSON dataをextractできる", async () => {
    const source: SourceFileContent = {
      file: {
        id: "presentation-1",
        name: "研究発表",
        mimeType: MIME.googleSlides,
        parentIds: ["folder"],
        modifiedTime: "2026-01-01T00:00:00Z",
      },
      data: new TextEncoder().encode(JSON.stringify(presentation)),
      contentMimeType: MIME.googleSlides,
    };
    const extracted = await new GoogleSlidesDocumentExtractor().extract(source);
    assert.equal(extracted.sections[0].slide, 1);
    assert.equal(extracted.sections[0].title, "モデルマージ");
  });
});
