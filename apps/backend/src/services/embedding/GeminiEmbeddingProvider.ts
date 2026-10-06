import { GoogleGenAI } from "@google/genai";
import {
  EmbeddingQuotaError,
  type EmbeddingProvider,
} from "./EmbeddingProvider.js";
import { normalizeVector } from "./vector.js";

const DEFAULT_MODEL = "gemini-embedding-001";
const DEFAULT_DIMENSIONS = 768;
const MAX_BATCH_SIZE = 100;
const DEFAULT_REQUESTS_PER_MINUTE = 90;
const DEFAULT_MAX_TEMPORARY_RETRIES = 8;
const RETRY_DELAY_BUFFER_MS = 1_000;
const MAX_FALLBACK_RETRY_DELAY_MS = 60_000;

type GeminiModelsClient = Pick<GoogleGenAI["models"], "embedContent">;
type Sleep = (milliseconds: number) => Promise<void>;

export type GeminiEmbeddingProviderOptions = {
  apiKey: string;
  model?: string;
  dimensions?: number;
  requestsPerMinute?: number;
  maxTemporaryRetries?: number;
  client?: GeminiModelsClient;
  sleep?: Sleep;
  now?: () => number;
};

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function errorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

function retryAfterMs(text: string): number | undefined {
  const match = text.match(
    /retryDelay(?:\\?"|\s*[:=]\s*)+\\?"?(\d+(?:\.\d+)?)s/i,
  );
  if (!match) return undefined;
  return Math.ceil(Number(match[1]) * 1_000);
}

export function classifyGeminiEmbeddingError(
  error: unknown,
): EmbeddingQuotaError | undefined {
  if (errorStatus(error) !== 429) return undefined;
  const text = errorText(error);
  const daily =
    /PerDay/i.test(text) ||
    /requests?\s+per\s+day/i.test(text) ||
    /daily\s+quota/i.test(text);
  return new EmbeddingQuotaError(
    daily
      ? "Gemini Embeddingの日次quotaを使い切りました。Google AI Studioでbillingを有効化するか、quota reset後に同期を再実行してください。"
      : "Gemini Embeddingの一時的なrate limitに達しました。時間を空けて再実行してください。",
    {
      scope: daily ? "daily" : "temporary",
      retryAfterMs: retryAfterMs(text),
      cause: error,
    },
  );
}

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly id: string;
  readonly dimensions: number;
  private readonly client: GeminiModelsClient;
  private readonly model: string;
  private readonly requestIntervalMs: number;
  private readonly maxTemporaryRetries: number;
  private readonly wait: Sleep;
  private readonly now: () => number;
  private requestSchedule: Promise<void> = Promise.resolve();
  private nextRequestAt = 0;

  constructor(options: GeminiEmbeddingProviderOptions) {
    this.model = options.model ?? DEFAULT_MODEL;
    this.dimensions = options.dimensions ?? DEFAULT_DIMENSIONS;
    if (!Number.isInteger(this.dimensions) || this.dimensions < 1) {
      throw new Error(
        "Gemini embedding dimensions must be a positive integer.",
      );
    }
    const requestsPerMinute =
      options.requestsPerMinute ?? DEFAULT_REQUESTS_PER_MINUTE;
    if (!Number.isInteger(requestsPerMinute) || requestsPerMinute < 1) {
      throw new Error("Gemini requests per minute must be a positive integer.");
    }
    this.maxTemporaryRetries =
      options.maxTemporaryRetries ?? DEFAULT_MAX_TEMPORARY_RETRIES;
    if (
      !Number.isInteger(this.maxTemporaryRetries) ||
      this.maxTemporaryRetries < 1
    ) {
      throw new Error(
        "Gemini max temporary retries must be a positive integer.",
      );
    }
    this.id = `${this.model}-${this.dimensions}`;
    this.client =
      options.client ?? new GoogleGenAI({ apiKey: options.apiKey }).models;
    this.requestIntervalMs = Math.ceil(60_000 / requestsPerMinute);
    this.wait = options.sleep ?? sleep;
    this.now = options.now ?? Date.now;
  }

  async embed(text: string): Promise<number[]> {
    return this.embedDocument(text);
  }

  async embedDocument(text: string, title?: string): Promise<number[]> {
    const [vector] = await this.embedDocuments([text], title);
    return vector;
  }

  async embedDocuments(texts: string[], title?: string): Promise<number[][]> {
    return this.request(texts, "RETRIEVAL_DOCUMENT", title);
  }

  async embedQuery(text: string): Promise<number[]> {
    const [vector] = await this.request([text], "RETRIEVAL_QUERY");
    return vector;
  }

  private async request(
    texts: string[],
    taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY",
    title?: string,
  ): Promise<number[][]> {
    if (texts.length === 0) return [];
    const normalizedTexts = texts.map((text) => text.trim());
    if (normalizedTexts.some((text) => !text)) {
      throw new Error("Embedding text must not be empty.");
    }

    const result: number[][] = [];
    for (
      let offset = 0;
      offset < normalizedTexts.length;
      offset += MAX_BATCH_SIZE
    ) {
      const batch = normalizedTexts.slice(offset, offset + MAX_BATCH_SIZE);
      const response = await this.requestBatch(batch, taskType, title);
      const embeddings = response.embeddings ?? [];
      if (embeddings.length !== batch.length) {
        throw new Error(
          `Gemini returned ${embeddings.length} embeddings; expected ${batch.length}.`,
        );
      }
      for (const embedding of embeddings) {
        const vector = embedding.values;
        if (!vector || vector.length !== this.dimensions) {
          throw new Error(
            `Gemini returned ${vector?.length ?? 0} dimensions; expected ${this.dimensions}.`,
          );
        }
        result.push(normalizeVector(vector));
      }
    }
    return result;
  }

  private async requestBatch(
    batch: string[],
    taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY",
    title?: string,
  ) {
    for (let retry = 0; ; retry += 1) {
      await this.waitForRequestSlot();
      try {
        return await this.client.embedContent({
          model: this.model,
          contents: batch,
          config: {
            taskType,
            outputDimensionality: this.dimensions,
            ...(taskType === "RETRIEVAL_DOCUMENT" && title ? { title } : {}),
          },
        });
      } catch (error) {
        const quotaError = classifyGeminiEmbeddingError(error);
        if (!quotaError) throw error;
        if (quotaError.scope === "daily" || retry >= this.maxTemporaryRetries) {
          throw quotaError;
        }

        const fallbackDelay = Math.min(
          2 ** retry * 1_000,
          MAX_FALLBACK_RETRY_DELAY_MS,
        );
        const delay =
          (quotaError.retryAfterMs ?? fallbackDelay) + RETRY_DELAY_BUFFER_MS;
        console.warn(
          `[embedding] temporary rate limit; waiting ${Math.ceil(delay / 1_000)}s before retry ${retry + 1}/${this.maxTemporaryRetries}`,
        );
        await this.wait(delay);
      }
    }
  }

  private async waitForRequestSlot(): Promise<void> {
    const scheduled = this.requestSchedule.then(async () => {
      const delay = Math.max(0, this.nextRequestAt - this.now());
      if (delay > 0) await this.wait(delay);
      this.nextRequestAt = this.now() + this.requestIntervalMs;
    });
    this.requestSchedule = scheduled.catch(() => undefined);
    await scheduled;
  }
}
