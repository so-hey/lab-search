import type { FeedbackRepository, SearchLogRepository } from "./types.js";

export class NullSearchLogRepository implements SearchLogRepository {
  async create(): Promise<null> {
    return null;
  }

  async isOwnedBy(): Promise<boolean> {
    return false;
  }
}

export class UnavailableFeedbackRepository implements FeedbackRepository {
  async create(): Promise<string> {
    throw new Error("Feedback storage is not configured.");
  }
}
