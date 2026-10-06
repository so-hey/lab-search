import type { ClientSource, FeedbackValue } from "@lab-search/shared";

export type DocumentRecord = {
  id: string;
  driveFileId: string;
  name: string;
  mimeType: string;
  parentFolderId: string | null;
  webViewLink: string | null;
  modifiedTime: string;
  isIndexed: boolean;
  embeddingProviderId: string | null;
  vectorStoreId: string | null;
  duplicateOf: string | null;
  isActive: boolean;
};

export type UpsertDocumentInput = Omit<DocumentRecord, "id">;

export interface DocumentMetadataRepository {
  listActive(): Promise<DocumentRecord[]>;
  upsert(input: UpsertDocumentInput): Promise<DocumentRecord>;
  updateIndexState(
    id: string,
    state: Pick<DocumentRecord, "isIndexed" | "duplicateOf" | "isActive">,
  ): Promise<void>;
}

export interface DocumentLocationRepository {
  getParentFolderIds(
    documentIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>>;
}

export type SearchLogInput = {
  userId: string;
  source: ClientSource;
  query: string;
  resultCount: number;
};

export interface SearchLogRepository {
  create(input: SearchLogInput): Promise<string | null>;
  isOwnedBy(searchLogId: string, userId: string): Promise<boolean>;
}

export type FeedbackInput = {
  userId: string;
  source: ClientSource;
  searchLogId: string;
  documentId: string;
  chunkId: string;
  rank: number;
  score: number;
  feedback: FeedbackValue;
};

export interface FeedbackRepository {
  create(input: FeedbackInput): Promise<string>;
}

export type AllowedUser = { email: string; role: string };

export interface AllowedUserRepository {
  findByEmail(email: string): Promise<AllowedUser | null>;
}
