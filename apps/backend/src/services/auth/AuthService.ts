import type { ClientSource } from "@lab-search/shared";

export type AuthUser = { id: string; email: string; role: string };

export type AuthenticationInput = {
  source: ClientSource;
  authorization?: string;
  slackTeamId?: string;
  slackUserId?: string;
  slackUserEmail?: string;
};

export class AuthenticationError extends Error {
  constructor(message: string, readonly status: 401 | 403) {
    super(message);
  }
}

export interface AuthService {
  authenticate(input: AuthenticationInput): Promise<AuthUser>;
}

export class DisabledAuthService implements AuthService {
  async authenticate(input: AuthenticationInput): Promise<AuthUser> {
    return {
      id:
        input.source === "slack" && input.slackUserId
          ? `slack:local:${input.slackUserId}`
          : "local-user",
      email: input.slackUserEmail ?? "local@localhost",
      role: "developer",
    };
  }
}
