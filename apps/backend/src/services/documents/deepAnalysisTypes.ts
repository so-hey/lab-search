import type { DriveAcquisitionErrorReason } from "./source/GoogleDriveDocumentSource.js";

export type DeepAnalysisFileStatus =
  | "success"
  | "duplicate_skipped"
  | "unsupported"
  | "not_sampled"
  | "extraction_failed"
  | "skipped_abusive_file"
  | "permission_error"
  | "export_size_error"
  | "file_not_downloadable"
  | "empty_document";

export type DeepAnalysisFile = {
  driveFileId: string;
  name: string;
  mimeType: string;
  category: string;
  parentFolderId: string | null;
  status: DeepAnalysisFileStatus;
  isDuplicate: boolean;
  duplicateOfDriveFileId?: string;
  sourceFileBytes?: number;
  metadataEstimatedChunks?: number;
  pageCount?: number;
  slideCount?: number;
  extractedCharacters?: number;
  extractedBytes?: number;
  chunkCount?: number;
  chunkTextCharacters?: number;
  chunkTextPayloadBytes?: number;
  metadataPayloadBytes?: number;
  driveErrorReason?: DriveAcquisitionErrorReason;
  error?: string;
};

export type Distribution = {
  min: number;
  p25: number;
  median: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
};

export type MetricSummary = {
  total: number;
  average: number;
  distribution: Distribution | null;
};

export type ChunkHistogram = {
  "0-10": number;
  "11-25": number;
  "26-50": number;
  "51-100": number;
  "101-250": number;
  "251-500": number;
  "501+": number;
};

export type FileTypeDeepAnalysis = {
  category: string;
  totalFiles: number;
  indexTargetFiles: number;
  selectedFiles: number;
  successfullyAnalyzed: number;
  extractionFailed: number;
  skippedAbusiveFiles: number;
  permissionErrors: number;
  exportSizeErrors: number;
  fileNotDownloadableErrors: number;
  emptyDocuments: number;
  totalExtractedCharacters: number;
  totalExtractedBytes: number;
  averageCharactersPerFile: number;
  totalChunkTextCharacters: number;
  averageCharactersPerChunk: number;
  averageCharactersPerPage: number | null;
  averageCharactersPerSlide: number | null;
  pages: MetricSummary | null;
  slides: MetricSummary | null;
  chunks: MetricSummary;
  chunkHistogram: ChunkHistogram;
  metadataEstimatedChunks: number;
  metadataEstimatedAverageChunksPerFile: number;
  projectedChunks: number;
  projectedChunkTextPayloadBytes: number;
  projectedMetadataPayloadBytes: number;
};

export type StorageScenario = {
  factor: number;
  estimatedBytes: number;
  usagePercent: number;
  remainingBytes: number;
  estimatedMaxChunks: number;
};

export type StorageEstimate = {
  basis: "actual" | "sample_projection" | "measured_sample";
  embeddingDimensions: number;
  bytesPerVector: number;
  totalVectors: number;
  rawVectorBytes: number;
  chunkTextPayloadBytes: number;
  metadataPayloadBytes: number;
  baseDataBytes: number;
  averageBaseBytesPerChunk: number;
  capacityBytes: number;
  scenarios: StorageScenario[];
  assessment: "LOW RISK" | "MODERATE" | "HIGH" | "NO DATA";
};

export type LargestFiles = {
  byChunkCount: DeepAnalysisFile[];
  byExtractedBytes: DeepAnalysisFile[];
  pdfByPageCount: DeepAnalysisFile[];
  pptxBySlideCount: DeepAnalysisFile[];
};

export type DeepDriveAnalysisReport = {
  generatedAt: string;
  summary: {
    totalFiles: number;
    pdfFiles: number;
    pptxFiles: number;
    supportedFiles: number;
    duplicatePairs: number;
    skippedDuplicatePdfs: number;
    finalIndexTargetFiles: number;
    unsupportedFiles: number;
    selectedForAnalysis: number;
    successfullyAnalyzed: number;
    extractionFailed: number;
    skippedAbusiveFiles: number;
    permissionErrors: number;
    exportSizeErrors: number;
    fileNotDownloadableErrors: number;
    emptyDocuments: number;
    duplicateSkipped: number;
    notSampled: number;
    isSampled: boolean;
    requestedSampleSize: number | null;
    measuredChunks: number;
    projectedTotalChunks: number;
  };
  byFileType: Record<string, FileTypeDeepAnalysis>;
  measuredStorage: StorageEstimate;
  storageEstimate: StorageEstimate;
  files: DeepAnalysisFile[];
  errors: DeepAnalysisFile[];
  largestFiles: LargestFiles;
  notes: string[];
};
