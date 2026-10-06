import { requiredEnv } from "../src/config/env.js";
import { ZillizDocumentRepository } from "../src/repositories/ZillizDocumentRepository.js";
import { createSupabaseAdminClient } from "../src/repositories/supabase/client.js";
import { SupabaseDocumentMetadataRepository } from "../src/repositories/supabase/SupabaseRepositories.js";
import { createEmbeddingProvider } from "../src/services/embedding/createEmbeddingProvider.js";

async function main() {
  const endpoint = requiredEnv("ZILLIZ_ENDPOINT");
  const token = requiredEnv("ZILLIZ_TOKEN");
  const sourceCollection = requiredEnv("ZILLIZ_SOURCE_COLLECTION");
  const destinationCollection = requiredEnv("ZILLIZ_COLLECTION");
  if (sourceCollection === destinationCollection) {
    throw new Error(
      "ZILLIZ_SOURCE_COLLECTION and ZILLIZ_COLLECTION must be different. An existing collection schema cannot be changed in place.",
    );
  }

  const embeddingProvider = createEmbeddingProvider();
  const source = new ZillizDocumentRepository({
    endpoint,
    token,
    collectionName: sourceCollection,
    dimensions: embeddingProvider.dimensions,
    embeddingProviderId: embeddingProvider.id,
    hybridEnabled: false,
  });
  const destination = new ZillizDocumentRepository({
    endpoint,
    token,
    collectionName: destinationCollection,
    dimensions: embeddingProvider.dimensions,
    embeddingProviderId: embeddingProvider.id,
    hybridEnabled: true,
  });
  const metadata = new SupabaseDocumentMetadataRepository(createSupabaseAdminClient());

  await Promise.all([source.ensureCollection(), destination.ensureCollection()]);
  const activeDocuments = await metadata.listActive();
  const candidates = activeDocuments.filter(
    (document) => document.isIndexed && document.vectorStoreId === source.indexId,
  );
  const alreadyMigrated = activeDocuments.filter(
    (document) => document.isIndexed && document.vectorStoreId === destination.indexId,
  ).length;
  let migratedDocuments = 0;
  let migratedChunks = 0;
  let emptyDocuments = 0;
  let incompatibleDocuments = 0;
  let failed = 0;

  console.log("Zilliz Dense → Hybrid Migration\n");
  console.log(`Source:      ${source.indexId}`);
  console.log(`Destination: ${destination.indexId}`);
  console.log(`Embedding:   ${embeddingProvider.id} (${embeddingProvider.dimensions} dimensions)`);
  console.log(`Candidates:  ${candidates.length}`);
  console.log(`Completed:   ${alreadyMigrated}\n`);

  for (const [index, document] of candidates.entries()) {
    const progress = `[migrate ${index + 1}/${candidates.length}]`;
    if (document.embeddingProviderId !== embeddingProvider.id) {
      incompatibleDocuments += 1;
      console.error(
        `${progress} incompatible embedding: ${document.name} (${document.embeddingProviderId ?? "unknown"})`,
      );
      continue;
    }
    try {
      const chunks = await source.getDocumentChunks(document.id);
      if (chunks.length === 0) {
        emptyDocuments += 1;
        console.warn(`${progress} empty: ${document.name}`);
        continue;
      }
      await destination.upsertDocumentChunks(chunks);
      await destination.finalizeDocumentChunks(
        document.id,
        new Set(chunks.map((chunk) => chunk.id)),
      );
      await metadata.upsert({
        driveFileId: document.driveFileId,
        name: document.name,
        mimeType: document.mimeType,
        parentFolderId: document.parentFolderId,
        webViewLink: document.webViewLink,
        modifiedTime: document.modifiedTime,
        isIndexed: true,
        embeddingProviderId: embeddingProvider.id,
        vectorStoreId: destination.indexId,
        duplicateOf: document.duplicateOf,
        isActive: document.isActive,
      });
      migratedDocuments += 1;
      migratedChunks += chunks.length;
      console.log(`${progress} ${document.name}: ${chunks.length} chunks`);
    } catch (error) {
      failed += 1;
      console.error(`${progress} failed: ${document.name}`, error);
    }
  }

  console.log("\nZilliz Dense → Hybrid Migration Summary\n");
  console.log(`Documents:    ${migratedDocuments}`);
  console.log(`Chunks:       ${migratedChunks}`);
  console.log(`Already done: ${alreadyMigrated}`);
  console.log(`Empty:        ${emptyDocuments}`);
  console.log(`Incompatible: ${incompatibleDocuments}`);
  console.log(`Failed:       ${failed}`);
  if (failed > 0 || incompatibleDocuments > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error("[migrate:zilliz-to-hybrid] failed", error);
  process.exitCode = 1;
});
