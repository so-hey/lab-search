import { enumEnv, optionalEnv, requiredEnv } from "../config/env.js";
import { getLocalIndexPath } from "../config/paths.js";
import type { EmbeddingProvider } from "../services/embedding/EmbeddingProvider.js";
import type {
  DocumentRepository,
  RemoteDocumentRepository,
} from "./DocumentRepository.js";
import { LocalDocumentRepository } from "./localDocumentRepository.js";
import { QdrantDocumentRepository } from "./QdrantDocumentRepository.js";
import { ZillizDocumentRepository } from "./ZillizDocumentRepository.js";

const SEARCH_MODES = ["local", "qdrant", "zilliz"] as const;
const SEARCH_STRATEGIES = ["dense", "hybrid"] as const;

function createRemoteDocumentRepository(
  mode: "qdrant" | "zilliz",
  embeddingProvider: EmbeddingProvider,
): RemoteDocumentRepository {
  const strategy = enumEnv(
    "SEARCH_STRATEGY",
    SEARCH_STRATEGIES,
    "dense",
  );
  if (strategy === "hybrid" && mode !== "zilliz") {
    throw new Error("SEARCH_STRATEGY=hybrid currently requires SEARCH_MODE=zilliz.");
  }
  if (mode === "qdrant") {
    return new QdrantDocumentRepository({
      url: requiredEnv("QDRANT_URL"),
      apiKey: optionalEnv("QDRANT_API_KEY"),
      collectionName: optionalEnv("QDRANT_COLLECTION"),
      dimensions: embeddingProvider.dimensions,
      embeddingProviderId: embeddingProvider.id,
    });
  }
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
  return createRemoteDocumentRepository(mode, embeddingProvider);
}

export function createWritableDocumentRepository(
  embeddingProvider: EmbeddingProvider,
): RemoteDocumentRepository {
  const mode = enumEnv("SEARCH_MODE", SEARCH_MODES, "local");
  if (mode === "local") {
    throw new Error("sync:drive requires SEARCH_MODE=qdrant or SEARCH_MODE=zilliz.");
  }
  return createRemoteDocumentRepository(mode, embeddingProvider);
}
