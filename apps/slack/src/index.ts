import {
  App,
  type BlockButtonAction,
  type types,
} from "@slack/bolt";
import { booleanEnv, integerEnv, optionalEnv, requiredEnv } from "./config/env.js";
import { BackendClient, type SlackIdentity } from "./services/BackendClient.js";
import {
  buildSearchResultBlocks,
  decodeFeedbackAction,
  markFeedbackSubmitted,
} from "./views/searchResults.js";

const socketMode = booleanEnv("SLACK_SOCKET_MODE", true);
const botToken = requiredEnv("SLACK_BOT_TOKEN");
const backend = new BackendClient(
  requiredEnv("BACKEND_URL"),
  requiredEnv("SLACK_BACKEND_SERVICE_TOKEN"),
);
const app = new App({
  token: botToken,
  socketMode,
  ...(socketMode
    ? { appToken: requiredEnv("SLACK_APP_TOKEN") }
    : { signingSecret: requiredEnv("SLACK_SIGNING_SECRET") }),
});
const commandName = optionalEnv("SLACK_SEARCH_COMMAND") ?? "/lab-search";

async function slackIdentity(
  client: Parameters<Parameters<typeof app.command>[1]>[0]["client"],
  teamId: string | undefined,
  userId: string,
): Promise<SlackIdentity> {
  if (!teamId) throw new Error("Slack workspace IDを取得できませんでした。");
  const response = await client.users.info({ user: userId });
  const email = response.user?.profile?.email;
  if (!email) {
    throw new Error(
      "Slackプロフィールからメールアドレスを取得できません。管理者へ連絡してください。",
    );
  }
  return { teamId, userId, email };
}

app.command(commandName, async ({ command, ack, client, respond, logger }) => {
  await ack();
  const query = command.text.trim();
  if (!query) {
    await respond({
      response_type: "ephemeral",
      text: `検索語を指定してください。例: ${commandName} モデルマージ`,
    });
    return;
  }
  try {
    const identity = await slackIdentity(
      client,
      command.team_id,
      command.user_id,
    );
    const response = await backend.search(query, identity, 5);
    await respond({
      response_type: "ephemeral",
      text: `「${query}」の検索結果 ${response.results.length}件`,
      blocks: buildSearchResultBlocks(query, response),
    });
  } catch (error) {
    logger.error(error);
    await respond({
      response_type: "ephemeral",
      text: error instanceof Error ? error.message : "検索に失敗しました。",
    });
  }
});

app.action<BlockButtonAction>(
  /^lab_search_feedback_(positive|negative)$/u,
  async ({ ack, body, action, client, respond, logger }) => {
    await ack();
    try {
      if (!action.value) throw new Error("評価情報がありません。");
      const request = decodeFeedbackAction(action.value);
      const identity = await slackIdentity(
        client,
        body.team?.id ?? body.user.team_id,
        body.user.id,
      );
      await backend.feedback({ ...request, source: "slack" }, identity);
      const blocks = body.message?.blocks as types.AnyBlock[] | undefined;
      if (blocks && action.block_id) {
        await respond({
          replace_original: true,
          text: body.message?.text ?? "研究室資料検索の結果",
          blocks: markFeedbackSubmitted(
            blocks,
            action.block_id,
            request.feedback,
          ),
        });
      } else {
        await respond({
          response_type: "ephemeral",
          text: "評価を保存しました。",
        });
      }
    } catch (error) {
      logger.error(error);
      await respond({
        response_type: "ephemeral",
        text:
          error instanceof Error
            ? error.message
            : "フィードバックの保存に失敗しました。",
      });
    }
  },
);

app.action<BlockButtonAction>(/^lab_search_open_(folder|file)_/u, async ({ ack }) => {
  await ack();
});

const port = integerEnv("PORT", 3001);
await app.start(port);
console.log(
  `[slack] ${commandName} started in ${socketMode ? "Socket Mode" : `HTTP mode on port ${port}`}`,
);
