import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SearchResponse } from "@lab-search/shared";
import {
  buildSearchResultBlocks,
  decodeFeedbackAction,
  encodeFeedbackAction,
  markFeedbackSubmitted,
} from "./searchResults.js";

const response: SearchResponse = {
  searchLogId: "log-1",
  results: [
    {
      chunkId: "document-1:0",
      documentId: "document-1",
      documentName: "モデルマージ.pdf",
      content: "モデルマージと破滅的忘却について説明する。",
      score: 0.86,
      scoreType: "reranker",
      page: 12,
      folderUrl: "https://drive.google.com/drive/folders/folder-1",
      url: "https://drive.google.com/file/d/file-1/view",
    },
  ],
};

describe("Slack search result blocks", () => {
  it("文書情報、Driveリンク、score方式、feedback buttonを生成する", () => {
    const blocks = buildSearchResultBlocks("モデルマージ", response);
    const json = JSON.stringify(blocks);

    assert.match(json, /モデルマージ\.pdf/u);
    assert.match(json, /Reranker関連度 0\.860/u);
    assert.match(json, /保存先フォルダ/u);
    assert.match(json, /このファイル/u);
    assert.match(json, /lab_search_feedback_positive/u);
    assert.match(json, /lab_search_feedback_negative/u);
  });

  it("feedback actionを復元し、送信後は同じ結果のfeedback buttonを除く", () => {
    const value = {
      searchLogId: "log-1",
      documentId: "document-1",
      chunkId: "document-1:0",
      rank: 1,
      score: 0.86,
      feedback: "positive" as const,
    };
    assert.deepEqual(decodeFeedbackAction(encodeFeedbackAction(value)), value);

    const blocks = buildSearchResultBlocks("モデルマージ", response);
    const updated = markFeedbackSubmitted(
      blocks,
      "lab_search_result_1",
      "positive",
    );
    const json = JSON.stringify(updated);
    assert.doesNotMatch(json, /lab_search_feedback_positive/u);
    assert.doesNotMatch(json, /lab_search_feedback_negative/u);
    assert.match(json, /評価を送信しました/u);
    assert.match(json, /lab_search_open_file_1/u);
  });
});
