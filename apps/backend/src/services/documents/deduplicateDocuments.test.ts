import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MIME } from "./mimeTypes.js";
import type { SourceFile } from "./source/types.js";
import { deduplicateDocuments, normalizeBasename } from "./deduplicateDocuments.js";

function file(id: string, name: string, mimeType: string, parent = "folder-a"): SourceFile {
  return { id, name, mimeType, parentIds: [parent], modifiedTime: "2026-01-01T00:00:00Z" };
}

describe("normalizeBasename", () => {
  it("拡張子だけを除きUnicodeを正規化する", () => {
    assert.equal(normalizeBasename("ｓｅｍｉｎａｒ.PDF"), "seminar");
    assert.equal(normalizeBasename("seminar_final.pptx"), "seminar_final");
  });
});

describe("deduplicateDocuments", () => {
  it("同一folder・同一basenameのPDF/PPTXではPPTXを優先する", () => {
    const result = deduplicateDocuments([
      file("pdf", "seminar.pdf", MIME.pdf),
      file("pptx", "seminar.pptx", MIME.pptx),
    ]);
    assert.deepEqual(result.filesToIndex.map((item) => item.id), ["pptx"]);
    assert.equal(result.duplicates[0].preferred.id, "pptx");
  });

  it("folderまたはbasenameが異なる資料はまとめない", () => {
    const files = [
      file("pdf", "seminar.pdf", MIME.pdf, "folder-a"),
      file("pptx", "seminar.pptx", MIME.pptx, "folder-b"),
      file("final", "seminar_final.pptx", MIME.pptx, "folder-a"),
    ];
    assert.equal(deduplicateDocuments(files).duplicates.length, 0);
  });
});
