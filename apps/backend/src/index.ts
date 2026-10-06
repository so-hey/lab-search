import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { enumEnv, integerEnv, optionalEnv, requiredEnv } from "./config/env.js";
import { isWritableDocumentRepository } from "./repositories/DocumentRepository.js";
import { createDocumentRepository } from "./repositories/createDocumentRepository.js";
import { NullSearchLogRepository, UnavailableFeedbackRepository } from "./repositories/metadata/NullRepositories.js";
import type {
  DocumentLocationRepository,
  FeedbackRepository,
  SearchLogRepository,
} from "./repositories/metadata/types.js";
import { DisabledAuthService, type AuthService } from "./services/auth/AuthService.js";
import { GoogleAuthService } from "./services/auth/GoogleAuthService.js";
import { createEmbeddingProvider } from "./services/embedding/createEmbeddingProvider.js";
import { saveFeedback } from "./services/feedback/saveFeedback.js";
import { createReranker } from "./services/reranking/createReranker.js";
import { searchDocuments } from "./services/search/searchDocuments.js";

const embeddingProvider = createEmbeddingProvider();
const documentRepository = createDocumentRepository(embeddingProvider);
const reranker = createReranker();
const retrievalMode = enumEnv(
  "SEARCH_STRATEGY",
  ["dense", "hybrid"] as const,
  "dense",
);
if (isWritableDocumentRepository(documentRepository)) {
  await documentRepository.ensureCollection();
}

let searchLogRepository: SearchLogRepository = new NullSearchLogRepository();
let feedbackRepository: FeedbackRepository = new UnavailableFeedbackRepository();
let documentLocationRepository: DocumentLocationRepository | undefined;
let authService: AuthService = new DisabledAuthService();
const hasSupabase = Boolean(
  optionalEnv("SUPABASE_URL") &&
    (optionalEnv("SUPABASE_SECRET_KEY") || optionalEnv("SUPABASE_SERVICE_ROLE_KEY")),
);
if (
  enumEnv("SEARCH_MODE", ["local", "qdrant", "zilliz"] as const, "local") !== "local" &&
  !hasSupabase
) {
  throw new Error("Remote search mode requires Supabase so search logs and feedback can be stored.");
}
if (hasSupabase) {
  const [{ createSupabaseAdminClient }, repositories] = await Promise.all([
    import("./repositories/supabase/client.js"),
    import("./repositories/supabase/SupabaseRepositories.js"),
  ]);
  const supabase = createSupabaseAdminClient();
  searchLogRepository = new repositories.SupabaseSearchLogRepository(supabase);
  feedbackRepository = new repositories.SupabaseFeedbackRepository(supabase);
  documentLocationRepository =
    new repositories.SupabaseDocumentLocationRepository(supabase);
  if (enumEnv("AUTH_MODE", ["disabled", "google"] as const, "disabled") === "google") {
    authService = new GoogleAuthService(
      requiredEnv("GOOGLE_CLIENT_ID"),
      new repositories.SupabaseAllowedUserRepository(supabase),
    );
  }
} else if (enumEnv("AUTH_MODE", ["disabled", "google"] as const, "disabled") === "google") {
  throw new Error("Google authentication requires Supabase for allowed_users.");
}

const app = createApp({
  authenticate: (authorization) => authService.authenticate(authorization),
  search: (request, user) =>
    searchDocuments(
      request,
      {
        embeddingProvider,
        documentRepository,
        searchLogRepository,
        ...(documentLocationRepository ? { documentLocationRepository } : {}),
        retrievalMode,
        ...(reranker
          ? {
              reranker,
              rerankCandidateDocuments: integerEnv(
                "RERANK_CANDIDATE_DOCUMENTS",
                20,
              ),
            }
          : {}),
      },
      user.id,
    ),
  feedback: (request, user) =>
    saveFeedback(request, user.id, { feedbackRepository, searchLogRepository }),
});

const configuredPort = Number(process.env.PORT ?? 8787);
if (!Number.isInteger(configuredPort) || configuredPort < 1) {
  throw new Error("PORT must be a positive integer.");
}

serve(
  {
    fetch: app.fetch,
    port: configuredPort,
  },
  ({ port }) => {
    console.log(`[backend] listening on port ${port}`);
  },
);

export default app;
