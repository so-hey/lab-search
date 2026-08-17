import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import {
  getLocalIndexPath,
  getLocalSampleDirectory,
} from "../src/config/paths.js";
import { LocalDocumentRepository } from "../src/repositories/localDocumentRepository.js";
import { chunkDocument } from "../src/services/documents/chunkDocument.js";
import { extractPdfText } from "../src/services/documents/extractPdfText.js";
import type { IndexedChunk } from "../src/services/documents/types.js";
import { LocalEmbeddingProvider } from "../src/services/embedding/LocalEmbeddingProvider.js";

function createDocumentId(relativePath: string, content: string): string {
  const digest = createHash("sha256")
    .update(relativePath)
    .update("\0")
    .update(content)
    .digest("hex")
    .slice(0, 16);

  return `document-${digest}`;
}

async function findPdfPaths(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".pdf"))
    .map((entry) => join(directory, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

async function main() {
  const sampleDirectory = getLocalSampleDirectory();
  const indexPath = getLocalIndexPath();
  const pdfPaths = await findPdfPaths(sampleDirectory);

  if (pdfPaths.length === 0) {
    throw new Error(`No PDF files found in ${sampleDirectory}`);
  }

  const embeddingProvider = new LocalEmbeddingProvider();
  const indexedChunks: IndexedChunk[] = [];

  for (const pdfPath of pdfPaths) {
    const documentName = basename(pdfPath);
    console.log(`[index] ${documentName}`);

    const text = await extractPdfText(pdfPath);
    console.log("  text extracted");

    const documentId = createDocumentId(
      relative(sampleDirectory, pdfPath),
      text,
    );
    const chunks = chunkDocument({
      id: documentId,
      name: documentName,
      content: text,
    });
    console.log(`  chunks: ${chunks.length}`);

    for (let index = 0; index < chunks.length; index += 1) {
      indexedChunks.push({
        ...chunks[index],
        embedding: await embeddingProvider.embed(chunks[index].content),
      });

      const completed = index + 1;
      if (completed % 10 === 0 || completed === chunks.length) {
        console.log(`  embedding: ${completed}/${chunks.length}`);
      }
    }
  }

  const repository = new LocalDocumentRepository(indexPath);
  await repository.replaceAll(indexedChunks, {
    embeddingProviderId: embeddingProvider.id,
    embeddingDimensions: embeddingProvider.dimensions,
  });

  console.log(`[index] saved ${indexedChunks.length} chunks to ${indexPath}`);
}

main().catch((error: unknown) => {
  console.error("[index] failed", error);
  process.exitCode = 1;
});
