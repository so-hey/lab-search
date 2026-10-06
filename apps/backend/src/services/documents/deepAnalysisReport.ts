import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  DeepAnalysisFile,
  DeepDriveAnalysisReport,
  FileTypeDeepAnalysis,
  StorageEstimate,
} from "./deepAnalysisTypes.js";

const number = new Intl.NumberFormat("en-US");

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${Math.round(bytes)} B`;
}

function row(label: string, value: string | number): string {
  return `${label.padEnd(34)}${String(value).padStart(14)}`;
}

function decimal(value: number, digits = 1): string {
  return value.toFixed(digits);
}

function sectionTitle(title: string): string {
  return `\n${title}\n${"-".repeat(title.length)}`;
}

function formatDistribution(summary: FileTypeDeepAnalysis): string[] {
  const distribution = summary.chunks.distribution;
  if (!distribution) return [];
  return [
    row(
      "Chunk min / p25 / median",
      `${distribution.min} / ${distribution.p25} / ${distribution.median}`,
    ),
    row(
      "Chunk p75 / p90 / p95",
      `${distribution.p75} / ${distribution.p90} / ${distribution.p95}`,
    ),
    row("Chunk p99 / max", `${distribution.p99} / ${distribution.max}`),
    "Chunk histogram",
    ...Object.entries(summary.chunkHistogram).map(([range, count]) =>
      row(`  ${range}`, number.format(count)),
    ),
  ];
}

function formatFileType(summary: FileTypeDeepAnalysis): string {
  const lines = [
    sectionTitle(summary.category),
    row("Index target files", number.format(summary.indexTargetFiles)),
    row("Selected for analysis", number.format(summary.selectedFiles)),
    row("Successfully analyzed", number.format(summary.successfullyAnalyzed)),
    row("Abusive files skipped", number.format(summary.skippedAbusiveFiles)),
    row("Permission errors", number.format(summary.permissionErrors)),
    row("Export-size errors", number.format(summary.exportSizeErrors)),
    row(
      "File-not-downloadable errors",
      number.format(summary.fileNotDownloadableErrors),
    ),
    row("Extraction failed", number.format(summary.extractionFailed)),
    row("Empty documents", number.format(summary.emptyDocuments)),
  ];
  if (summary.pages) {
    lines.push(
      row("Total pages", number.format(summary.pages.total)),
      row("Average pages/file", decimal(summary.pages.average)),
      row(
        "Median pages/file",
        number.format(summary.pages.distribution?.median ?? 0),
      ),
      row(
        "Max pages/file",
        number.format(summary.pages.distribution?.max ?? 0),
      ),
    );
  }
  if (summary.slides) {
    lines.push(
      row("Total slides", number.format(summary.slides.total)),
      row("Average slides/file", decimal(summary.slides.average)),
      row(
        "Median slides/file",
        number.format(summary.slides.distribution?.median ?? 0),
      ),
      row(
        "Max slides/file",
        number.format(summary.slides.distribution?.max ?? 0),
      ),
    );
  }
  lines.push(
    row(
      "Extracted characters",
      number.format(summary.totalExtractedCharacters),
    ),
    row("Extracted UTF-8 bytes", formatBytes(summary.totalExtractedBytes)),
    row("Average characters/file", decimal(summary.averageCharactersPerFile)),
    row("Average characters/chunk", decimal(summary.averageCharactersPerChunk)),
  );
  if (summary.averageCharactersPerPage !== null) {
    lines.push(
      row("Average characters/page", decimal(summary.averageCharactersPerPage)),
    );
  }
  if (summary.averageCharactersPerSlide !== null) {
    lines.push(
      row(
        "Average characters/slide",
        decimal(summary.averageCharactersPerSlide),
      ),
    );
  }
  lines.push(
    row("Measured chunks", number.format(summary.chunks.total)),
    row("Average chunks/file", decimal(summary.chunks.average)),
    row(
      "Metadata-size estimated chunks",
      number.format(summary.metadataEstimatedChunks),
    ),
    row(
      "Metadata estimate avg/file",
      decimal(summary.metadataEstimatedAverageChunksPerFile),
    ),
    row(
      "Projected chunks for all targets",
      number.format(summary.projectedChunks),
    ),
    ...formatDistribution(summary),
  );
  return lines.join("\n");
}

function formatStorage(storage: StorageEstimate): string {
  const basis =
    storage.basis === "actual"
      ? "actual full analysis"
      : storage.basis === "sample_projection"
        ? "stratified sample projection"
        : "measured sample only";
  const lines = [
    row("Basis", basis),
    row("Embedding dimension", number.format(storage.embeddingDimensions)),
    row("Bytes/vector", number.format(storage.bytesPerVector)),
    row("Total vectors", number.format(storage.totalVectors)),
    row("Raw vector storage", formatBytes(storage.rawVectorBytes)),
    row("Chunk text payload", formatBytes(storage.chunkTextPayloadBytes)),
    row(
      "Other metadata/JSON payload",
      formatBytes(storage.metadataPayloadBytes),
    ),
    row("Base data estimate", formatBytes(storage.baseDataBytes)),
    row("Average base bytes/chunk", decimal(storage.averageBaseBytesPerChunk)),
    "",
    "Scenario        Estimated size   Usage of capacity   Remaining       Max chunks",
    "-------------------------------------------------------------------------------",
  ];
  for (const scenario of storage.scenarios) {
    const name =
      scenario.factor === 1 ? "Base" : `${scenario.factor.toFixed(1)}x`;
    lines.push(
      `${name.padEnd(15)}${formatBytes(scenario.estimatedBytes).padStart(14)}${`${scenario.usagePercent.toFixed(1)}%`.padStart(20)}${formatBytes(scenario.remainingBytes).padStart(14)}${number.format(scenario.estimatedMaxChunks).padStart(17)}`,
    );
  }
  lines.push("", row("Capacity assessment (3x)", storage.assessment));
  return lines.join("\n");
}

function formatRanking(
  title: string,
  files: DeepAnalysisFile[],
  value: (file: DeepAnalysisFile) => string,
): string {
  return [
    sectionTitle(title),
    ...(files.length === 0
      ? ["(no data)"]
      : files.map(
          (file, index) =>
            `${String(index + 1).padStart(2)}. ${file.name} — ${value(file)}`,
        )),
  ].join("\n");
}

export function formatDeepAnalysisReport(
  report: DeepDriveAnalysisReport,
): string {
  const summary = report.summary;
  const order = ["PDF", "PPTX", "Google Slides", "DOCX", "Google Docs"];
  const fileTypes = order
    .flatMap((category) => {
      const value = report.byFileType[category];
      return value && value.totalFiles > 0 ? [formatFileType(value)] : [];
    })
    .join("\n");
  const sampleNotice = summary.isSampled
    ? `SAMPLE MODE: ${summary.selectedForAnalysis}/${summary.finalIndexTargetFiles} index targets were downloaded. Projected totals are estimates.`
    : "FULL MODE: all index targets were downloaded and measured.";
  return [
    "Google Drive Deep Analysis",
    "==========================",
    sampleNotice,
    sectionTitle("Files"),
    row("Total files", number.format(summary.totalFiles)),
    row("PDF total", number.format(summary.pdfFiles)),
    row("PPTX total", number.format(summary.pptxFiles)),
    row("Supported", number.format(summary.supportedFiles)),
    row("Duplicate PDF/PPTX pairs", number.format(summary.duplicatePairs)),
    row("Skipped duplicate PDFs", number.format(summary.skippedDuplicatePdfs)),
    row(
      "Final index target files",
      number.format(summary.finalIndexTargetFiles),
    ),
    row("Unsupported", number.format(summary.unsupportedFiles)),
    row("Successfully analyzed", number.format(summary.successfullyAnalyzed)),
    row("Extraction failed", number.format(summary.extractionFailed)),
    row("Empty documents", number.format(summary.emptyDocuments)),
    fileTypes,
    sectionTitle("Overall"),
    row("Indexed files", number.format(summary.finalIndexTargetFiles)),
    row("Measured chunks", number.format(summary.measuredChunks)),
    ...(summary.isSampled
      ? [
          row(
            "Projected total chunks",
            number.format(summary.projectedTotalChunks),
          ),
        ]
      : []),
    sectionTitle("Storage estimate"),
    formatStorage(report.storageEstimate),
    "",
    "※ HNSW・segment・allocator等の実測値ではなく、base dataへ係数を掛けた安全側のシナリオです。",
    formatRanking(
      "Top files by chunk count",
      report.largestFiles.byChunkCount,
      (file) => `${number.format(file.chunkCount ?? 0)} chunks`,
    ),
    formatRanking(
      "Top files by extracted text bytes",
      report.largestFiles.byExtractedBytes,
      (file) => formatBytes(file.extractedBytes ?? 0),
    ),
    formatRanking(
      "Top PDF files by page count",
      report.largestFiles.pdfByPageCount,
      (file) => `${number.format(file.pageCount ?? 0)} pages`,
    ),
    formatRanking(
      "Top PPTX files by slide count",
      report.largestFiles.pptxBySlideCount,
      (file) => `${number.format(file.slideCount ?? 0)} slides`,
    ),
    sectionTitle("Errors / skipped"),
    ...(report.errors.length === 0
      ? ["No acquisition errors, extraction failures, or empty documents."]
      : report.errors.map(
          (file) =>
            `${file.name} (${file.mimeType}) [${file.status}]${file.driveErrorReason ? ` reason=${file.driveErrorReason}` : ""}: ${file.error ?? "unknown"}`,
        )),
    "",
    "Dry-run guarantee: no Embedding API call, Zilliz/Supabase write, or Drive mutation was performed.",
  ].join("\n");
}

function csvValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  const text = String(value);
  return /[",\n\r]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function reportTimestamp(isoDate: string): string {
  return isoDate.replace(/[-:]/gu, "").replace("T", "-").slice(0, 15);
}

export async function writeDeepAnalysisReports(
  report: DeepDriveAnalysisReport,
  outputDirectory: string,
): Promise<{ jsonPath: string; csvPath: string }> {
  await mkdir(outputDirectory, { recursive: true });
  const timestamp = reportTimestamp(report.generatedAt);
  const jsonPath = join(outputDirectory, `drive-analysis-${timestamp}.json`);
  const csvPath = join(
    outputDirectory,
    `drive-analysis-files-${timestamp}.csv`,
  );
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const headers = [
    "drive_file_id",
    "name",
    "mime_type",
    "category",
    "parent_folder_id",
    "status",
    "duplicate",
    "duplicate_of_drive_file_id",
    "source_file_bytes",
    "page_count",
    "slide_count",
    "extracted_characters",
    "extracted_bytes",
    "chunk_count",
    "chunk_text_characters",
    "chunk_text_payload_bytes",
    "metadata_payload_bytes",
    "drive_error_reason",
    "error",
  ];
  const rows = report.files.map((file) =>
    [
      file.driveFileId,
      file.name,
      file.mimeType,
      file.category,
      file.parentFolderId,
      file.status,
      file.isDuplicate,
      file.duplicateOfDriveFileId,
      file.sourceFileBytes,
      file.pageCount,
      file.slideCount,
      file.extractedCharacters,
      file.extractedBytes,
      file.chunkCount,
      file.chunkTextCharacters,
      file.chunkTextPayloadBytes,
      file.metadataPayloadBytes,
      file.driveErrorReason,
      file.error,
    ]
      .map(csvValue)
      .join(","),
  );
  await writeFile(
    csvPath,
    `${headers.join(",")}\n${rows.join("\n")}\n`,
    "utf8",
  );
  return { jsonPath, csvPath };
}
