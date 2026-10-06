export type RelevanceGrade = 0 | 1 | 2 | 3;

export type SearchEvaluationJudgment = {
  documentName: string;
  relevance: RelevanceGrade;
  rationale?: string;
};

export type SearchEvaluationCase = {
  id: string;
  query: string;
  category: string;
  noAnswer?: boolean;
  note?: string;
  judgments: SearchEvaluationJudgment[];
};

export type SearchEvaluationDataset = {
  version: number;
  description: string;
  relevantThreshold: RelevanceGrade;
  relevanceScale: Record<string, string>;
  cases: SearchEvaluationCase[];
};

export type RankedSearchResult = {
  documentName: string;
  score: number;
};

export type EvaluatedRank = RankedSearchResult & {
  rank: number;
  relevance: RelevanceGrade;
};

export type SearchCaseMetrics = {
  caseId: string;
  query: string;
  category: string;
  noAnswer: boolean;
  hitAtK: number | null;
  reciprocalRankAtK: number | null;
  ndcgAtK: number | null;
  topScore: number | null;
  judgedRelevantCount: number;
  unjudgedResultCount: number;
  rankedResults: EvaluatedRank[];
};

export type SearchEvaluationSummary = {
  evaluatedCases: number;
  answerCases: number;
  noAnswerCases: number;
  meanHitAtK: number | null;
  meanReciprocalRankAtK: number | null;
  meanNdcgAtK: number | null;
  meanNoAnswerTopScore: number | null;
  maxNoAnswerTopScore: number | null;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRelevanceGrade(value: unknown): value is RelevanceGrade {
  return value === 0 || value === 1 || value === 2 || value === 3;
}

function normalizedDocumentName(value: string): string {
  return value.normalize("NFC");
}

export function parseSearchEvaluationDataset(
  value: unknown,
): SearchEvaluationDataset {
  if (!isObject(value)) throw new Error("Evaluation dataset must be an object.");
  if (!Number.isInteger(value.version) || (value.version as number) < 1) {
    throw new Error("Evaluation dataset version must be a positive integer.");
  }
  if (typeof value.description !== "string" || !value.description.trim()) {
    throw new Error("Evaluation dataset description is required.");
  }
  if (!isRelevanceGrade(value.relevantThreshold)) {
    throw new Error("Evaluation relevantThreshold must be an integer from 0 to 3.");
  }
  const relevantThreshold = value.relevantThreshold;
  if (!isObject(value.relevanceScale)) {
    throw new Error("Evaluation relevanceScale must be an object.");
  }
  if (!Array.isArray(value.cases) || value.cases.length === 0) {
    throw new Error("Evaluation dataset must contain at least one case.");
  }

  const seenCaseIds = new Set<string>();
  const cases = value.cases.map((candidate, caseIndex): SearchEvaluationCase => {
    if (!isObject(candidate)) {
      throw new Error(`Evaluation case ${caseIndex + 1} must be an object.`);
    }
    const { id, query, category, note } = candidate;
    if (typeof id !== "string" || !id.trim()) {
      throw new Error(`Evaluation case ${caseIndex + 1} requires an id.`);
    }
    if (seenCaseIds.has(id)) throw new Error(`Duplicate evaluation case id: ${id}`);
    seenCaseIds.add(id);
    if (typeof query !== "string" || !query.trim()) {
      throw new Error(`Evaluation case ${id} requires a query.`);
    }
    if (typeof category !== "string" || !category.trim()) {
      throw new Error(`Evaluation case ${id} requires a category.`);
    }
    if (note !== undefined && typeof note !== "string") {
      throw new Error(`Evaluation case ${id} has an invalid note.`);
    }
    if (!Array.isArray(candidate.judgments)) {
      throw new Error(`Evaluation case ${id} requires judgments.`);
    }

    const seenDocuments = new Set<string>();
    const judgments = candidate.judgments.map(
      (judgment, judgmentIndex): SearchEvaluationJudgment => {
        if (!isObject(judgment)) {
          throw new Error(
            `Evaluation case ${id} judgment ${judgmentIndex + 1} must be an object.`,
          );
        }
        const { documentName, relevance, rationale } = judgment;
        if (typeof documentName !== "string" || !documentName.trim()) {
          throw new Error(`Evaluation case ${id} has a judgment without documentName.`);
        }
        const normalizedName = normalizedDocumentName(documentName);
        if (seenDocuments.has(normalizedName)) {
          throw new Error(
            `Evaluation case ${id} contains duplicate judgment: ${documentName}`,
          );
        }
        seenDocuments.add(normalizedName);
        if (!isRelevanceGrade(relevance)) {
          throw new Error(
            `Evaluation case ${id} judgment relevance must be an integer from 0 to 3.`,
          );
        }
        if (rationale !== undefined && typeof rationale !== "string") {
          throw new Error(`Evaluation case ${id} has an invalid rationale.`);
        }
        return {
          documentName,
          relevance,
          ...(rationale === undefined ? {} : { rationale }),
        };
      },
    );

    const noAnswer = candidate.noAnswer === true;
    if (
      noAnswer &&
      judgments.some((judgment) => judgment.relevance >= relevantThreshold)
    ) {
      throw new Error(`No-answer case ${id} cannot contain a relevant judgment.`);
    }

    return {
      id,
      query,
      category,
      ...(noAnswer ? { noAnswer: true } : {}),
      ...(note === undefined ? {} : { note }),
      judgments,
    };
  });

  return {
    version: value.version as number,
    description: value.description,
    relevantThreshold,
    relevanceScale: Object.fromEntries(
      Object.entries(value.relevanceScale).map(([key, description]) => {
        if (typeof description !== "string") {
          throw new Error(`Evaluation relevanceScale.${key} must be a string.`);
        }
        return [key, description];
      }),
    ),
    cases,
  };
}

function discountedCumulativeGain(relevances: readonly number[]): number {
  return relevances.reduce(
    (total, relevance, index) =>
      total + (2 ** relevance - 1) / Math.log2(index + 2),
    0,
  );
}

export function evaluateSearchCase(
  testCase: SearchEvaluationCase,
  results: readonly RankedSearchResult[],
  options: { limit: number; relevantThreshold: RelevanceGrade },
): SearchCaseMetrics {
  if (!Number.isInteger(options.limit) || options.limit < 1) {
    throw new Error("Evaluation limit must be a positive integer.");
  }

  const judgments = new Map(
    testCase.judgments.map((judgment) => [
      normalizedDocumentName(judgment.documentName),
      judgment.relevance,
    ]),
  );
  const rankedResults = results.slice(0, options.limit).map((result, index) => ({
    ...result,
    rank: index + 1,
    relevance:
      judgments.get(normalizedDocumentName(result.documentName)) ?? 0,
  }));
  const topScore = rankedResults[0]?.score ?? null;
  const judgedRelevantCount = testCase.judgments.filter(
    (judgment) => judgment.relevance >= options.relevantThreshold,
  ).length;
  const unjudgedResultCount = rankedResults.filter(
    (result) => !judgments.has(normalizedDocumentName(result.documentName)),
  ).length;

  if (testCase.noAnswer) {
    return {
      caseId: testCase.id,
      query: testCase.query,
      category: testCase.category,
      noAnswer: true,
      hitAtK: null,
      reciprocalRankAtK: null,
      ndcgAtK: null,
      topScore,
      judgedRelevantCount,
      unjudgedResultCount,
      rankedResults,
    };
  }

  const firstRelevantIndex = rankedResults.findIndex(
    (result) => result.relevance >= options.relevantThreshold,
  );
  const actualGain = discountedCumulativeGain(
    rankedResults.map((result) => result.relevance),
  );
  const idealGain = discountedCumulativeGain(
    testCase.judgments
      .map((judgment) => judgment.relevance)
      .sort((a, b) => b - a)
      .slice(0, options.limit),
  );

  return {
    caseId: testCase.id,
    query: testCase.query,
    category: testCase.category,
    noAnswer: false,
    hitAtK: firstRelevantIndex === -1 ? 0 : 1,
    reciprocalRankAtK: firstRelevantIndex === -1 ? 0 : 1 / (firstRelevantIndex + 1),
    ndcgAtK: idealGain === 0 ? 0 : actualGain / idealGain,
    topScore,
    judgedRelevantCount,
    unjudgedResultCount,
    rankedResults,
  };
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

export function summarizeSearchEvaluation(
  metrics: readonly SearchCaseMetrics[],
): SearchEvaluationSummary {
  const answerCases = metrics.filter((item) => !item.noAnswer);
  const noAnswerCases = metrics.filter((item) => item.noAnswer);
  const noAnswerScores = noAnswerCases.flatMap((item) =>
    item.topScore === null ? [] : [item.topScore],
  );

  return {
    evaluatedCases: metrics.length,
    answerCases: answerCases.length,
    noAnswerCases: noAnswerCases.length,
    meanHitAtK: mean(answerCases.flatMap((item) => item.hitAtK ?? [])),
    meanReciprocalRankAtK: mean(
      answerCases.flatMap((item) => item.reciprocalRankAtK ?? []),
    ),
    meanNdcgAtK: mean(answerCases.flatMap((item) => item.ndcgAtK ?? [])),
    meanNoAnswerTopScore: mean(noAnswerScores),
    maxNoAnswerTopScore:
      noAnswerScores.length === 0 ? null : Math.max(...noAnswerScores),
  };
}
