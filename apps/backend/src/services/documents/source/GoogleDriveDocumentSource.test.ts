import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuthClient } from "google-auth-library";
import { MIME } from "../mimeTypes.js";
import {
  buildDriveContentRequest,
  buildDriveRetrievalErrorLog,
  classifyDriveAcquisitionError,
  DriveAcquisitionError,
  formatDriveRetrievalErrorLog,
  GoogleDriveDocumentSource,
} from "./GoogleDriveDocumentSource.js";
import type { SourceFile } from "./types.js";

function sourceFile(mimeType: string): SourceFile {
  return {
    id: "file/id",
    name: "研究資料",
    mimeType,
    parentIds: ["parent-1"],
    modifiedTime: "2026-08-18T00:00:00Z",
    capabilities: { canDownload: false },
    driveId: "shared-drive-1",
  };
}

function abusiveError() {
  const body = {
    error: {
      code: 403,
      message: "This file has been identified as malware or spam and cannot be downloaded.",
      errors: [{ reason: "cannotDownloadAbusiveFile" }],
    },
  };
  return Object.assign(new Error("Request failed with status code 403"), {
    response: { status: 403, data: body },
  });
}

function logger() {
  const messages: string[] = [];
  return {
    messages,
    logger: {
      error(message: string) { messages.push(message); },
      warn(message: string) { messages.push(message); },
    },
  };
}

