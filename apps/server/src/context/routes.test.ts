import { MAX_CONTEXT_CHARS, MAX_CONTEXT_DOCUMENTS, type Session } from "@quorumind/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BODY_LIMITS, createApp } from "../app.ts";
import { EventBus } from "../bus.ts";
import { SqliteSessionStore } from "../store.ts";
import { ImportLimiter } from "./limit.ts";
import { contextRoutes } from "./routes.ts";

let store: SqliteSessionStore | null = null;
afterEach(async () => {
  await store?.close();
  store = null;
});

function makeApp() {
  store = new SqliteSessionStore(":memory:");
  return createApp({ store, bus: new EventBus(), env: {}, mockDelayMs: 0 });
}

const encode = (text: string) => new TextEncoder().encode(text);
const upload = (name: string, bytes: Uint8Array, type = "") => {
  const form = new FormData();
  form.append("file", new File([bytes as Uint8Array<ArrayBuffer>], name, { type }));
  return { method: "POST", body: form };
};
const json = (body: unknown) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

interface Imported {
  document: { id: string; kind: string; name: string; text: string; source?: string; chars: number; truncated: boolean };
}

describe("context import routes", () => {
  it("turns an uploaded file larger than the general body limit into a document", async () => {
    const app = makeApp();
    const text = `# Cahier des charges\n\n${"detail ".repeat(100_000)}`;
    expect(text.length).toBeGreaterThan(BODY_LIMITS.api);
    const response = await app.request("/api/context/file", upload("cahier des charges.md", encode(text)));
    expect(response.status).toBe(200);
    const { document } = (await response.json()) as Imported;
    expect(document).toMatchObject({ kind: "file", name: "cahier des charges.md", source: "cahier des charges.md", truncated: true });
    expect(document.chars).toBe(document.text.length);
    expect(document.chars).toBeLessThanOrEqual(MAX_CONTEXT_CHARS);
  });

  it("answers errors as JSON with a stable code", async () => {
    const app = makeApp();
    const unsupported = await app.request("/api/context/file", upload("tool.exe", encode("MZ")));
    expect(unsupported.status).toBe(400);
    expect(await unsupported.json()).toMatchObject({ error: "unsupported_type" });
    const missing = await app.request("/api/context/file", { method: "POST", body: new FormData() });
    expect(missing.status).toBe(400);
    const tooLarge = await app.request("/api/context/file", upload("huge.txt", new Uint8Array(10 * 1024 * 1024 + 1)));
    expect(tooLarge.status).toBe(413);
    expect(await tooLarge.json()).toMatchObject({ error: "too_large" });
    const blocked = await app.request("/api/context/url", json({ url: "http://169.254.169.254/latest/meta-data/" }));
    expect(blocked.status).toBe(400);
    expect(await blocked.json()).toMatchObject({ error: "blocked_address" });
    const empty = await app.request("/api/context/text", json({ name: "Notes", text: "   " }));
    expect(empty.status).toBe(422);
    expect(await empty.json()).toMatchObject({ error: "empty" });
    expect((await app.request("/api/context/url", json({}))).status).toBe(400);
  });

  it("turns pasted text into a document", async () => {
    const app = makeApp();
    const response = await app.request("/api/context/text", json({ name: "  Meeting notes ", text: "Budget: 10k\n\n\n\nDeadline: June" }));
    expect(await response.json()).toMatchObject({
      document: { kind: "text", name: "Meeting notes", text: "Budget: 10k\n\nDeadline: June", truncated: false, chars: 27 },
    });
  });

  it("sends GitHub addresses to the GitHub importer", async () => {
    const githubFetch = vi.fn(async () => new Response("", { status: 404 }));
    const app = contextRoutes({ env: {}, githubFetch });
    const response = await app.request("/api/context/url", json({ url: "https://github.com/acme/missing" }));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: "not_found" });
    expect(githubFetch).toHaveBeenCalledWith("https://api.github.com/repos/acme/missing", expect.anything());
  });

  it("uses the server's GitHub token for public repositories only, unless private access is enabled", async () => {
    const githubFetch = vi.fn(async (input: string | URL | Request) =>
      String(input) === "https://api.github.com/repos/acme/secret"
        ? new Response(
            JSON.stringify({ full_name: "acme/secret", html_url: "https://github.com/acme/secret", default_branch: "main", private: true }),
          )
        : new Response("", { status: 404 }),
    );
    const url = json({ url: "https://github.com/acme/secret" });
    const shared = contextRoutes({ env: { GITHUB_TOKEN: "server-token" }, githubFetch });
    const refused = await shared.request("/api/context/url", url);
    expect(refused.status).toBe(422);
    expect(await refused.json()).toMatchObject({ error: "not_found" });
    const single = contextRoutes({ env: { GITHUB_TOKEN: "server-token", GITHUB_TOKEN_PRIVATE: "1" }, githubFetch });
    const imported = await single.request("/api/context/url", url);
    expect(imported.status).toBe(200);
    expect(await imported.json()).toMatchObject({ document: { kind: "github", name: "acme/secret" } });
  });

  it("throttles each caller", async () => {
    let now = 0;
    const limiter = new ImportLimiter({ perWindow: 2, windowMs: 60_000, concurrent: 2 }, () => now);
    const app = contextRoutes({ env: {}, limiter });
    const paste = () => app.request("/api/context/text", json({ text: "Budget: 10k" }));
    expect((await paste()).status).toBe(200);
    expect((await paste()).status).toBe(200);
    const refused = await paste();
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ error: "too_many_imports" });
    now += 60_000;
    expect((await paste()).status).toBe(200);
  });

  it("limits the imports one caller runs at the same time", async () => {
    const limiter = new ImportLimiter({ perWindow: 10, windowMs: 60_000, concurrent: 1 });
    let release = () => {};
    const slow = limiter.run("someone", () => new Promise<string>((resolve) => (release = () => resolve("done"))));
    await expect(limiter.run("someone", async () => "second")).rejects.toMatchObject({ code: "too_many_imports" });
    expect(await limiter.run("someone else", async () => "other")).toBe("other");
    release();
    expect(await slow).toBe("done");
    expect(await limiter.run("someone", async () => "third")).toBe("third");
  });
});

