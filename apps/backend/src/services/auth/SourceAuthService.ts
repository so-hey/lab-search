import type {
  AuthenticationInput,
  AuthService,
  AuthUser,
} from "./AuthService.js";

export class SourceAuthService implements AuthService {
  constructor(
    private readonly webAuthService: AuthService,
    private readonly slackAuthService?: AuthService,
  ) {}

  authenticate(input: AuthenticationInput): Promise<AuthUser> {
    if (input.source === "slack" && this.slackAuthService) {
      return this.slackAuthService.authenticate(input);
    }
    return this.webAuthService.authenticate(input);
  }
}
