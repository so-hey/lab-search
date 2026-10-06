import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { VoyageReranker } from "./VoyageReranker.js";

describe("VoyageReranker", () => {
  it("documentをVoyage APIへ送り、indexとrelevance scoreを返す", async () => {
    let requestBody: unknown;
    let authorization: string | null = null;
    const request = (async (_input: string | URL | Request, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      authorization = new Headers(init?.headers).get("authorization");
      return new Response(
        JSON.stringify({
          data: [
            { index: 1, relevance_score: 0.93 },
            { index: 0, relevance_score: 0.71 },
          ],
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    const reranker = new VoyageReranker({
      apiKey: "secret",
      model: "rerank-2.5-lite",
      fetch: request,
    });

    const results = await reranker.rerank(
      "量子誤り訂正",
      ["文書A", "文書B", "文書C"],
      2,
    );

    assert.equal(authorization, "Bearer secret");
    assert.deepEqual(requestBody, {
      query: "量子誤り訂正",
      documents: ["文書A", "文書B", "文書C"],
      model: "rerank-2.5-lite",
      top_k: 2,
      return_documents: false,
      truncation: true,
    });
    assert.deepEqual(results, [
      { index: 1, score: 0.93 },
      { index: 0, score: 0.71 },
    ]);
  });

  it("429ではRetry-Afterを待って同じrequestを再試行する", async () => {
    let attempts = 0;
    const delays: number[] = [];
    const request = (async () => {
      attempts += 1;
      if (attempts === 1) {
        return new Response(JSON.stringify({ detail: "rate limited" }), {
          status: 429,
          headers: { "retry-after": "2" },
        });
      }
      return new Response(
        JSON.stringify({ data: [{ index: 0, relevance_score: 0.8 }] }),
        { status: 200 },
      );
    }) as typeof fetch;
    const reranker = new VoyageReranker({
      apiKey: "secret",
      maxRetries: 2,
      fetch: request,
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
      },
    });

    const results = await reranker.rerank("query", ["document"], 1);

    assert.equal(attempts, 2);
    assert.deepEqual(delays, [2_000]);
    assert.deepEqual(results, [{ index: 0, score: 0.8 }]);
  });
});
