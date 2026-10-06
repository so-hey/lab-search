import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ScoredChunk } from "../../repositories/DocumentRepository.js";
import { groupSearchResults } from "./groupSearchResults.js";

function match(documentId: string, chunkIndex: number, score: number): ScoredChunk {
  return {
    score,
    chunk: { id: `${documentId}:${chunkIndex}`, documentId, documentName: `${documentId}.pdf`, chunkIndex, content: "text", embedding: [] },
  };
}

describe("groupSearchResults", () => {
  it("文書ごとの最高scoreを採用し関連chunkを保持する", () => {
    const result = groupSearchResults([
      match("a", 1, 0.84), match("b", 0, 0.82), match("a", 0, 0.88),
    ], 5);
    assert.deepEqual(result.map((item) => [item.documentId, item.score]), [["a", 0.88], ["b", 0.82]]);
    assert.equal(result[0].relatedChunks?.[0].score, 0.84);
  });
});
