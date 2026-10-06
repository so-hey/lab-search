import assert from "node:assert/strict";
import test from "node:test";
import {
  ConsistencyLevelEnum,
  DataType,
  FunctionType,
} from "@zilliz/milvus2-sdk-node";
import type { ZillizClientPort } from "./ZillizDocumentRepository.js";
import { ZillizDocumentRepository } from "./ZillizDocumentRepository.js";

const success = { error_code: "Success", reason: "", code: 0 };
const fieldNames = [
  "id",
  "documentId",
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
  "embedding",
];

function repository(
  client: ZillizClientPort,
  dimensions = 2,
  hybridEnabled = false,
) {
  return new ZillizDocumentRepository({
    endpoint: "https://zilliz.test",
    token: "test-token",
    dimensions,
    embeddingProviderId: "test-embedding-2",
    hybridEnabled,
    client,
  });
}

function entity(index: number) {
  return {
    id: `doc:${index}`,
    documentId: "doc",
    sourceModifiedTime: "2026-01-01T00:00:00Z",
    driveFileId: "drive-doc",
    documentName: "paper.pdf",
    mimeType: "application/pdf",
    chunkIndex: index,
    content: `content-${index}`,
    page: index + 1,
    slide: undefined,
    sectionTitle: null,
    url: "https://drive.test/doc",
    embedding: index === 0 ? [1, 0] : [0, 1],
  };
}

function describedCollection(dimensions: number, hybridEnabled = false) {
  const fields = hybridEnabled
    ? [...fieldNames, "searchText", "searchTextSparse"]
    : fieldNames;
  return {
    status: success,
    collection_name: "document_chunks",
    schema: {
      description: `${hybridEnabled ? "lab-search:v2" : "lab-search:v1"};dimensions=${dimensions};embeddingProvider=test-embedding-2${hybridEnabled ? ";hybrid=bm25-icu-rrf" : ""}`,
      fields: fields.map((name) => ({
        name,
        dim: name === "embedding" ? dimensions : undefined,
        type_params: [],
      })),
      ...(hybridEnabled
        ? {
            functions: [
              {
                name: "search_text_bm25",
                // Zilliz CloudのdescribeCollectionはSDKのenum型と異なり文字列を返す。
                type: "BM25",
                input_field_names: ["searchText"],
                output_field_names: ["searchTextSparse"],
                params: {},
              },
            ],
          }
        : {}),
    },
  };
}

test("ensureCollection creates the fixed chunk schema and indexes", async () => {
  const creations: unknown[] = [];
  const client = {
    async hasCollection() { return { status: success, value: false }; },
    async createCollection(input: unknown) {
      creations.push(input);
      return success;
    },
  } as unknown as ZillizClientPort;

  await repository(client).ensureCollection();

  assert.equal(creations.length, 1);
  const creation = creations[0] as {
    fields: Array<{ name: string; dim?: number }>;
    index_params: Array<{ field_name: string; index_type: string; metric_type?: string }>;
  };
  assert.equal(creation.fields.find((field) => field.name === "embedding")?.dim, 2);
  assert.deepEqual(
    creation.index_params,
    [
      {
        field_name: "embedding",
        index_name: "embedding_autoindex",
        index_type: "AUTOINDEX",
        metric_type: "COSINE",
      },
      {
        field_name: "documentId",
        index_name: "documentId_trie",
        index_type: "TRIE",
      },
    ],
  );
});

test("ensureCollection rejects an incompatible vector dimension", async () => {
  const client = {
    async hasCollection() { return { status: success, value: true }; },
    async describeCollection() { return describedCollection(768); },
  } as unknown as ZillizClientPort;

  await assert.rejects(
    () => repository(client, 384).ensureCollection(),
    /vector size 768; expected 384/,
  );
});

test("hybrid collectionはICU analyzer、BM25 function、sparse indexを作成する", async () => {
  const creations: unknown[] = [];
  const client = {
    async hasCollection() { return { status: success, value: false }; },
    async createCollection(input: unknown) {
      creations.push(input);
      return success;
    },
  } as unknown as ZillizClientPort;

  await repository(client, 2, true).ensureCollection();

  const creation = creations[0] as {
    description: string;
    fields: Array<{
      name: string;
      data_type: DataType;
      enable_analyzer?: boolean;
      analyzer_params?: unknown;
    }>;
    functions: Array<{
      name: string;
      description: string;
      type: FunctionType;
      input_field_names: string[];
      output_field_names: string[];
      params: unknown;
    }>;
    index_params: Array<{
      field_name: string;
      index_type: string;
      metric_type?: string;
    }>;
  };
  const searchText = creation.fields.find((field) => field.name === "searchText");
  const sparse = creation.fields.find((field) => field.name === "searchTextSparse");
  assert.match(creation.description, /hybrid=bm25-icu-rrf/);
  assert.equal(searchText?.enable_analyzer, true);
  assert.deepEqual(searchText?.analyzer_params, {
    tokenizer: "icu",
    filter: ["lowercase"],
  });
  assert.equal(sparse?.data_type, DataType.SparseFloatVector);
  assert.deepEqual(creation.functions, [
    {
      name: "search_text_bm25",
      description: "BM25 sparse vectors for chunk title and content",
      type: FunctionType.BM25,
      input_field_names: ["searchText"],
      output_field_names: ["searchTextSparse"],
      params: {},
    },
  ]);
  assert.equal(
    creation.index_params.find((index) => index.field_name === "searchTextSparse")
      ?.metric_type,
    "BM25",
  );
});

