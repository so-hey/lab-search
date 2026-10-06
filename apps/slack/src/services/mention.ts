export function extractMentionQuery(
  text: string,
  botUserId?: string,
): string {
  const mentionPattern = /<@([A-Z0-9]+)(?:\|[^>]+)?>/giu;
  let removedBotMention = false;
  const normalizedBotUserId = botUserId?.trim().toUpperCase();
  const withoutBotMention = text.replace(
    mentionPattern,
    (mention, mentionedUserId: string) => {
      if (
        !normalizedBotUserId ||
        mentionedUserId.toUpperCase() !== normalizedBotUserId
      ) {
        return mention;
      }
      removedBotMention = true;
      return " ";
    },
  );
  // app_mention以外にDMのmessageイベントとして届く場合もある。Boltの
  // botUserIdがない、または本文中のIDと一致しない場合も先頭メンションを除く。
  const normalized = removedBotMention
    ? withoutBotMention
    : withoutBotMention.replace(/^\s*<@[A-Z0-9]+(?:\|[^>]+)?>\s*/iu, " ");
  return normalized.replace(/\s+/gu, " ").trim();
}
