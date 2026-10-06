import {
  ConsistencyLevelEnum,
  DataType,
  FunctionType,
  MilvusClient,
  type DescribeCollectionResponse,
  type FieldSchema,
  type QueryResults,
  type ResStatus,
  type RowData,
  type SearchResultData,
  type SearchResults,
} from "@zilliz/milvus2-sdk-node";
import type { IndexedChunk } from "../services/documents/types.js";
import type {
  DocumentRepository,
  HybridSearchDocumentRepository,
  ScoredChunk,
  WritableDocumentRepository,
} from "./DocumentRepository.js";

const DEFAULT_COLLECTION = "document_chunks";
const VECTOR_FIELD = "embedding";
const PRIMARY_FIELD = "id";
const DOCUMENT_ID_FIELD = "documentId";
const SEARCH_TEXT_FIELD = "searchText";
const SPARSE_VECTOR_FIELD = "searchTextSparse";
const BM25_FUNCTION_NAME = "search_text_bm25";
const HYBRID_SCHEMA_ID = "bm25-icu-rrf";
const SEARCH_TEXT_MAX_BYTES = 65_535;
const QUERY_BATCH_SIZE = 1_000;
const UPSERT_BATCH_SIZE = 100;

const OUTPUT_FIELDS = [
  PRIMARY_FIELD,
  DOCUMENT_ID_FIELD,
  "sourceModifiedTime",
  "driveFileId",
  "documentName",
  "mimeType",
  "chunkIndex",
  "content",
  "page",
  "slide",
  "sectionTitle",
  "url",
] as const;

export type ZillizClientPort = Pick<
  MilvusClient,
  | "createCollection"
  | "delete"
  | "describeCollection"
  | "hasCollection"
  | "query"
  | "search"
  | "hybridSearch"
  | "upsert"
>;

export type ZillizRepositoryOptions = {
  endpoint: string;
  token: string;
  collectionName?: string;
  dimensions: number;
  embeddingProviderId?: string;
  hybridEnabled?: boolean;
  client?: ZillizClientPort;
};

function assertSuccess(status: ResStatus, operation: string): void {
  const code = status.code ?? status.error_code;
  if (code === 0 || code === "0" || code === "Success") return;
  throw new Error(`Zilliz ${operation} failed: ${status.reason || String(code)}`);
}

function quoteFilterValue(value: string): string {
  return JSON.stringify(value);
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = optionalString(record, key);
  if (!value) throw new Error(`Zilliz entity has an invalid ${key} field.`);
  return value;
}

function optionalNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : undefined;
  }
  return undefined;
}

function entityToChunk(record: Record<string, unknown>): IndexedChunk {
  const chunkIndex = optionalNumber(record, "chunkIndex");
  if (chunkIndex === undefined) {
    throw new Error("Zilliz entity has an invalid chunkIndex field.");
  }
  const embedding = record[VECTOR_FIELD];
  return {
    id: requiredString(record, PRIMARY_FIELD),
    documentId: requiredString(record, DOCUMENT_ID_FIELD),
    documentName: requiredString(record, "documentName"),
    chunkIndex,
    content: requiredString(record, "content"),
    embedding:
      Array.isArray(embedding) && embedding.every((value) => typeof value === "number")
        ? embedding
        : [],
    ...(optionalString(record, "sourceModifiedTime")
      ? { sourceModifiedTime: optionalString(record, "sourceModifiedTime") }
      : {}),
    ...(optionalString(record, "driveFileId")
      ? { driveFileId: optionalString(record, "driveFileId") }
      : {}),
    ...(optionalString(record, "mimeType")
      ? { mimeType: optionalString(record, "mimeType") }
      : {}),
    ...(optionalNumber(record, "page") !== undefined
      ? { page: optionalNumber(record, "page") }
      : {}),
    ...(optionalNumber(record, "slide") !== undefined
      ? { slide: optionalNumber(record, "slide") }
      : {}),
    ...(optionalString(record, "sectionTitle")
      ? { sectionTitle: optionalString(record, "sectionTitle") }
      : {}),
    ...(optionalString(record, "url") ? { url: optionalString(record, "url") } : {}),
  };
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  let low = 0;
  let high = value.length;
  while (low < high) {
    const midpoint = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(value.slice(0, midpoint), "utf8") <= maxBytes) {
      low = midpoint;
    } else {
      high = midpoint - 1;
    }
  }
  return value.slice(0, low);
}

function searchableText(chunk: IndexedChunk): string {
  return truncateUtf8(
    [chunk.documentName, chunk.sectionTitle, chunk.content]
      .filter((value): value is string => Boolean(value))
      .join("\n"),
    SEARCH_TEXT_MAX_BYTES,
  );
}

