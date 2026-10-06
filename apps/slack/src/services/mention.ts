export function extractMentionQuery(text: string, botUserId: string): string {
  const mentionPattern = /<@([A-Z0-9]+)(?:\|[^>]+)?>/giu;
  let removedBotMention = false;
  const withoutBotMention = text.replace(
    mentionPattern,
    (mention, mentionedUserId: string) => {
      if (mentionedUserId.toUpperCase() !== botUserId.toUpperCase()) {
        return mention;
      }
      removedBotMention = true;
      return " ";
    },
  );
  // app_mentionイベントではBotへのメンションが必ず含まれる。Boltの
  // botUserIdと本文中のIDが一致しない場合も、通常の先頭メンションを除く。
  const normalized = removedBotMention
    ? withoutBotMention
    : withoutBotMention.replace(/^\s*<@[A-Z0-9]+(?:\|[^>]+)?>\s*/iu, " ");
  return normalized.replace(/\s+/gu, " ").trim();
}
