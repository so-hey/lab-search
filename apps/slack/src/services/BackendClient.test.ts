import assert from "node:assert/strict";
import { it } from "node:test";
import { BackendClient } from "./BackendClient.js";

it("BackendClientはSlack service tokenとuser identityを検索APIへ送る", async () => {
  let url = "";
  let request: RequestInit | undefined;
  const client = new BackendClient(
    "https://backend.example.com/",
    "a".repeat(64),
    async (input, init) => {
      url = String(input);
      request = init;
      return new Response(
        JSON.stringify({ searchLogId: "log-1", results: [] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
  );

  const result = await client.search(
    "モデルマージ",
    {
      teamId: "T-LAB",
      userId: "U123",
      email: "member@example.ac.jp",
    },
    5,
  );

  assert.equal(url, "https://backend.example.com/api/search");
  assert.equal(new Headers(request?.headers).get("Authorization"), `Bearer ${"a".repeat(64)}`);
  assert.equal(new Headers(request?.headers).get("X-Slack-Team-Id"), "T-LAB");
  assert.equal(new Headers(request?.headers).get("X-Slack-User-Id"), "U123");
  assert.equal(
    new Headers(request?.headers).get("X-Slack-User-Email"),
    "member@example.ac.jp",
  );
  assert.deepEqual(JSON.parse(String(request?.body)), {
    query: "モデルマージ",
    limit: 5,
    source: "slack",
  });
  assert.equal(result.searchLogId, "log-1");
});
