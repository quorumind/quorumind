import { type ContextDocument, MAX_CONTEXT_DOCUMENTS, MAX_CONTEXT_FILE_BYTES } from "@quorumind/core/session";
import { ApiError } from "./api.ts";

export type { ContextDocument };

/** The server's limits (apps/server/src/context), checked here first to fail fast. */
export const CONTEXT_LIMITS = {
  documents: MAX_CONTEXT_DOCUMENTS,
  fileBytes: MAX_CONTEXT_FILE_BYTES,
  extensions: [".pdf", ".docx", ".md", ".txt"],
} as const;

type Result = { document: ContextDocument & { chars?: number } };

/** Keeps what a session stores: the character count is for display only. */
const documentOf = (result: Result): ContextDocument => {
  const { chars: _chars, ...document } = result.document;
  return document;
};

function failure(status: number, text: string): ApiError {
  let body: { error?: string; message?: string } = {};
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    // Not JSON: a proxy or a body limit in front of the server answered.
  }
  const code = body.error ?? (status === 413 ? "too_large" : status === 429 ? "too_many_imports" : "error");
  return new ApiError(status, code, body.message ?? (text || `HTTP ${status}`));
}

async function post(path: string, payload: unknown, signal?: AbortSignal): Promise<ContextDocument> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError(0, "network", "The request failed.");
  }
  const text = await response.text();
  if (!response.ok) throw failure(response.status, text);
  return documentOf(JSON.parse(text) as Result);
}

export const contextApi = {
  /** Uploads a file; `onProgress` receives the share sent, from 0 to 1. XHR because fetch cannot report upload progress. */
  uploadFile(file: File, onProgress?: (share: number) => void, signal?: AbortSignal): Promise<ContextDocument> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/context/file");
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) onProgress?.(event.loaded / event.total);
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(documentOf(JSON.parse(xhr.responseText) as Result));
          } catch {
            reject(new ApiError(xhr.status, "error", "Invalid response."));
          }
        } else {
          reject(failure(xhr.status, xhr.responseText));
        }
      };
      xhr.onerror = () => reject(new ApiError(0, "network", "The request failed."));
      xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
      signal?.addEventListener("abort", () => xhr.abort(), { once: true });
      const form = new FormData();
      form.append("file", file);
      xhr.send(form);
    });
  },
  /** A web page, a PDF on the web, or a GitHub repository (the server tells them apart). */
  addUrl: (url: string, signal?: AbortSignal) => post("/api/context/url", { url }, signal),
  addText: (name: string, text: string, signal?: AbortSignal) => post("/api/context/text", { name, text }, signal),
};
