// Reads the text layer of a PDF with PDF.js. Runs in an extraction worker (extract.ts): PDF.js has no budget of its
// own, and a crafted file can make it work or allocate for a long time.

// The session module only: the worker does not load the engine and its providers.
import { MAX_CONTEXT_CHARS } from "@quorumind/core/session";
import { getDocumentProxy } from "unpdf";
import { ContextError } from "./errors.ts";

/** Pages read from a PDF: reading stops earlier once enough text is collected. */
export const MAX_PDF_PAGES = 500;

export async function pdfText(bytes: Uint8Array): Promise<{ text: string; partial: boolean }> {
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
