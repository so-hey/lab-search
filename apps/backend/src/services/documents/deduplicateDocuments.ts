import { extname } from "node:path";
import { MIME } from "./mimeTypes.js";
import type { SourceFile } from "./source/types.js";

export type DuplicatePair = { preferred: SourceFile; skipped: SourceFile };
export type DeduplicationResult = {
  filesToIndex: SourceFile[];
  duplicates: DuplicatePair[];
};

export function normalizeBasename(name: string): string {
  const normalized = name.normalize("NFKC");
  const extension = extname(normalized);
  return extension ? normalized.slice(0, -extension.length) : normalized;
}

function isPdfPptxPair(left: SourceFile, right: SourceFile): boolean {
  const types = new Set([left.mimeType, right.mimeType]);
  return types.size === 2 && types.has(MIME.pdf) && types.has(MIME.pptx);
}

function sharesParent(left: SourceFile, right: SourceFile): boolean {
  const rightParents = new Set(right.parentIds);
  return left.parentIds.some((parent) => rightParents.has(parent));
}

export function deduplicateDocuments(files: SourceFile[]): DeduplicationResult {
  const skippedIds = new Set<string>();
  const duplicates: DuplicatePair[] = [];
  const sorted = [...files].sort((a, b) => a.id.localeCompare(b.id));

  for (let leftIndex = 0; leftIndex < sorted.length; leftIndex += 1) {
    const left = sorted[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < sorted.length; rightIndex += 1) {
      const right = sorted[rightIndex];
      if (
        normalizeBasename(left.name) !== normalizeBasename(right.name) ||
        !sharesParent(left, right) ||
        !isPdfPptxPair(left, right)
      ) continue;
      const preferred = left.mimeType === MIME.pptx ? left : right;
      const skipped = left.mimeType === MIME.pdf ? left : right;
      if (!skippedIds.has(skipped.id)) {
        skippedIds.add(skipped.id);
        duplicates.push({ preferred, skipped });
      }
    }
  }

  return {
    filesToIndex: files.filter((file) => !skippedIds.has(file.id)),
    duplicates,
  };
}

export function logDuplicates(duplicates: DuplicatePair[]): void {
  for (const pair of duplicates) {
    console.log(`[dedup]\n  preferred: ${pair.preferred.name}\n  skipped:   ${pair.skipped.name}`);
  }
}
