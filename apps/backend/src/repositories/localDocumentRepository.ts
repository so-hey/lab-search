import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { IndexedChunk } from "../services/documents/types.js";
import { cosineSimilarity } from "../services/search/cosineSimilarity.js";
import type {
  DocumentRepository,
  ScoredChunk,
} from "./DocumentRepository.js";

type LocalIndexFile = {
  version: 1;
  createdAt: string;
  embeddingProviderId: string;
  embeddingDimensions: number;
  chunks: IndexedChunk[];
};

export type LocalIndexMetadata = {
  embeddingProviderId: string;
  embeddingDimensions: number;
};

function isIndexedChunk(value: unknown): value is IndexedChunk {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<IndexedChunk>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.documentId === "string" &&
    typeof candidate.documentName === "string" &&
    typeof candidate.chunkIndex === "number" &&
    typeof candidate.content === "string" &&
    (candidate.url === undefined || typeof candidate.url === "string") &&
    Array.isArray(candidate.embedding) &&
    candidate.embedding.every((entry) => Number.isFinite(entry))
  );
}

function parseLocalIndex(serialized: string): LocalIndexFile {
  const value: unknown = JSON.parse(serialized);

  if (typeof value !== "object" || value === null) {
    throw new Error("Local index must be a JSON object.");
  }

  const candidate = value as Partial<LocalIndexFile>;
  if (
    candidate.version !== 1 ||
    typeof candidate.createdAt !== "string" ||
    typeof candidate.embeddingProviderId !== "string" ||
    !Number.isInteger(candidate.embeddingDimensions) ||
    !Array.isArray(candidate.chunks) ||
    !candidate.chunks.every(isIndexedChunk)
  ) {
    throw new Error("Local index has an unsupported or invalid format.");
  }

  return candidate as LocalIndexFile;
}

export class LocalDocumentRepository implements DocumentRepository {
  constructor(private readonly indexPath: string) {}

  async searchSimilar(
    queryEmbedding: number[],
    limit: number,
  ): Promise<ScoredChunk[]> {
    const index = await this.readIndex();

    if (queryEmbedding.length !== index.embeddingDimensions) {
      throw new Error(
        `Query embedding dimension ${queryEmbedding.length} does not match index dimension ${index.embeddingDimensions}. Rebuild the local index.`,
      );
    }

    return index.chunks
      .map((chunk) => ({
        chunk,
        score: cosineSimilarity(queryEmbedding, chunk.embedding),
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);
  }

  async replaceAll(
    chunks: IndexedChunk[],
    metadata: LocalIndexMetadata,
  ): Promise<void> {
    const index: LocalIndexFile = {
      version: 1,
      createdAt: new Date().toISOString(),
      ...metadata,
      chunks,
    };

    await mkdir(dirname(this.indexPath), { recursive: true });
    await writeFile(this.indexPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  }

  private async readIndex(): Promise<LocalIndexFile> {
    try {
      return parseLocalIndex(await readFile(this.indexPath, "utf8"));
    } catch (cause) {
      if (
        typeof cause === "object" &&
        cause !== null &&
        "code" in cause &&
        cause.code === "ENOENT"
      ) {
        throw new Error(
          `Local index not found at ${this.indexPath}. Run "pnpm --filter backend index:local" first.`,
        );
      }

      throw cause;
    }
  }
}
