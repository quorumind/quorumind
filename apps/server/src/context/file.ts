import { MAX_CONTEXT_FILE_BYTES } from "@quorumind/core";
import { isCompoundFile } from "./docx.ts";
import { ContextError } from "./errors.ts";
import { extractInWorker } from "./extract.ts";
import { type ImportedDocument, makeDocument } from "./text.ts";

export const MAX_FILE_BYTES = MAX_CONTEXT_FILE_BYTES;
export { MAX_PDF_PAGES } from "./pdf.ts";

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
    const { text, partial } = await extractInWorker("pdf", bytes);
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
  const raw = type === "docx" ? (await extractInWorker("docx", bytes)).text : decodeText(bytes);
  return makeDocument({ kind: "file", name, raw, source, fallbackName: "File", emptyMessage: "This file contains no text." });
}

const startsWith = (bytes: Uint8Array, signature: number[]) => signature.every((byte, i) => bytes[i] === byte);

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
