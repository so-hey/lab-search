import { integerEnv } from "../src/config/env.js";
import { analyzeDrive } from "../src/services/documents/analyzeDrive.js";
import { createGoogleDriveSource } from "../src/services/documents/source/createGoogleDriveSource.js";

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

async function main() {
  const source = await createGoogleDriveSource();
  const dimensions = integerEnv("EMBEDDING_DIMENSIONS", 768);
  const result = await analyzeDrive(source, dimensions);
  console.log("\nGoogle Drive Analysis\n");
  console.log("Files\n-----------------------");
  for (const [category, count] of Object.entries(result.counts)) {
    console.log(`${category.padEnd(20)}${String(count).padStart(8)}`);
  }
  console.log(`\nSupported files     ${result.supportedFiles}`);
  console.log(`Duplicate PDFs      ${result.duplicates}`);
  console.log(`Estimated chunks    ${result.estimatedChunks}`);
  console.log(`Estimated vectors   ${result.estimatedChunks}`);
  console.log(
    `Estimated vector storage (raw float32 only) ${formatBytes(result.estimatedVectorBytes)}`,
  );
  console.log(
    "\n※ chunk数と容量はDriveのfile sizeから求めた概算です。Vector DBのindex/payload overheadは含みません。",
  );
}

main().catch((error: unknown) => {
  console.error("[analyze:drive] failed", error);
  process.exitCode = 1;
});
