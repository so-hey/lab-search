import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createDocumentRepository } from "../src/repositories/createDocumentRepository.js";
import { createEmbeddingProvider } from "../src/services/embedding/createEmbeddingProvider.js";
import { enumEnv, integerEnv } from "../src/config/env.js";
import { createReranker } from "../src/services/reranking/createReranker.js";
import {
  evaluateSearchCase,
  parseSearchEvaluationDataset,
  summarizeSearchEvaluation,
  type SearchCaseMetrics,
} from "../src/services/search/searchEvaluation.js";
import { searchDocuments } from "../src/services/search/searchDocuments.js";

const DEFAULT_DATASET_PATH = "evaluation/search-cases.json";
const DEFAULT_LIMIT = 5;

type CliOptions = {
  datasetPath: string;
  caseId?: string;
  category?: string;
  limit: number;
  listOnly: boolean;
};

function optionValue(args: string[], name: string): string | undefined {
  const equalsValue = args.find((argument) => argument.startsWith(`${name}=`));
  if (equalsValue) return equalsValue.slice(name.length + 1);
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function parseOptions(args: string[]): CliOptions {
  const limitValue = optionValue(args, "--limit");
  const limit = limitValue === undefined ? DEFAULT_LIMIT : Number(limitValue);
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
    throw new Error("--limit must be an integer from 1 to 20.");
  }
  return {
    datasetPath: optionValue(args, "--dataset") ?? DEFAULT_DATASET_PATH,
    ...(optionValue(args, "--case")
      ? { caseId: optionValue(args, "--case") }
      : {}),
    ...(optionValue(args, "--category")
      ? { category: optionValue(args, "--category") }
      : {}),
    limit,
    listOnly: args.includes("--list"),
  };
}

function percent(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function decimal(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(4);
}

function timestampForFile(date: Date): string {
  return date.toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const datasetPath = resolve(process.cwd(), options.datasetPath);
  const dataset = parseSearchEvaluationDataset(
    JSON.parse(await readFile(datasetPath, "utf8")) as unknown,
  );
  const selectedCases = dataset.cases.filter(
    (testCase) =>
      (!options.caseId || testCase.id === options.caseId) &&
      (!options.category || testCase.category === options.category),
  );
  if (selectedCases.length === 0) {
    throw new Error(
      `No evaluation cases matched case=${options.caseId ?? "*"}, category=${options.category ?? "*"}.`,
    );
  }

  console.log("Search Evaluation");
  console.log(`dataset: ${datasetPath}`);
  console.log(`cases: ${selectedCases.length}/${dataset.cases.length}`);
  console.log(`relevant: grade >= ${dataset.relevantThreshold}`);
  console.log(`limit: ${options.limit}`);

  if (options.listOnly) {
    for (const [index, testCase] of selectedCases.entries()) {
      console.log(
        `${index + 1}. ${testCase.id} [${testCase.category}] ${testCase.query}`,
      );
    }
    return;
  }

  const embeddingProvider = createEmbeddingProvider();
  const documentRepository = createDocumentRepository(embeddingProvider);
  const reranker = createReranker();
  const retrievalMode = enumEnv(
    "SEARCH_STRATEGY",
    ["dense", "hybrid"] as const,
    "dense",
  );
  const metrics: SearchCaseMetrics[] = [];
  const failures: Array<{ caseId: string; query: string; error: string }> = [];

  console.log(`embedding: ${embeddingProvider.id}`);
  console.log(`search mode: ${process.env.SEARCH_MODE ?? "local"}`);
  console.log(`search strategy: ${retrievalMode}`);
  console.log(`reranker: ${reranker?.id ?? "none"}`);

  for (const [index, testCase] of selectedCases.entries()) {
    console.log(`\n[${index + 1}/${selectedCases.length}] ${testCase.id}`);
    console.log(`query: ${testCase.query}`);
    try {
      const response = await searchDocuments(
        { query: testCase.query, limit: options.limit, source: "web" },
        {
          embeddingProvider,
          documentRepository,
          retrievalMode,
          ...(reranker
            ? {
                reranker,
                rerankCandidateDocuments: integerEnv(
                  "RERANK_CANDIDATE_DOCUMENTS",
                  20,
                ),
              }
            : {}),
        },
      );
      const caseMetrics = evaluateSearchCase(
        testCase,
        response.results.map((result) => ({
          documentName: result.documentName,
          score: result.score,
        })),
        {
          limit: options.limit,
          relevantThreshold: dataset.relevantThreshold,
        },
      );
      metrics.push(caseMetrics);

      for (const result of caseMetrics.rankedResults) {
        console.log(
          `  ${result.rank}. score=${result.score.toFixed(4)} relevance=${result.relevance} ${result.documentName}`,
        );
      }
      if (caseMetrics.noAnswer) {
        console.log(
          `  no-answer probe: top score=${decimal(caseMetrics.topScore)} (ranking指標の平均から除外)`,
        );
      } else {
        console.log(
          `  Hit@${options.limit}=${caseMetrics.hitAtK} MRR@${options.limit}=${decimal(caseMetrics.reciprocalRankAtK)} nDCG@${options.limit}=${decimal(caseMetrics.ndcgAtK)}`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ caseId: testCase.id, query: testCase.query, error: message });
      console.error(`  failed: ${message}`);
    }
  }

  const summary = summarizeSearchEvaluation(metrics);
  console.log("\nSearch Evaluation Summary");
  console.log(`Evaluated: ${summary.evaluatedCases}`);
  console.log(`Failed: ${failures.length}`);
  console.log(`Hit@${options.limit}: ${percent(summary.meanHitAtK)}`);
  console.log(`MRR@${options.limit}: ${decimal(summary.meanReciprocalRankAtK)}`);
  console.log(`nDCG@${options.limit}: ${decimal(summary.meanNdcgAtK)}`);
  console.log(
    `No-answer top score (mean/max): ${decimal(summary.meanNoAnswerTopScore)} / ${decimal(summary.maxNoAnswerTopScore)}`,
  );

  const generatedAt = new Date();
  const reportsDirectory = resolve(process.cwd(), "reports");
  const reportPath = resolve(
    reportsDirectory,
    `search-evaluation-${timestampForFile(generatedAt)}.json`,
  );
  await mkdir(reportsDirectory, { recursive: true });
  await writeFile(
    reportPath,
    `${JSON.stringify(
      {
        generatedAt: generatedAt.toISOString(),
        datasetPath,
        datasetVersion: dataset.version,
        embeddingProviderId: embeddingProvider.id,
        rerankerId: reranker?.id ?? null,
        searchStrategy: retrievalMode,
        searchMode: process.env.SEARCH_MODE ?? "local",
        vectorCollection:
          process.env.ZILLIZ_COLLECTION ?? process.env.QDRANT_COLLECTION ?? null,
        limit: options.limit,
        relevantThreshold: dataset.relevantThreshold,
        summary,
        cases: metrics,
        failures,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  console.log(`report: ${reportPath}`);

  if (failures.length > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error("[evaluate:search] failed", error);
  process.exitCode = 1;
});
