import { booleanEnv } from "../src/config/env.js";
import { chunkExtractedDocument } from "../src/services/documents/chunkExtractedDocument.js";
import { ExtractorRegistry } from "../src/services/documents/extractors/ExtractorRegistry.js";
import {
  buildDriveContentRequest,
  DriveAcquisitionError,
} from "../src/services/documents/source/GoogleDriveDocumentSource.js";
import { createGoogleDriveSource } from "../src/services/documents/source/createGoogleDriveSource.js";

function fileIdArgument(args: string[]): string {
  const index = args.findIndex((argument) => argument === "--file-id");
  const value = index < 0 ? undefined : args[index + 1];
  if (!value) {
    throw new Error("Usage: pnpm --filter backend debug:drive-file --file-id <FILE_ID>");
  }
  return value;
}

function strategyLabel(strategy: ReturnType<typeof buildDriveContentRequest>["strategy"]): string {
  switch (strategy) {
    case "google_slides_api": return "Google Slides API (presentations.get)";
    case "export": return "Drive Workspace export";
    case "download": return "Drive binary download";
  }
}

async function main() {
  const fileId = fileIdArgument(process.argv.slice(2));
  const acknowledgeAbuse = booleanEnv("GOOGLE_DRIVE_ACKNOWLEDGE_ABUSE", false);
  const source = await createGoogleDriveSource();
  const file = (await source.listDocuments()).find((item) => item.id === fileId);
  if (!file) throw new Error(`Drive file is outside the configured folder or not found: ${fileId}`);
  const request = buildDriveContentRequest(file);
  console.log("Drive File Debug\n================");
  console.log("\nMetadata");
  console.log(JSON.stringify({
    fileId: file.id,
    fileName: file.name,
    mimeType: file.mimeType,
    capabilities: { canDownload: file.capabilities?.canDownload ?? null },
    driveId: file.driveId ?? null,
    parents: file.parentIds,
  }, null, 2));
  console.log(`\nAcquisition strategy:\n${strategyLabel(request.strategy)}`);
  console.log(`\nacknowledgeAbuse enabled:\n${acknowledgeAbuse}`);

  try {
    const content = await source.getDocument(file);
    const extracted = await new ExtractorRegistry().extract(content);
    const chunks = chunkExtractedDocument({ documentId: file.id, file, extracted });
    console.log("\nResult:\nsuccess");
    console.log(`Sections: ${extracted.sections.length}`);
    if (extracted.pageCount !== undefined) console.log(`Pages: ${extracted.pageCount}`);
    if (extracted.slideCount !== undefined) console.log(`Slides: ${extracted.slideCount}`);
    console.log(`Chunks: ${chunks.length}`);
  } catch (error) {
    console.log("\nResult:\nskipped/failed");
    if (error instanceof DriveAcquisitionError) {
      console.log(`Google API reason: ${error.reason}`);
      console.log(`Action: ${error.action}`);
      console.log(`Status: ${error.status ?? "unknown"}`);
    } else {
      console.log(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error("[debug:drive-file] failed", error);
  process.exitCode = 1;
});
