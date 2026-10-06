"use client";

import type {
  FeedbackRequest,
  FeedbackValue,
  SearchErrorResponse,
  SearchRequest,
  SearchResponse,
} from "@lab-search/shared";
import Script from "next/script";
import { type FormEvent, useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize(options: {
            client_id: string;
            callback: (response: { credential: string }) => void;
            use_fedcm_for_button?: boolean;
          }): void;
          renderButton(
            element: HTMLElement,
            options: Record<string, string>,
          ): void;
          disableAutoSelect(): void;
        };
      };
    };
  }
}

const RESULT_LIMIT = 20;
const INITIAL_VISIBLE_RESULT_COUNT = 10;
const LOAD_MORE_RESULT_COUNT = 10;
const CONTENT_PREVIEW_LENGTH = 320;
const RRF_K = 60;
const RRF_RETRIEVER_COUNT = 2;
const EMPTY_SEARCH_RESPONSE: SearchResponse = {
  searchLogId: null,
  results: [],
};
const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/$/u, "");
const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
const requiresLogin = process.env.NEXT_PUBLIC_AUTH_MODE === "google";

function getErrorMessage(payload: unknown): string | undefined {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof (payload as SearchErrorResponse).error === "string"
  )
    return (payload as SearchErrorResponse).error;
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

function contentPreview(content: string): string {
  const compact = content.replace(/\s+/gu, " ").trim();
  const characters = Array.from(compact);
  if (characters.length <= CONTENT_PREVIEW_LENGTH) return compact;
  return `${characters.slice(0, CONTENT_PREVIEW_LENGTH).join("")}…`;
}

function theoreticalMaximumScore(
  scoreType: SearchResponse["results"][number]["scoreType"],
): number {
  if (scoreType === "rrf") {
    return RRF_RETRIEVER_COUNT / (RRF_K + 1);
  }
  return 1;
}

function normalizedScore(
  score: number,
  scoreType: SearchResponse["results"][number]["scoreType"],
): number {
  const maximumScore = theoreticalMaximumScore(scoreType);
  if (!Number.isFinite(score) || maximumScore <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, score / maximumScore));
}

function scoreMetricLabel(
  scoreType: SearchResponse["results"][number]["scoreType"],
): string {
  if (scoreType === "reranker") return "Reranker関連度";
  if (scoreType === "rrf") return "RRF統合スコア";
  if (scoreType === "cosine") return "コサイン類似度";
  return "関連度";
}

function documentFormat(documentName: string, mimeType?: string): string {
  const name = documentName.toLocaleLowerCase();
  const mime = mimeType?.toLocaleLowerCase() ?? "";
  if (mime.includes("pdf") || name.endsWith(".pdf")) return "PDF";
  if (mime.includes("presentation") || name.endsWith(".pptx")) return "SLIDES";
  if (mime.includes("document") || name.endsWith(".docx")) return "DOC";
  return "FILE";
}

