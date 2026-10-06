import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { HybridSearchDocumentRepository } from "../../repositories/DocumentRepository.js";
import { searchDocuments } from "./searchDocuments.js";

describe("searchDocuments", () => {
  it("query embedding、候補検索、文書集約、検索ログを順に行う", async () => {
    let requestedCandidates = 0;
    let loggedCount = -1;
    const response = await searchDocuments(
      { query: " 日本語検索 ", limit: 2, source: "web" },
      {
        embeddingProvider: {
          id: "mock",
          dimensions: 2,
          async embed() {
            return [1, 0];
          },
          async embedDocument() {
            return [1, 0];
          },
          async embedDocuments(texts) {
            return texts.map(() => [1, 0]);
          },
          async embedQuery(text) {
            assert.equal(text, "日本語検索");
            return [1, 0];
          },
        },
        documentRepository: {
          async searchSimilar(_vector, limit) {
            requestedCandidates = limit;
            return [
              {
                score: 0.9,
                chunk: {
                  id: "a:0",
                  documentId: "a",
                  documentName: "a.pdf",
                  chunkIndex: 0,
                  content: "a",
                  embedding: [],
                },
              },
              {
                score: 0.8,
                chunk: {
                  id: "a:1",
                  documentId: "a",
                  documentName: "a.pdf",
                  chunkIndex: 1,
                  content: "a2",
                  embedding: [],
                },
              },
              {
                score: 0.7,
                chunk: {
                  id: "b:0",
                  documentId: "b",
                  documentName: "b.pdf",
                  chunkIndex: 0,
                  content: "b",
                  embedding: [],
                },
              },
            ];
          },
        },
        searchLogRepository: {
          async create(input) {
            loggedCount = input.resultCount;
            return "log-id";
          },
          async isOwnedBy() {
            return true;
          },
        },
      },
      "user-id",
    );
    assert.equal(requestedCandidates, 100);
    assert.equal(loggedCount, 2);
    assert.equal(response.searchLogId, "log-id");
    assert.deepEqual(
      response.results.map((item) => item.documentId),
      ["a", "b"],
    );
  });

  it("元ファイルのリンクを残して保存先Google Driveフォルダのリンクを加える", async () => {
    let requestedDocumentIds: readonly string[] = [];
    const response = await searchDocuments(
      { query: "研究資料", limit: 1, source: "web" },
      {
        embeddingProvider: {
          id: "mock",
          dimensions: 2,
          async embed() {
            return [1, 0];
          },
          async embedDocument() {
            return [1, 0];
          },
          async embedDocuments(texts) {
            return texts.map(() => [1, 0]);
          },
          async embedQuery() {
            return [1, 0];
          },
        },
        documentRepository: {
          async searchSimilar() {
            return [
              {
                score: 0.9,
                chunk: {
                  id: "document-a:0",
                  documentId: "document-a",
                  documentName: "資料.pdf",
                  chunkIndex: 0,
                  content: "研究資料の本文",
                  url: "https://drive.google.com/file/d/file-a/view",
                  embedding: [],
                },
              },
            ];
          },
        },
        documentLocationRepository: {
          async getParentFolderIds(documentIds) {
            requestedDocumentIds = documentIds;
            return new Map([["document-a", "folder-a"]]);
          },
        },
      },
    );

    assert.deepEqual(requestedDocumentIds, ["document-a"]);
    assert.equal(
      response.results[0].folderUrl,
      "https://drive.google.com/drive/folders/folder-a",
    );
    assert.equal(
      response.results[0].url,
      "https://drive.google.com/file/d/file-a/view",
    );
  });

  it("同一文書のchunkで候補が埋まる場合は候補数を段階的に増やす", async () => {
    const requestedCandidates: number[] = [];
    const response = await searchDocuments(
      { query: "モデルマージ", limit: 3, source: "web" },
      {
        embeddingProvider: {
          id: "mock",
          dimensions: 2,
          async embed() {
            return [1, 0];
          },
          async embedDocument() {
            return [1, 0];
          },
          async embedDocuments(texts) {
            return texts.map(() => [1, 0]);
          },
          async embedQuery() {
            return [1, 0];
          },
        },
        documentRepository: {
          async searchSimilar(_vector, limit) {
            requestedCandidates.push(limit);
            const matches = Array.from({ length: limit }, (_, index) => {
              const documentId = index % 2 === 0 ? "a" : "b";
              return {
                score: 1 - index / 10_000,
                chunk: {
                  id: `${documentId}:${index}`,
                  documentId,
                  documentName: `${documentId}.pdf`,
                  chunkIndex: index,
                  content: "text",
                  embedding: [],
                },
              };
            });
            if (limit >= 200) {
              matches[matches.length - 1] = {
                score: 0.5,
                chunk: {
                  id: "c:0",
                  documentId: "c",
                  documentName: "c.pdf",
                  chunkIndex: 0,
                  content: "text",
                  embedding: [],
                },
              };
            }
            return matches;
          },
        },
      },
    );

    assert.deepEqual(requestedCandidates, [100, 200]);
    assert.deepEqual(
      response.results.map((result) => result.documentId),
      ["a", "b", "c"],
    );
  });

  it("hybrid modeではquery本文とembeddingをrepositoryへ渡す", async () => {
    let denseCalled = false;
    let hybridInput: { vector: number[]; query: string; limit: number } | undefined;
    const documentRepository: HybridSearchDocumentRepository = {
      async searchSimilar() {
        denseCalled = true;
        return [];
      },
      async searchHybrid(vector, query, limit) {
        hybridInput = { vector, query, limit };
        return [
          {
            score: 0.031,
            chunk: {
              id: "quantum:0",
              documentId: "quantum",
              documentName: "量子誤り訂正.pdf",
              chunkIndex: 0,
              content: "量子誤り訂正符号について",
              embedding: [],
            },
          },
        ];
      },
    };
    const response = await searchDocuments(
      { query: "量子コンピュータの誤り訂正", limit: 1, source: "web" },
      {
        retrievalMode: "hybrid",
        embeddingProvider: {
          id: "mock",
          dimensions: 2,
          async embed() { return [1, 0]; },
          async embedDocument() { return [1, 0]; },
          async embedDocuments(texts) { return texts.map(() => [1, 0]); },
          async embedQuery() { return [1, 0]; },
        },
        documentRepository,
      },
    );

    assert.equal(denseCalled, false);
    assert.deepEqual(hybridInput, {
      vector: [1, 0],
      query: "量子コンピュータの誤り訂正",
      limit: 100,
    });
    assert.equal(response.results[0].scoreType, "rrf");
  });

  it("Voyage rerankerのscoreと順位を最終結果へ反映する", async () => {
    let requestedCandidates = 0;
    let rerankerDocuments: readonly string[] = [];
    const documentRepository: HybridSearchDocumentRepository = {
      async searchSimilar() { return []; },
      async searchHybrid(_vector, _query, limit) {
        requestedCandidates = limit;
        const matches = ["a", "b", "c"].map((documentId, index) => ({
          score: 0.03 - index * 0.001,
          chunk: {
            id: `${documentId}:0`,
            documentId,
            documentName: `${documentId}.pdf`,
            chunkIndex: 0,
            content: `本文${documentId}`,
            embedding: [],
          },
        }));
        matches.push({
          score: 0.02,
          chunk: {
            id: "a:1",
            documentId: "a",
            documentName: "a.pdf",
            chunkIndex: 1,
            content: "関連本文a",
            embedding: [],
          },
        });
        return matches;
      },
    };
    const response = await searchDocuments(
      { query: "検索行動", limit: 2, source: "web" },
      {
        retrievalMode: "hybrid",
        rerankCandidateDocuments: 3,
        embeddingProvider: {
          id: "mock",
          dimensions: 2,
          async embed() { return [1, 0]; },
          async embedDocument() { return [1, 0]; },
          async embedDocuments(texts) { return texts.map(() => [1, 0]); },
          async embedQuery() { return [1, 0]; },
        },
        documentRepository,
        reranker: {
          id: "mock-reranker",
          async rerank(_query, documents, limit) {
            assert.equal(limit, 2);
            rerankerDocuments = documents;
            return [
              { index: 1, score: 0.91 },
              { index: 0, score: 0.82 },
            ];
          },
        },
      },
    );

    assert.equal(requestedCandidates, 100);
    assert.equal(rerankerDocuments.length, 3);
    assert.match(rerankerDocuments[0], /文書名: a\.pdf/);
    assert.match(rerankerDocuments[0], /関連箇所1:\n関連本文a/);
    assert.deepEqual(
      response.results.map((result) => result.documentId),
      ["b", "a"],
    );
    assert.equal(response.results[0].score, 0.91);
    assert.ok(Math.abs((response.results[0].retrievalScore ?? 0) - 0.029) < 1e-12);
    assert.equal(response.results[0].scoreType, "reranker");
    assert.deepEqual(
      {
        score: response.results[1].score,
        retrievalScore: response.results[1].retrievalScore,
        scoreType: response.results[1].scoreType,
      },
      { score: 0.82, retrievalScore: 0.03, scoreType: "reranker" },
    );
  });
});
