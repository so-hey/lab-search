import { enumEnv, optionalEnv, requiredEnv } from "../src/config/env.js";
import { ZillizDocumentRepository } from "../src/repositories/ZillizDocumentRepository.js";
import { createEmbeddingProvider } from "../src/services/embedding/createEmbeddingProvider.js";

async function main() {
  const embeddingProvider = createEmbeddingProvider();
  const repository = new ZillizDocumentRepository({
    endpoint: requiredEnv("ZILLIZ_ENDPOINT"),
    token: requiredEnv("ZILLIZ_TOKEN"),
    collectionName: optionalEnv("ZILLIZ_COLLECTION"),
    dimensions: embeddingProvider.dimensions,
    embeddingProviderId: embeddingProvider.id,
    hybridEnabled:
      enumEnv(
        "SEARCH_STRATEGY",
        ["dense", "hybrid"] as const,
        "dense",
      ) === "hybrid",
  });
  await repository.ensureCollection();
  console.log(
    `[setup:zilliz] ready (${embeddingProvider.id}, ${embeddingProvider.dimensions} dimensions, ${process.env.SEARCH_STRATEGY ?? "dense"})`,
  );
}

main().catch((error: unknown) => {
  console.error("[setup:zilliz] failed", error);
  process.exitCode = 1;
});
