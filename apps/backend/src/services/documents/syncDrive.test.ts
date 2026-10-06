import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DocumentRecord } from "../../repositories/metadata/types.js";
import { EmptyDocumentError } from "./extractors/DocumentExtractor.js";
import { ExtractorRegistry } from "./extractors/ExtractorRegistry.js";
import { MIME } from "./mimeTypes.js";
import { syncDrive } from "./syncDrive.js";
import type { SourceFile } from "./source/types.js";
import { DriveAcquisitionError } from "./source/GoogleDriveDocumentSource.js";
import { EmbeddingQuotaError } from "../embedding/EmbeddingProvider.js";
import type { IndexedChunk } from "./types.js";

function sourceFile(id: string, modifiedTime: string): SourceFile {
  return {
    id,
    name: `${id}.pdf`,
    mimeType: MIME.pdf,
    parentIds: ["folder"],
    modifiedTime,
  };
}

function record(id: string, modifiedTime: string): DocumentRecord {
  return {
    id: `db-${id}`,
    driveFileId: id,
    name: `${id}.pdf`,
    mimeType: MIME.pdf,
    parentFolderId: "folder",
    webViewLink: null,
    modifiedTime,
    isIndexed: true,
    embeddingProviderId: "mock",
    vectorStoreId: "test:index",
    duplicateOf: null,
    isActive: true,
  };
}

