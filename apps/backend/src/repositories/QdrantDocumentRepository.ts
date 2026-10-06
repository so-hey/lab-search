import { createHash } from "node:crypto";
import { QdrantClient } from "@qdrant/js-client-rest";
import type { IndexedChunk } from "../services/documents/types.js";
import { createChunkPayload } from "../services/documents/createChunkPayload.js";
import type {
  DocumentRepository,
  ScoredChunk,
  WritableDocumentRepository,
} from "./DocumentRepository.js";

type QdrantClientPort = Pick<
  QdrantClient,
  | "collectionExists"
  | "createCollection"
  | "createPayloadIndex"
  | "delete"
  | "getCollection"
  | "query"
  | "scroll"
  | "upsert"
>;

export type QdrantRepositoryOptions = {
  url: string;
  apiKey?: string;
  collectionName?: string;
  dimensions: number;
  embeddingProviderId?: string;
  client?: QdrantClientPort;
};

function pointId(chunkId: string): string {
  const hex = createHash("sha256").update(chunkId).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}

function readVectorSize(collection: unknown): number | undefined {
  if (typeof collection !== "object" || collection === null) return undefined;
  const config = (collection as { config?: unknown }).config;
  if (typeof config !== "object" || config === null) return undefined;
  const params = (config as { params?: unknown }).params;
  if (typeof params !== "object" || params === null) return undefined;
  const vectors = (params as { vectors?: unknown }).vectors;
  if (typeof vectors !== "object" || vectors === null) return undefined;
  const size = (vectors as { size?: unknown }).size;
  return typeof size === "number" ? size : undefined;
}

export function readPayloadIndexType(
  collection: unknown,
  fieldName: string,
): string | undefined {
  if (typeof collection !== "object" || collection === null) return undefined;
  const payloadSchema = (collection as { payload_schema?: unknown }).payload_schema;
  if (typeof payloadSchema !== "object" || payloadSchema === null) return undefined;
  const index = (payloadSchema as Record<string, unknown>)[fieldName];
  if (typeof index !== "object" || index === null) return undefined;
  const dataType = (index as { data_type?: unknown }).data_type;
  return typeof dataType === "string" ? dataType : undefined;
}

function optionalString(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "string" ? value : undefined;
}

function optionalNumber(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "number" ? value : undefined;
}

function payloadToChunk(payload: Record<string, unknown>): IndexedChunk {
  const id = optionalString(payload, "chunkId");
  const documentId = optionalString(payload, "documentId");
  const documentName = optionalString(payload, "documentName");
  const content = optionalString(payload, "content");
  const chunkIndex = optionalNumber(payload, "chunkIndex");
  if (!id || !documentId || !documentName || content === undefined || chunkIndex === undefined) {
    throw new Error("Qdrant point has an invalid document chunk payload.");
  }
  return {
    id,
    documentId,
    documentName,
    chunkIndex,
    content,
    embedding: [],
    ...(optionalString(payload, "sourceModifiedTime") ? { sourceModifiedTime: optionalString(payload, "sourceModifiedTime") } : {}),
    ...(optionalString(payload, "driveFileId") ? { driveFileId: optionalString(payload, "driveFileId") } : {}),
    ...(optionalString(payload, "mimeType") ? { mimeType: optionalString(payload, "mimeType") } : {}),
    ...(optionalNumber(payload, "page") ? { page: optionalNumber(payload, "page") } : {}),
    ...(optionalNumber(payload, "slide") ? { slide: optionalNumber(payload, "slide") } : {}),
    ...(optionalString(payload, "sectionTitle") ? { sectionTitle: optionalString(payload, "sectionTitle") } : {}),
    ...(optionalString(payload, "url") ? { url: optionalString(payload, "url") } : {}),
  };
}

