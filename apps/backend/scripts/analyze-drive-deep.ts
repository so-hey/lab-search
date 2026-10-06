import { resolve } from "node:path";
import { integerEnv } from "../src/config/env.js";
import { deepAnalyzeDrive, type DeepAnalyzeDriveOptions } from "../src/services/documents/deepAnalyzeDrive.js";
import { formatDeepAnalysisReport, writeDeepAnalysisReports } from "../src/services/documents/deepAnalysisReport.js";
import { ExtractorRegistry } from "../src/services/documents/extractors/ExtractorRegistry.js";
import { createGoogleDriveSource } from "../src/services/documents/source/createGoogleDriveSource.js";

type CliOptions = DeepAnalyzeDriveOptions & { outputDirectory: string; help: boolean };

function readNumber(args: string[], index: number, name: string): number {
  const value = Number(args[index + 1]);
  if (!Number.isFinite(value)) throw new Error(`${name} requires a numeric value.`);
  return value;
}

function parseArguments(args: string[]): CliOptions {
  const options: CliOptions = {
    embeddingDimensions: integerEnv("EMBEDDING_DIMENSIONS", 768),
    concurrency: integerEnv("DRIVE_ANALYSIS_CONCURRENCY", 3),
    capacityGiB: 5,
    retryAttempts: 3,
    retryBaseDelayMs: 500,
    topLimit: 20,
    outputDirectory: resolve(process.cwd(), "reports"),
    help: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") continue;
    if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--sample") options.sampleSize = readNumber(args, index++, argument);
    else if (argument === "--dimension") options.embeddingDimensions = readNumber(args, index++, argument);
    else if (argument === "--concurrency") options.concurrency = readNumber(args, index++, argument);
    else if (argument === "--capacity-gib") options.capacityGiB = readNumber(args, index++, argument);
    else if (argument === "--top") options.topLimit = readNumber(args, index++, argument);
    else if (argument === "--output-dir") {
      const value = args[++index];
      if (!value) throw new Error("--output-dir requires a path.");
      options.outputDirectory = resolve(value);
    } else throw new Error(`Unknown option: ${argument}`);
  }
  return options;
}

function printHelp() {
  console.log(`Google Drive deep analysis (dry-run)

Usage:
  pnpm --filter backend analyze:drive:deep [options]

Options:
  --sample <count>       Stratified sample size instead of all index targets
  --dimension <count>    Embedding dimensions for capacity math (default: 768)
  --concurrency <count>  Concurrent Drive downloads (default: 3)
  --capacity-gib <GiB>   Vector DB capacity assumption (default: 5 for Zilliz Free)
  --top <count>          Largest-file ranking length (default: 20)
  --output-dir <path>    JSON/CSV output directory (default: apps/backend/reports)
  --help                 Show this help

This command never calls an Embedding API or writes to Zilliz, Qdrant, Supabase, or Drive.`);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) return printHelp();
  console.log("Google Drive Deep Analysis\n==========================");
  console.log(
    options.sampleSize
      ? `Mode: stratified sample (${options.sampleSize} files requested)`
      : "Mode: full analysis",
  );
  console.log(`Concurrency: ${options.concurrency}\n`);
  const report = await deepAnalyzeDrive(
    {
      source: await createGoogleDriveSource(),
      extractorRegistry: new ExtractorRegistry(),
    },
    options,
  );
  const paths = await writeDeepAnalysisReports(report, options.outputDirectory);
  console.log(`\n${formatDeepAnalysisReport(report)}`);
  console.log(`\nJSON report: ${paths.jsonPath}`);
  console.log(`CSV report:  ${paths.csvPath}`);
}

main().catch((error: unknown) => {
  console.error("[analyze:drive:deep] failed", error);
  process.exitCode = 1;
});