export function SearchPage() {
  const [query, setQuery] = useState("");
  const [searchedQuery, setSearchedQuery] = useState("");
  const [response, setResponse] = useState<SearchResponse>(EMPTY_SEARCH_RESPONSE);
  const [visibleResultCount, setVisibleResultCount] = useState(
    INITIAL_VISIBLE_RESULT_COUNT,
  );
  const [hasSearched, setHasSearched] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [credential, setCredential] = useState<string | null>(null);
  const [googleReady, setGoogleReady] = useState(false);
  const [feedbackState, setFeedbackState] = useState<
    Record<string, "sending" | FeedbackValue>
  >({});
  const googleButton = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (
      !requiresLogin ||
      !googleReady ||
      !googleClientId ||
      credential ||
      !window.google ||
      !googleButton.current
    )
      return;
    window.google.accounts.id.initialize({
      client_id: googleClientId,
      callback: ({ credential: token }) => {
        setCredential(token);
        setError(null);
      },
      use_fedcm_for_button: true,
    });
    googleButton.current.replaceChildren();
    window.google.accounts.id.renderButton(googleButton.current, {
      type: "standard",
      theme: "outline",
      size: "large",
      text: "signin_with",
      shape: "rectangular",
      locale: "ja",
    });
  }, [credential, googleReady]);

  function headers(): HeadersInit {
    return {
      "Content-Type": "application/json",
      ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
    };
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedQuery = query.trim();
    if (!normalizedQuery) return setError("検索語を入力してください。");
    if (!backendUrl)
      return setError("NEXT_PUBLIC_BACKEND_URL が設定されていません。");
    if (requiresLogin && !credential)
      return setError("Googleアカウントでログインしてください。");
    const request: SearchRequest = {
      query: normalizedQuery,
      limit: RESULT_LIMIT,
      source: "web",
    };
    setIsLoading(true);
    setError(null);
    setResponse(EMPTY_SEARCH_RESPONSE);
    setHasSearched(false);
    setSearchedQuery(normalizedQuery);
    setVisibleResultCount(INITIAL_VISIBLE_RESULT_COUNT);
    setFeedbackState({});
    try {
      const fetchResponse = await fetch(`${backendUrl}/api/search`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(request),
      });
      const payload: unknown = await fetchResponse.json();
      if (!fetchResponse.ok)
        throw new Error(
          getErrorMessage(payload) ??
            `検索に失敗しました (${fetchResponse.status})。`,
        );
      if (!isSearchResponse(payload))
        throw new Error("Backendから不正なレスポンスを受信しました。");
      setResponse(payload);
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

  async function sendFeedback(index: number, feedback: FeedbackValue) {
    const result = response.results[index];
    if (!backendUrl || !response.searchLogId || feedbackState[result.chunkId])
      return;
    setFeedbackState((state) => ({ ...state, [result.chunkId]: "sending" }));
    const request: FeedbackRequest = {
      searchLogId: response.searchLogId,
      documentId: result.documentId,
      chunkId: result.chunkId,
      rank: index + 1,
      score: result.score,
      feedback,
      source: "web",
    };
    try {
      const fetchResponse = await fetch(`${backendUrl}/api/feedback`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(request),
      });
      const payload: unknown = await fetchResponse.json();
      if (!fetchResponse.ok)
        throw new Error(
          getErrorMessage(payload) ?? "フィードバックの保存に失敗しました。",
        );
      setFeedbackState((state) => ({ ...state, [result.chunkId]: feedback }));
    } catch (cause) {
      setFeedbackState((state) => {
        const next = { ...state };
        delete next[result.chunkId];
        return next;
      });
      setError(
        cause instanceof Error
          ? cause.message
          : "フィードバックの保存に失敗しました。",
      );
    }
  }

  function logout() {
    window.google?.accounts.id.disableAutoSelect();
    setCredential(null);
    setResponse(EMPTY_SEARCH_RESPONSE);
    setHasSearched(false);
    setSearchedQuery("");
    setVisibleResultCount(INITIAL_VISIBLE_RESULT_COUNT);
  }

  const visibleResults = response.results.slice(0, visibleResultCount);
  const hiddenResultCount = Math.max(
    0,
    response.results.length - visibleResults.length,
  );

  return (
    <div className="min-h-screen bg-[#f6f5f2] text-[#252a30]">
      {requiresLogin ? (
        <Script
          src="https://accounts.google.com/gsi/client"
          strategy="afterInteractive"
          onLoad={() => setGoogleReady(true)}
        />
      ) : null}
      <header className="border-b border-[#deddd8] bg-[#fbfaf8]">
        <div className="mx-auto flex min-h-16 w-full max-w-5xl items-center justify-between gap-5 px-5 py-3 sm:px-8">
          <p className="text-lg font-semibold tracking-wide text-[#263446]">
            研究室資料検索
          </p>

          {requiresLogin ? (
            <div className="flex min-h-11 items-center gap-3">
              {credential ? (
                <>
                  <span className="hidden items-center gap-2 text-xs text-[#71767c] sm:flex">
                    <span className="size-1.5 rounded-full bg-[#5f7d68]" />
                    ログイン中
                  </span>
                  <button
                    type="button"
                    onClick={logout}
                    className="rounded-sm border border-[#d4d2cc] bg-white px-3 py-2 text-xs text-[#4c545d] transition hover:border-[#9b9d9d] hover:text-[#202b38]"
                  >
                    ログアウト
                  </button>
                </>
              ) : googleClientId ? (
                <div ref={googleButton} />
              ) : (
                <p className="text-xs text-[#9b3434]">
                  Google Client IDが未設定です
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-[#7b7f83]">開発環境</p>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-5 pb-20 sm:px-8">
        <section className="pt-12 pb-8 sm:pt-16 sm:pb-10">
          <h1 className="text-3xl font-bold tracking-tight text-[#263446] sm:text-4xl">
            研究資料を検索
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-[#676d73]">
            研究室のGoogle Driveにある論文、発表資料、文書を横断して検索します。
          </p>
        </section>

        <section>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row">
            <label htmlFor="search-query" className="sr-only">
              検索語
            </label>
            <div className="flex min-h-14 flex-1 items-center rounded-sm border border-[#c9c9c4] bg-white shadow-[0_1px_2px_rgba(28,35,42,0.04)] focus-within:border-[#607086] focus-within:ring-2 focus-within:ring-[#607086]/10">
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                className="ml-4 size-5 shrink-0 text-[#81858a]"
              >
                <circle cx="11" cy="11" r="6.5" />
                <path d="m16 16 4 4" />
              </svg>
              <input
                id="search-query"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="例：モデルマージによる破滅的忘却"
                disabled={isLoading || (requiresLogin && !credential)}
                className="min-h-14 w-full bg-transparent px-4 text-base text-[#242c35] outline-none placeholder:text-[#9a9da0] disabled:cursor-not-allowed disabled:bg-[#f2f2ef]"
              />
            </div>
            <button
              type="submit"
              disabled={isLoading || (requiresLogin && !credential)}
              className="min-h-14 rounded-sm bg-[#263446] px-8 text-sm font-semibold text-white transition hover:bg-[#1b2736] focus:outline-none focus:ring-2 focus:ring-[#607086] focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-[#a7adb4]"
            >
              {isLoading ? "検索中" : "検索する"}
            </button>
          </form>
        </section>

        {error ? (
          <p
            role="alert"
            className="mt-5 border-l-2 border-[#a04b4b] bg-[#fffafa] px-4 py-3 text-sm text-[#843939]"
          >
            {error}
          </p>
        ) : null}

        <section className="mt-11" aria-live="polite" aria-busy={isLoading}>
          {isLoading ? (
            <div className="flex items-center gap-3 border-y border-[#deddd8] py-6 text-sm text-[#686e74]">
              <span className="size-1.5 animate-pulse rounded-full bg-[#52677f]" />
              検索しています…
            </div>
          ) : null}

          {hasSearched && response.results.length === 0 ? (
            <div className="border-y border-[#deddd8] bg-white px-6 py-10 text-center">
              <p className="text-base font-semibold text-[#333a42]">該当する資料はありませんでした</p>
              <p className="mt-2 text-sm text-[#747a82]">
                検索語を短くするか、別の表現を試してください。
              </p>
            </div>
          ) : null}

          {hasSearched && response.results.length > 0 ? (
            <div className="mb-4 flex items-baseline justify-between gap-4">
              <h2 className="text-base font-semibold text-[#303943]">
                「{searchedQuery}」の検索結果
              </h2>
              <p className="shrink-0 text-xs text-[#7b7f83]">
                {hiddenResultCount > 0
                  ? `${visibleResults.length} / ${response.results.length}件を表示`
                  : `${response.results.length}件`}
              </p>
            </div>
          ) : null}

          {response.results.length > 0 ? (
            <ol
              id="search-results"
              className="divide-y divide-[#e2e1dc] border-y border-[#d8d7d1] bg-white"
            >
              {visibleResults.map((result, index) => {
              const submitted = feedbackState[result.chunkId];
              const maximumScore = theoreticalMaximumScore(result.scoreType);
              const format = documentFormat(result.documentName, result.mimeType);
              return (
                <li
                  key={result.chunkId}
                  className="grid transition-colors hover:bg-[#fbfbf9] sm:grid-cols-[3.5rem_minmax(0,1fr)]"
                >
                  <div className="hidden pt-7 text-center sm:block">
                    <span className="font-mono text-xs text-[#92969a]">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                  </div>

                  <article className="min-w-0 px-5 py-6 sm:pr-7 sm:pl-2">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold tracking-wide text-[#767c82]">
                          <span className="sm:hidden">
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          <span className="text-[#52677f]">{format}</span>
                        </p>
                        <h3 className="break-words text-base leading-7 font-semibold text-[#253142] sm:text-[1.05rem]">
                          {result.documentName}
                        </h3>
                        {result.page !== undefined ||
                        result.slide !== undefined ||
                        result.sectionTitle ? (
                          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#747a82]">
                            {result.page !== undefined ? (
                              <span>Page {result.page}</span>
                            ) : null}
                            {result.slide !== undefined ? (
                              <span>Slide {result.slide}</span>
                            ) : null}
                            {result.sectionTitle ? (
                              <span className="border-l border-[#d3d2cd] pl-3">
                                {result.sectionTitle}
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                      </div>

                      <div
                        className="flex shrink-0 items-baseline gap-2 text-[#59616a] sm:justify-end"
                        title={`raw score: ${result.score.toFixed(6)} / max score: ${maximumScore.toFixed(6)}${result.scoreType ? ` (${result.scoreType})` : ""}`}
                      >
                        <span className="text-xs">
                          {scoreMetricLabel(result.scoreType)}
                        </span>
                        <p className="font-mono text-sm font-semibold text-[#35475d]">
                          {normalizedScore(result.score, result.scoreType).toFixed(3)}
                        </p>
                      </div>
                    </div>

                    <p className="mt-4 text-sm leading-7 text-[#555d65]">
                      {contentPreview(result.content)}
                    </p>

                    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
                      {result.folderUrl || result.url ? (
                        <div className="mr-auto flex flex-wrap items-center gap-x-5 gap-y-2">
                          {result.folderUrl ? (
                            <a
                              href={result.folderUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1.5 text-sm font-medium text-[#354e6b] underline decoration-[#b4bcc5] underline-offset-4 transition hover:text-[#1f3753]"
                            >
                              保存先フォルダを開く
                              <span aria-hidden="true">↗</span>
                            </a>
                          ) : null}
                          {result.url ? (
                            <a
                              href={result.url}
                              target="_blank"
                              rel="noreferrer"
                              title={`${result.documentName}を直接開く`}
                              className="inline-flex items-center gap-1.5 text-sm text-[#646c75] underline decoration-[#c5c8cb] underline-offset-4 transition hover:text-[#2f4053]"
                            >
                              このファイルを開く
                              <span aria-hidden="true">↗</span>
                            </a>
                          ) : null}
                        </div>
                      ) : (
                        <span className="mr-auto" />
                      )}

                      {submitted && submitted !== "sending" ? (
                        <span className="text-xs text-[#747a82]">
                          送信済み：
                          {submitted === "positive" ? "役に立った" : "役に立たなかった"}
                        </span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={!response.searchLogId || submitted === "sending"}
                            onClick={() => sendFeedback(index, "positive")}
                            className="rounded-sm border border-[#d2d2cd] bg-white px-3 py-1.5 text-xs text-[#4b545d] transition hover:border-[#849286] hover:bg-[#f5f8f5] disabled:cursor-not-allowed disabled:opacity-45"
                          >
                            役に立った
                          </button>
                          <button
                            type="button"
                            disabled={!response.searchLogId || submitted === "sending"}
                            onClick={() => sendFeedback(index, "negative")}
                            className="rounded-sm border border-[#d2d2cd] bg-white px-3 py-1.5 text-xs text-[#4b545d] transition hover:border-[#a18a8a] hover:bg-[#faf7f7] disabled:cursor-not-allowed disabled:opacity-45"
                          >
                            役に立たなかった
                          </button>
                        </div>
                      )}
                    </div>
                  </article>
                </li>
              );
              })}
            </ol>
          ) : null}

          {hasSearched && hiddenResultCount > 0 ? (
            <div className="mt-6 flex justify-center">
              <button
                type="button"
                aria-controls="search-results"
                onClick={() =>
                  setVisibleResultCount((count) =>
                    Math.min(
                      count + LOAD_MORE_RESULT_COUNT,
                      response.results.length,
                    ),
                  )
                }
                className="rounded-sm border border-[#c8c9c6] bg-white px-6 py-3 text-sm font-medium text-[#35475d] transition hover:border-[#8793a0] hover:bg-[#fafbfc] focus:outline-none focus:ring-2 focus:ring-[#607086] focus:ring-offset-2"
              >
                さらに
                {Math.min(LOAD_MORE_RESULT_COUNT, hiddenResultCount)}件表示
              </button>
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}
