import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cosineSimilarity } from "../search/cosineSimilarity.js";
import { LocalEmbeddingProvider } from "./LocalEmbeddingProvider.js";

describe("LocalEmbeddingProvider", () => {
  it("creates deterministic fixed-size embeddings", async () => {
    const provider = new LocalEmbeddingProvider(128);
    const first = await provider.embed("モデルマージの手法");
    const second = await provider.embed("モデルマージの手法");

    assert.equal(first.length, 128);
    assert.deepEqual(first, second);
  });

  it("scores overlapping text above unrelated text", async () => {
    const provider = new LocalEmbeddingProvider(256);
    const query = await provider.embed("資料検索");
    const related = await provider.embed(
      "研究室の資料検索システムではPDF文書を検索できます",
    );
    const unrelated = await provider.embed(
      "海洋生物の生態と沿岸環境について観察します",
    );

    assert.ok(
      cosineSimilarity(query, related) > cosineSimilarity(query, unrelated),
    );
  });
});
