"use client";

import type {
  SearchErrorResponse,
  SearchRequest,
  SearchResponse,
} from "@lab-search/shared";
import { type FormEvent, useState } from "react";

const RESULT_LIMIT = 5;

function getErrorMessage(payload: unknown): string | undefined {
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

function isSearchResponse(payload: unknown): payload is SearchResponse {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "results" in payload &&
    Array.isArray((payload as SearchResponse).results)
  );
}

export function SearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResponse["results"]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      setError("検索語を入力してください。");
      return;
    }

    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
    if (!backendUrl) {
      setError("NEXT_PUBLIC_BACKEND_URL が設定されていません。");
      return;
    }

    const request: SearchRequest = {
      query: normalizedQuery,
      limit: RESULT_LIMIT,
      source: "web",
    };

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `${backendUrl.replace(/\/$/, "")}/api/search`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        },
      );
      const payload: unknown = await response.json();

      if (!response.ok) {
        throw new Error(
          getErrorMessage(payload) ?? `検索に失敗しました (${response.status})。`,
        );
      }

      if (!isSearchResponse(payload)) {
        throw new Error("Backendから不正なレスポンスを受信しました。");
      }

      setResults(payload.results);
      setHasSearched(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Backendへ接続できませんでした。",
      );
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-5 py-14 sm:px-8 sm:py-20">
      <header className="mb-10">
        <p className="mb-3 text-sm font-semibold tracking-[0.18em] text-emerald-700 uppercase">
          研究室内ナレッジ検索
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-zinc-950 sm:text-4xl">
          研究室資料検索
        </h1>
        <p className="mt-3 text-sm leading-7 text-zinc-600 sm:text-base">
          ローカルPDFから作成したインデックスを意味検索します。
        </p>
      </header>

      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-3 sm:flex-row"
      >
        <label htmlFor="search-query" className="sr-only">
          検索語
        </label>
        <input
          id="search-query"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="例: モデルマージの手法"
          disabled={isLoading}
          className="min-h-12 flex-1 rounded-xl border border-zinc-300 bg-white px-4 text-base text-zinc-950 shadow-sm outline-none transition placeholder:text-zinc-400 focus:border-emerald-600 focus:ring-3 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:bg-zinc-100"
        />
        <button
          type="submit"
          disabled={isLoading}
          className="min-h-12 rounded-xl bg-emerald-700 px-7 font-semibold text-white shadow-sm transition hover:bg-emerald-800 focus:outline-none focus:ring-3 focus:ring-emerald-200 disabled:cursor-not-allowed disabled:bg-emerald-400"
        >
          {isLoading ? "検索中…" : "検索"}
        </button>
      </form>

      {error ? (
        <p
          role="alert"
          className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {error}
        </p>
      ) : null}

      <section className="mt-10" aria-live="polite" aria-busy={isLoading}>
        {hasSearched && results.length === 0 ? (
          <p className="rounded-xl border border-zinc-200 bg-white px-5 py-6 text-zinc-600">
            該当する資料は見つかりませんでした。
          </p>
        ) : null}

        <ol className="space-y-5">
          {results.map((result, index) => (
            <li
              key={result.chunkId}
              className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6"
            >
              <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
                <h2 className="font-semibold text-zinc-950">
                  <span className="mr-2 text-zinc-400">{index + 1}.</span>
                  {result.documentName}
                </h2>
                <p className="font-mono text-sm text-emerald-800">
                  score: {result.score.toFixed(3)}
                </p>
              </div>
              <p className="whitespace-pre-wrap break-words text-sm leading-7 text-zinc-700 sm:text-base">
                {result.content}
              </p>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
