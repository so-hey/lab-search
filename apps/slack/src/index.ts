import {
  App,
  type BlockButtonAction,
  type types,
} from "@slack/bolt";
import { booleanEnv, integerEnv, optionalEnv, requiredEnv } from "./config/env.js";
import { BackendClient, type SlackIdentity } from "./services/BackendClient.js";
import { parseDirectMessage } from "./services/directMessage.js";
import { extractMentionQuery } from "./services/mention.js";
import {
  SlackUserFacingError,
  userFacingErrorMessage,
} from "./services/userFacingError.js";
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
  if (!teamId) {
    throw new SlackUserFacingError(
      "Slack workspaceの情報を取得できませんでした。管理者へ連絡してください。",
    );
  }
  const response = await client.users.info({ user: userId });
  const email = response.user?.profile?.email;
  if (!email) {
    throw new SlackUserFacingError(
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
      text: userFacingErrorMessage(error, "search"),
    });
  }
});

app.event("app_mention", async ({ event, body, client, context, say, logger }) => {
  const threadTs = event.thread_ts ?? event.ts;
  try {
    if (!context.botUserId || !event.user) {
      throw new SlackUserFacingError(
        "SlackのBotまたはユーザー情報を取得できませんでした。管理者へ連絡してください。",
      );
    }
    const query = extractMentionQuery(event.text, context.botUserId);
    if (!query) {
      await say({
        text: "検索語を指定してください。例: @lab-search モデルマージ",
        thread_ts: threadTs,
      });
      return;
    }
    const identity = await slackIdentity(client, body.team_id, event.user);
    const response = await backend.search(query, identity, 5);
    await say({
      text: `「${query}」の検索結果 ${response.results.length}件`,
      blocks: buildSearchResultBlocks(query, response),
      thread_ts: threadTs,
    });
  } catch (error) {
    logger.error(error);
    await say({
      text: userFacingErrorMessage(error, "search"),
      thread_ts: threadTs,
    });
  }
});

app.message(async ({ message, body, client, say, logger }) => {
  const directMessage = parseDirectMessage(message);
  if (!directMessage) return;
  try {
    if (!directMessage.query) {
      await say("検索語を入力してください。例: モデルマージ");
      return;
    }
    const identity = await slackIdentity(
      client,
      body.team_id,
      directMessage.userId,
    );
    const response = await backend.search(directMessage.query, identity, 5);
    await say({
      text: `「${directMessage.query}」の検索結果 ${response.results.length}件`,
      blocks: buildSearchResultBlocks(directMessage.query, response),
    });
  } catch (error) {
    logger.error(error);
    await say(userFacingErrorMessage(error, "search"));
  }
});

app.action<BlockButtonAction>(
  /^lab_search_feedback_(positive|negative)$/u,
  async ({ ack, body, action, client, respond, logger }) => {
    await ack();
    try {
      if (!action.value) {
        throw new SlackUserFacingError(
          "評価対象の情報を取得できませんでした。検索をやり直してください。",
        );
      }
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
        text: userFacingErrorMessage(error, "feedback"),
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
