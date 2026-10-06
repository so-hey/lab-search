import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EmptyDocumentError } from "./extractors/DocumentExtractor.js";
import { ExtractorRegistry } from "./extractors/ExtractorRegistry.js";
import { MIME } from "./mimeTypes.js";
import type { SourceFile } from "./source/types.js";
import { DriveAcquisitionError } from "./source/GoogleDriveDocumentSource.js";
import { deepAnalyzeDrive } from "./deepAnalyzeDrive.js";

function file(id: string, name: string, mimeType: string): SourceFile {
  return {
    id,
    name,
    mimeType,
    parentIds: ["folder"],
    modifiedTime: "2026-01-01T00:00:00Z",
    size: 1000,
  };
}

describe("deepAnalyzeDrive", () => {
  it("重複排除、retry、失敗継続、実chunk集計をdry-runで行う", async () => {
    const files = [
      file("duplicate-pdf", "seminar.pdf", MIME.pdf),
      file("preferred-pptx", "seminar.pptx", MIME.pptx),
      file("retry-pdf", "paper.pdf", MIME.pdf),
      file("empty-docx", "empty.docx", MIME.docx),
      file("failed-docx", "failed.docx", MIME.docx),
      file("other", "image.png", "image/png"),
    ];
    let retryDownloads = 0;
    const report = await deepAnalyzeDrive(
      {
        source: {
          async listDocuments() {
            return files;
          },
          async getDocument(sourceFile) {
            if (sourceFile.id === "retry-pdf" && retryDownloads++ === 0) {
              throw Object.assign(new Error("rate limited"), { status: 429 });
            }
            return {
              file: sourceFile,
              data: new Uint8Array([1]),
              contentMimeType: sourceFile.mimeType,
            };
          },
        },
        extractorRegistry: new ExtractorRegistry([
          {
            supports() {
              return true;
            },
            async extract(source) {
              if (source.file.id === "empty-docx")
                throw new EmptyDocumentError("empty");
              if (source.file.id === "failed-docx")
                throw new Error("broken document");
              if (source.file.id === "preferred-pptx") {
                return {
                  sections: [{ text: "スライド本文", slide: 1 }],
                  slideCount: 1,
                };
              }
              return { sections: [{ text: "PDF本文", page: 1 }], pageCount: 1 };
            },
          },
        ]),
        logger: { log() {}, error() {} },
      },
      { concurrency: 2, retryAttempts: 2, retryBaseDelayMs: 0 },
    );
    assert.equal(retryDownloads, 2);
    assert.equal(report.summary.totalFiles, 6);
    assert.equal(report.summary.duplicatePairs, 1);
    assert.equal(report.summary.skippedDuplicatePdfs, 1);
    assert.equal(report.summary.finalIndexTargetFiles, 4);
    assert.equal(report.summary.successfullyAnalyzed, 2);
    assert.equal(report.summary.emptyDocuments, 1);
    assert.equal(report.summary.extractionFailed, 1);
    assert.equal(report.summary.unsupportedFiles, 1);
    assert.equal(report.summary.measuredChunks, 2);
    assert.equal(report.byFileType.PDF.pages?.total, 1);
    assert.equal(report.byFileType.PPTX.slides?.total, 1);
    assert.ok(report.storageEstimate.chunkTextPayloadBytes > 0);
    assert.ok(report.storageEstimate.metadataPayloadBytes > 0);
  });

  it("abusive PDFをextraction failureではなく専用skipとして集計する", async () => {
    const abusive = file("abusive-pdf", "flagged.pdf", MIME.pdf);
    const report = await deepAnalyzeDrive(
      {
        source: {
          async listDocuments() {
            return [abusive];
          },
          async getDocument() {
            throw new DriveAcquisitionError(
              "Google flagged this file as abusive.",
              "cannotDownloadAbusiveFile",
              {
                status: 403,
                error: {
                  message: "Google flagged this file as abusive.",
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
        logger: { log() {}, error() {} },
      },
      { retryAttempts: 1 },
    );
    assert.equal(report.summary.skippedAbusiveFiles, 1);
    assert.equal(report.summary.extractionFailed, 0);
    assert.equal(report.files[0].status, "skipped_abusive_file");
    assert.equal(report.files[0].driveErrorReason, "cannotDownloadAbusiveFile");
  });
});
