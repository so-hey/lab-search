import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { getLocalIndexPath } from "./config/paths.js";
import { LocalDocumentRepository } from "./repositories/localDocumentRepository.js";
import { LocalEmbeddingProvider } from "./services/embedding/LocalEmbeddingProvider.js";
import { searchDocuments } from "./services/search/searchDocuments.js";

const embeddingProvider = new LocalEmbeddingProvider();
const documentRepository = new LocalDocumentRepository(getLocalIndexPath());

const app = createApp({
  search: (request) =>
    searchDocuments(request, { embeddingProvider, documentRepository }),
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