function chunkToEntity(chunk: IndexedChunk, hybridEnabled: boolean): RowData {
  return {
    id: chunk.id,
    documentId: chunk.documentId,
    sourceModifiedTime: chunk.sourceModifiedTime ?? null,
    driveFileId: chunk.driveFileId ?? null,
    documentName: chunk.documentName,
    mimeType: chunk.mimeType ?? null,
    chunkIndex: chunk.chunkIndex,
    content: chunk.content,
    page: chunk.page ?? null,
    slide: chunk.slide ?? null,
    sectionTitle: chunk.sectionTitle ?? null,
    url: chunk.url ?? null,
    embedding: chunk.embedding,
    ...(hybridEnabled ? { [SEARCH_TEXT_FIELD]: searchableText(chunk) } : {}),
  };
}

function collectionDescription(
  dimensions: number,
  providerId: string | undefined,
  hybridEnabled: boolean,
): string {
  return [
    hybridEnabled ? "lab-search:v2" : "lab-search:v1",
    `dimensions=${dimensions}`,
    ...(providerId ? [`embeddingProvider=${encodeURIComponent(providerId)}`] : []),
    ...(hybridEnabled ? [`hybrid=${HYBRID_SCHEMA_ID}`] : []),
  ].join(";");
}

function descriptionValue(description: string, key: string): string | undefined {
  const entry = description.split(";").find((part) => part.startsWith(`${key}=`));
  if (!entry) return undefined;
  return decodeURIComponent(entry.slice(key.length + 1));
}

function fieldDimension(field: FieldSchema): number | undefined {
  if (typeof field.dim === "number") return field.dim;
  if (typeof field.dim === "string" && /^\d+$/.test(field.dim)) return Number(field.dim);
  const dim = field.type_params.find((parameter) => parameter.key === "dim")?.value;
  if (typeof dim === "number") return dim;
  return typeof dim === "string" && /^\d+$/.test(dim) ? Number(dim) : undefined;
}

function isBm25FunctionType(value: unknown): boolean {
  return value === FunctionType.BM25 || value === "BM25";
}

function validateCollection(
  collection: DescribeCollectionResponse,
  dimensions: number,
  providerId?: string,
  hybridEnabled = false,
): void {
  const fields = new Map(collection.schema.fields.map((field) => [field.name, field]));
  const requiredFields = [
    ...OUTPUT_FIELDS,
    VECTOR_FIELD,
    ...(hybridEnabled ? [SEARCH_TEXT_FIELD, SPARSE_VECTOR_FIELD] : []),
  ];
  for (const field of requiredFields) {
    if (!fields.has(field)) {
      throw new Error(
        `Zilliz collection ${collection.collection_name} is missing field ${field}. Use a new collection or recreate it with pnpm setup:zilliz.`,
      );
    }
  }
  const vectorField = fields.get(VECTOR_FIELD);
  const storedDimensions = vectorField ? fieldDimension(vectorField) : undefined;
  if (storedDimensions !== dimensions) {
    throw new Error(
      `Zilliz collection ${collection.collection_name} has vector size ${storedDimensions ?? "unknown"}; expected ${dimensions}. Use a new collection or matching embedding dimension.`,
    );
  }
  const storedProvider = descriptionValue(collection.schema.description ?? "", "embeddingProvider");
  if (storedProvider && providerId && storedProvider !== providerId) {
    throw new Error(
      `Zilliz collection ${collection.collection_name} uses ${storedProvider}; current provider is ${providerId}. Use a new collection or rebuild it explicitly.`,
    );
  }
  if (!storedProvider && providerId) {
    console.warn(
      `[zilliz] collection ${collection.collection_name} does not record an embedding provider; dimension was validated but model compatibility cannot be verified.`,
    );
  }
  if (hybridEnabled) {
    const storedHybrid = descriptionValue(
      collection.schema.description ?? "",
      "hybrid",
    );
    if (storedHybrid !== HYBRID_SCHEMA_ID) {
      throw new Error(
        `Zilliz collection ${collection.collection_name} is not the expected ${HYBRID_SCHEMA_ID} hybrid schema. Use a new collection and migrate the existing chunks.`,
      );
    }
    const bm25Function = collection.schema.functions?.find(
      (candidate) => candidate.name === BM25_FUNCTION_NAME,
    );
    if (
      !bm25Function ||
      !isBm25FunctionType(bm25Function.type) ||
      !bm25Function.input_field_names.includes(SEARCH_TEXT_FIELD) ||
      !bm25Function.output_field_names?.includes(SPARSE_VECTOR_FIELD)
    ) {
      throw new Error(
        `Zilliz collection ${collection.collection_name} is missing the expected BM25 function.`,
      );
    }
  }
}

