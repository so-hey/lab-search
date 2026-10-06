export type DirectMessageQuery = {
  userId: string;
  query: string;
};

export function parseDirectMessage(message: unknown): DirectMessageQuery | null {
  if (typeof message !== "object" || message === null || Array.isArray(message)) {
    return null;
  }
  const value = message as Record<string, unknown>;
  if (
    value.channel_type !== "im" ||
    value.subtype !== undefined ||
    typeof value.user !== "string" ||
    !value.user ||
    typeof value.text !== "string" ||
    typeof value.bot_id === "string"
  ) {
    return null;
  }
  return { userId: value.user, query: value.text.trim() };
}