describe("GoogleDriveDocumentSource", () => {
  it("Google SlidesはDrive exportではなくSlides APIを使う", () => {
    const request = buildDriveContentRequest(sourceFile(MIME.googleSlides));
    assert.equal(request.strategy, "google_slides_api");
    assert.match(request.url, /^https:\/\/slides\.googleapis\.com\/v1\/presentations\/file%2Fid$/);
    assert.doesNotMatch(request.url, /\/export$/);
    assert.match(request.params.fields, /slides/);
    assert.equal(request.contentMimeType, MIME.googleSlides);
  });

  it("Google DocsはDOCXとしてexportする", () => {
    const request = buildDriveContentRequest(sourceFile(MIME.googleDocs));
    assert.equal(request.strategy, "export");
    assert.match(request.url, /\/files\/file%2Fid\/export$/);
    assert.deepEqual(request.params, { mimeType: MIME.docx });
    assert.equal(request.contentMimeType, MIME.docx);
  });

  it("PDFやOfficeファイルはalt=mediaでdownloadする", () => {
    const request = buildDriveContentRequest(sourceFile(MIME.pdf));
    assert.equal(request.strategy, "download");
    assert.doesNotMatch(request.url, /\/export$/);
    assert.deepEqual(request.params, { alt: "media" });
    assert.equal(request.contentMimeType, MIME.pdf);
  });

  it("Google APIのbinary error bodyとDrive metadataを構造化する", () => {
    const body = {
      error: {
        code: 403,
        message: "This file cannot be downloaded by the user.",
        errors: [{ reason: "cannotDownloadFile" }],
      },
    };
    const encoded = new TextEncoder().encode(JSON.stringify(body));
    const cause = Object.assign(new Error("Request failed with status code 403"), {
      response: { status: 403, data: encoded },
    });
    const file = sourceFile(MIME.googleSlides);
    const request = buildDriveContentRequest(file);
    const details = buildDriveRetrievalErrorLog(cause, file, request);

    assert.equal(details.status, 403);
    assert.equal(details.error.message, body.error.message);
    assert.deepEqual(details.error.errors, [{ reason: "cannotDownloadFile" }]);
    assert.equal(details.fileId, "file/id");
    assert.equal(details.fileName, "研究資料");
    assert.equal(details.mimeType, MIME.googleSlides);
    assert.equal(details.capabilities.canDownload, false);
    assert.equal(details.driveId, "shared-drive-1");
    assert.deepEqual(details.parents, ["parent-1"]);
    assert.equal(details.retrievalStrategy, "google_slides_api");
    assert.deepEqual(details.googleApiResponseBody, body);
    const log = formatDriveRetrievalErrorLog(details);
    assert.match(log, /"status": 403/);
    assert.match(log, /"reason": "cannotDownloadFile"/);
    assert.match(log, /"googleApiResponseBody"/);
  });

  it("403 reasonを正式なDrive acquisition reasonへ分類する", () => {
    const file = sourceFile(MIME.pdf);
    const request = buildDriveContentRequest(file);
    const details = buildDriveRetrievalErrorLog(abusiveError(), file, request);
    assert.equal(classifyDriveAcquisitionError(details), "cannotDownloadAbusiveFile");
  });

  it("既知のGoogle API reasonとその他を分類する", () => {
    const file = sourceFile(MIME.pdf);
    const request = buildDriveContentRequest(file);
    for (const reason of [
      "exportSizeLimitExceeded",
      "insufficientFilePermissions",
      "fileNotDownloadable",
    ] as const) {
      const cause = {
        response: {
          status: 403,
          data: { error: { code: 403, message: reason, errors: [{ reason }] } },
        },
      };
      assert.equal(
        classifyDriveAcquisitionError(buildDriveRetrievalErrorLog(cause, file, request)),
        reason,
      );
    }
    const unknown = {
      response: {
        status: 403,
        data: { error: { code: 403, message: "disabled", errors: [{ reason: "accessNotConfigured" }] } },
      },
    };
    assert.equal(
      classifyDriveAcquisitionError(buildDriveRetrievalErrorLog(unknown, file, request)),
      "unknown",
    );
  });

  it("acknowledgeAbuse=falseではabusive PDFを再試行せずskipする", async () => {
    let requestCount = 0;
    const auth = {
      async request() {
        requestCount += 1;
        throw abusiveError();
      },
    } as unknown as AuthClient;
    const output = logger();
    const source = new GoogleDriveDocumentSource("folder", auth, {
      acknowledgeAbuse: false,
      logger: output.logger,
    });
    await assert.rejects(
      source.getDocument(sourceFile(MIME.pdf)),
      (error: unknown) => {
        assert.ok(error instanceof DriveAcquisitionError);
        assert.equal(error.reason, "cannotDownloadAbusiveFile");
        assert.equal(error.action, "skipped");
        return true;
      },
    );
    assert.equal(requestCount, 1);
    assert.match(output.messages.join("\n"), /"action": "skipped"/);
  });

  it("acknowledgeAbuse=trueではabusive PDFだけを指定付きで1回再試行する", async () => {
    const requests: Array<{ params?: Record<string, unknown> }> = [];
    const auth = {
      async request(options: { params?: Record<string, unknown> }) {
        requests.push(options);
        if (requests.length === 1) throw abusiveError();
        return { data: new Uint8Array([1, 2, 3]).buffer };
      },
    } as unknown as AuthClient;
    const output = logger();
    const source = new GoogleDriveDocumentSource("folder", auth, {
      acknowledgeAbuse: true,
      logger: output.logger,
    });
    const result = await source.getDocument(sourceFile(MIME.pdf));
    assert.equal(result.data.byteLength, 3);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].params?.acknowledgeAbuse, undefined);
    assert.equal(requests[1].params?.acknowledgeAbuse, "true");
    assert.match(output.messages.join("\n"), /"action": "downloaded"/);
  });

  it("Google Slides取得時はpresentations.getだけを呼ぶ", async () => {
    const requests: Array<{ url?: string }> = [];
    const presentation = { presentationId: "file/id", slides: [] };
    const auth = {
      async request(options: { url?: string }) {
        requests.push(options);
        return { data: presentation };
      },
    } as unknown as AuthClient;
    const source = new GoogleDriveDocumentSource("folder", auth);
    const result = await source.getDocument(sourceFile(MIME.googleSlides));
    assert.equal(requests.length, 1);
    assert.match(requests[0].url ?? "", /slides\.googleapis\.com\/v1\/presentations/);
    assert.doesNotMatch(requests[0].url ?? "", /\/export/);
    assert.deepEqual(JSON.parse(new TextDecoder().decode(result.data)), presentation);
    assert.equal(result.contentMimeType, MIME.googleSlides);
  });
});
