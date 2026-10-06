import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chunkExtractedDocument } from "./chunkExtractedDocument.js";
import { MIME } from "./mimeTypes.js";

describe("chunkExtractedDocument", () => {
  it("PPTXのslide番号をchunkに維持する", () => {
    const chunks = chunkExtractedDocument({
      documentId: "doc",
      file: { id: "drive", name: "seminar.pptx", mimeType: MIME.pptx, parentIds: ["root"], modifiedTime: "2026-01-01T00:00:00Z" },
      extracted: { sections: [{ text: "タイトル\n本文", slide: 3, title: "タイトル" }] },
    });
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].slide, 3);
    assert.equal(chunks[0].sectionTitle, "タイトル");
    assert.equal(chunks[0].sourceModifiedTime, "2026-01-01T00:00:00Z");
  });
});
