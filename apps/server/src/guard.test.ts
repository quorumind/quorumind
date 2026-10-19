import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { EventBus } from "./bus.ts";
import { allowedHosts, securityHeaders } from "./guard.ts";
import { SqliteSessionStore } from "./store.ts";

let store: SqliteSessionStore | null = null;

function makeApp(env: Record<string, string> = {}, publicUrl: string | null = null, signedIn = false) {
  store = new SqliteSessionStore(":memory:");
  return createApp({
    store,
    bus: new EventBus(),
    env,
    mockDelayMs: 0,
    publicUrl,
    ...(signedIn ? { hooks: { identify: async () => ({ userId: "ada" }) } } : {}),
  });
}

afterEach(async () => {
  await store?.close();
  store = null;
});

const demo = JSON.stringify({ locale: "en", demo: true });
const post = (headers: Record<string, string>, body = demo) => ({ method: "POST", headers, body });
const json = { "Content-Type": "application/json" };

describe("a server without sign-in", () => {
  it("refuses a cross-site request, whatever its content type", async () => {
    const app = makeApp();
    // What any page can send without a CORS preflight: a "simple" request.
    const simple = await app.request(
      "http://127.0.0.1:8787/api/sessions",
      post({ "Content-Type": "text/plain", Origin: "https://evil.example" }),
    );
    expect(simple.status).toBe(403);
    expect(await simple.json()).toMatchObject({ error: "cross_site" });
    const asJson = await app.request("http://127.0.0.1:8787/api/sessions", post({ ...json, Origin: "https://evil.example" }));
    expect(asJson.status).toBe(403);
    expect((await app.request("/api/sessions", post({ ...json, Origin: "null" }))).status).toBe(403);
    expect((await app.request("/api/sessions", post({ ...json, "Sec-Fetch-Site": "cross-site" }))).status).toBe(403);
    expect((await app.request("/api/sessions", post({ ...json, Referer: "https://evil.example/page" }))).status).toBe(403);
    expect(await store?.list()).toEqual([]);
  });

  it("refuses a body that is not JSON, even without an Origin", async () => {
    const app = makeApp();
    const plain = await app.request("/api/sessions", post({ "Content-Type": "text/plain" }));
    expect(plain.status).toBe(415);
    expect(await plain.json()).toMatchObject({ error: "unsupported_media_type" });
    const form = await app.request("/api/sessions", post({ "Content-Type": "application/x-www-form-urlencoded" }, "locale=en"));
    expect(form.status).toBe(415);
    const untyped = await app.request("/api/sessions", post({ "Content-Length": String(demo.length) }));
    expect(untyped.status).toBe(415);
    // The upload route takes multipart, and nothing else.
    const upload = new FormData();
    upload.append("file", new File(["# Notes"], "notes.md", { type: "text/markdown" }));
    expect((await app.request("/api/context/file", { method: "POST", body: upload })).status).toBe(200);
    expect((await app.request("/api/context/file", post(json, "{}"))).status).toBe(415);
    expect(await store?.list()).toEqual([]);
  });

  it("accepts its own interface, the development server, scripts and the MCP server", async () => {
    const app = makeApp();
    expect((await app.request("http://localhost:8787/api/sessions", post({ ...json, Origin: "http://localhost:8787" }))).status).toBe(201);
    expect((await app.request("http://localhost:5173/api/sessions", post({ ...json, Origin: "http://localhost:5173" }))).status).toBe(201);
    expect((await app.request("http://127.0.0.1:8787/api/sessions", post(json))).status).toBe(201);
    expect((await app.request("http://[::1]:8787/api/sessions", post({ ...json, "Sec-Fetch-Site": "same-origin" }))).status).toBe(201);
    // A request without a body needs no content type.
    expect((await app.request("/api/sessions/unknown/stop", { method: "POST" })).status).toBe(404);
  });

  it("refuses a host name it does not answer for (DNS rebinding)", async () => {
    const app = makeApp();
    const rebound = await app.request("http://evil.example:8787/api/export");
    expect(rebound.status).toBe(403);
    expect(await rebound.json()).toMatchObject({ error: "forbidden_host" });
    expect((await app.request("http://evil.example:8787/api/sessions", post(json))).status).toBe(403);
    expect((await app.request("http://localhost:8787/api/export")).status).toBe(200);
  });

  it("answers for the public address and the host names it is given", async () => {
    const app = makeApp({ QUORUMIND_ALLOWED_HOSTS: "quorumind.lan, 192.168.1.20:8787" }, "https://decisions.example.org/app");
    for (const host of ["quorumind.lan", "192.168.1.20", "decisions.example.org"]) {
      expect((await app.request(`http://${host}:8787/api/health`)).status).toBe(200);
    }
    const posted = await app.request(
      "https://decisions.example.org/api/sessions",
      post({ ...json, Origin: "https://decisions.example.org" }),
    );
    expect(posted.status).toBe(201);
    expect((await app.request("http://other.lan/api/health")).status).toBe(403);
    expect(allowedHosts({ QUORUMIND_ALLOWED_HOSTS: "[fd00::1]" }, null)?.has("[fd00::1]")).toBe(true);
  });

  it("answers for any host name when told to, and still refuses other sites", async () => {
    const app = makeApp({ QUORUMIND_ALLOWED_HOSTS: "*" });
    expect((await app.request("http://anything.example/api/health")).status).toBe(200);
    expect((await app.request("http://anything.example/api/sessions", post({ ...json, Origin: "http://anything.example" }))).status).toBe(
      201,
    );
    expect((await app.request("http://anything.example/api/sessions", post({ ...json, Origin: "https://evil.example" }))).status).toBe(403);
  });
});

describe("a server with sign-in", () => {
  it("leaves host names and origins to its host", async () => {
    const app = makeApp({}, null, true);
    expect((await app.request("https://app.example.com/api/health")).status).toBe(200);
  });
});

describe("security headers", () => {
  it("forbid framing and type sniffing on every response", async () => {
    const root = new Hono();
    root.use("*", securityHeaders);
    root.get("*", (c) => c.html("<p>app</p>"));
    const response = await root.request("/any/page");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("content-security-policy")).toBe("frame-ancestors 'none'");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
