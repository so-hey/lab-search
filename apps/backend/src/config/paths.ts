import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

const backendRoot = fileURLToPath(new URL("../../", import.meta.url));

function resolveConfiguredPath(value: string | undefined, fallback: string) {
  return value ? resolve(value) : fallback;
}

export function getLocalIndexPath(): string {
  return resolveConfiguredPath(
    process.env.LOCAL_INDEX_PATH,
    join(backendRoot, "data", "local-index.json"),
  );
}

export function getLocalSampleDirectory(): string {
  return resolveConfiguredPath(
    process.env.LOCAL_SAMPLE_DIR,
    join(backendRoot, "sample"),
  );
}
