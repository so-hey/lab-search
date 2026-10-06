import assert from "node:assert/strict";
import test from "node:test";
import type { QdrantClient } from "@qdrant/js-client-rest";
import {
  QdrantDocumentRepository,
  readPayloadIndexType,
} from "./QdrantDocumentRepository.js";

function collection(payloadSchema: Record<string, unknown> = {}) {
  return {
    config: {
      params: { vectors: { size: 768, distance: "Cosine" } },
      metadata: { embeddingProviderId: "gemini:text-embedding-004:768" },
    },
    payload_schema: payloadSchema,
  };
}

test("readPayloadIndexType reads an existing payload index", () => {
  assert.equal(
    readPayloadIndexType(
      collection({ documentId: { data_type: "keyword", points: 1 } }),
      "documentId",
    ),
    "keyword",
  );
  assert.equal(readPayloadIndexType(collection(), "documentId"), undefined);
});

test("ensureCollection adds the documentId payload index to an existing collection", async () => {
  const createdIndexes: unknown[] = [];
  const client = {
    async collectionExists() {
      return { exists: true };
    },
    async getCollection() {
      return collection();
    },
    async createPayloadIndex(name: string, options: unknown) {
      createdIndexes.push({ name, options });
      return { operation_id: 1, status: "completed" };
    },
  } as unknown as QdrantClient;
  const repository = new QdrantDocumentRepository({
    url: "http://qdrant.test",
    dimensions: 768,
    embeddingProviderId: "gemini:text-embedding-004:768",
    client,
  });

  await repository.ensureCollection();

  assert.deepEqual(createdIndexes, [
    {
      name: "document_chunks",
      options: {
        wait: true,
        field_name: "documentId",
        field_schema: "keyword",
      },
    },
  ]);
});

test("ensureCollection reuses a compatible documentId payload index", async () => {
  let createPayloadIndexCalls = 0;
  const client = {
    async collectionExists() {
      return { exists: true };
    },
    async getCollection() {
      return collection({ documentId: { data_type: "keyword", points: 1 } });
    },
    async createPayloadIndex() {
      createPayloadIndexCalls += 1;
      return { operation_id: 1, status: "completed" };
    },
  } as unknown as QdrantClient;
  const repository = new QdrantDocumentRepository({
    url: "http://qdrant.test",
    dimensions: 768,
    embeddingProviderId: "gemini:text-embedding-004:768",
    client,
  });

  await repository.ensureCollection();

  assert.equal(createPayloadIndexCalls, 0);
});

test("checkpoint chunkをvector付きで読み戻し、完了時に余分なpointだけ削除する", async () => {
  const deletions: Array<{ name: string; options: unknown }> = [];
  const payload = (chunkIndex: number) => ({
    chunkId: `doc:${chunkIndex}`,
    documentId: "doc",
    documentName: "paper.pdf",
    chunkIndex,
    content: `content-${chunkIndex}`,
    sourceModifiedTime: "2026-01-01T00:00:00Z",
  });
  const client = {
    async scroll() {
      return {
        points: [
          { id: "point-0", vector: [1, 0], payload: payload(0) },
          { id: "point-1", vector: [0, 1], payload: payload(1) },
        ],
        next_page_offset: null,
      };
    },
    async delete(name: string, options: unknown) {
      deletions.push({ name, options });
      return { operation_id: 1, status: "completed" };
    },
  } as unknown as QdrantClient;
  const repository = new QdrantDocumentRepository({
    url: "http://qdrant.test",
    dimensions: 2,
    client,
  });

  const chunks = await repository.getDocumentChunks("doc");
  await repository.finalizeDocumentChunks("doc", new Set(["doc:0"]));

  assert.equal(chunks.length, 2);
  assert.deepEqual(chunks[0].embedding, [1, 0]);
  assert.equal(chunks[0].sourceModifiedTime, "2026-01-01T00:00:00Z");
  assert.equal(deletions.length, 1);
  assert.equal(deletions[0].name, "document_chunks");
  assert.equal((deletions[0].options as { points: string[] }).points.length, 1);
});
