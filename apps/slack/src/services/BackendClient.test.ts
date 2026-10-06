import assert from "node:assert/strict";
import { it } from "node:test";
import { BackendClient, BackendClientError } from "./BackendClient.js";

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

it("Backendへ接続できない場合は安全な利用者向けmessageを持つerrorを返す", async () => {
  const client = new BackendClient(
    "http://localhost:8787",
    "a".repeat(64),
    async () => {
      throw new TypeError("fetch failed: private host detail");
    },
  );

  await assert.rejects(
    client.search("モデルマージ", {
      teamId: "T-LAB",
      userId: "U123",
      email: "member@example.ac.jp",
    }),
    (error: unknown) =>
      error instanceof BackendClientError &&
      error.kind === "connection" &&
      !error.userMessage.includes("private host detail"),
  );
});

it("403ではallowed_usersを確認するよう案内する", async () => {
  const client = new BackendClient(
    "https://backend.example.com",
    "a".repeat(64),
    async () =>
      new Response(
        JSON.stringify({
          error: "このSlackアカウントには利用権限がありません。",
        }),
        { status: 403 },
      ),
  );

  await assert.rejects(
    client.search("モデルマージ", {
      teamId: "T-LAB",
      userId: "U123",
      email: "member@example.ac.jp",
    }),
    (error: unknown) =>
      error instanceof BackendClientError &&
      error.kind === "permission" &&
      error.userMessage.includes("allowed_users"),
  );
});
