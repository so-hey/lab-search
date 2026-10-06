import { integerEnv, enumEnv, optionalEnv, requiredEnv } from "../../config/env.js";
import type { EmbeddingProvider } from "./EmbeddingProvider.js";
import { LocalEmbeddingProvider } from "./LocalEmbeddingProvider.js";
import { VoyageEmbeddingProvider } from "./VoyageEmbeddingProvider.js";

export function createEmbeddingProvider(): EmbeddingProvider {
  const mode = enumEnv(
    "EMBEDDING_PROVIDER",
    ["local", "voyage"] as const,
    "local",
  );
  if (mode === "local") {
    return new LocalEmbeddingProvider(
      integerEnv("LOCAL_EMBEDDING_DIMENSIONS", 384),
    );
  }
  return new VoyageEmbeddingProvider({
    apiKey: requiredEnv("VOYAGE_API_KEY"),
    model: optionalEnv("VOYAGE_EMBEDDING_MODEL"),
    dimensions: integerEnv("EMBEDDING_DIMENSIONS", 1_024),
    maxRetries: integerEnv("VOYAGE_EMBEDDING_MAX_RETRIES", 8),
    requestsPerMinute: integerEnv(
      "VOYAGE_EMBEDDING_REQUESTS_PER_MINUTE",
      3,
    ),
    tokensPerMinute: integerEnv("VOYAGE_EMBEDDING_TOKENS_PER_MINUTE", 10_000),
  });
}
