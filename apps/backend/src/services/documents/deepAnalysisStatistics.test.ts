import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MIME } from "./mimeTypes.js";
import type { SourceFile } from "./source/types.js";
import {
  calculateChunkHistogram,
  calculateDistribution,
  calculateStorageEstimate,
  selectStratifiedSample,
} from "./deepAnalysisStatistics.js";

function file(id: string, mimeType: string): SourceFile {
  return {
    id,
    name: id,
    mimeType,
    parentIds: ["folder"],
    modifiedTime: "2026-01-01T00:00:00Z",
  };
}

describe("deep analysis statistics", () => {
  it("percentileとchunk histogramを計算する", () => {
    assert.deepEqual(calculateDistribution([100, 1, 4, 3, 2]), {
      min: 1,
      p25: 2,
      median: 3,
      p75: 4,
      p90: 100,
      p95: 100,
      p99: 100,
      max: 100,
    });
    assert.deepEqual(
      calculateChunkHistogram([
        0, 10, 11, 25, 26, 50, 51, 100, 101, 250, 251, 500, 501,
      ]),
      {
        "0-10": 2,
        "11-25": 2,
        "26-50": 2,
        "51-100": 2,
        "101-250": 2,
        "251-500": 2,
        "501+": 1,
      },
    );
  });

  it("形式比率を維持した決定的sampleを選ぶ", () => {
    const files = [
      ...Array.from({ length: 30 }, (_, index) =>
        file(`pdf-${index}`, MIME.pdf),
      ),
      ...Array.from({ length: 70 }, (_, index) =>
        file(`pptx-${index}`, MIME.pptx),
      ),
    ];
    const first = selectStratifiedSample(files, 10);
    const second = selectStratifiedSample(files, 10);
    assert.equal(first.filter((item) => item.mimeType === MIME.pdf).length, 3);
    assert.equal(first.filter((item) => item.mimeType === MIME.pptx).length, 7);
    assert.deepEqual(
      first.map((item) => item.id),
      second.map((item) => item.id),
    );
  });

  it("sample数が形式数以上なら希少形式も最低1件含める", () => {
    const files = [
      ...Array.from({ length: 30 }, (_, index) =>
        file(`pdf-${index}`, MIME.pdf),
      ),
      ...Array.from({ length: 69 }, (_, index) =>
        file(`pptx-${index}`, MIME.pptx),
      ),
      file("google-doc", MIME.googleDocs),
    ];
    const sample = selectStratifiedSample(files, 10);
    assert.equal(sample.length, 10);
    assert.equal(
      sample.filter((item) => item.mimeType === MIME.googleDocs).length,
      1,
    );
  });

  it("float32 vector、payload、overhead、4GiB使用率を計算する", () => {
    const capacityBytes = 4 * 1024 ** 3;
    const result = calculateStorageEstimate({
      basis: "actual",
      dimensions: 768,
      totalVectors: 10,
      chunkTextPayloadBytes: 100,
      metadataPayloadBytes: 50,
      capacityBytes,
    });
    assert.equal(result.bytesPerVector, 3072);
    assert.equal(result.rawVectorBytes, 30_720);
    assert.equal(result.baseDataBytes, 30_870);
    assert.equal(
      result.scenarios.find((item) => item.factor === 2)?.estimatedBytes,
      61_740,
    );
    assert.equal(result.assessment, "LOW RISK");
  });
});
