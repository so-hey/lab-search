import assert from "node:assert/strict";
import test from "node:test";
import { keepFreeServicesAlive } from "./keepFreeServicesAlive.js";

test("Supabaseを軽量SELECTし、Zillizをvectorなしでqueryする", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const request = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.includes("/v2/vectordb/entities/query")) {
      return Response.json({ code: 0, cost: 1, data: [{ id: "chunk-1" }] });
    }
    return Response.json([{ id: "row-1" }]);
  }) as typeof fetch;

  const result = await keepFreeServicesAlive({
    supabaseUrl: "https://example.supabase.co/",
    supabaseSecretKey: "sb_secret_supabase-secret",
    zillizEndpoint: "https://example.zillizcloud.com/",
    zillizToken: "zilliz-token",
    zillizCollection: "document_chunks",
    request,
  });

  assert.deepEqual(result, {
    supabaseQueries: 3,
    zillizEntities: 1,
    zillizCost: 1,
  });
  assert.equal(requests.length, 4);
  assert.match(requests[0]!.url, /documents\?select=id&limit=1/u);
  assert.equal(
    (requests[0]!.init?.headers as Record<string, string>).apikey,
    "sb_secret_supabase-secret",
  );
  assert.equal(
    (requests[0]!.init?.headers as Record<string, string>).Authorization,
    undefined,
  );
  assert.deepEqual(JSON.parse(String(requests[3]!.init?.body)), {
    collectionName: "document_chunks",
    outputFields: ["id"],
    limit: 1,
  });
});

test("外部サービスの失敗をサービス名とstatus付きで返す", async () => {
  const request = (async () =>
    new Response('{"message":"project paused"}', {
      status: 503,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;

  await assert.rejects(
    keepFreeServicesAlive({
      supabaseUrl: "https://example.supabase.co",
      supabaseSecretKey: "supabase-secret",
      zillizEndpoint: "https://example.zillizcloud.com",
      zillizToken: "zilliz-token",
      zillizCollection: "document_chunks",
      request,
    }),
    /Supabase keep-alive failed for documents \(503\).*project paused/u,
  );
});
