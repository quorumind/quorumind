import "../i18n.ts";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// What every component test of the interface shares: the English interface, and a clean page and clean mocks after
// each test. A test file asks for the DOM with a `@vitest-environment happy-dom` comment and imports this file first.

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.location.hash = "";
});

/** A JSON response of the API. */
export function json(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** An error of the API, with its stable code. */
export function failure(status: number, code: string): Response {
  return json({ error: code, message: code }, status);
}

/**
 * Answers the API's requests from a table of handlers, by method and path ("GET /api/sessions/s1"); a request
 * nobody answers fails the test.
 */
export function stubApi(routes: Record<string, (request: { body: unknown; url: URL }) => Response | Promise<Response>>) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: url.pathname, body });
    const handler = routes[`${method} ${url.pathname}`];
    if (!handler) throw new Error(`Unexpected request: ${method} ${url.pathname}`);
    return handler({ body, url });
  });
  vi.stubGlobal("fetch", fetch);
  return { fetch, calls };
}
