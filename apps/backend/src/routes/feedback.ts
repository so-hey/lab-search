import type {
  FeedbackRequest,
  FeedbackResponse,
  SearchErrorResponse,
} from "@lab-search/shared";
import { Hono } from "hono";
import type { AuthUser } from "../services/auth/AuthService.js";

export type FeedbackHandler = (
  request: FeedbackRequest,
  user: AuthUser,
) => Promise<FeedbackResponse>;
export type AuthenticateHandler = (
  authorization: string | undefined,
) => Promise<AuthUser>;

function validateFeedbackRequest(body: unknown): FeedbackRequest | string {
  if (typeof body !== "object" || body === null || Array.isArray(body))
    return "リクエスト本文はJSONオブジェクトにしてください。";
  const value = body as Partial<FeedbackRequest>;
  if (
    typeof value.searchLogId !== "string" ||
    !value.searchLogId ||
    typeof value.documentId !== "string" ||
    !value.documentId ||
    typeof value.chunkId !== "string" ||
    !value.chunkId
  )
    return "検索ログ・文書・chunkのIDが必要です。";
  if (
    !Number.isInteger(value.rank) ||
    (value.rank ?? 0) < 1 ||
    (value.rank ?? 0) > 20
  )
    return "rankには1から20までの整数を指定してください。";
  if (typeof value.score !== "number" || !Number.isFinite(value.score))
    return "scoreには有限の数値を指定してください。";
  if (value.feedback !== "positive" && value.feedback !== "negative")
    return "feedbackが不正です。";
  if (value.source !== "web" && value.source !== "slack")
    return "sourceが不正です。";
  return value as FeedbackRequest;
}

export function createFeedbackRoutes(
  feedback: FeedbackHandler,
  authenticate: AuthenticateHandler,
) {
  const routes = new Hono();
  routes.post("/", async (context) => {
    let body: unknown;
    try {
      body = await context.req.json();
    } catch {
      return context.json(
        {
          error: "リクエスト本文を正しいJSON形式にしてください。",
        } satisfies SearchErrorResponse,
        400,
      );
    }
    const validation = validateFeedbackRequest(body);
    if (typeof validation === "string")
      return context.json(
        { error: validation } satisfies SearchErrorResponse,
        400,
      );
    const user = await authenticate(context.req.header("Authorization"));
    return context.json(await feedback(validation, user));
  });
  return routes;
}
