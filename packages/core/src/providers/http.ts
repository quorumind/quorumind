// Helpers shared by the providers that talk to their API with plain `fetch`.

export type FetchLike = typeof globalThis.fetch;

/** Yields the body line by line as it streams in, without the line terminators. */
export async function* readLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      yield buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
  }
  buffer += decoder.decode();
  if (buffer) yield buffer.replace(/\r$/, "");
}

/** Reads an error response body, preferring the API's own message. */
export async function errorMessage(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  try {
    const json = JSON.parse(text) as { error?: string | { message?: string } };
    const message = typeof json.error === "string" ? json.error : json.error?.message;
    if (message) return message;
  } catch {
    // Not JSON: fall back to the raw text.
  }
  return text.trim().slice(0, 500) || response.statusText || `HTTP ${response.status}`;
}

export function isAbort(error: unknown, signal: AbortSignal | undefined): boolean {
  return Boolean(signal?.aborted) || (error instanceof Error && error.name === "AbortError");
}
