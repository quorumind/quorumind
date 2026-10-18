import { MAX_CONTEXT_CHARS, MAX_CONTEXT_FILE_BYTES } from "@quorumind/core";
import { getDocumentProxy } from "unpdf";
import { docxText, isCompoundFile } from "./docx.ts";
import { ContextError } from "./errors.ts";
import { type ImportedDocument, makeDocument } from "./text.ts";

export const MAX_FILE_BYTES = MAX_CONTEXT_FILE_BYTES;
/** Pages read from a PDF: reading stops earlier once enough text is collected. */
export const MAX_PDF_PAGES = 500;

type FileType = "pdf" | "docx" | "text";

/** What the interface offers; a few other plain text formats are accepted as well. */
export const FILE_EXTENSIONS = [".pdf", ".docx", ".md", ".txt"] as const;

const EXTENSIONS: Record<string, FileType> = {
  pdf: "pdf",
  docx: "docx",
  md: "text",
  markdown: "text",
  txt: "text",
  text: "text",
  csv: "text",
  json: "text",
};

const MIME_TYPES: Record<string, FileType> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/markdown": "text",
  "text/x-markdown": "text",
  "text/plain": "text",
  "text/csv": "text",
  "application/json": "text",
};

const TOO_LARGE = "The file is larger than 10 MB.";

function detectType(name: string, mime: string): FileType {
  const extension = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  const type = extension ? EXTENSIONS[extension] : MIME_TYPES[mime.split(";")[0]?.trim().toLowerCase() ?? ""];
  if (type) return type;
  if (extension === "doc") throw new ContextError("unsupported_type", "Old Word files (.doc) are not supported. Save the file as .docx.");
  throw new ContextError("unsupported_type", "Only PDF, Word (.docx), Markdown and plain text files are supported.");
}

/** Extracts the text of an uploaded specification. `source` says where it came from when it is not the file name. */
export async function extractFile(name: string, mime: string, bytes: Uint8Array, source = name): Promise<ImportedDocument> {
  if (bytes.byteLength > MAX_FILE_BYTES) throw new ContextError("too_large", TOO_LARGE);
  const type = detectType(name, mime);
  if (type === "pdf") {
    const { text, partial } = await pdfText(bytes);
    return makeDocument({
      kind: "file",
      name,
      raw: text,
      source,
      partial,
      fallbackName: "File",
      emptyCode: "scanned",
      emptyMessage: "This PDF has no text layer: it is probably a scan. Run text recognition (OCR) on it first.",
    });
  }
  const raw = type === "docx" ? docxText(bytes) : decodeText(bytes);
  return makeDocument({ kind: "file", name, raw, source, fallbackName: "File", emptyMessage: "This file contains no text." });
}

const startsWith = (bytes: Uint8Array, signature: number[]) => signature.every((byte, i) => bytes[i] === byte);

async function pdfText(bytes: Uint8Array): Promise<{ text: string; partial: boolean }> {
  // The signature may follow a few bytes of junk, which readers tolerate.
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  if (!head.includes("%PDF-")) throw new ContextError("unsupported_type", "This file is not a valid PDF.");
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    // PDF.js may take ownership of the buffer: hand it a copy. Only text is read: no font is loaded, no image decoded.
    pdf = await getDocumentProxy(new Uint8Array(bytes), { stopAtErrors: false, disableFontFace: true });
  } catch (error) {
    if (error instanceof Error && error.name === "PasswordException") {
      throw new ContextError("encrypted", "This PDF is protected by a password. Remove the protection and try again.");
    }
    throw new ContextError("unsupported_type", "This PDF could not be read.");
  }
  try {
    const pages: string[] = [];
    let length = 0;
    const last = Math.min(pdf.numPages, MAX_PDF_PAGES);
    for (let number = 1; number <= last && length <= MAX_CONTEXT_CHARS; number++) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      const text = content.items.map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : "") : "")).join("");
      page.cleanup();
      pages.push(text);
      length += text.length;
    }
    const partial = pages.length < pdf.numPages;
    if (partial && length <= MAX_CONTEXT_CHARS) pages.push(`[…only the first ${last} of ${pdf.numPages} pages were read]`);
    return { text: pages.join("\n\n"), partial };
  } finally {
    await pdf.loadingTask.destroy();
  }
}

/** Decodes a text file: UTF-8 (or UTF-16 with a byte order mark), else Windows-1252 as legacy editors write it. */
export function decodeText(bytes: Uint8Array): string {
  if (startsWith(bytes, [0xff, 0xfe])) return new TextDecoder("utf-16le").decode(bytes);
  if (startsWith(bytes, [0xfe, 0xff])) return new TextDecoder("utf-16be").decode(bytes);
  if (isCompoundFile(bytes) || bytes.subarray(0, 8_192).includes(0)) {
    throw new ContextError("unsupported_type", "This file is not a text file.");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}
