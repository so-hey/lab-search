import { createHash, timingSafeEqual } from "node:crypto";
import type { AllowedUserRepository } from "../../repositories/metadata/types.js";
import {
  AuthenticationError,
  type AuthenticationInput,
  type AuthService,
  type AuthUser,
} from "./AuthService.js";

function tokenDigest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export class SlackServiceAuthService implements AuthService {
  private readonly serviceTokenDigest: Buffer;

  constructor(
    serviceToken: string,
    private readonly allowedTeamId: string,
    private readonly allowedUsers: AllowedUserRepository,
  ) {
    if (serviceToken.length < 32) {
      throw new Error("SLACK_BACKEND_SERVICE_TOKEN must be at least 32 characters.");
    }
    if (!allowedTeamId.trim()) {
      throw new Error("SLACK_ALLOWED_TEAM_ID must not be empty.");
    }
    this.serviceTokenDigest = tokenDigest(serviceToken);
  }

  async authenticate(input: AuthenticationInput): Promise<AuthUser> {
    if (input.source !== "slack") {
      throw new AuthenticationError("Googleへのログインが必要です。", 401);
    }

    const match = input.authorization?.match(/^Bearer\s+(.+)$/iu);
    if (
      !match ||
      !timingSafeEqual(this.serviceTokenDigest, tokenDigest(match[1]))
    ) {
      throw new AuthenticationError("Slack Botの認証情報が無効です。", 401);
    }
    if (input.slackTeamId !== this.allowedTeamId) {
      throw new AuthenticationError(
        "このSlack workspaceからは利用できません。",
        403,
      );
    }
    if (!input.slackUserId?.trim() || !input.slackUserEmail?.trim()) {
      throw new AuthenticationError(
        "Slackユーザーの識別情報を取得できません。",
        401,
      );
    }

    const email = input.slackUserEmail.trim().toLocaleLowerCase();
    const allowed = await this.allowedUsers.findByEmail(email);
    if (!allowed) {
      throw new AuthenticationError(
        "このSlackアカウントには利用権限がありません。",
        403,
      );
    }
    return {
      id: `slack:${input.slackTeamId}:${input.slackUserId.trim()}`,
      email: allowed.email,
      role: allowed.role,
    };
  }
}
