// PDF and Word documents are read in a worker thread, one per document, with a deadline and a memory cap: a crafted
// file can make PDF.js or the XML scan work for a long time or allocate without bound, and on the main thread that
// would stall every request and every running debate. A worker past either limit is terminated.

import { Worker } from "node:worker_threads";
import { ContextError, type ContextErrorCode } from "./errors.ts";

export interface ExtractionRequest {
  type: "pdf" | "docx";
  bytes: Uint8Array;
}

export type ExtractionResult = { ok: true; text: string; partial: boolean } | { ok: false; code: ContextErrorCode; message: string };

export interface ExtractionLimits {
  /** Wall-clock time a document may take to read. */
  timeoutMs: number;
  /** The worker's heap, in MB: a 10 MB PDF of 500 pages reads in well under it. */
  memoryMb: number;
  /** Workers reading at the same time in this process; the others wait their turn. */
  concurrent: number;
}

export const EXTRACTION_LIMITS: ExtractionLimits = { timeoutMs: 30_000, memoryMb: 256, concurrent: 4 };

const WORKER = new URL("./extract-worker.ts", import.meta.url);

let running = 0;
const waiting: (() => void)[] = [];

async function inTurn<T>(concurrent: number, work: () => Promise<T>): Promise<T> {
  while (running >= concurrent) await new Promise<void>((resolve) => waiting.push(resolve));
  running++;
  try {
    return await work();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

const TOO_HEAVY = "This document is too complex to read: it takes too long or too much memory.";

/** The text of a PDF or Word document, read in a worker within the limits. */
export function extractInWorker(
  type: ExtractionRequest["type"],
  bytes: Uint8Array,
  limits: ExtractionLimits = EXTRACTION_LIMITS,
): Promise<{ text: string; partial: boolean }> {
  return inTurn(limits.concurrent, () => new Promise((resolve, reject) => read({ type, bytes }, limits, resolve, reject)));
}

/** Reads one document in a new worker, which is terminated once it answers or goes past a limit. */
function read(
  request: ExtractionRequest,
  limits: ExtractionLimits,
  resolve: (read: { text: string; partial: boolean }) => void,
  reject: (error: ContextError) => void,
) {
  const worker = new Worker(WORKER, {
    workerData: request,
    resourceLimits: { maxOldGenerationSizeMb: limits.memoryMb, maxYoungGenerationSizeMb: Math.min(64, limits.memoryMb / 4) },
  });
  let settled = false;
  const settle = (done: () => void) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    done();
    void worker.terminate();
  };
  const timer = setTimeout(() => settle(() => reject(new ContextError("too_large", TOO_HEAVY))), limits.timeoutMs);
  worker.once("message", (result: ExtractionResult) =>
    settle(() =>
      result.ok ? resolve({ text: result.text, partial: result.partial }) : reject(new ContextError(result.code, result.message)),
    ),
  );
  worker.once("error", (error: Error & { code?: string }) =>
    settle(() => {
      if (error.code === "ERR_WORKER_OUT_OF_MEMORY") return reject(new ContextError("too_large", TOO_HEAVY));
      console.error("A document could not be read:", error);
      reject(new ContextError("unsupported_type", "This document could not be read."));
    }),
  );
  worker.once("exit", () => settle(() => reject(new ContextError("unsupported_type", "This document could not be read."))));
}
