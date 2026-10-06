import { optionalEnv, requiredEnv } from "../src/config/env.js";
import { QdrantDocumentRepository } from "../src/repositories/QdrantDocumentRepository.js";
import { ZillizDocumentRepository } from "../src/repositories/ZillizDocumentRepository.js";
import { createSupabaseAdminClient } from "../src/repositories/supabase/client.js";
import { SupabaseDocumentMetadataRepository } from "../src/repositories/supabase/SupabaseRepositories.js";
import { createEmbeddingProvider } from "../src/services/embedding/createEmbeddingProvider.js";

async function main() {
  const embeddingProvider = createEmbeddingProvider();
  const source = new QdrantDocumentRepository({
    url: requiredEnv("QDRANT_URL"),
    apiKey: optionalEnv("QDRANT_API_KEY"),
    collectionName: optionalEnv("QDRANT_COLLECTION"),
    dimensions: embeddingProvider.dimensions,
    embeddingProviderId: embeddingProvider.id,
  });
  const destination = new ZillizDocumentRepository({
    endpoint: requiredEnv("ZILLIZ_ENDPOINT"),
    token: requiredEnv("ZILLIZ_TOKEN"),
    collectionName: optionalEnv("ZILLIZ_COLLECTION"),
    dimensions: embeddingProvider.dimensions,
    embeddingProviderId: embeddingProvider.id,
  });
  const metadata = new SupabaseDocumentMetadataRepository(createSupabaseAdminClient());

  await Promise.all([source.ensureCollection(), destination.ensureCollection()]);
  const documents = await metadata.listActive();
  let migratedDocuments = 0;
  let migratedChunks = 0;
  let emptyDocuments = 0;
  let failed = 0;

  for (const [index, document] of documents.entries()) {
    try {
      const chunks = await source.getDocumentChunks(document.id);
      if (chunks.length === 0) {
        emptyDocuments += 1;
        console.log(`[migrate ${index + 1}/${documents.length}] empty: ${document.name}`);
        continue;
      }
      await destination.upsertDocumentChunks(chunks);
      migratedDocuments += 1;
      migratedChunks += chunks.length;
      console.log(
        `[migrate ${index + 1}/${documents.length}] ${document.name}: ${chunks.length} chunks`,
      );
    } catch (error) {
      failed += 1;
      console.error(`[migrate] failed: ${document.name}`, error);
    }
  }

  console.log("\nQdrant → Zilliz Migration Summary\n");
  console.log(`Documents: ${migratedDocuments}`);
  console.log(`Chunks:    ${migratedChunks}`);
  console.log(`Empty:     ${emptyDocuments}`);
  console.log(`Failed:    ${failed}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error("[migrate:qdrant-to-zilliz] failed", error);
  process.exitCode = 1;
});
