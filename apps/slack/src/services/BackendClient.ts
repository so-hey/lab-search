import type {
  FeedbackRequest,
  FeedbackResponse,
  SearchErrorResponse,
  SearchRequest,
  SearchResponse,
} from "@lab-search/shared";

export type SlackIdentity = {
  teamId: string;
  userId: string;
  email: string;
};

type Fetch = typeof fetch;

export type BackendClientErrorKind =
  | "connection"
  | "invalid_response"
  | "authentication"
  | "permission"
  | "not_found"
  | "rate_limit"
  | "request"
  | "server";

export class BackendClientError extends Error {
  constructor(
    readonly kind: BackendClientErrorKind,
    readonly userMessage: string,
    readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(
      status === undefined
        ? `Backend request failed: ${kind}`
        : `Backend request failed (${status}): ${kind}`,
      options,
    );
    this.name = "BackendClientError";
  }
}

function backendErrorMessage(payload: unknown): string | undefined {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof (payload as SearchErrorResponse).error === "string"
  ) {
    return (payload as SearchErrorResponse).error;
  }
  return undefined;
}

async function responseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new BackendClientError(
      "invalid_response",
      "検索サーバーから正しい応答を受け取れませんでした。管理者へ連絡してください。",
      response.status,
      { cause },
    );
  }
}

function responseError(payload: unknown, status: number): BackendClientError {
  const detail = backendErrorMessage(payload);
  if (status === 400) {
    return new BackendClientError(
      "request",
      detail
        ? `入力内容を確認してください。${detail}`
        : "入力内容を確認して、もう一度お試しください。",
      status,
    );
  }
  if (status === 401) {
    return new BackendClientError(
      "authentication",
      "Slack Botと検索サーバーの認証設定に問題があります。管理者へ連絡してください。",
      status,
    );
  }
  if (status === 403) {
    return new BackendClientError(
      "permission",
      detail === "このSlackアカウントには利用権限がありません。"
        ? "このSlackアカウントには検索権限がありません。Slackのメールアドレスがallowed_usersに登録されているか管理者へ確認してください。"
        : "このSlack workspaceまたはアカウントには利用権限がありません。管理者へ確認してください。",
      status,
    );
  }
  if (status === 404) {
    return new BackendClientError(
      "not_found",
      "検索APIが見つかりません。BotのBACKEND_URL設定を管理者へ確認してください。",
      status,
    );
  }
  if (status === 429) {
    return new BackendClientError(
      "rate_limit",
      "検索サービスが一時的に混み合っています。少し待ってからもう一度お試しください。",
      status,
    );
  }
  if (status >= 500) {
    return new BackendClientError(
      "server",
      "検索サーバーで一時的なエラーが発生しました。少し待ってからもう一度お試しください。改善しない場合は管理者へ連絡してください。",
      status,
    );
  }
  return new BackendClientError(
    "request",
    detail ?? "検索リクエストを処理できませんでした。管理者へ連絡してください。",
    status,
  );
}

export class BackendClient {
  private readonly backendUrl: string;

  constructor(
    backendUrl: string,
    private readonly serviceToken: string,
    private readonly request: Fetch = fetch,
  ) {
    this.backendUrl = backendUrl.replace(/\/$/u, "");
    if (!this.backendUrl) throw new Error("BACKEND_URL must not be empty.");
    if (serviceToken.length < 32) {
      throw new Error("SLACK_BACKEND_SERVICE_TOKEN must be at least 32 characters.");
    }
  }

  private headers(identity: SlackIdentity): HeadersInit {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.serviceToken}`,
      "X-Slack-Team-Id": identity.teamId,
      "X-Slack-User-Id": identity.userId,
      "X-Slack-User-Email": identity.email,
    };
  }

  private async post(
    path: string,
    body: unknown,
    identity: SlackIdentity,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await this.request(`${this.backendUrl}${path}`, {
        method: "POST",
        headers: this.headers(identity),
        body: JSON.stringify(body),
      });
    } catch (cause) {
      throw new BackendClientError(
        "connection",
        "検索サーバーに接続できませんでした。Backendが起動しているか管理者へ確認してください。",
        undefined,
        { cause },
      );
    }
    const payload = await responseJson(response);
    if (!response.ok) throw responseError(payload, response.status);
    return payload;
  }

  async search(
    query: string,
    identity: SlackIdentity,
    limit = 5,
  ): Promise<SearchResponse> {
    const body: SearchRequest = { query, limit, source: "slack" };
    const payload = await this.post("/api/search", body, identity);
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("results" in payload) ||
      !Array.isArray((payload as Partial<SearchResponse>).results)
    ) {
      throw new BackendClientError(
        "invalid_response",
        "検索サーバーから正しい検索結果を受け取れませんでした。管理者へ連絡してください。",
      );
    }
    return payload as SearchResponse;
  }

  async feedback(
    request: FeedbackRequest,
    identity: SlackIdentity,
  ): Promise<FeedbackResponse> {
    const payload = await this.post(
      "/api/feedback",
      { ...request, source: "slack" },
      identity,
    );
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("feedbackId" in payload) ||
      typeof (payload as Partial<FeedbackResponse>).feedbackId !== "string"
    ) {
      throw new BackendClientError(
        "invalid_response",
        "検索サーバーから正しい評価保存結果を受け取れませんでした。管理者へ連絡してください。",
      );
    }
    return payload as FeedbackResponse;
  }
}
