import type { EmbeddingProvider } from "./EmbeddingProvider.js";
import { normalizeVector } from "./vector.js";

const DEFAULT_ENDPOINT = "https://api.voyageai.com/v1/embeddings";
const DEFAULT_MODEL = "voyage-4-lite";
const DEFAULT_DIMENSIONS = 1_024;
const DEFAULT_MAX_RETRIES = 8;
const DEFAULT_REQUESTS_PER_MINUTE = 3;
const DEFAULT_TOKENS_PER_MINUTE = 10_000;
const MAX_BATCH_SIZE = 1_000;
const MAX_API_TOKENS_PER_BATCH = 1_000_000;
const MAX_RETRY_DELAY_MS = 60_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_SAFETY_MS = 250;
const TOKEN_ESTIMATE_OVERHEAD = 16;

type VoyageInputType = "document" | "query";
type Sleep = (milliseconds: number) => Promise<void>;
type Fetch = typeof fetch;
type Clock = () => number;

export type VoyageEmbeddingProviderOptions = {
  apiKey: string;
  model?: string;
  dimensions?: number;
  endpoint?: string;
  maxRetries?: number;
  requestsPerMinute?: number;
  tokensPerMinute?: number;
  fetch?: Fetch;
  sleep?: Sleep;
  now?: Clock;
};

type VoyageEmbeddingData = {
  index: number;
  embedding: number[];
};

