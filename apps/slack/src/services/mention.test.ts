import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractMentionQuery } from "./mention.js";

describe("extractMentionQuery", () => {
  it("Botへのメンションだけを除いて検索語を返す", () => {
    assert.equal(
      extractMentionQuery("<@U012ABCDEF>  破滅的忘却", "U012ABCDEF"),
      "破滅的忘却",
    );
    assert.equal(
      extractMentionQuery("モデルマージについて <@U012ABCDEF> 検索", "U012ABCDEF"),
      "モデルマージについて 検索",
    );
  });

  it("別ユーザーへのメンションは検索語に残す", () => {
    assert.equal(
      extractMentionQuery("<@U012ABCDEF> <@U999999999> の研究", "U012ABCDEF"),
      "<@U999999999> の研究",
    );
  });
});
