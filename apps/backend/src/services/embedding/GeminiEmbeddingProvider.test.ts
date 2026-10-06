import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GoogleGenAI } from "@google/genai";
import { EmbeddingQuotaError } from "./EmbeddingProvider.js";
import {
  classifyGeminiEmbeddingError,
  GeminiEmbeddingProvider,
} from "./GeminiEmbeddingProvider.js";

describe("GeminiEmbeddingProvider", () => {
  it("複数文書を最大100件ずつbatch送信する", async () => {
    const batchSizes: number[] = [];
    const client = {
      async embedContent(input: { contents: unknown }) {
        const contents = input.contents as string[];
        batchSizes.push(contents.length);
        return {
          embeddings: contents.map(() => ({ values: [3, 4] })),
        };
      },
    } as unknown as GoogleGenAI["models"];
    const provider = new GeminiEmbeddingProvider({
      apiKey: "test",
      dimensions: 2,
      requestsPerMinute: 60_000,
      client,
    });

    const vectors = await provider.embedDocuments(
      Array.from({ length: 101 }, (_, index) => `chunk-${index}`),
      "paper.pdf",
    );

    assert.deepEqual(batchSizes, [100, 1]);
    assert.equal(vectors.length, 101);
    assert.deepEqual(vectors[0], [0.6, 0.8]);
  });

  it("free tierの日次429を一時的rate limitと区別する", () => {
    const cause = Object.assign(
      new Error(
        '{"error":{"details":[{"quotaId":"EmbedContentRequestsPerDayPerUserPerProjectPerModel-FreeTier"},{"retryDelay":"10s"}]}}',
      ),
      { status: 429 },
    );

    const classified = classifyGeminiEmbeddingError(cause);

    assert.ok(classified instanceof EmbeddingQuotaError);
    assert.equal(classified.scope, "daily");
    assert.equal(classified.retryAfterMs, 10_000);
  });

  it("分間rate limitではretryDelayを待って同じbatchを再試行する", async () => {
    let calls = 0;
    let now = 0;
    const delays: number[] = [];
    const client = {
      async embedContent() {
        calls += 1;
        if (calls === 1) {
          throw Object.assign(
            new Error(
              '{"error":{"details":[{"quotaId":"EmbedContentRequestsPerMinutePerUserPerProjectPerModel-FreeTier"},{"retryDelay":"37s"}]}}',
            ),
            { status: 429 },
          );
        }
        return { embeddings: [{ values: [3, 4] }] };
      },
    } as unknown as GoogleGenAI["models"];
    const provider = new GeminiEmbeddingProvider({
      apiKey: "test",
      dimensions: 2,
      client,
      now: () => now,
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
        now += milliseconds;
      },
    });

    const vector = await provider.embedQuery("検索クエリ");

    assert.deepEqual(vector, [0.6, 0.8]);
    assert.equal(calls, 2);
    assert.deepEqual(delays, [38_000]);
  });

  it("日次quotaは待機・再試行せず呼び出し元へ通知する", async () => {
    let calls = 0;
    const delays: number[] = [];
    const client = {
      async embedContent() {
        calls += 1;
        throw Object.assign(
          new Error(
            '{"error":{"details":[{"quotaId":"EmbedContentRequestsPerDayPerUserPerProjectPerModel-FreeTier"},{"retryDelay":"10s"}]}}',
          ),
          { status: 429 },
        );
      },
    } as unknown as GoogleGenAI["models"];
    const provider = new GeminiEmbeddingProvider({
      apiKey: "test",
      dimensions: 2,
      client,
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
      },
    });

    await assert.rejects(
      provider.embedQuery("検索クエリ"),
      (error: unknown) =>
        error instanceof EmbeddingQuotaError && error.scope === "daily",
    );
    assert.equal(calls, 1);
    assert.deepEqual(delays, []);
  });
});