test("hybrid modeは旧dense collectionを誤って再利用しない", async () => {
  const client = {
    async hasCollection() { return { status: success, value: true }; },
    async describeCollection() { return describedCollection(2); },
  } as unknown as ZillizClientPort;

  await assert.rejects(
    () => repository(client, 2, true).ensureCollection(),
    /missing field searchText/,
  );
});

test("hybrid modeはZilliz Cloudが返す文字列のBM25 function typeを受け入れる", async () => {
  const client = {
    async hasCollection() { return { status: success, value: true }; },
    async describeCollection() { return describedCollection(2, true); },
  } as unknown as ZillizClientPort;

  await repository(client, 2, true).ensureCollection();
});

test("searchSimilar returns payload without requesting stored vectors", async () => {
  const calls: unknown[] = [];
  const client = {
    async search(input: unknown) {
      calls.push(input);
      return {
        status: success,
        results: [{ ...entity(0), embedding: undefined, score: 0.91 }],
        recalls: [],
        session_ts: 0,
        collection_name: "document_chunks",
      };
    },
  } as unknown as ZillizClientPort;

  const matches = await repository(client).searchSimilar([1, 0], 20);

  assert.equal(matches[0].chunk.id, "doc:0");
  assert.deepEqual(matches[0].chunk.embedding, []);
  assert.equal(matches[0].score, 0.91);
  const outputFields = (calls[0] as { output_fields: string[] }).output_fields;
  assert.equal(outputFields.includes("embedding"), false);
});

test("searchHybridはdenseとBM25をRRFで統合する", async () => {
  const calls: unknown[] = [];
  const client = {
    async hybridSearch(input: unknown) {
      calls.push(input);
      return {
        status: success,
        results: [{ ...entity(0), embedding: undefined, score: 0.031 }],
        recalls: [],
        session_ts: 0,
        collection_name: "document_chunks",
      };
    },
  } as unknown as ZillizClientPort;

  const matches = await repository(client, 2, true).searchHybrid(
    [1, 0],
    "量子 誤り訂正",
    100,
  );

  assert.equal(matches[0].chunk.id, "doc:0");
  assert.equal(matches[0].score, 0.031);
  assert.deepEqual(calls[0], {
    collection_name: "document_chunks",
    data: [
      {
        anns_field: "embedding",
        data: [1, 0],
        params: { metric_type: "COSINE" },
      },
      {
        anns_field: "searchTextSparse",
        data: "量子 誤り訂正",
        params: { metric_type: "BM25" },
      },
    ],
    limit: 100,
    rerank: { strategy: "rrf", params: { k: 60 } },
    consistency_level: ConsistencyLevelEnum.Bounded,
    output_fields: fieldNames.filter((name) => name !== "embedding"),
  });
});

test("hybrid modeのupsertはBM25入力用の検索本文を含める", async () => {
  const calls: unknown[] = [];
  const client = {
    async upsert(input: unknown) {
      calls.push(input);
      return { status: success };
    },
  } as unknown as ZillizClientPort;

  await repository(client, 2, true).upsertDocumentChunks([
    {
      ...entity(0),
      sectionTitle: "誤り訂正",
    },
  ]);

  const data = (calls[0] as { data: Array<Record<string, unknown>> }).data;
  assert.equal(data[0].searchText, "paper.pdf\n誤り訂正\ncontent-0");
});

test("checkpoint chunks are read with vectors and stale IDs are deleted", async () => {
  const deletions: unknown[] = [];
  const client = {
    async query() {
      return { status: success, data: [entity(0), entity(1)] };
    },
    async delete(input: unknown) {
      deletions.push(input);
      return { status: success };
    },
  } as unknown as ZillizClientPort;
  const target = repository(client);

  const chunks = await target.getDocumentChunks("doc");
  await target.finalizeDocumentChunks("doc", new Set(["doc:0"]));

  assert.deepEqual(chunks[0].embedding, [1, 0]);
  assert.equal(deletions.length, 1);
  assert.deepEqual((deletions[0] as { ids: string[] }).ids, ["doc:1"]);
});
