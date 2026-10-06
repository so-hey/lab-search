import { formatCategory } from "./mimeTypes.js";
import type { SourceFile } from "./source/types.js";
import type {
  ChunkHistogram,
  DeepAnalysisFile,
  DeepDriveAnalysisReport,
  Distribution,
  FileTypeDeepAnalysis,
  MetricSummary,
  StorageEstimate,
} from "./deepAnalysisTypes.js";

const DEFAULT_OVERHEAD_FACTORS = [1, 1.5, 2, 3];

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.max(0, Math.ceil(fraction * sorted.length) - 1);
  return sorted[index];
}

export function calculateDistribution(values: number[]): Distribution | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return {
    min: sorted[0],
    p25: percentile(sorted, 0.25),
    median: percentile(sorted, 0.5),
    p75: percentile(sorted, 0.75),
    p90: percentile(sorted, 0.9),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted.at(-1) ?? 0,
  };
}

export function summarizeMetric(values: number[]): MetricSummary {
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    total,
    average: values.length === 0 ? 0 : total / values.length,
    distribution: calculateDistribution(values),
  };
}

export function calculateChunkHistogram(values: number[]): ChunkHistogram {
  const result: ChunkHistogram = {
    "0-10": 0,
    "11-25": 0,
    "26-50": 0,
    "51-100": 0,
    "101-250": 0,
    "251-500": 0,
    "501+": 0,
  };
  for (const value of values) {
    if (value <= 10) result["0-10"] += 1;
    else if (value <= 25) result["11-25"] += 1;
    else if (value <= 50) result["26-50"] += 1;
    else if (value <= 100) result["51-100"] += 1;
    else if (value <= 250) result["101-250"] += 1;
    else if (value <= 500) result["251-500"] += 1;
    else result["501+"] += 1;
  }
  return result;
}

function stableHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function selectStratifiedSample(
  files: SourceFile[],
  requestedSize: number | undefined,
): SourceFile[] {
  if (requestedSize === undefined || requestedSize >= files.length) return [...files];
  if (!Number.isInteger(requestedSize) || requestedSize < 1) {
    throw new Error("sample size must be a positive integer.");
  }
  const groups = new Map<string, SourceFile[]>();
  for (const file of files) {
    const category = formatCategory(file.mimeType);
    const group = groups.get(category) ?? [];
    group.push(file);
    groups.set(category, group);
  }
  const includeEveryCategory = requestedSize >= groups.size;
  const baseCount = includeEveryCategory ? 1 : 0;
  const remainingAfterBase = requestedSize - baseCount * groups.size;
  const remainingPopulation = files.length - baseCount * groups.size;
  const allocations = [...groups.entries()].map(([category, group]) => {
    const available = group.length - baseCount;
    const exact =
      remainingPopulation === 0
        ? 0
        : (remainingAfterBase * available) / remainingPopulation;
    return {
      category,
      group,
      count: baseCount + Math.floor(exact),
      remainder: exact % 1,
    };
  });
  let remaining = requestedSize - allocations.reduce((sum, item) => sum + item.count, 0);
  allocations.sort(
    (left, right) => right.remainder - left.remainder || right.group.length - left.group.length,
  );
  for (const allocation of allocations) {
    if (remaining === 0) break;
    if (allocation.count < allocation.group.length) {
      allocation.count += 1;
      remaining -= 1;
    }
  }
  return allocations
    .flatMap(({ group, count }) =>
      [...group]
        .sort((left, right) => stableHash(left.id) - stableHash(right.id))
        .slice(0, count),
    )
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function calculateStorageEstimate(input: {
  basis: StorageEstimate["basis"];
  dimensions: number;
  totalVectors: number;
  chunkTextPayloadBytes: number;
  metadataPayloadBytes: number;
  capacityBytes: number;
  overheadFactors?: number[];
}): StorageEstimate {
  const bytesPerVector = input.dimensions * Float32Array.BYTES_PER_ELEMENT;
  const rawVectorBytes = input.totalVectors * bytesPerVector;
  const baseDataBytes = rawVectorBytes + input.chunkTextPayloadBytes + input.metadataPayloadBytes;
  const averageBaseBytesPerChunk = input.totalVectors === 0 ? 0 : baseDataBytes / input.totalVectors;
  const factors = input.overheadFactors ?? DEFAULT_OVERHEAD_FACTORS;
  const scenarios = factors.map((factor) => {
    const estimatedBytes = baseDataBytes * factor;
    return {
      factor,
      estimatedBytes,
      usagePercent: (estimatedBytes / input.capacityBytes) * 100,
      remainingBytes: Math.max(0, input.capacityBytes - estimatedBytes),
      estimatedMaxChunks:
        averageBaseBytesPerChunk === 0
          ? 0
          : Math.floor(input.capacityBytes / (averageBaseBytesPerChunk * factor)),
    };
  });
  const conservativeUsage = scenarios.find((item) => item.factor === 3)?.usagePercent ?? 0;
  const assessment =
    input.totalVectors === 0
      ? "NO DATA"
      : conservativeUsage < 25
        ? "LOW RISK"
        : conservativeUsage < 60
          ? "MODERATE"
          : "HIGH";
  return {
    basis: input.basis,
    embeddingDimensions: input.dimensions,
    bytesPerVector,
    totalVectors: input.totalVectors,
    rawVectorBytes,
    chunkTextPayloadBytes: input.chunkTextPayloadBytes,
    metadataPayloadBytes: input.metadataPayloadBytes,
    baseDataBytes,
    averageBaseBytesPerChunk,
    capacityBytes: input.capacityBytes,
    scenarios,
    assessment,
  };
}

function createFileTypeSummary(
  category: string,
  files: DeepAnalysisFile[],
  sampled: boolean,
): FileTypeDeepAnalysis {
  const all = files.filter((file) => file.category === category);
  const targets = all.filter(
    (file) => file.status !== "unsupported" && file.status !== "duplicate_skipped",
  );
  const selected = targets.filter((file) => file.status !== "not_sampled");
  const successful = selected.filter((file) => file.status === "success");
  const effective = selected.filter(
    (file) => file.status === "success" || file.status === "empty_document",
  );
  const chunkValues = successful.map((file) => file.chunkCount ?? 0);
  const pageValues = successful.flatMap((file) =>
    file.pageCount === undefined ? [] : [file.pageCount],
  );
  const slideValues = successful.flatMap((file) =>
    file.slideCount === undefined ? [] : [file.slideCount],
  );
  const extractedCharacters = successful.reduce(
    (sum, file) => sum + (file.extractedCharacters ?? 0),
    0,
  );
  const scale = sampled && effective.length > 0 ? targets.length / effective.length : 1;
  const chunkTextBytes = successful.reduce(
    (sum, file) => sum + (file.chunkTextPayloadBytes ?? 0),
    0,
  );
  const metadataBytes = successful.reduce(
    (sum, file) => sum + (file.metadataPayloadBytes ?? 0),
    0,
  );
  const chunkTextCharacters = successful.reduce(
    (sum, file) => sum + (file.chunkTextCharacters ?? 0),
    0,
  );
  const metadataEstimatedChunks = selected.reduce(
    (sum, file) => sum + (file.metadataEstimatedChunks ?? 0),
    0,
  );
  return {
    category,
    totalFiles: all.length,
    indexTargetFiles: targets.length,
    selectedFiles: selected.length,
    successfullyAnalyzed: successful.length,
    extractionFailed: selected.filter((file) => file.status === "extraction_failed").length,
    skippedAbusiveFiles: selected.filter((file) => file.status === "skipped_abusive_file").length,
    permissionErrors: selected.filter((file) => file.status === "permission_error").length,
    exportSizeErrors: selected.filter((file) => file.status === "export_size_error").length,
    fileNotDownloadableErrors: selected.filter(
      (file) => file.status === "file_not_downloadable",
    ).length,
    emptyDocuments: selected.filter((file) => file.status === "empty_document").length,
    totalExtractedCharacters: extractedCharacters,
    totalExtractedBytes: successful.reduce((sum, file) => sum + (file.extractedBytes ?? 0), 0),
    averageCharactersPerFile:
      successful.length === 0 ? 0 : extractedCharacters / successful.length,
    totalChunkTextCharacters: chunkTextCharacters,
    averageCharactersPerChunk:
      summarizeMetric(chunkValues).total === 0
        ? 0
        : chunkTextCharacters / summarizeMetric(chunkValues).total,
    averageCharactersPerPage:
      pageValues.length === 0 ? null : extractedCharacters / summarizeMetric(pageValues).total,
    averageCharactersPerSlide:
      slideValues.length === 0 ? null : extractedCharacters / summarizeMetric(slideValues).total,
    pages: pageValues.length === 0 ? null : summarizeMetric(pageValues),
    slides: slideValues.length === 0 ? null : summarizeMetric(slideValues),
    chunks: summarizeMetric(chunkValues),
    chunkHistogram: calculateChunkHistogram(chunkValues),
    metadataEstimatedChunks,
    metadataEstimatedAverageChunksPerFile:
      selected.length === 0 ? 0 : metadataEstimatedChunks / selected.length,
    projectedChunks: Math.round(summarizeMetric(chunkValues).total * scale),
    projectedChunkTextPayloadBytes: Math.round(chunkTextBytes * scale),
    projectedMetadataPayloadBytes: Math.round(metadataBytes * scale),
  };
}

function topFiles(
  files: DeepAnalysisFile[],
  field: "chunkCount" | "extractedBytes" | "pageCount" | "slideCount",
  limit: number,
  category?: string,
) {
  return files
    .filter(
      (file) =>
        file.status === "success" &&
        file[field] !== undefined &&
        (category === undefined || file.category === category),
    )
    .sort((left, right) => (right[field] ?? 0) - (left[field] ?? 0))
    .slice(0, limit);
}

export function buildDeepDriveAnalysisReport(input: {
  generatedAt: string;
  files: DeepAnalysisFile[];
  dimensions: number;
  capacityBytes: number;
  duplicatePairs: number;
  requestedSampleSize?: number;
  topLimit: number;
}): DeepDriveAnalysisReport {
  const categories = [...new Set(input.files.map((file) => file.category))].sort();
  const isSampled = input.files.some((file) => file.status === "not_sampled");
  const byFileType = Object.fromEntries(
    categories.map((category) => [
      category,
      createFileTypeSummary(category, input.files, isSampled),
    ]),
  );
  const successful = input.files.filter((file) => file.status === "success");
  const measuredChunks = successful.reduce((sum, file) => sum + (file.chunkCount ?? 0), 0);
  const measuredTextBytes = successful.reduce(
    (sum, file) => sum + (file.chunkTextPayloadBytes ?? 0),
    0,
  );
  const measuredMetadataBytes = successful.reduce(
    (sum, file) => sum + (file.metadataPayloadBytes ?? 0),
    0,
  );
  const projectedTotalChunks = Object.values(byFileType).reduce(
    (sum, value) => sum + value.projectedChunks,
    0,
  );
  const projectedTextBytes = Object.values(byFileType).reduce(
    (sum, value) => sum + value.projectedChunkTextPayloadBytes,
    0,
  );
  const projectedMetadataBytes = Object.values(byFileType).reduce(
    (sum, value) => sum + value.projectedMetadataPayloadBytes,
    0,
  );
  const measuredStorage = calculateStorageEstimate({
    basis: isSampled ? "measured_sample" : "actual",
    dimensions: input.dimensions,
    totalVectors: measuredChunks,
    chunkTextPayloadBytes: measuredTextBytes,
    metadataPayloadBytes: measuredMetadataBytes,
    capacityBytes: input.capacityBytes,
  });
  const storageEstimate = isSampled
    ? calculateStorageEstimate({
        basis: "sample_projection",
        dimensions: input.dimensions,
        totalVectors: projectedTotalChunks,
        chunkTextPayloadBytes: projectedTextBytes,
        metadataPayloadBytes: projectedMetadataBytes,
        capacityBytes: input.capacityBytes,
      })
    : measuredStorage;
  return {
    generatedAt: input.generatedAt,
    summary: {
      totalFiles: input.files.length,
      pdfFiles: input.files.filter((file) => file.category === "PDF").length,
      pptxFiles: input.files.filter((file) => file.category === "PPTX").length,
      supportedFiles: input.files.filter((file) => file.status !== "unsupported").length,
      duplicatePairs: input.duplicatePairs,
      skippedDuplicatePdfs: input.files.filter(
        (file) => file.category === "PDF" && file.status === "duplicate_skipped",
      ).length,
      finalIndexTargetFiles: input.files.filter(
        (file) => file.status !== "unsupported" && file.status !== "duplicate_skipped",
      ).length,
      unsupportedFiles: input.files.filter((file) => file.status === "unsupported").length,
      selectedForAnalysis: input.files.filter(
        (file) =>
          file.status !== "unsupported" &&
          file.status !== "duplicate_skipped" &&
          file.status !== "not_sampled",
      ).length,
      successfullyAnalyzed: successful.length,
      extractionFailed: input.files.filter((file) => file.status === "extraction_failed").length,
      skippedAbusiveFiles: input.files.filter(
        (file) => file.status === "skipped_abusive_file",
      ).length,
      permissionErrors: input.files.filter((file) => file.status === "permission_error").length,
      exportSizeErrors: input.files.filter((file) => file.status === "export_size_error").length,
      fileNotDownloadableErrors: input.files.filter(
        (file) => file.status === "file_not_downloadable",
      ).length,
      emptyDocuments: input.files.filter((file) => file.status === "empty_document").length,
      duplicateSkipped: input.files.filter((file) => file.status === "duplicate_skipped").length,
      notSampled: input.files.filter((file) => file.status === "not_sampled").length,
      isSampled,
      requestedSampleSize: input.requestedSampleSize ?? null,
      measuredChunks,
      projectedTotalChunks,
    },
    byFileType,
    measuredStorage,
    storageEstimate,
    files: input.files,
    errors: input.files.filter((file) => [
      "extraction_failed",
      "skipped_abusive_file",
      "permission_error",
      "export_size_error",
      "file_not_downloadable",
      "empty_document",
    ].includes(file.status)),
    largestFiles: {
      byChunkCount: topFiles(input.files, "chunkCount", input.topLimit),
      byExtractedBytes: topFiles(input.files, "extractedBytes", input.topLimit),
      pdfByPageCount: topFiles(input.files, "pageCount", input.topLimit, "PDF"),
      pptxBySlideCount: topFiles(input.files, "slideCount", input.topLimit, "PPTX"),
    },
    notes: [
      "No embedding API, Zilliz/Qdrant write, Supabase write, or Google Drive mutation was performed.",
      "Vector DB overhead scenarios are multipliers, not measured provider storage usage.",
      ...(isSampled
        ? ["Projected totals are stratified-sample estimates; measured sample values are reported separately."]
        : []),
    ],
  };
}