type RecentRequest = {
  startedAt: number;
  estimatedTokens: number;
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

function isRetriableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

// UTF-8 bytes are a conservative tokenizer-free upper bound for the predominantly
// Japanese corpus. This deliberately under-utilizes TPM rather than causing a 429.
function estimateTokens(text: string): number {
  return Buffer.byteLength(text, "utf8") + TOKEN_ESTIMATE_OVERHEAD;
}

function retryDelay(attempt: number, response?: Response): number {
  const fromHeader = response ? retryAfterMilliseconds(response) : undefined;
  return fromHeader ?? Math.min(2 ** attempt * 1_000, MAX_RETRY_DELAY_MS);
}

function errorMessage(payload: string): string {
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

function parseEmbeddings(payload: string, expectedCount: number): number[][] {
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    throw new Error("Voyage returned invalid JSON.");
  }
  if (typeof value !== "object" || value === null) {
    throw new Error("Voyage returned an invalid response object.");
  }
  const data = (value as { data?: unknown }).data;
  if (!Array.isArray(data) || data.length !== expectedCount) {
    throw new Error(
      `Voyage returned ${Array.isArray(data) ? data.length : 0} embeddings; expected ${expectedCount}.`,
    );
  }

  const indexed = new Map<number, number[]>();
  for (const entry of data) {
    if (typeof entry !== "object" || entry === null) {
      throw new Error("Voyage returned an invalid embedding entry.");
    }
    const candidate = entry as Partial<VoyageEmbeddingData>;
    if (
      !Number.isInteger(candidate.index) ||
      !Array.isArray(candidate.embedding) ||
      !candidate.embedding.every(Number.isFinite)
    ) {
      throw new Error("Voyage returned an invalid embedding entry.");
    }
    if (indexed.has(candidate.index as number)) {
      throw new Error("Voyage returned duplicate embedding indexes.");
    }
    indexed.set(candidate.index as number, candidate.embedding);
  }

  return Array.from({ length: expectedCount }, (_, index) => {
    const vector = indexed.get(index);
    if (!vector) throw new Error(`Voyage response is missing embedding index ${index}.`);
    return vector;
  });
}

export class VoyageEmbeddingProvider implements EmbeddingProvider {
  readonly id: string;
  readonly dimensions: number;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly endpoint: string;
  private readonly maxRetries: number;
  private readonly requestsPerMinute: number;
  private readonly tokensPerMinute: number;
  private readonly maxEstimatedTokensPerBatch: number;
  private readonly request: Fetch;
  private readonly wait: Sleep;
  private readonly now: Clock;
  private recentRequests: RecentRequest[] = [];

  constructor(options: VoyageEmbeddingProviderOptions) {
    if (!options.apiKey.trim()) throw new Error("Voyage API key must not be empty.");
    this.model = options.model ?? DEFAULT_MODEL;
    this.dimensions = options.dimensions ?? DEFAULT_DIMENSIONS;
    if (!Number.isInteger(this.dimensions) || this.dimensions < 1) {
      throw new Error("Voyage embedding dimensions must be a positive integer.");
    }
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    if (!Number.isInteger(this.maxRetries) || this.maxRetries < 1) {
      throw new Error("Voyage max retries must be a positive integer.");
    }
    this.requestsPerMinute =
      options.requestsPerMinute ?? DEFAULT_REQUESTS_PER_MINUTE;
    if (!Number.isInteger(this.requestsPerMinute) || this.requestsPerMinute < 1) {
      throw new Error("Voyage requests per minute must be a positive integer.");
    }
    this.tokensPerMinute = options.tokensPerMinute ?? DEFAULT_TOKENS_PER_MINUTE;
    if (!Number.isInteger(this.tokensPerMinute) || this.tokensPerMinute < 1) {
      throw new Error("Voyage tokens per minute must be a positive integer.");
    }
    this.maxEstimatedTokensPerBatch = Math.min(
      MAX_API_TOKENS_PER_BATCH,
      Math.max(1, Math.floor(this.tokensPerMinute * 0.9)),
    );
    this.apiKey = options.apiKey;
    this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    this.request = options.fetch ?? fetch;
    this.wait = options.sleep ?? sleep;
    this.now = options.now ?? Date.now;
    this.id = `${this.model}-${this.dimensions}`;
  }

  async embed(text: string): Promise<number[]> {
    return this.embedDocument(text);
  }

  async embedDocument(text: string, title?: string): Promise<number[]> {
    const [vector] = await this.embedDocuments([text], title);
    return vector;
  }

  async embedDocuments(texts: string[], title?: string): Promise<number[][]> {
    const prepared = texts.map((text) =>
      title ? `${title.trim()}\n${text.trim()}`.trim() : text.trim(),
    );
    return this.embedMany(prepared, "document");
  }

  async embedQuery(text: string): Promise<number[]> {
    const [vector] = await this.embedMany([text.trim()], "query");
    return vector;
  }

  private async embedMany(
    texts: string[],
    inputType: VoyageInputType,
  ): Promise<number[][]> {
    if (texts.length === 0) return [];
    if (texts.some((text) => !text)) throw new Error("Embedding text must not be empty.");

    const result: number[][] = [];
    for (const batch of this.createBatches(texts)) {
      const vectors = await this.requestBatch(batch, inputType);
      for (const vector of vectors) {
        if (vector.length !== this.dimensions) {
          throw new Error(
            `Voyage returned ${vector.length} dimensions; expected ${this.dimensions}.`,
          );
        }
        result.push(normalizeVector(vector));
      }
    }
    return result;
  }

  private createBatches(texts: string[]): string[][] {
    const batches: string[][] = [];
    let batch: string[] = [];
    let estimatedTokens = 0;

    for (const text of texts) {
      const inputTokens = estimateTokens(text);
      if (inputTokens > this.maxEstimatedTokensPerBatch) {
        throw new Error(
          `Voyage input is too large for the configured TPM limit (estimated ${inputTokens}; batch budget ${this.maxEstimatedTokensPerBatch}). Reduce chunk size or increase VOYAGE_EMBEDDING_TOKENS_PER_MINUTE.`,
        );
      }
      if (
        batch.length >= MAX_BATCH_SIZE ||
        (batch.length > 0 &&
          estimatedTokens + inputTokens > this.maxEstimatedTokensPerBatch)
      ) {
        batches.push(batch);
        batch = [];
        estimatedTokens = 0;
      }
      batch.push(text);
      estimatedTokens += inputTokens;
    }
    if (batch.length > 0) batches.push(batch);
    return batches;
  }

  private async waitForRateLimit(estimatedTokens: number): Promise<void> {
    for (;;) {
      const now = this.now();
      this.recentRequests = this.recentRequests.filter(
        (request) => now - request.startedAt < RATE_LIMIT_WINDOW_MS,
      );

      let allowedAt = now;
      if (this.recentRequests.length >= this.requestsPerMinute) {
        const requestToExpire =
          this.recentRequests[
            this.recentRequests.length - this.requestsPerMinute
          ];
        allowedAt = Math.max(
          allowedAt,
          requestToExpire.startedAt + RATE_LIMIT_WINDOW_MS,
        );
      }

      const recentTokens = this.recentRequests.reduce(
        (total, request) => total + request.estimatedTokens,
        0,
      );
      if (recentTokens + estimatedTokens > this.tokensPerMinute) {
        let remainingTokens = recentTokens;
        for (const request of this.recentRequests) {
          remainingTokens -= request.estimatedTokens;
          if (remainingTokens + estimatedTokens <= this.tokensPerMinute) {
            allowedAt = Math.max(
              allowedAt,
              request.startedAt + RATE_LIMIT_WINDOW_MS,
            );
            break;
          }
        }
      }

      if (allowedAt <= now) {
        this.recentRequests.push({ startedAt: now, estimatedTokens });
        return;
      }

      const delay = allowedAt - now + RATE_LIMIT_SAFETY_MS;
      console.log(
        `[embedding] Voyage rate limit pacing; waiting ${Math.ceil(delay / 1_000)}s`,
      );
      await this.wait(delay);
    }
  }

  private async requestBatch(
    texts: string[],
    inputType: VoyageInputType,
  ): Promise<number[][]> {
    const estimatedTokens = texts.reduce(
      (total, text) => total + estimateTokens(text),
      0,
    );
    for (let attempt = 0; ; attempt += 1) {
      await this.waitForRateLimit(estimatedTokens);
      let response: Response;
      try {
        response = await this.request(this.endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            input: texts,
            model: this.model,
            input_type: inputType,
            output_dimension: this.dimensions,
            output_dtype: "float",
            truncation: true,
          }),
        });
      } catch (error) {
        if (attempt >= this.maxRetries) throw error;
        const delay = retryDelay(attempt);
        console.warn(
          `[embedding] Voyage network error; waiting ${Math.ceil(delay / 1_000)}s before retry ${attempt + 1}/${this.maxRetries}`,
        );
        await this.wait(delay);
        continue;
      }

      const payload = await response.text();
      if (response.ok) return parseEmbeddings(payload, texts.length);
      if (!isRetriableStatus(response.status) || attempt >= this.maxRetries) {
        throw new Error(
          `Voyage Embedding API failed (${response.status}): ${errorMessage(payload)}`,
        );
      }

      const delay = retryDelay(attempt, response);
      console.warn(
        `[embedding] Voyage API returned ${response.status}; waiting ${Math.ceil(delay / 1_000)}s before retry ${attempt + 1}/${this.maxRetries}`,
      );
      await this.wait(delay);
    }
  }
}