describe("syncDrive", () => {
  it("未変更をskipし、更新・削除を反映し、1ファイル失敗後も続行する", async () => {
    // Supabaseのtimestamptzは+00:00、Drive APIはZで返すことがある。
    // 同じinstantなら文字列表現が異なっても未変更として扱う。
    const existing = [
      record("unchanged", "2026-01-02T00:00:00+00:00"),
      record("updated", "2026-01-01T00:00:00Z"),
      record("removed", "2026-01-01T00:00:00Z"),
    ];
    const files = [
      sourceFile("unchanged", "2026-01-02T00:00:00Z"),
      sourceFile("updated", "2026-01-02T00:00:00Z"),
      sourceFile("broken", "2026-01-02T00:00:00Z"),
    ];
    const records = new Map(existing.map((item) => [item.driveFileId, item]));
    const replaced: string[] = [];
    const deleted: string[] = [];
    const summary = await syncDrive({
      source: {
        async listDocuments() {
          return files;
        },
        async getDocument(file) {
          if (file.id === "broken") throw new Error("download failed");
          return { file, contentMimeType: MIME.pdf, data: new Uint8Array([1]) };
        },
      },
      extractorRegistry: new ExtractorRegistry([
        {
          supports() {
            return true;
          },
          async extract() {
            return { sections: [{ text: "検索可能な本文", page: 1 }] };
          },
        },
      ]),
      embeddingProvider: {
        id: "mock",
        dimensions: 2,
        async embed() {
          return [1, 0];
        },
        async embedQuery() {
          return [1, 0];
        },
        async embedDocument() {
          return [1, 0];
        },
        async embedDocuments(texts) {
          return texts.map(() => [1, 0]);
        },
      },
      documentRepository: {
        indexId: "test:index",
        async ensureCollection() {},
        async getDocumentChunks() {
          return [];
        },
        async upsertDocumentChunks() {},
        async finalizeDocumentChunks(documentId) {
          replaced.push(documentId);
        },
        async deleteDocument(documentId) {
          deleted.push(documentId);
        },
      },
      metadataRepository: {
        async listActive() {
          return existing;
        },
        async upsert(input) {
          const item = records.get(input.driveFileId) ?? {
            id: `db-${input.driveFileId}`,
            ...input,
          };
          const updated = { ...item, ...input };
          records.set(input.driveFileId, updated);
          return updated;
        },
        async updateIndexState(id, state) {
          const entry = [...records.entries()].find(
            ([, item]) => item.id === id,
          );
          if (entry) records.set(entry[0], { ...entry[1], ...state });
        },
      },
    });
    assert.deepEqual(summary, {
      new: 0,
      updated: 1,
      skipped: 1,
      duplicates: 0,
      failed: 1,
      removed: 1,
      unsupported: 0,
      skippedAbusiveFiles: 0,
      skippedEmptyDocuments: 0,
      permissionErrors: 0,
      exportSizeErrors: 0,
      fileNotDownloadableErrors: 0,
      embeddingQuotaExhausted: false,
      deferred: 0,
      embeddedChunks: 1,
      reusedChunks: 0,
      embeddingBatchAttempts: 1,
      embeddingInputAttempts: 1,
    });
    assert.deepEqual(replaced, ["db-updated"]);
    assert.ok(deleted.includes("db-removed"));
  });

  it("同じDrive更新時刻でもEmbedding ProviderまたはCollectionが変われば再indexする", async () => {
    const file = sourceFile("provider-changed", "2026-01-02T00:00:00Z");
    const existing = {
      ...record(file.id, file.modifiedTime),
      embeddingProviderId: "gemini-embedding-001-768",
      vectorStoreId: "zilliz:document_chunks",
    };
    let current: DocumentRecord = existing;
    let embeddingCalls = 0;

    const summary = await syncDrive({
      source: {
        async listDocuments() {
          return [file];
        },
        async getDocument() {
          return { file, contentMimeType: MIME.pdf, data: new Uint8Array([1]) };
        },
      },
      extractorRegistry: new ExtractorRegistry([
        {
          supports() {
            return true;
          },
          async extract() {
            return { sections: [{ text: "検索可能な本文", page: 1 }] };
          },
        },
      ]),
      embeddingProvider: {
        id: "voyage-4-lite-1024",
        dimensions: 2,
        async embed() {
          return [1, 0];
        },
        async embedQuery() {
          return [1, 0];
        },
        async embedDocument() {
          return [1, 0];
        },
        async embedDocuments(texts) {
          embeddingCalls += 1;
          return texts.map(() => [1, 0]);
        },
      },
      documentRepository: {
        indexId: "zilliz:document_chunks_voyage4_lite_1024",
        async ensureCollection() {},
        async getDocumentChunks() {
          return [];
        },
        async upsertDocumentChunks() {},
        async finalizeDocumentChunks() {},
        async deleteDocument() {},
      },
      metadataRepository: {
        async listActive() {
          return [existing];
        },
        async upsert(input) {
          current = { ...current, ...input };
          return current;
        },
        async updateIndexState(_id, state) {
          current = { ...current, ...state };
        },
      },
    });

    assert.equal(summary.updated, 1);
    assert.equal(summary.skipped, 0);
    assert.equal(embeddingCalls, 1);
    assert.equal(current.isIndexed, true);
    assert.equal(current.embeddingProviderId, "voyage-4-lite-1024");
    assert.equal(
      current.vectorStoreId,
      "zilliz:document_chunks_voyage4_lite_1024",
    );
  });

  it("abusive PDFを専用skipとして扱い、同期全体を失敗にしない", async () => {
    const abusive = sourceFile("abusive", "2026-01-02T00:00:00Z");
    const deleted: string[] = [];
    const states: Array<{ id: string; isIndexed: boolean }> = [];
    const summary = await syncDrive({
      source: {
        async listDocuments() {
          return [abusive];
        },
        async getDocument() {
          throw new DriveAcquisitionError(
            "abusive file",
            "cannotDownloadAbusiveFile",
            {
              status: 403,
              error: {
                message: "abusive file",
                errors: [{ reason: "cannotDownloadAbusiveFile" }],
              },
              fileId: abusive.id,
              fileName: abusive.name,
              mimeType: abusive.mimeType,
              capabilities: { canDownload: true },
              driveId: null,
              parents: abusive.parentIds,
              retrievalStrategy: "download",
              googleApiResponseBody: null,
            },
            "skipped",
          );
        },
      },
      extractorRegistry: new ExtractorRegistry([]),
      embeddingProvider: {
        id: "mock",
        dimensions: 2,
        async embed() {
          return [1, 0];
        },
        async embedQuery() {
          return [1, 0];
        },
        async embedDocument() {
          return [1, 0];
        },
        async embedDocuments(texts) {
          return texts.map(() => [1, 0]);
        },
      },
      documentRepository: {
        indexId: "test:index",
        async ensureCollection() {},
        async getDocumentChunks() {
          return [];
        },
        async upsertDocumentChunks() {},
        async finalizeDocumentChunks() {},
        async deleteDocument(id) {
          deleted.push(id);
        },
      },
      metadataRepository: {
        async listActive() {
          return [];
        },
        async upsert(input) {
          return { id: "db-abusive", ...input };
        },
        async updateIndexState(id, state) {
          states.push({ id, isIndexed: state.isIndexed });
        },
      },
    });
    assert.equal(summary.skippedAbusiveFiles, 1);
    assert.equal(summary.failed, 0);
    assert.deepEqual(deleted, ["db-abusive"]);
    assert.deepEqual(states, [{ id: "db-abusive", isIndexed: false }]);
  });

  it("抽出可能なテキストがない文書を正常なskipとして扱う", async () => {
    const empty = sourceFile("empty", "2026-01-02T00:00:00Z");
    const deleted: string[] = [];
    const states: Array<{ id: string; isIndexed: boolean }> = [];
    const summary = await syncDrive({
      source: {
        async listDocuments() {
          return [empty];
        },
        async getDocument() {
          return {
            file: empty,
            contentMimeType: MIME.pdf,
            data: new Uint8Array([1]),
          };
        },
      },
      extractorRegistry: new ExtractorRegistry([
        {
          supports() {
            return true;
          },
          async extract() {
            throw new EmptyDocumentError("no text");
          },
        },
      ]),
      embeddingProvider: {
        id: "mock",
        dimensions: 2,
        async embed() {
          return [1, 0];
        },
        async embedQuery() {
          return [1, 0];
        },
        async embedDocument() {
          return [1, 0];
        },
        async embedDocuments(texts) {
          return texts.map(() => [1, 0]);
        },
      },
      documentRepository: {
        indexId: "test:index",
        async ensureCollection() {},
        async getDocumentChunks() {
          return [];
        },
        async upsertDocumentChunks() {},
        async finalizeDocumentChunks() {},
        async deleteDocument(id) {
          deleted.push(id);
        },
      },
      metadataRepository: {
        async listActive() {
          return [];
        },
        async upsert(input) {
          return { id: "db-empty", ...input };
        },
        async updateIndexState(id, state) {
          states.push({ id, isIndexed: state.isIndexed });
        },
      },
    });

    assert.equal(summary.skippedEmptyDocuments, 1);
    assert.equal(summary.failed, 0);
    assert.deepEqual(deleted, ["db-empty"]);
    assert.deepEqual(states, [{ id: "db-empty", isIndexed: false }]);
  });

  it("Geminiの日次quota枯渇時は後続文書をAPIへ送らず再実行へ繰り越す", async () => {
    const files = [
      sourceFile("first", "2026-01-02T00:00:00Z"),
      sourceFile("second", "2026-01-02T00:00:00Z"),
      sourceFile("third", "2026-01-02T00:00:00Z"),
    ];
    const downloaded: string[] = [];
    const summary = await syncDrive({
      source: {
        async listDocuments() {
          return files;
        },
        async getDocument(file) {
          downloaded.push(file.id);
          return { file, contentMimeType: MIME.pdf, data: new Uint8Array([1]) };
        },
      },
      extractorRegistry: new ExtractorRegistry([
        {
          supports() {
            return true;
          },
          async extract() {
            return { sections: [{ text: "検索可能な本文", page: 1 }] };
          },
        },
      ]),
      embeddingProvider: {
        id: "mock",
        dimensions: 2,
        async embed() {
          return [1, 0];
        },
        async embedQuery() {
          return [1, 0];
        },
        async embedDocument() {
          return [1, 0];
        },
        async embedDocuments() {
          throw new EmbeddingQuotaError("daily quota exhausted", {
            scope: "daily",
          });
        },
      },
      documentRepository: {
        indexId: "test:index",
        async ensureCollection() {},
        async getDocumentChunks() {
          return [];
        },
        async upsertDocumentChunks() {},
        async finalizeDocumentChunks() {},
        async deleteDocument() {},
      },
      metadataRepository: {
        async listActive() {
          return [];
        },
        async upsert(input) {
          return { id: `db-${input.driveFileId}`, ...input };
        },
        async updateIndexState() {},
      },
    });

    assert.equal(summary.embeddingQuotaExhausted, true);
    assert.equal(summary.deferred, 3);
    assert.equal(summary.failed, 1);
    assert.deepEqual(downloaded, ["first"]);
  });

  it("quota到達前のbatchをcheckpoint保存し、再実行時は未保存chunkだけEmbeddingする", async () => {
    const file = sourceFile("checkpoint", "2026-01-02T00:00:00Z");
    let metadata: DocumentRecord | undefined;
    const stored = new Map<string, IndexedChunk>();
    const embeddedBatchSizes: number[] = [];
    let firstRunCalls = 0;

    const base = {
      source: {
        async listDocuments() {
          return [file];
        },
        async getDocument() {
          return { file, contentMimeType: MIME.pdf, data: new Uint8Array([1]) };
        },
      },
      extractorRegistry: new ExtractorRegistry([
        {
          supports() {
            return true;
          },
          async extract() {
            return {
              sections: [
                { text: "最初の検索可能な本文", page: 1 },
                { text: "二番目の検索可能な本文", page: 2 },
                { text: "三番目の検索可能な本文", page: 3 },
              ],
            };
          },
        },
      ]),
      documentRepository: {
        indexId: "test:index",
        async ensureCollection() {},
        async getDocumentChunks() {
          return [...stored.values()];
        },
        async upsertDocumentChunks(chunks: IndexedChunk[]) {
          for (const chunk of chunks) stored.set(chunk.id, chunk);
        },
        async finalizeDocumentChunks() {},
        async deleteDocument() {},
      },
      metadataRepository: {
        async listActive() {
          return metadata ? [metadata] : [];
        },
        async upsert(input: Omit<DocumentRecord, "id">) {
          metadata = { id: "db-checkpoint", ...input };
          return metadata;
        },
        async updateIndexState(
          id: string,
          state: Pick<DocumentRecord, "isIndexed" | "duplicateOf" | "isActive">,
        ) {
          assert.equal(id, "db-checkpoint");
          assert.ok(metadata);
          metadata = { ...metadata, ...state };
        },
      },
      embeddingBatchSize: 2,
    };

    const first = await syncDrive({
      ...base,
      embeddingProvider: {
        id: "mock",
        dimensions: 2,
        async embed() {
          return [1, 0];
        },
        async embedQuery() {
          return [1, 0];
        },
        async embedDocument() {
          return [1, 0];
        },
        async embedDocuments(texts: string[]) {
          firstRunCalls += 1;
          embeddedBatchSizes.push(texts.length);
          if (firstRunCalls === 2) {
            throw new EmbeddingQuotaError("daily quota exhausted", {
              scope: "daily",
            });
          }
          return texts.map(() => [1, 0]);
        },
      },
    });

    assert.equal(first.embeddingQuotaExhausted, true);
    assert.equal(first.embeddedChunks, 2);
    assert.equal(first.embeddingBatchAttempts, 2);
    assert.equal(first.embeddingInputAttempts, 3);
    assert.equal(stored.size, 2);
    assert.equal(metadata?.isIndexed, false);

    const second = await syncDrive({
      ...base,
      embeddingProvider: {
        id: "mock",
        dimensions: 2,
        async embed() {
          return [1, 0];
        },
        async embedQuery() {
          return [1, 0];
        },
        async embedDocument() {
          return [1, 0];
        },
        async embedDocuments(texts: string[]) {
          embeddedBatchSizes.push(texts.length);
          return texts.map(() => [1, 0]);
        },
      },
    });

    assert.deepEqual(embeddedBatchSizes, [2, 1, 1]);
    assert.equal(second.reusedChunks, 2);
    assert.equal(second.embeddedChunks, 1);
    assert.equal(second.embeddingBatchAttempts, 1);
    assert.equal(second.embeddingInputAttempts, 1);
    assert.equal(stored.size, 3);
    assert.equal(metadata?.isIndexed, true);
  });
});
