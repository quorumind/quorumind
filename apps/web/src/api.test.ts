import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api.ts";

/** A response whose headers arrived but whose body ends with `failure`. */
const answered = (status: number, failure: unknown) =>
  vi.fn(async () => ({ ok: status < 400, status, statusText: "", json: () => Promise.reject(failure) }));

describe("request", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fails with the timeout when the body stops arriving, instead of reading as empty", async () => {
    vi.stubGlobal("fetch", answered(200, new DOMException("The operation timed out.", "TimeoutError")));
    await expect(api.config()).rejects.toMatchObject({ status: 0, code: "timeout" });
  });

  it("keeps a cancel a cancel while the body arrives", async () => {
    vi.stubGlobal("fetch", answered(200, new DOMException("Aborted.", "AbortError")));
    await expect(api.config()).rejects.toMatchObject({ name: "AbortError" });
  });

  it("reads a body that is not JSON as empty, so the status says what failed", async () => {
    vi.stubGlobal("fetch", answered(502, new SyntaxError("Unexpected token <")));
    await expect(api.config()).rejects.toMatchObject({ status: 502, code: "error" });
  });
});
