import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseDirectMessage } from "./directMessage.js";

describe("parseDirectMessage", () => {
  it("通常のBot DMからユーザーと検索語を取り出す", () => {
    assert.deepEqual(
      parseDirectMessage({
        type: "message",
        channel_type: "im",
        user: "U012ABCDEF",
        text: "  破滅的忘却  ",
      }),
      { userId: "U012ABCDEF", query: "破滅的忘却" },
    );
  });

  it("Bot投稿、編集イベント、チャンネル投稿を無視する", () => {
    assert.equal(
      parseDirectMessage({
        channel_type: "im",
        user: "U012ABCDEF",
        text: "Bot reply",
        bot_id: "B012ABCDEF",
      }),
      null,
    );
    assert.equal(
      parseDirectMessage({
        channel_type: "im",
        subtype: "message_changed",
        user: "U012ABCDEF",
        text: "edited",
      }),
      null,
    );
    assert.equal(
      parseDirectMessage({
        channel_type: "channel",
        user: "U012ABCDEF",
        text: "channel message",
      }),
      null,
    );
  });
});
