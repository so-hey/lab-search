import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import { PDFParse } from "pdf-parse";

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
    const parser = new PDFParse({ data: new Uint8Array(data) });

    try {
      const result = await parser.getText();
      const text = result.text
        .normalize("NFKC")
        .replace(/\r\n?/g, "\n")
        .trim();

      if (!text) {
        throw new Error(`No text could be extracted from PDF: ${path}`);
      }

      return text;
    } finally {
      await parser.destroy();
    }
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes(path)) {
      throw cause;
    }

    throw new Error(`Failed to extract text from PDF: ${path}`, { cause });
  }
}
