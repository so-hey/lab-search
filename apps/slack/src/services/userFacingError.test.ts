import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BackendClientError } from "./BackendClient.js";
import {
  SlackUserFacingError,
  userFacingErrorMessage,
} from "./userFacingError.js";

describe("userFacingErrorMessage", () => {
  it("Backend接続エラーの利用者向け案内を返す", () => {
    const error = new BackendClientError(
      "connection",
      "検索サーバーに接続できませんでした。Backendが起動しているか管理者へ確認してください。",
    );
    assert.equal(
      userFacingErrorMessage(error, "search"),
      "検索サーバーに接続できませんでした。Backendが起動しているか管理者へ確認してください。",
    );
  });

  it("Slack権限不足を設定案内へ変換する", () => {
    assert.equal(
      userFacingErrorMessage(
        { code: "slack_webapi_platform_error", data: { error: "missing_scope" } },
        "search",
      ),
      "Slack Botの認証または権限設定に問題があります。管理者へ連絡してください。",
    );
  });

  it("既知の利用者向けエラーはそのまま返す", () => {
    assert.equal(
      userFacingErrorMessage(
        new SlackUserFacingError("メールアドレスを取得できません。"),
        "search",
      ),
      "メールアドレスを取得できません。",
    );
  });

  it("未知の例外では内部情報を表示しない", () => {
    const message = userFacingErrorMessage(
      new Error("secret internal stack detail"),
      "feedback",
    );
    assert.doesNotMatch(message, /secret/u);
    assert.match(message, /評価を保存できませんでした/u);
  });
});
