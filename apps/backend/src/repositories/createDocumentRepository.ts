import { enumEnv, optionalEnv, requiredEnv } from "../config/env.js";
import { getLocalIndexPath } from "../config/paths.js";
import type { EmbeddingProvider } from "../services/embedding/EmbeddingProvider.js";
import type {
  DocumentRepository,
  RemoteDocumentRepository,
} from "./DocumentRepository.js";
import { LocalDocumentRepository } from "./localDocumentRepository.js";
import { ZillizDocumentRepository } from "./ZillizDocumentRepository.js";

const SEARCH_MODES = ["local", "zilliz"] as const;
const SEARCH_STRATEGIES = ["dense", "hybrid"] as const;

function createRemoteDocumentRepository(
  embeddingProvider: EmbeddingProvider,
): RemoteDocumentRepository {
  const strategy = enumEnv(
    "SEARCH_STRATEGY",
    SEARCH_STRATEGIES,
    "dense",
  );
  return new ZillizDocumentRepository({
    endpoint: requiredEnv("ZILLIZ_ENDPOINT"),
    token: requiredEnv("ZILLIZ_TOKEN"),
    collectionName: optionalEnv("ZILLIZ_COLLECTION"),
    dimensions: embeddingProvider.dimensions,
    embeddingProviderId: embeddingProvider.id,
    hybridEnabled: strategy === "hybrid",
  });
}

export function createDocumentRepository(
  embeddingProvider: EmbeddingProvider,
): DocumentRepository {
  const mode = enumEnv("SEARCH_MODE", SEARCH_MODES, "local");
  if (mode === "local") {
    if (
      enumEnv("SEARCH_STRATEGY", SEARCH_STRATEGIES, "dense") === "hybrid"
    ) {
      throw new Error("SEARCH_STRATEGY=hybrid currently requires SEARCH_MODE=zilliz.");
    }
    return new LocalDocumentRepository(getLocalIndexPath());
  }
  return createRemoteDocumentRepository(embeddingProvider);
}

export function createWritableDocumentRepository(
  embeddingProvider: EmbeddingProvider,
): RemoteDocumentRepository {
  const mode = enumEnv("SEARCH_MODE", SEARCH_MODES, "local");
  if (mode === "local") {
    throw new Error("sync:drive requires SEARCH_MODE=zilliz.");
  }
  return createRemoteDocumentRepository(embeddingProvider);
}
