import { enumEnv, optionalEnv, requiredEnv, integerEnv } from "../../config/env.js";
import type { Reranker } from "./Reranker.js";
import { VoyageReranker } from "./VoyageReranker.js";

export function createReranker(): Reranker | undefined {
  const provider = enumEnv(
    "RERANKER_PROVIDER",
    ["none", "voyage"] as const,
    "none",
  );
  if (provider === "none") return undefined;
  return new VoyageReranker({
    apiKey: requiredEnv("VOYAGE_API_KEY"),
    model: optionalEnv("VOYAGE_RERANK_MODEL"),
    maxRetries: integerEnv("VOYAGE_RERANK_MAX_RETRIES", 4),
  });
}
