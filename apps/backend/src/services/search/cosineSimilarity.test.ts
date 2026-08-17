import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cosineSimilarity } from "./cosineSimilarity.js";

describe("cosineSimilarity", () => {
  it("returns one for identical vectors", () => {
    assert.equal(cosineSimilarity([1, 2, 3], [1, 2, 3]), 1);
  });

  it("returns zero for orthogonal or zero vectors", () => {
    assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
    assert.equal(cosineSimilarity([0, 0], [1, 1]), 0);
  });

  it("rejects vectors with different dimensions", () => {
    assert.throws(() => cosineSimilarity([1], [1, 2]), /dimensions/);
  });
});
