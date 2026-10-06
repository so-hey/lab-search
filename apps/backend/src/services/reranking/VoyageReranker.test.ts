import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RerankerRateLimitError } from "./Reranker.js";
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
      model: "rerank-3-lite",
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
      model: "rerank-3-lite",
      top_k: 2,
      return_documents: false,
      truncation: true,
    });
    assert.deepEqual(results, [
      { index: 1, score: 0.93 },
      { index: 0, score: 0.71 },
    ]);
  });

  it("429では再試行せずRetry-After付きのrate limit errorを返す", async () => {
    let attempts = 0;
    const request = (async () => {
      attempts += 1;
      return new Response(JSON.stringify({ detail: "rate limited" }), {
        status: 429,
        headers: { "retry-after": "2" },
      });
    }) as typeof fetch;
    const reranker = new VoyageReranker({
      apiKey: "secret",
      maxRetries: 2,
      fetch: request,
    });

    await assert.rejects(
      reranker.rerank("query", ["document"], 1),
      (error: unknown) =>
        error instanceof RerankerRateLimitError && error.retryAfterMs === 2_000,
    );

    assert.equal(attempts, 1);
  });

  it("設定したRPMを超えるrequestはAPIを呼ばずにfallback用errorを返す", async () => {
    let attempts = 0;
    let now = 1_000;
    const request = (async () => {
      attempts += 1;
      return new Response(
        JSON.stringify({ data: [{ index: 0, relevance_score: 0.8 }] }),
        { status: 200 },
      );
    }) as typeof fetch;
    const reranker = new VoyageReranker({
      apiKey: "secret",
      requestsPerMinute: 1,
      fetch: request,
      now: () => now,
    });

    await reranker.rerank("query", ["document"], 1);
    await assert.rejects(
      reranker.rerank("query", ["document"], 1),
      (error: unknown) =>
        error instanceof RerankerRateLimitError && error.retryAfterMs === 60_000,
    );
    assert.equal(attempts, 1);

    now += 60_000;
    await reranker.rerank("query", ["document"], 1);
    assert.equal(attempts, 2);
  });
});
