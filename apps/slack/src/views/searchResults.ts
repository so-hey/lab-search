import type {
  FeedbackRequest,
  FeedbackValue,
  SearchResponse,
  SearchResult,
} from "@lab-search/shared";
import type { types } from "@slack/bolt";

const CONTENT_PREVIEW_LENGTH = 420;
const RRF_MAX_SCORE = 2 / 61;

export type FeedbackActionValue = Omit<FeedbackRequest, "source">;

function escapeMrkdwn(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function truncate(value: string, maximum: number): string {
  const characters = Array.from(value);
  return characters.length <= maximum
    ? value
    : `${characters.slice(0, maximum).join("")}…`;
}

function preview(content: string): string {
  const compact = content.replace(/\s+/gu, " ").trim();
  const characters = Array.from(compact);
  return characters.length <= CONTENT_PREVIEW_LENGTH
    ? compact
    : `${characters.slice(0, CONTENT_PREVIEW_LENGTH).join("")}…`;
}

function scoreLabel(result: SearchResult): string {
  if (result.scoreType === "reranker") return "Reranker関連度";
  if (result.scoreType === "rrf") return "RRF統合スコア";
  if (result.scoreType === "cosine") return "コサイン類似度";
  return "関連度";
}

function displayScore(result: SearchResult): number {
  const maximum = result.scoreType === "rrf" ? RRF_MAX_SCORE : 1;
  return Math.min(1, Math.max(0, result.score / maximum));
}

function location(result: SearchResult): string | undefined {
  if (result.page !== undefined) return `Page ${result.page}`;
  if (result.slide !== undefined) return `Slide ${result.slide}`;
  return result.sectionTitle;
}

export function encodeFeedbackAction(value: FeedbackActionValue): string {
  return JSON.stringify(value);
}

export function decodeFeedbackAction(value: string): FeedbackActionValue {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error("Feedback action contains invalid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Feedback action must be an object.");
  }
  const candidate = parsed as Partial<FeedbackActionValue>;
  if (
    typeof candidate.searchLogId !== "string" ||
    !candidate.searchLogId ||
    typeof candidate.documentId !== "string" ||
    !candidate.documentId ||
    typeof candidate.chunkId !== "string" ||
    !candidate.chunkId ||
    !Number.isInteger(candidate.rank) ||
    (candidate.rank ?? 0) < 1 ||
    typeof candidate.score !== "number" ||
    !Number.isFinite(candidate.score) ||
    (candidate.feedback !== "positive" && candidate.feedback !== "negative")
  ) {
    throw new Error("Feedback action has invalid fields.");
  }
  return candidate as FeedbackActionValue;
}

function resultBlocks(
  result: SearchResult,
  index: number,
  searchLogId: string | null,
): types.KnownBlock[] {
  const metadata = [
    location(result),
    `${scoreLabel(result)} ${displayScore(result).toFixed(3)}`,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" · ");
  const elements: types.ActionsBlockElement[] = [];
  if (result.folderUrl) {
    elements.push({
      type: "button",
      action_id: `lab_search_open_folder_${index + 1}`,
      text: { type: "plain_text", text: "保存先フォルダ" },
      url: result.folderUrl,
    });
  }
  if (result.url) {
    elements.push({
      type: "button",
      action_id: `lab_search_open_file_${index + 1}`,
      text: { type: "plain_text", text: "このファイル" },
      url: result.url,
    });
  }
  if (searchLogId) {
    const base = {
      searchLogId,
      documentId: result.documentId,
      chunkId: result.chunkId,
      rank: index + 1,
      score: result.score,
    };
    for (const [feedback, text] of [
      ["positive", "役に立った"],
      ["negative", "役に立たなかった"],
    ] as const satisfies readonly (readonly [FeedbackValue, string])[]) {
      elements.push({
        type: "button",
        action_id: `lab_search_feedback_${feedback}`,
        text: { type: "plain_text", text },
        value: encodeFeedbackAction({ ...base, feedback }),
      });
    }
  }

  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${index + 1}. ${escapeMrkdwn(truncate(result.documentName, 180))}*\n${escapeMrkdwn(metadata)}\n${escapeMrkdwn(preview(result.content))}`,
      },
    },
    ...(elements.length > 0
      ? [
          {
            type: "actions" as const,
            block_id: `lab_search_result_${index + 1}`,
            elements,
          },
        ]
      : []),
    { type: "divider" },
  ];
}

export function buildSearchResultBlocks(
  query: string,
  response: SearchResponse,
): types.KnownBlock[] {
  if (response.results.length === 0) {
    return [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `「${escapeMrkdwn(query)}」に該当する資料はありませんでした。`,
        },
      },
    ];
  }
  return [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `「${truncate(query, 100)}」の検索結果`,
      },
    },
    ...response.results.flatMap((result, index) =>
      resultBlocks(result, index, response.searchLogId),
    ),
  ];
}

export function markFeedbackSubmitted(
  blocks: readonly types.AnyBlock[],
  resultBlockId: string,
  feedback: FeedbackValue,
): types.AnyBlock[] {
  return blocks.flatMap((block) => {
    if (
      block.type !== "actions" ||
      !("elements" in block) ||
      !Array.isArray(block.elements) ||
      block.block_id !== resultBlockId
    ) {
      return [block];
    }
    const elements = block.elements.filter(
      (element) =>
        !("action_id" in element) ||
        typeof element.action_id !== "string" ||
        !element.action_id.startsWith("lab_search_feedback_"),
    );
    return [
      ...(elements.length > 0 ? [{ ...block, elements }] : []),
      {
        type: "context" as const,
        elements: [
          {
            type: "mrkdwn" as const,
            text:
              feedback === "positive"
                ? "評価を送信しました：役に立った"
                : "評価を送信しました：役に立たなかった",
          },
        ],
      },
    ];
  });
}
