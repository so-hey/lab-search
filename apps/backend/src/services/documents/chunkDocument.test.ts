import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chunkDocument } from "./chunkDocument.js";

const document = {
  id: "document-1",
  name: "paper.pdf",
  content:
    "アルファではモデルマージの基本手法について詳しく説明します。" +
    "ベータでは統合したモデルを複数のベンチマークで慎重に評価します。" +
    "ガンマでは最終的な実験結果と今後の研究課題を報告します。",
};

describe("chunkDocument", () => {
  it("prefers a natural sentence boundary near the target size", () => {
    const chunks = chunkDocument(document, { chunkSize: 55, overlap: 12 });

    assert.ok(chunks.length > 1);
    assert.match(chunks[0].content, /。$/);
    assert.ok(chunks.every((chunk) => chunk.content.length <= 55));
  });

  it("keeps overlap between neighboring chunks", () => {
    const chunks = chunkDocument(document, { chunkSize: 50, overlap: 12 });

    assert.ok(chunks.length > 1);
    assert.ok(
      chunks[1].content.includes(chunks[0].content.slice(-10).trim()),
    );
  });

  it("rejects overlap that is not smaller than chunkSize", () => {
    assert.throws(
      () => chunkDocument(document, { chunkSize: 10, overlap: 10 }),
      /overlap/,
    );
  });
});