function collectionFields(dimensions: number, hybridEnabled: boolean) {
  const optionalVarchar = (name: string, maxLength: number) => ({
    name,
    data_type: DataType.VarChar,
    max_length: maxLength,
    nullable: true,
  });
  return [
    {
      name: PRIMARY_FIELD,
      data_type: DataType.VarChar,
      max_length: 1_024,
      is_primary_key: true,
      autoID: false,
    },
    { name: DOCUMENT_ID_FIELD, data_type: DataType.VarChar, max_length: 1_024 },
    optionalVarchar("sourceModifiedTime", 128),
    optionalVarchar("driveFileId", 1_024),
    { name: "documentName", data_type: DataType.VarChar, max_length: 8_192 },
    optionalVarchar("mimeType", 512),
    { name: "chunkIndex", data_type: DataType.Int64 },
    { name: "content", data_type: DataType.VarChar, max_length: 65_535 },
    { name: "page", data_type: DataType.Int64, nullable: true },
    { name: "slide", data_type: DataType.Int64, nullable: true },
    optionalVarchar("sectionTitle", 16_384),
    optionalVarchar("url", 16_384),
    {
      name: VECTOR_FIELD,
      data_type: DataType.FloatVector,
      dim: dimensions,
    },
    ...(hybridEnabled
      ? [
          {
            name: SEARCH_TEXT_FIELD,
            data_type: DataType.VarChar,
            max_length: SEARCH_TEXT_MAX_BYTES,
            enable_analyzer: true,
            analyzer_params: {
              tokenizer: "icu",
              filter: ["lowercase"],
            },
          },
          {
            name: SPARSE_VECTOR_FIELD,
            data_type: DataType.SparseFloatVector,
          },
        ]
      : []),
  ];
}

