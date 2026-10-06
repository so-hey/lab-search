import type { SearchErrorResponse } from "@lab-search/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createSearchRoutes, type SearchHandler } from "./routes/search.js";
import {
  createFeedbackRoutes,
  type AuthenticateHandler,
  type FeedbackHandler,
} from "./routes/feedback.js";
import { AuthenticationError } from "./services/auth/AuthService.js";
import { FeedbackAuthorizationError } from "./services/feedback/saveFeedback.js";

export type AppDependencies = {
  search: SearchHandler;
  feedback: FeedbackHandler;
  authenticate: AuthenticateHandler;
};

export function createApp(dependencies: AppDependencies) {
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: process.env.CORS_ORIGIN ?? "*",
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
    }),
  );

  app.get("/health", (context) => context.json({ status: "ok" }));
  app.route(
    "/api/search",
    createSearchRoutes(dependencies.search, dependencies.authenticate),
  );
  app.route(
    "/api/feedback",
    createFeedbackRoutes(dependencies.feedback, dependencies.authenticate),
  );

  app.notFound((context) =>
    context.json(
      {
        error: "指定されたAPIが見つかりません。",
      } satisfies SearchErrorResponse,
      404,
    ),
  );

  app.onError((error, context) => {
    if (error instanceof AuthenticationError) {
      return context.json(
        { error: error.message } satisfies SearchErrorResponse,
        error.status,
      );
    }
    if (error instanceof FeedbackAuthorizationError) {
      return context.json(
        { error: error.message } satisfies SearchErrorResponse,
        403,
      );
    }
    console.error("[backend] request failed", error);
    return context.json(
      {
        error: "サーバー内部でエラーが発生しました。",
      } satisfies SearchErrorResponse,
      500,
    );
  });

  return app;
}
