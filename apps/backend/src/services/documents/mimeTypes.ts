export const MIME = {
  folder: "application/vnd.google-apps.folder",
  pdf: "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  googleSlides: "application/vnd.google-apps.presentation",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  googleDocs: "application/vnd.google-apps.document",
} as const;

export type SupportedMimeType =
  | typeof MIME.pdf
  | typeof MIME.pptx
  | typeof MIME.googleSlides
  | typeof MIME.docx
  | typeof MIME.googleDocs;

export function isSupportedMimeType(mimeType: string): mimeType is SupportedMimeType {
  return Object.values(MIME).some((value) => value === mimeType) && mimeType !== MIME.folder;
}

export function formatCategory(mimeType: string): string {
  switch (mimeType) {
    case MIME.pdf: return "PDF";
    case MIME.pptx: return "PPTX";
    case MIME.googleSlides: return "Google Slides";
    case MIME.docx: return "DOCX";
    case MIME.googleDocs: return "Google Docs";
    default: return "Other";
  }
}
