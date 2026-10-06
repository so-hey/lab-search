import type {
  FeedbackRequest,
  FeedbackResponse,
  SearchErrorResponse,
  SearchRequest,
  SearchResponse,
} from "@lab-search/shared";

export type SlackIdentity = {
  teamId: string;
  userId: string;
  email: string;
};

type Fetch = typeof fetch;

function errorMessage(payload: unknown, status: number): string {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof (payload as SearchErrorResponse).error === "string"
  ) {
    return (payload as SearchErrorResponse).error;
  }
  return `Backend request failed (${status}).`;
}

async function responseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Backend returned invalid JSON (${response.status}).`);
  }
}

export class BackendClient {
  private readonly backendUrl: string;

  constructor(
    backendUrl: string,
    private readonly serviceToken: string,
    private readonly request: Fetch = fetch,
  ) {
    this.backendUrl = backendUrl.replace(/\/$/u, "");
    if (!this.backendUrl) throw new Error("BACKEND_URL must not be empty.");
    if (serviceToken.length < 32) {
      throw new Error("SLACK_BACKEND_SERVICE_TOKEN must be at least 32 characters.");
    }
  }

  private headers(identity: SlackIdentity): HeadersInit {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.serviceToken}`,
      "X-Slack-Team-Id": identity.teamId,
      "X-Slack-User-Id": identity.userId,
      "X-Slack-User-Email": identity.email,
    };
  }

  async search(
    query: string,
    identity: SlackIdentity,
    limit = 5,
  ): Promise<SearchResponse> {
    const body: SearchRequest = { query, limit, source: "slack" };
    const response = await this.request(`${this.backendUrl}/api/search`, {
      method: "POST",
      headers: this.headers(identity),
      body: JSON.stringify(body),
    });
    const payload = await responseJson(response);
    if (!response.ok) throw new Error(errorMessage(payload, response.status));
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("results" in payload) ||
      !Array.isArray((payload as Partial<SearchResponse>).results)
    ) {
      throw new Error("Backend returned an invalid search response.");
    }
    return payload as SearchResponse;
  }

  async feedback(
    request: FeedbackRequest,
    identity: SlackIdentity,
  ): Promise<FeedbackResponse> {
    const response = await this.request(`${this.backendUrl}/api/feedback`, {
      method: "POST",
      headers: this.headers(identity),
      body: JSON.stringify({ ...request, source: "slack" }),
    });
    const payload = await responseJson(response);
    if (!response.ok) throw new Error(errorMessage(payload, response.status));
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("feedbackId" in payload) ||
      typeof (payload as Partial<FeedbackResponse>).feedbackId !== "string"
    ) {
      throw new Error("Backend returned an invalid feedback response.");
    }
    return payload as FeedbackResponse;
  }
}