export class QdrantDocumentRepository
  implements DocumentRepository, WritableDocumentRepository
{
  readonly indexId: string;
  private readonly client: QdrantClientPort;
  private readonly collectionName: string;
  private readonly dimensions: number;
  private readonly embeddingProviderId?: string;

  constructor(options: QdrantRepositoryOptions) {
    this.client = options.client ?? new QdrantClient({ url: options.url, apiKey: options.apiKey });
    this.collectionName = options.collectionName ?? "document_chunks";
    this.indexId = `qdrant:${this.collectionName}`;
    this.dimensions = options.dimensions;
    this.embeddingProviderId = options.embeddingProviderId;
  }

  async ensureCollection(): Promise<void> {
    const { exists } = await this.client.collectionExists(this.collectionName);
    if (!exists) {
      await this.client.createCollection(this.collectionName, {
        vectors: { size: this.dimensions, distance: "Cosine" },
        on_disk_payload: true,
        ...(this.embeddingProviderId
          ? { metadata: { embeddingProviderId: this.embeddingProviderId } }
          : {}),
      });
      await this.ensureDocumentIdPayloadIndex();
      return;
    }
    const collection = await this.client.getCollection(this.collectionName);
    const size = readVectorSize(collection);
    if (size !== this.dimensions) {
      throw new Error(
        `Qdrant collection ${this.collectionName} has vector size ${size ?? "unknown"}; expected ${this.dimensions}. Use a new collection or matching embedding dimension.`,
      );
    }
    const metadata = collection.config.metadata;
    const storedProvider =
      metadata && typeof metadata.embeddingProviderId === "string"
        ? metadata.embeddingProviderId
        : undefined;
    if (storedProvider && this.embeddingProviderId && storedProvider !== this.embeddingProviderId) {
      throw new Error(
        `Qdrant collection ${this.collectionName} uses ${storedProvider}; current provider is ${this.embeddingProviderId}. Use a new collection or rebuild it explicitly.`,
      );
    }
    await this.ensureDocumentIdPayloadIndex(collection);
  }

  private async ensureDocumentIdPayloadIndex(collection?: unknown): Promise<void> {
    const indexType = readPayloadIndexType(collection, "documentId");
    if (indexType === "keyword" || indexType === "uuid") return;
    if (indexType !== undefined) {
      throw new Error(
        `Qdrant payload index documentId has type ${indexType}; expected keyword or uuid.`,
      );
    }

    console.info("[qdrant] creating payload index: documentId (keyword)");
    await this.client.createPayloadIndex(this.collectionName, {
      wait: true,
      field_name: "documentId",
      field_schema: "keyword",
    });
  }

  async searchSimilar(queryEmbedding: number[], limit: number): Promise<ScoredChunk[]> {
    if (queryEmbedding.length !== this.dimensions) {
      throw new Error(`Query vector has ${queryEmbedding.length} dimensions; expected ${this.dimensions}.`);
    }
    const response = await this.client.query(this.collectionName, {
      query: queryEmbedding,
      limit,
      with_payload: true,
      with_vector: false,
    });
    return response.points.map((point) => ({
      chunk: payloadToChunk(point.payload ?? {}),
      score: point.score,
    }));
  }

  async getDocumentChunks(documentId: string): Promise<IndexedChunk[]> {
    const chunks: IndexedChunk[] = [];
    let offset: string | number | undefined;
    do {
      const response = await this.client.scroll(this.collectionName, {
        filter: { must: [{ key: "documentId", match: { value: documentId } }] },
        limit: 100,
        ...(offset === undefined ? {} : { offset }),
        with_payload: true,
        with_vector: true,
      });
      for (const point of response.points) {
        if (!Array.isArray(point.vector) || !point.vector.every((value) => typeof value === "number")) {
          throw new Error("Qdrant point has an invalid or named vector.");
        }
        chunks.push({
          ...payloadToChunk(point.payload ?? {}),
          embedding: point.vector,
        });
      }
      offset =
        typeof response.next_page_offset === "string" ||
        typeof response.next_page_offset === "number"
          ? response.next_page_offset
          : undefined;
    } while (offset !== undefined);
    return chunks;
  }

  async upsertDocumentChunks(chunks: IndexedChunk[]): Promise<void> {
    for (let offset = 0; offset < chunks.length; offset += 100) {
      const batch = chunks.slice(offset, offset + 100);
      for (const chunk of batch) {
        if (chunk.embedding.length !== this.dimensions) {
          throw new Error(
            `Chunk ${chunk.id} has ${chunk.embedding.length} dimensions; expected ${this.dimensions}.`,
          );
        }
      }
      await this.client.upsert(this.collectionName, {
        wait: true,
        points: batch.map((chunk) => ({
          id: pointId(chunk.id),
          vector: chunk.embedding,
          payload: createChunkPayload(chunk),
        })),
      });
    }
  }

  async finalizeDocumentChunks(
    documentId: string,
    expectedChunkIds: ReadonlySet<string>,
  ): Promise<void> {
    const stored = await this.getDocumentChunks(documentId);
    const stalePointIds = stored
      .filter((chunk) => !expectedChunkIds.has(chunk.id))
      .map((chunk) => pointId(chunk.id));
    for (let offset = 0; offset < stalePointIds.length; offset += 100) {
      await this.client.delete(this.collectionName, {
        wait: true,
        points: stalePointIds.slice(offset, offset + 100),
      });
    }
  }

  async deleteDocument(documentId: string): Promise<void> {
    await this.client.delete(this.collectionName, {
      wait: true,
      filter: { must: [{ key: "documentId", match: { value: documentId } }] },
    });
  }
}
