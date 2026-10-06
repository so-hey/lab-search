import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AuthenticationError } from "./AuthService.js";
import { SlackServiceAuthService } from "./SlackServiceAuthService.js";

const SERVICE_TOKEN = "a".repeat(64);

function service(allowedEmail = "member@example.ac.jp") {
  return new SlackServiceAuthService(SERVICE_TOKEN, "T-LAB", {
    async findByEmail(email) {
      return email === allowedEmail
        ? { email: allowedEmail, role: "member" }
        : null;
    },
  });
}

describe("SlackServiceAuthService", () => {
  it("service token、workspace、emailを検証してSlack userを返す", async () => {
    const user = await service().authenticate({
      source: "slack",
      authorization: `Bearer ${SERVICE_TOKEN}`,
      slackTeamId: "T-LAB",
      slackUserId: "U123",
      slackUserEmail: "MEMBER@example.ac.jp",
    });

    assert.deepEqual(user, {
      id: "slack:T-LAB:U123",
      email: "member@example.ac.jp",
      role: "member",
    });
  });

  it("不正なservice tokenを拒否する", async () => {
    await assert.rejects(
      service().authenticate({
        source: "slack",
        authorization: `Bearer ${"b".repeat(64)}`,
        slackTeamId: "T-LAB",
        slackUserId: "U123",
        slackUserEmail: "member@example.ac.jp",
      }),
      (error: unknown) =>
        error instanceof AuthenticationError && error.status === 401,
    );
  });

  it("別workspaceと未許可emailを拒否する", async () => {
    const authenticate = service().authenticate.bind(service());
    await assert.rejects(
      authenticate({
        source: "slack",
        authorization: `Bearer ${SERVICE_TOKEN}`,
        slackTeamId: "T-OTHER",
        slackUserId: "U123",
        slackUserEmail: "member@example.ac.jp",
      }),
      (error: unknown) =>
        error instanceof AuthenticationError && error.status === 403,
    );
    await assert.rejects(
      authenticate({
        source: "slack",
        authorization: `Bearer ${SERVICE_TOKEN}`,
        slackTeamId: "T-LAB",
        slackUserId: "U123",
        slackUserEmail: "outsider@example.ac.jp",
      }),
      (error: unknown) =>
        error instanceof AuthenticationError && error.status === 403,
    );
  });
});
