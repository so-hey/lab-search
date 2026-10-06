import assert from "node:assert/strict";
import test from "node:test";
import { SlackIdentityCache } from "./SlackIdentityCache.js";

test("同じworkspace/userのemail取得をTTL内は再利用する", async () => {
  let calls = 0;
  const cache = new SlackIdentityCache(1_000, 10, () => 100);
  const load = async () => {
    calls += 1;
    return {
      teamId: "T001",
      userId: "U001",
      email: "member@example.com",
    };
  };

  const first = await cache.getOrLoad("T001", "U001", load);
  const second = await cache.getOrLoad("T001", "U001", load);

  assert.deepEqual(first, second);
  assert.equal(calls, 1);
});

test("TTL経過後はemailをSlack APIから再取得する", async () => {
  let now = 0;
  let calls = 0;
  const cache = new SlackIdentityCache(100, 10, () => now);
  const load = async () => ({
    teamId: "T001",
    userId: "U001",
    email: `member-${++calls}@example.com`,
  });

  await cache.getOrLoad("T001", "U001", load);
  now = 101;
  const identity = await cache.getOrLoad("T001", "U001", load);

  assert.equal(identity.email, "member-2@example.com");
});
