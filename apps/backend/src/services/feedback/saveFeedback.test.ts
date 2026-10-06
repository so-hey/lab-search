import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { saveFeedback } from "./saveFeedback.js";

describe("saveFeedback", () => {
  it("所有する検索ログのfeedbackをrepositoryへ保存する", async () => {
    let savedUser = "";
    const response = await saveFeedback(
      { searchLogId: "log", documentId: "doc", chunkId: "chunk", rank: 1, score: 0.8, feedback: "positive", source: "web" },
      "user",
      {
        searchLogRepository: { async create() { return null; }, async isOwnedBy() { return true; } },
        feedbackRepository: { async create(input) { savedUser = input.userId; return "feedback"; } },
      },
    );
    assert.equal(savedUser, "user");
    assert.equal(response.feedbackId, "feedback");
  });
});
