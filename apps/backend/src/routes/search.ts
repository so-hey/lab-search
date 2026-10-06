import type {
  SearchErrorResponse,
  SearchRequest,
  SearchResponse,
} from "@lab-search/shared";
import { Hono } from "hono";
import type { AuthUser } from "../services/auth/AuthService.js";
import type { AuthenticateHandler } from "./feedback.js";

const MAX_QUERY_LENGTH = 2_000;
const MAX_LIMIT = 20;

export type SearchHandler = (
  request: SearchRequest,
  user: AuthUser,
) => Promise<SearchResponse>;

type ValidationResult =
  | { ok: true; request: SearchRequest }
  | { ok: false; error: string };

function validateSearchRequest(body: unknown): ValidationResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      ok: false,
      error: "リクエスト本文はJSONオブジェクトにしてください。",
    };
  }

  const candidate = body as Partial<SearchRequest>;
  if (typeof candidate.query !== "string" || !candidate.query.trim()) {
    return { ok: false, error: "queryには空でない文字列を指定してください。" };
  }

  if (candidate.query.length > MAX_QUERY_LENGTH) {
    return {
      ok: false,
      error: `queryは${MAX_QUERY_LENGTH}文字以内で指定してください。`,
    };
  }

  if (candidate.source !== "web" && candidate.source !== "slack") {
    return {
      ok: false,
      error: 'sourceには"web"または"slack"を指定してください。',
    };
  }

  if (
    candidate.limit !== undefined &&
    (!Number.isInteger(candidate.limit) ||
      candidate.limit < 1 ||
      candidate.limit > MAX_LIMIT)
  ) {
    return {
      ok: false,
      error: `limitには1から${MAX_LIMIT}までの整数を指定してください。`,
    };
  }

  return {
    ok: true,
    request: {
      query: candidate.query.trim(),
      source: candidate.source,
      ...(candidate.limit === undefined ? {} : { limit: candidate.limit }),
    },
  };
}

export function createSearchRoutes(
  search: SearchHandler,
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

    const validation = validateSearchRequest(body);
    if (!validation.ok) {
      return context.json(
        { error: validation.error } satisfies SearchErrorResponse,
        400,
      );
    }

    const user = await authenticate(context.req.header("Authorization"));
    return context.json(await search(validation.request, user));
  });

  return routes;
}