export class ZillizDocumentRepository
  implements
    DocumentRepository,
    HybridSearchDocumentRepository,
    WritableDocumentRepository
{
  readonly indexId: string;
  private readonly client: ZillizClientPort;
  private readonly collectionName: string;
  private readonly dimensions: number;
  private readonly embeddingProviderId?: string;
  private readonly hybridEnabled: boolean;

  constructor(options: ZillizRepositoryOptions) {
    if (!Number.isInteger(options.dimensions) || options.dimensions < 1) {
      throw new Error("Zilliz embedding dimensions must be a positive integer.");
    }
    this.client =
      options.client ??
      new MilvusClient({
        address: options.endpoint,
        token: options.token,
        ssl: true,
      });
    this.collectionName = options.collectionName ?? DEFAULT_COLLECTION;
    this.indexId = `zilliz:${this.collectionName}`;
    this.dimensions = options.dimensions;
    this.embeddingProviderId = options.embeddingProviderId;
    this.hybridEnabled = options.hybridEnabled ?? false;
  }

  async ensureCollection(): Promise<void> {
    const exists = await this.client.hasCollection({ collection_name: this.collectionName });
    assertSuccess(exists.status, "hasCollection");
    if (!exists.value) {
      const status = await this.client.createCollection({
        collection_name: this.collectionName,
        description: collectionDescription(
          this.dimensions,
          this.embeddingProviderId,
          this.hybridEnabled,
        ),
        consistency_level: "Bounded",
        enable_dynamic_field: false,
        fields: collectionFields(this.dimensions, this.hybridEnabled),
        ...(this.hybridEnabled
          ? {
              functions: [
                {
                  name: BM25_FUNCTION_NAME,
                  description: "BM25 sparse vectors for chunk title and content",
                  type: FunctionType.BM25,
                  input_field_names: [SEARCH_TEXT_FIELD],
                  output_field_names: [SPARSE_VECTOR_FIELD],
                  params: {},
                },
              ],
            }
          : {}),
        index_params: [
          {
            field_name: VECTOR_FIELD,
            index_name: `${VECTOR_FIELD}_autoindex`,
            index_type: "AUTOINDEX",
            metric_type: "COSINE",
          },
          {
            field_name: DOCUMENT_ID_FIELD,
            index_name: `${DOCUMENT_ID_FIELD}_trie`,
            index_type: "TRIE",
          },
          ...(this.hybridEnabled
            ? [
                {
                  field_name: SPARSE_VECTOR_FIELD,
                  index_name: `${SPARSE_VECTOR_FIELD}_autoindex`,
                  index_type: "AUTOINDEX",
                  metric_type: "BM25",
                  params: { inverted_index_algo: "DAAT_MAXSCORE" },
                },
              ]
            : []),
        ],
      });
      assertSuccess(status, "createCollection");
      console.info(
        `[zilliz] created collection ${this.collectionName} (${this.dimensions} dimensions, COSINE${this.hybridEnabled ? " + BM25/ICU" : ""})`,
      );
      return;
    }

    const collection = await this.client.describeCollection({
      collection_name: this.collectionName,
    });
    assertSuccess(collection.status, "describeCollection");
    validateCollection(
      collection,
      this.dimensions,
      this.embeddingProviderId,
      this.hybridEnabled,
    );
  }

  async searchSimilar(queryEmbedding: number[], limit: number): Promise<ScoredChunk[]> {
    if (queryEmbedding.length !== this.dimensions) {
      throw new Error(
        `Query vector has ${queryEmbedding.length} dimensions; expected ${this.dimensions}.`,
      );
    }
    const response: SearchResults<never> = await this.client.search({
      collection_name: this.collectionName,
      anns_field: VECTOR_FIELD,
      vector: queryEmbedding,
      limit,
      metric_type: "COSINE",
      consistency_level: ConsistencyLevelEnum.Bounded,
      output_fields: [...OUTPUT_FIELDS],
    });
    assertSuccess(response.status, "search");
    const results = response.results as SearchResultData[];
    return results.map((result) => ({
      chunk: entityToChunk(result),
      score: result.score,
    }));
  }

  async searchHybrid(
    queryEmbedding: number[],
    queryText: string,
    limit: number,
  ): Promise<ScoredChunk[]> {
    if (!this.hybridEnabled) {
      throw new Error(
        "This Zilliz repository was not configured with hybrid search enabled.",
      );
    }
    if (queryEmbedding.length !== this.dimensions) {
      throw new Error(
        `Query vector has ${queryEmbedding.length} dimensions; expected ${this.dimensions}.`,
      );
    }
    if (!queryText.trim()) throw new Error("Hybrid search query must not be empty.");

    const response = await this.client.hybridSearch({
      collection_name: this.collectionName,
      data: [
        {
          anns_field: VECTOR_FIELD,
          data: queryEmbedding,
          params: { metric_type: "COSINE" },
        },
        {
          anns_field: SPARSE_VECTOR_FIELD,
          data: queryText.trim(),
          params: { metric_type: "BM25" },
        },
      ],
      limit,
      rerank: { strategy: "rrf", params: { k: 60 } },
      consistency_level: ConsistencyLevelEnum.Bounded,
      output_fields: [...OUTPUT_FIELDS],
    });
    assertSuccess(response.status, "hybrid search");
    const results = response.results as SearchResultData[];
    return results.map((result) => ({
      chunk: entityToChunk(result),
      score: result.score,
    }));
  }

  async getDocumentChunks(documentId: string): Promise<IndexedChunk[]> {
    const chunks: IndexedChunk[] = [];
    for (let offset = 0; ; offset += QUERY_BATCH_SIZE) {
      const response: QueryResults = await this.client.query({
        collection_name: this.collectionName,
        filter: `${DOCUMENT_ID_FIELD} == ${quoteFilterValue(documentId)}`,
        output_fields: [...OUTPUT_FIELDS, VECTOR_FIELD],
        limit: QUERY_BATCH_SIZE,
        offset,
        consistency_level: ConsistencyLevelEnum.Bounded,
      });
      assertSuccess(response.status, "query");
      chunks.push(...response.data.map(entityToChunk));
      if (response.data.length < QUERY_BATCH_SIZE) break;
    }
    return chunks;
  }

  async upsertDocumentChunks(chunks: IndexedChunk[]): Promise<void> {
    for (let offset = 0; offset < chunks.length; offset += UPSERT_BATCH_SIZE) {
      const batch = chunks.slice(offset, offset + UPSERT_BATCH_SIZE);
      for (const chunk of batch) {
        if (chunk.embedding.length !== this.dimensions) {
          throw new Error(
            `Chunk ${chunk.id} has ${chunk.embedding.length} dimensions; expected ${this.dimensions}.`,
          );
        }
      }
      const response = await this.client.upsert({
        collection_name: this.collectionName,
        data: batch.map((chunk) => chunkToEntity(chunk, this.hybridEnabled)),
      });
      assertSuccess(response.status, "upsert");
    }
  }

  async finalizeDocumentChunks(
    documentId: string,
    expectedChunkIds: ReadonlySet<string>,
  ): Promise<void> {
    const stored = await this.getDocumentChunks(documentId);
    const staleIds = stored
      .filter((chunk) => !expectedChunkIds.has(chunk.id))
      .map((chunk) => chunk.id);
    for (let offset = 0; offset < staleIds.length; offset += UPSERT_BATCH_SIZE) {
      const response = await this.client.delete({
        collection_name: this.collectionName,
        ids: staleIds.slice(offset, offset + UPSERT_BATCH_SIZE),
      });
      assertSuccess(response.status, "delete stale chunks");
    }
  }

  async deleteDocument(documentId: string): Promise<void> {
    const response = await this.client.delete({
      collection_name: this.collectionName,
      filter: `${DOCUMENT_ID_FIELD} == ${quoteFilterValue(documentId)}`,
    });
    assertSuccess(response.status, "delete document");
  }
}
