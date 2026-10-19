// The entry point of an extraction worker (extract.ts): reads one PDF or Word document and posts its text back.

import { parentPort, workerData } from "node:worker_threads";
import { docxText } from "./docx.ts";
import { ContextError } from "./errors.ts";
import type { ExtractionRequest, ExtractionResult } from "./extract.ts";

async function run({ type, bytes }: ExtractionRequest): Promise<ExtractionResult> {
  try {
    // PDF.js is loaded for PDFs only.
    if (type === "pdf") return { ok: true, ...(await (await import("./pdf.ts")).pdfText(bytes)) };
    return { ok: true, text: docxText(bytes), partial: false };
  } catch (error) {
    if (error instanceof ContextError) return { ok: false, code: error.code, message: error.message };
    throw error;
  }
}

parentPort?.postMessage(await run(workerData as ExtractionRequest));
