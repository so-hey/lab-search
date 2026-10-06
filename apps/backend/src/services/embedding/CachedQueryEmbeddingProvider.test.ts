import assert from "node:assert/strict";
import test from "node:test";
import type { EmbeddingProvider } from "./EmbeddingProvider.js";
import { CachedQueryEmbeddingProvider } from "./CachedQueryEmbeddingProvider.js";

function fakeProvider(embedQuery: (text: string) => Promise<number[]>): EmbeddingProvider {
  return {
    id: "fake:2",
    dimensions: 2,
    embedQuery,
    embedDocuments: async () => [],
    embedDocument: async () => [1, 0],
    embed: async () => [1, 0],
  };
}

test("同じ検索queryのEmbeddingをTTL内は再利用する", async () => {
  let calls = 0;
  const provider = new CachedQueryEmbeddingProvider(
    fakeProvider(async () => {
      calls += 1;
      return [1, calls];
    }),
    { ttlMs: 1_000, maxEntries: 10, now: () => 100 },
  );

  const first = await provider.embedQuery("  モデル   マージ ");
  first[0] = 99;
  const second = await provider.embedQuery("モデル マージ");

  assert.equal(calls, 1);
  assert.deepEqual(second, [1, 1]);
});

test("同時に届いた同一queryのAPI requestを1回へまとめる", async () => {
  let calls = 0;
  let resolveEmbedding: ((value: number[]) => void) | undefined;
  const provider = new CachedQueryEmbeddingProvider(
    fakeProvider(
      () =>
        new Promise<number[]>((resolve) => {
          calls += 1;
          resolveEmbedding = resolve;
        }),
    ),
    { ttlMs: 1_000, maxEntries: 10 },
  );

  const first = provider.embedQuery("量子コンピュータ");
  const second = provider.embedQuery("量子コンピュータ");
  resolveEmbedding?.([0, 1]);

  assert.deepEqual(await Promise.all([first, second]), [[0, 1], [0, 1]]);
  assert.equal(calls, 1);
});

test("TTL経過後はEmbeddingを再取得する", async () => {
  let now = 0;
  let calls = 0;
  const provider = new CachedQueryEmbeddingProvider(
    fakeProvider(async () => [++calls, 0]),
    { ttlMs: 100, maxEntries: 10, now: () => now },
  );

  await provider.embedQuery("検索");
  now = 101;
  const embedding = await provider.embedQuery("検索");

  assert.deepEqual(embedding, [2, 0]);
});
