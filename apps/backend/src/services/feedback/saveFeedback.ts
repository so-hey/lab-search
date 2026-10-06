import type { FeedbackRequest, FeedbackResponse } from "@lab-search/shared";
import type {
  FeedbackRepository,
  SearchLogRepository,
} from "../../repositories/metadata/types.js";

export type SaveFeedbackDependencies = {
  feedbackRepository: FeedbackRepository;
  searchLogRepository: SearchLogRepository;
};

export class FeedbackAuthorizationError extends Error {}

export async function saveFeedback(
  request: FeedbackRequest,
  userId: string,
  dependencies: SaveFeedbackDependencies,
): Promise<FeedbackResponse> {
  if (
    !(await dependencies.searchLogRepository.isOwnedBy(
      request.searchLogId,
      userId,
    ))
  ) {
    throw new FeedbackAuthorizationError(
      "指定された検索ログを利用できません。",
    );
  }
  const feedbackId = await dependencies.feedbackRepository.create({
    userId,
    ...request,
  });
  return { feedbackId };
}
