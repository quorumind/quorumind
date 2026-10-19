/** @vitest-environment happy-dom */
import "./test/dom.ts";
import i18n from "i18next";
import { describe, expect, it } from "vitest";
import { ApiError, api } from "./api.ts";
import { errorText, failureText, sessionErrorText } from "./errors.ts";
import { json, stubApi } from "./test/dom.ts";

const t = i18n.t.bind(i18n);

describe("error messages", () => {
  it("explains a known code in the person's language, and an unknown one with the generic message", () => {
    expect(errorText(t, "not_found")).toBe(t("errors.not_found"));
    expect(errorText(t, "not_a_known_code")).toBe(t("errors.generic"));
    expect(errorText(t, undefined)).toBe(t("errors.generic"));
  });

  it("tells a refusal of the server from a connection problem", () => {
    expect(failureText(t, new ApiError(409, "session_busy", "busy"))).toBe(t("errors.session_busy"));
    expect(failureText(t, new TypeError("Failed to fetch"))).toBe(t("error.request"));
  });

  it("explains a cost cap as the price's limit when the host keeps provider costs to itself", () => {
    const error = { code: "budget_exceeded", message: "", params: { capUsd: 2 } };
    expect(sessionErrorText(t, error, false, "en")).toBe(t("errors.price_limit"));
    expect(sessionErrorText(t, error, true, "en")).toBe(t("errors.budget_exceeded"));
    expect(sessionErrorText(t, { code: "non_european_model", message: "", params: { model: "gpt" } }, true, "en")).toContain("gpt");
    expect(sessionErrorText(t, null, true, "en")).toBe(t("errors.internal_error"));
  });
});

describe("API requests", () => {
  it("turns an error answer into an ApiError with its code and parameters", async () => {
    stubApi({ "DELETE /api/sessions/s1": () => json({ error: "session_busy", message: "Busy", params: { a: 1 } }, 409) });
    const caught = await api.remove("s1").catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(ApiError);
    expect(caught).toMatchObject({ status: 409, code: "session_busy", params: { a: 1 } });
  });

  it("accepts an empty answer, and an error page that is not JSON", async () => {
    stubApi({
      "DELETE /api/sessions/s1": () => new Response(null, { status: 204 }),
      "DELETE /api/sessions/s2": () => new Response("<html>Bad gateway</html>", { status: 502, statusText: "Bad Gateway" }),
    });
    await expect(api.remove("s1")).resolves.toBeUndefined();
    await expect(api.remove("s2")).rejects.toMatchObject({ status: 502, code: "error" });
  });
});
