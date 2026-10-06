import { integerEnv } from "../src/config/env.js";
import { createWritableDocumentRepository } from "../src/repositories/createDocumentRepository.js";
import { createSupabaseAdminClient } from "../src/repositories/supabase/client.js";
import { SupabaseDocumentMetadataRepository } from "../src/repositories/supabase/SupabaseRepositories.js";
import { ExtractorRegistry } from "../src/services/documents/extractors/ExtractorRegistry.js";
import { createGoogleDriveSource } from "../src/services/documents/source/createGoogleDriveSource.js";
import { syncDrive } from "../src/services/documents/syncDrive.js";
import { createEmbeddingProvider } from "../src/services/embedding/createEmbeddingProvider.js";

async function main() {
  const embeddingProvider = createEmbeddingProvider();
  if (process.env.EMBEDDING_PROVIDER === "local") {
    console.warn("[sync:drive] local embeddings are intended only for development.");
  }
  const documentRepository = createWritableDocumentRepository(embeddingProvider);
  const summary = await syncDrive({
    source: await createGoogleDriveSource(),
    extractorRegistry: new ExtractorRegistry(),
    embeddingProvider,
    embeddingBatchSize: integerEnv("EMBEDDING_SYNC_BATCH_SIZE", 20),
    documentRepository,
    metadataRepository: new SupabaseDocumentMetadataRepository(createSupabaseAdminClient()),
  });
  console.log("\nDrive Sync Summary\n");
  console.log(`New:         ${summary.new}`);
  console.log(`Updated:     ${summary.updated}`);
  console.log(`Skipped:     ${summary.skipped}`);
  console.log(`Abusive skipped: ${summary.skippedAbusiveFiles}`);
  console.log(`Empty skipped:    ${summary.skippedEmptyDocuments}`);
  console.log(`Duplicates:  ${summary.duplicates}`);
  console.log(`Unsupported: ${summary.unsupported}`);
  console.log(`Permission errors: ${summary.permissionErrors}`);
  console.log(`Export-size errors: ${summary.exportSizeErrors}`);
  console.log(`Not-downloadable:   ${summary.fileNotDownloadableErrors}`);
  console.log(`Embedding quota exhausted: ${summary.embeddingQuotaExhausted ? "yes" : "no"}`);
  console.log(`Embedded chunks: ${summary.embeddedChunks}`);
  console.log(`Reused checkpoint chunks: ${summary.reusedChunks}`);
  console.log(`Embedding batch attempts: ${summary.embeddingBatchAttempts}`);
  console.log(`Embedding input chunks submitted: ${summary.embeddingInputAttempts}`);
  console.log(`Deferred:     ${summary.deferred}`);
  console.log(`Removed:     ${summary.removed}`);
  console.log(`Failed:      ${summary.failed}`);
  if (summary.failed > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error("[sync:drive] failed", error);
  process.exitCode = 1;
});