describe("session limits", () => {
  const document = (index: number, chars = MAX_CONTEXT_CHARS) => ({
    id: String(index),
    kind: "file",
    name: `spec-${index}.pdf`,
    // Three bytes per character in UTF-8, as in Chinese or Japanese.
    text: "漢".repeat(chars),
    source: `spec-${index}.pdf`,
    truncated: true,
  });

  it("accepts the largest context the interface can attach", async () => {
    const app = makeApp();
    const context = Array.from({ length: MAX_CONTEXT_DOCUMENTS }, (_, i) => document(i));
    const bytes = new TextEncoder().encode(JSON.stringify({ locale: "en", demo: true, context })).byteLength;
    expect(bytes).toBeGreaterThan(BODY_LIMITS.api);
    expect(bytes).toBeLessThan(BODY_LIMITS.session);
    const response = await app.request("/api/sessions", json({ locale: "en", demo: true, context }));
    expect(response.status).toBe(201);
    const { session } = (await response.json()) as { session: Session };
    expect(session.context).toHaveLength(MAX_CONTEXT_DOCUMENTS);
    expect(session.context[0]).toMatchObject({ source: "spec-0.pdf", truncated: true });
  });

  it("refuses more documents, longer ones, and oversized bodies elsewhere", async () => {
    const app = makeApp();
    const tooMany = Array.from({ length: MAX_CONTEXT_DOCUMENTS + 1 }, (_, i) => document(i, 10));
    expect((await app.request("/api/sessions", json({ locale: "en", demo: true, context: tooMany }))).status).toBe(400);
    const tooLong = [document(0, MAX_CONTEXT_CHARS + 1)];
    expect((await app.request("/api/sessions", json({ locale: "en", demo: true, context: tooLong }))).status).toBe(400);
    const other = await app.request("/api/estimate", json({ padding: "x".repeat(BODY_LIMITS.api) }));
    expect(other.status).toBe(413);
    expect(await other.json()).toMatchObject({ error: "too_large" });
  });

  it("keeps the source of the documents out of shared links", async () => {
    const app = makeApp();
    const created = await app.request("/api/sessions", json({ locale: "en", demo: true, context: [document(0, 10)] }));
    const { session } = (await created.json()) as { session: Session };
    const shared = await app.request(`/api/sessions/${session.id}/share`, json({ public: false, mode: "full" }));
    const { share } = (await shared.json()) as { share: { token: string } };
    const view = (await (await app.request(`/api/shared/${share.token}`)).json()) as { session: Session };
    expect(view.session.context[0]).toMatchObject({ name: "spec-0.pdf", text: "" });
    expect(view.session.context[0]?.source).toBeUndefined();
  });
});
