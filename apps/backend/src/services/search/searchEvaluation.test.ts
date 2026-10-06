import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateSearchCase,
  parseSearchEvaluationDataset,
  summarizeSearchEvaluation,
  type SearchEvaluationCase,
} from "./searchEvaluation.js";

const testCase: SearchEvaluationCase = {
  id: "example",
  query: "検索モデル",
  category: "semantic",
  judgments: [
    { documentName: "direct.pdf", relevance: 3 },
    { documentName: "related.pdf", relevance: 2 },
    { documentName: "peripheral.pdf", relevance: 1 },
  ],
};

describe("search evaluation", () => {
  it("人手関連度からHit、MRR、nDCGを計算する", () => {
    const metrics = evaluateSearchCase(
      testCase,
      [
        { documentName: "direct.pdf", score: 0.91 },
        { documentName: "unknown.pdf", score: 0.88 },
        { documentName: "related.pdf", score: 0.83 },
      ],
      { limit: 3, relevantThreshold: 2 },
    );

    assert.equal(metrics.hitAtK, 1);
    assert.equal(metrics.reciprocalRankAtK, 1);
    assert.ok(
      metrics.ndcgAtK !== null &&
        metrics.ndcgAtK > 0.9 &&
        metrics.ndcgAtK < 0.91,
    );
    assert.equal(metrics.unjudgedResultCount, 1);
    assert.deepEqual(
      metrics.rankedResults.map((result) => result.relevance),
      [3, 0, 2],
    );
  });

  it("圏外の正解は0として評価する", () => {
    const metrics = evaluateSearchCase(
      testCase,
      [{ documentName: "unknown.pdf", score: 0.75 }],
      { limit: 5, relevantThreshold: 2 },
    );
    assert.equal(metrics.hitAtK, 0);
    assert.equal(metrics.reciprocalRankAtK, 0);
    assert.equal(metrics.ndcgAtK, 0);
  });

  it("該当資料なしqueryはranking指標から除外しtop scoreを保持する", () => {
    const metrics = evaluateSearchCase(
      {
        id: "no-answer",
        query: "トマトの有機栽培",
        category: "no-answer",
        noAnswer: true,
        judgments: [],
      },
      [{ documentName: "誤検索.pdf", score: 0.62 }],
      { limit: 5, relevantThreshold: 2 },
    );
    const summary = summarizeSearchEvaluation([metrics]);

    assert.equal(metrics.hitAtK, null);
    assert.equal(metrics.topScore, 0.62);
    assert.equal(summary.answerCases, 0);
    assert.equal(summary.meanNoAnswerTopScore, 0.62);
  });

  it("不正なdatasetとno-answer内の正解labelを拒否する", () => {
    assert.throws(
      () =>
        parseSearchEvaluationDataset({
          version: 1,
          description: "test",
          relevantThreshold: 2,
          relevanceScale: { "0": "不適合" },
          cases: [
            {
              id: "bad",
              query: "test",
              category: "no-answer",
              noAnswer: true,
              judgments: [{ documentName: "answer.pdf", relevance: 3 }],
            },
          ],
        }),
      /No-answer case/,
    );
  });
});
