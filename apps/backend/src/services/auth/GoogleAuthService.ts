import { OAuth2Client } from "google-auth-library";
import type { AllowedUserRepository } from "../../repositories/metadata/types.js";
import {
  AuthenticationError,
  type AuthService,
  type AuthUser,
} from "./AuthService.js";

export class GoogleAuthService implements AuthService {
  private readonly client = new OAuth2Client();

  constructor(
    private readonly clientId: string,
    private readonly allowedUsers: AllowedUserRepository,
  ) {}

  async authenticate(authorization: string | undefined): Promise<AuthUser> {
    const match = authorization?.match(/^Bearer\s+(.+)$/iu);
    if (!match)
      throw new AuthenticationError("Googleへのログインが必要です。", 401);
    let payload;
    try {
      const ticket = await this.client.verifyIdToken({
        idToken: match[1],
        audience: this.clientId,
      });
      payload = ticket.getPayload();
    } catch {
      throw new AuthenticationError(
        "ログイントークンが無効または期限切れです。",
        401,
      );
    }
    if (!payload?.sub || !payload.email || payload.email_verified !== true) {
      throw new AuthenticationError(
        "確認済みメールアドレスを取得できません。",
        401,
      );
    }
    const allowed = await this.allowedUsers.findByEmail(payload.email);
    if (!allowed)
      throw new AuthenticationError(
        "このアカウントには利用権限がありません。",
        403,
      );
    return { id: payload.sub, email: allowed.email, role: allowed.role };
  }
}
