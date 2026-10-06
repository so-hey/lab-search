export type AuthUser = { id: string; email: string; role: string };

export class AuthenticationError extends Error {
  constructor(message: string, readonly status: 401 | 403) {
    super(message);
  }
}

export interface AuthService {
  authenticate(authorization: string | undefined): Promise<AuthUser>;
}

export class DisabledAuthService implements AuthService {
  async authenticate(): Promise<AuthUser> {
    return { id: "local-user", email: "local@localhost", role: "developer" };
  }
}
