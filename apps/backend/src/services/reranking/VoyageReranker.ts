import {
  RerankerRateLimitError,
  type Reranker,
  type RerankResult,
} from "./Reranker.js";

const DEFAULT_ENDPOINT = "https://api.voyageai.com/v1/rerank";
const DEFAULT_MODEL = "rerank-3-lite";
const DEFAULT_MAX_RETRIES = 4;
const DEFAULT_REQUESTS_PER_MINUTE = 3;
const MAX_RETRY_DELAY_MS = 60_000;
const RATE_LIMIT_WINDOW_MS = 60_000;

type Fetch = typeof fetch;
type Sleep = (milliseconds: number) => Promise<void>;
type Clock = () => number;

export type VoyageRerankerOptions = {
  apiKey: string;
  model?: string;
  endpoint?: string;
  maxRetries?: number;
  requestsPerMinute?: number;
  fetch?: Fetch;
  sleep?: Sleep;
  now?: Clock;
};

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryAfterMilliseconds(response: Response): number | undefined {
  const value = response.headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function isRetriable(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function responseError(payload: string): string {
  if (!payload) return "empty response";
  try {
    const value: unknown = JSON.parse(payload);
    if (typeof value === "object" && value !== null) {
      const detail = (value as { detail?: unknown }).detail;
      if (typeof detail === "string") return detail;
      const message = (value as { message?: unknown }).message;
      if (typeof message === "string") return message;
    }
  } catch {
    // Use the bounded raw response below.
  }
  return payload.slice(0, 500);
}

function parseResults(payload: string, documentCount: number): RerankResult[] {
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    throw new Error("Voyage reranker returned invalid JSON.");
  }
  if (typeof value !== "object" || value === null) {
    throw new Error("Voyage reranker returned an invalid response object.");
  }
  const data = (value as { data?: unknown }).data;
  if (!Array.isArray(data)) {
    throw new Error("Voyage reranker response is missing data.");
  }

  const seen = new Set<number>();
  return data.map((entry): RerankResult => {
    if (typeof entry !== "object" || entry === null) {
      throw new Error("Voyage reranker returned an invalid result.");
    }
    const index = (entry as { index?: unknown }).index;
    const score = (entry as { relevance_score?: unknown }).relevance_score;
    if (
      !Number.isInteger(index) ||
      (index as number) < 0 ||
      (index as number) >= documentCount ||
      typeof score !== "number" ||
      !Number.isFinite(score)
    ) {
      throw new Error("Voyage reranker returned an invalid result.");
    }
    if (seen.has(index as number)) {
      throw new Error("Voyage reranker returned a duplicate result index.");
    }
    seen.add(index as number);
    return { index: index as number, score };
  });
}

export class VoyageReranker implements Reranker {
  readonly id: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly endpoint: string;
  private readonly maxRetries: number;
  private readonly requestsPerMinute: number;
  private readonly request: Fetch;
  private readonly wait: Sleep;
  private readonly now: Clock;
  private recentRequests: number[] = [];
  private blockedUntil = 0;

  constructor(options: VoyageRerankerOptions) {
    if (!options.apiKey.trim()) throw new Error("Voyage API key must not be empty.");
    this.apiKey = options.apiKey;
    this.model = options.model ?? DEFAULT_MODEL;
    this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    if (!Number.isInteger(this.maxRetries) || this.maxRetries < 1) {
      throw new Error("Voyage reranker max retries must be a positive integer.");
    }
    this.requestsPerMinute =
      options.requestsPerMinute ?? DEFAULT_REQUESTS_PER_MINUTE;
    if (!Number.isInteger(this.requestsPerMinute) || this.requestsPerMinute < 1) {
      throw new Error(
        "Voyage reranker requests per minute must be a positive integer.",
      );
    }
    this.request = options.fetch ?? fetch;
    this.wait = options.sleep ?? sleep;
    this.now = options.now ?? Date.now;
    this.id = `voyage:${this.model}`;
  }

  private reserveRequest(): void {
    const now = this.now();
    if (this.blockedUntil > now) {
      throw new RerankerRateLimitError(
        "Voyage Reranker is cooling down after a 429 response.",
        this.blockedUntil - now,
      );
    }

    this.recentRequests = this.recentRequests.filter(
      (startedAt) => now - startedAt < RATE_LIMIT_WINDOW_MS,
    );
    if (this.recentRequests.length >= this.requestsPerMinute) {
      const retryAfterMs = Math.max(
        1,
        this.recentRequests[0] + RATE_LIMIT_WINDOW_MS - now,
      );
      throw new RerankerRateLimitError(
        `Voyage Reranker local rate limit (${this.requestsPerMinute} RPM) reached.`,
        retryAfterMs,
      );
    }
    this.recentRequests.push(now);
  }

  async rerank(
    query: string,
    documents: readonly string[],
    limit: number,
  ): Promise<RerankResult[]> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) throw new Error("Reranker query must not be empty.");
    if (documents.length === 0) return [];
    if (!Number.isInteger(limit) || limit < 1 || limit > documents.length) {
      throw new Error("Reranker limit must be within the document count.");
    }

    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxRetries; attempt += 1) {
      try {
        this.reserveRequest();
        const response = await this.request(this.endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query: normalizedQuery,
            documents,
            model: this.model,
            top_k: limit,
            return_documents: false,
            truncation: true,
          }),
        });
        const payload = await response.text();
        if (response.ok) {
          const results = parseResults(payload, documents.length);
          if (results.length !== limit) {
            throw new Error(
              `Voyage reranker returned ${results.length} results; expected ${limit}.`,
            );
          }
          return results;
        }
        const error = new Error(
          `Voyage Reranker API failed (${response.status}): ${responseError(payload)}`,
        );
        if (response.status === 429) {
          const retryAfterMs =
            retryAfterMilliseconds(response) ?? RATE_LIMIT_WINDOW_MS;
          this.blockedUntil = Math.max(
            this.blockedUntil,
            this.now() + retryAfterMs,
          );
          throw new RerankerRateLimitError(error.message, retryAfterMs);
        }
        if (!isRetriable(response.status) || attempt === this.maxRetries) throw error;
        lastError = error;
        const delay =
          retryAfterMilliseconds(response) ??
          Math.min(2 ** (attempt - 1) * 1_000, MAX_RETRY_DELAY_MS);
        console.warn(
          `[reranker] Voyage returned ${response.status}; waiting ${Math.ceil(delay / 1_000)}s before retry ${attempt}/${this.maxRetries}`,
        );
        await this.wait(delay);
      } catch (error) {
        if (error instanceof RerankerRateLimitError) throw error;
        if (
          error instanceof Error &&
          error.message.startsWith("Voyage Reranker API failed")
        ) {
          throw error;
        }
        lastError = error;
        if (attempt === this.maxRetries) break;
        await this.wait(Math.min(2 ** (attempt - 1) * 1_000, MAX_RETRY_DELAY_MS));
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("Voyage reranker request failed.");
  }
}
