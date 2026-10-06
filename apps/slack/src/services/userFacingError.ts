import { BackendClientError } from "./BackendClient.js";

export type SlackOperation = "search" | "feedback";

export class SlackUserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SlackUserFacingError";
  }
}

function slackApiErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const value = error as {
    code?: unknown;
    data?: { error?: unknown };
  };
  if (typeof value.data?.error === "string") return value.data.error;
  return typeof value.code === "string" ? value.code : undefined;
}

export function userFacingErrorMessage(
  error: unknown,
  operation: SlackOperation,
): string {
  if (error instanceof BackendClientError) return error.userMessage;
  if (error instanceof SlackUserFacingError) return error.message;

  const slackError = slackApiErrorCode(error);
  switch (slackError) {
    case "ratelimited":
      return "Slack APIが一時的に混み合っています。少し待ってからもう一度お試しください。";
    case "missing_scope":
    case "not_authed":
    case "invalid_auth":
    case "token_revoked":
    case "account_inactive":
      return "Slack Botの認証または権限設定に問題があります。管理者へ連絡してください。";
    case "not_in_channel":
    case "channel_not_found":
      return "このチャンネルから応答できません。Botをチャンネルへ追加してから、もう一度お試しください。";
    case "user_not_found":
      return "Slackユーザー情報を取得できませんでした。管理者へ連絡してください。";
  }

  return operation === "search"
    ? "検索中に予期しないエラーが発生しました。少し待ってからもう一度お試しください。改善しない場合は管理者へ連絡してください。"
    : "評価を保存できませんでした。少し待ってからもう一度お試しください。改善しない場合は管理者へ連絡してください。";
}
