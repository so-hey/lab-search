export type DocumentChunk = {
  id: string;
  documentId: string;
  documentName: string;
  chunkIndex: number;
  content: string;
  url?: string;
};

export type IndexedChunk = DocumentChunk & {
  embedding: number[];
};
