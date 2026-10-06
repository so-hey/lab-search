import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { strToU8, zipSync } from "fflate";
import { MIME } from "../mimeTypes.js";
import type { SourceFileContent } from "../source/types.js";
import { DocxDocumentExtractor } from "./DocxDocumentExtractor.js";
import { PptxDocumentExtractor } from "./PptxDocumentExtractor.js";

function source(data: Uint8Array, contentMimeType: string): SourceFileContent {
  return {
    data,
    contentMimeType,
    file: { id: "file", name: "sample", mimeType: contentMimeType, parentIds: ["folder"], modifiedTime: "2026-01-01T00:00:00Z" },
  };
}

describe("Office document extractors", () => {
  it("PPTXをslide順に抽出して番号とtitleを保持する", async () => {
    const data = zipSync({
      "ppt/slides/slide2.xml": strToU8("<p:sld><a:t>二枚目</a:t><a:t>本文</a:t></p:sld>"),
      "ppt/slides/slide1.xml": strToU8("<p:sld><a:t>一枚目</a:t></p:sld>"),
    });
    const result = await new PptxDocumentExtractor().extract(source(data, MIME.pptx));
    assert.equal(result.slideCount, 2);
    assert.deepEqual(result.sections.map((item) => [item.slide, item.title]), [[1, "一枚目"], [2, "二枚目"]]);
  });

  it("DOCXをheadingごとのsectionとして抽出する", async () => {
    const xml = '<w:document><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>概要</w:t></w:r></w:p><w:p><w:r><w:t>研究の本文</w:t></w:r></w:p></w:body></w:document>';
    const data = zipSync({ "word/document.xml": strToU8(xml) });
    const result = await new DocxDocumentExtractor().extract(source(data, MIME.docx));
    assert.deepEqual(result.sections, [{ title: "概要", text: "研究の本文" }]);
  });
});
