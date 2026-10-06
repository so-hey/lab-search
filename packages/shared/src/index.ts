export type ClientSource = "web" | "slack";

export type SearchRequest = {
  query: string;
  limit?: number;
  source: ClientSource;
};

export type SearchResult = {
  chunkId: string;
  documentId: string;
  documentName: string;
  mimeType?: string;
  content: string;
  score: number;
  scoreType?: "cosine" | "rrf" | "reranker";
  retrievalScore?: number;
  page?: number;
  slide?: number;
  sectionTitle?: string;
  url?: string;
  folderUrl?: string;
  relatedChunks?: RelatedSearchChunk[];
};

export type RelatedSearchChunk = {
  chunkId: string;
  content: string;
  score: number;
  page?: number;
  slide?: number;
  sectionTitle?: string;
};

export type SearchResponse = {
  searchLogId: string | null;
  results: SearchResult[];
};

export type FeedbackValue = "positive" | "negative";

export type FeedbackRequest = {
  searchLogId: string;
  documentId: string;
  chunkId: string;
  rank: number;
  score: number;
  feedback: FeedbackValue;
  source: ClientSource;
};

export type FeedbackResponse = {
  feedbackId: string;
};

export type SearchErrorResponse = {
  error: string;
};
