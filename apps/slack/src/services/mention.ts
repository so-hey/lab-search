export function extractMentionQuery(text: string, botUserId: string): string {
  const mention = `<@${botUserId}>`;
  return text.split(mention).join(" ").replace(/\s+/gu, " ").trim();
}
