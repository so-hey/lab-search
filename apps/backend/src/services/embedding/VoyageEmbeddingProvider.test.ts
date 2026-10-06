import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { VoyageEmbeddingProvider } from "./VoyageEmbeddingProvider.js";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
}

describe("VoyageEmbeddingProvider", () => {
  it("document/queryのinput_typeを分離し、response index順に正規化する", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const provider = new VoyageEmbeddingProvider({
      apiKey: "test",
      model: "voyage-4-lite",
      dimensions: 2,
      fetch: async (_input, init) => {
        requests.push(
          JSON.parse(String(init?.body)) as Record<string, unknown>,
        );
        const current = requests.length;
        return current === 1
          ? jsonResponse({
              data: [
                { index: 1, embedding: [0, 5] },
                { index: 0, embedding: [3, 4] },
              ],
            })
          : jsonResponse({ data: [{ index: 0, embedding: [4, 3] }] });
      },
    });

    const documents = await provider.embedDocuments(
      ["本文A", "本文B"],
      "paper.pdf",
    );
    const query = await provider.embedQuery("検索語");

    assert.deepEqual(documents, [
      [0.6, 0.8],
      [0, 1],
    ]);
    assert.deepEqual(query, [0.8, 0.6]);
    assert.deepEqual(requests[0], {
      input: ["paper.pdf\n本文A", "paper.pdf\n本文B"],
      model: "voyage-4-lite",
      input_type: "document",
      output_dimension: 2,
      output_dtype: "float",
      truncation: true,
    });
    assert.equal(requests[1].input_type, "query");
  });

  it("429ではRetry-Afterに従って同じbatchを再試行する", async () => {
    let calls = 0;
    const delays: number[] = [];
    const provider = new VoyageEmbeddingProvider({
      apiKey: "test",
      dimensions: 2,
      fetch: async () => {
        calls += 1;
        if (calls === 1) {
          return jsonResponse(
            { detail: "rate limited" },
            { status: 429, headers: { "Retry-After": "2" } },
          );
        }
        return jsonResponse({ data: [{ index: 0, embedding: [1, 0] }] });
      },
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
      },
    });

    assert.deepEqual(await provider.embedQuery("検索語"), [1, 0]);
    assert.equal(calls, 2);
    assert.deepEqual(delays, [2_000]);
  });

  it("認証エラーは再試行せずAPIのdetailを通知する", async () => {
    let calls = 0;
    const provider = new VoyageEmbeddingProvider({
      apiKey: "invalid",
      dimensions: 2,
      fetch: async () => {
        calls += 1;
        return jsonResponse({ detail: "invalid API key" }, { status: 401 });
      },
    });

    await assert.rejects(
      provider.embedQuery("検索語"),
      /Voyage Embedding API failed \(401\): invalid API key/u,
    );
    assert.equal(calls, 1);
  });

  it("TPM budgetを超えないよう、大きな入力配列を内部で分割する", async () => {
    const batchSizes: number[] = [];
    const provider = new VoyageEmbeddingProvider({
      apiKey: "test",
      dimensions: 2,
      requestsPerMinute: 100,
      tokensPerMinute: 120,
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { input: string[] };
        batchSizes.push(body.input.length);
        return jsonResponse({
          data: body.input.map((_, index) => ({
            index,
            embedding: [1, 0],
          })),
        });
      },
    });

    const vectors = await provider.embedDocuments(
      Array.from({ length: 7 }, () => "a"),
    );

    assert.equal(vectors.length, 7);
    assert.deepEqual(batchSizes, [6, 1]);
  });

  it("設定したRPMを超える次のrequestを60秒windowの外まで待機させる", async () => {
    let now = 0;
    const delays: number[] = [];
    const provider = new VoyageEmbeddingProvider({
      apiKey: "test",
      dimensions: 2,
      requestsPerMinute: 1,
      tokensPerMinute: 10_000,
      now: () => now,
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
        now += milliseconds;
      },
      fetch: async () =>
        jsonResponse({ data: [{ index: 0, embedding: [1, 0] }] }),
    });

    await provider.embedDocument("文書");
    await provider.embedQuery("検索");

    assert.deepEqual(delays, [60_250]);
  });
});
