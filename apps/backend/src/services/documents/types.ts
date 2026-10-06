export type DocumentChunk = {
  id: string;
  documentId: string;
  sourceModifiedTime?: string;
  driveFileId?: string;
  documentName: string;
  mimeType?: string;
  chunkIndex: number;
  content: string;
  page?: number;
  slide?: number;
  sectionTitle?: string;
  url?: string;
};

export type IndexedChunk = DocumentChunk & {
  embedding: number[];
};
