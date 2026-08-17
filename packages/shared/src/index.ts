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
  content: string;
  score: number;
  url?: string;
};

export type SearchResponse = {
  results: SearchResult[];
};

export type SearchErrorResponse = {
  error: string;
};
