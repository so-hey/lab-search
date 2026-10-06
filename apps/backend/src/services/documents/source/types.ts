export type SourceFile = {
  id: string;
  name: string;
  mimeType: string;
  parentIds: string[];
  modifiedTime: string;
  capabilities?: {
    canDownload?: boolean;
  };
  driveId?: string;
  webViewLink?: string;
  size?: number;
};

export type SourceFileContent = {
  file: SourceFile;
  data: Uint8Array;
  contentMimeType: string;
};

export interface DocumentSource {
  listDocuments(): Promise<SourceFile[]>;
  getDocument(file: SourceFile): Promise<SourceFileContent>;
}
