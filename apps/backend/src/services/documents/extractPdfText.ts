import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import { extractPdfSections } from "./extractors/PdfDocumentExtractor.js";

export async function extractPdfText(path: string): Promise<string> {
  if (extname(path).toLocaleLowerCase() !== ".pdf") {
    throw new Error(`Expected a PDF file: ${path}`);
  }

  try {
    const fileStat = await stat(path);
    if (!fileStat.isFile()) {
      throw new Error(`PDF path is not a file: ${path}`);
    }

    if (fileStat.size === 0) {
      throw new Error(`PDF file is empty: ${path}`);
    }

    const data = await readFile(path);
    const result = await extractPdfSections(new Uint8Array(data));
    return result.sections.map((section) => section.text).join("\n\n");
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes(path)) {
      throw cause;
    }

    throw new Error(`Failed to extract text from PDF: ${path}`, { cause });
  }
}
