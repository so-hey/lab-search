import type { SearchErrorResponse } from "@lab-search/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createSearchRoutes, type SearchHandler } from "./routes/search.js";

export type AppDependencies = {
  search: SearchHandler;
};

export function createApp(dependencies: AppDependencies) {
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: process.env.CORS_ORIGIN ?? "*",
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type"],
    }),
  );

  app.get("/health", (context) => context.json({ status: "ok" }));
  app.route("/api/search", createSearchRoutes(dependencies.search));

  app.notFound((context) =>
    context.json(
      { error: "指定されたAPIが見つかりません。" } satisfies SearchErrorResponse,
      404,
    ),
  );

  app.onError((error, context) => {
    console.error("[backend] request failed", error);
    return context.json(
      { error: "サーバー内部でエラーが発生しました。" } satisfies SearchErrorResponse,
      500,
    );
  });

  return app;
}
