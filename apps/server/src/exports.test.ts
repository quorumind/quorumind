import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PRINT_SCRIPT, type Session } from "@quorumind/core";
import { afterEach, describe, expect, it } from "vitest";
import { type AppHooks, createApp } from "./app.ts";
import { BrandingStore } from "./branding.ts";
import { EventBus } from "./bus.ts";
import { SessionStore } from "./store.ts";

let store: SessionStore | null = null;

function makeApp(hooks?: AppHooks) {
  store = new SessionStore(":memory:");
  return createApp({ store, bus: new EventBus(), env: {}, mockDelayMs: 0, ...(hooks ? { hooks } : {}) });
}

afterEach(() => {
  store?.close();
  store = null;
});

type App = ReturnType<typeof makeApp>;

const send = (method: string, body: unknown) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

async function waitFor(app: App, id: string, done: (session: Session, busy: boolean) => boolean) {
  for (let i = 0; i < 200; i++) {
    const response = await app.request(`/api/sessions/${id}`);
    const { session, busy } = (await response.json()) as { session: Session; busy: boolean };
    if (done(session, busy)) return session;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out");
}

/** Drives the recorded demo from the interview to the verdict, through the API. */
async function demoSession(app: App, locale = "en", untilVerdict = true) {
  const created = await app.request("/api/sessions", send("POST", { locale, demo: true }));
  const { session } = (await created.json()) as { session: Session };
  await waitFor(app, session.id, (s, busy) => s.interview.length === 1 && !busy);
  await app.request(`/api/sessions/${session.id}/interview`, send("POST", { answers: [{ question: "Budget?", answer: "€15,000" }] }));
  const review = await waitFor(app, session.id, (s, busy) => s.phase === "review" && !busy);
  if (!untilVerdict) return review;
  await app.request(`/api/sessions/${session.id}/sheet`, send("PUT", { sheet: review.sheet }));
  await waitFor(app, session.id, (s, busy) => s.phase === "awaiting_answers" && !busy);
  await app.request(`/api/sessions/${session.id}/answers`, send("POST", { answers: [{ question: "Hosted?", answer: "Yes" }] }));
  return waitFor(app, session.id, (s, busy) => s.phase === "complete" && !busy);
}

describe("exports", () => {
  it("serves a self-contained report page, with the print call only when asked", async () => {
    const app = makeApp();
    const session = await demoSession(app);
    const page = await app.request(`/api/sessions/${session.id}/report.html`);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    const html = await page.text();
    expect(html).toMatch(/^<!doctype html>\n<html lang="en" dir="ltr">/);
    expect(html).toContain("Studio booking app");
    expect(html).toContain("<svg");
    expect(html).not.toContain("window.print");

    const printed = await app.request(`/api/sessions/${session.id}/report.html?print=1`);
    expect(await printed.text()).toContain(PRINT_SCRIPT);
    const hash = createHash("sha256").update(PRINT_SCRIPT).digest("base64");
    expect(printed.headers.get("content-security-policy")).toContain(`'sha256-${hash}'`);
    expect(printed.headers.get("content-security-policy")).toContain("default-src 'none'");
  });

  it("lays the report out right to left in Arabic", async () => {
    const app = makeApp();
    const session = await demoSession(app, "ar");
    const html = await (await app.request(`/api/sessions/${session.id}/report.html`)).text();
    expect(html).toContain('<html lang="ar" dir="rtl">');
    expect(html).toContain("تقرير القرار");
  });

  it("downloads the Word report, the ADR and the hand-off bundle with slugged names", async () => {
    const app = makeApp();
    const session = await demoSession(app);

    const docx = await app.request(`/api/sessions/${session.id}/report.docx`);
    expect(docx.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(docx.headers.get("content-disposition")).toBe('attachment; filename="studio-booking-app-report.docx"');
    const bytes = new Uint8Array(await docx.arrayBuffer());
    expect(String.fromCharCode(bytes[0]!, bytes[1]!)).toBe("PK");

    const adr = await app.request(`/api/sessions/${session.id}/adr.md`);
    expect(adr.headers.get("content-type")).toContain("text/markdown");
    expect(adr.headers.get("content-disposition")).toBe('attachment; filename="0001-studio-booking-app.md"');
    expect(await adr.text()).toContain("**Status:** Proposed");

    const zip = await app.request(`/api/sessions/${session.id}/handoff.zip`);
    expect(zip.headers.get("content-type")).toBe("application/zip");
    expect(zip.headers.get("content-disposition")).toBe('attachment; filename="studio-booking-app-handoff.zip"');
    const archive = new TextDecoder().decode(await zip.arrayBuffer());
    for (const name of ["CLAUDE.md", "AGENTS.md", "PLAN.md"]) expect(archive).toContain(name);
  });

  it("answers 404 for an unknown session and 409 before the verdict", async () => {
    const app = makeApp();
    for (const path of ["report.html", "report.docx", "adr.md", "handoff.zip"]) {
      const response = await app.request(`/api/sessions/nope/${path}`);
      expect(response.status).toBe(404);
      expect(((await response.json()) as { error: string }).error).toBe("not_found");
    }
    const session = await demoSession(app, "en", false);
    expect((await app.request(`/api/sessions/${session.id}/adr.md`)).status).toBe(409);
    expect((await app.request(`/api/sessions/${session.id}/handoff.zip`)).status).toBe(409);
    expect((await app.request(`/api/sessions/${session.id}/report.html`)).status).toBe(200);
  });

  it("keeps each account's exports and branding to itself in the hosted version", async () => {
    const app = makeApp({
      identify: async (request) => (request.headers.has("x-user") ? { userId: request.headers.get("x-user") ?? "" } : null),
    });
    const as = (user: string, init: RequestInit = {}) => ({ ...init, headers: { ...init.headers, "x-user": user } });
    const created = await app.request("/api/sessions", as("ada", send("POST", { locale: "en", demo: true })));
    const { session } = (await created.json()) as { session: Session };

    expect((await app.request(`/api/sessions/${session.id}/report.html`, as("ada"))).status).toBe(200);
    for (const path of ["report.html", "report.docx", "adr.md", "handoff.zip"]) {
      expect((await app.request(`/api/sessions/${session.id}/${path}`, as("bob"))).status).toBe(404);
      expect((await app.request(`/api/sessions/${session.id}/${path}`)).status).toBe(401);
    }

    await app.request("/api/branding", as("ada", send("PUT", { name: "Ada Studio", logoDataUrl: null, accent: null })));
    const brandingOf = async (user: string) =>
      ((await (await app.request("/api/branding", as(user))).json()) as { branding: { name: string | null } }).branding.name;
    expect(await brandingOf("ada")).toBe("Ada Studio");
    expect(await brandingOf("bob")).toBeNull();
    expect((await app.request("/api/branding")).status).toBe(401);
  });
});

describe("branding", () => {
  it("starts empty, saves a valid branding and shows it in the exports", async () => {
    const app = makeApp();
    expect(await (await app.request("/api/branding")).json()).toEqual({ branding: { name: null, logoDataUrl: null, accent: null } });

    const saved = await app.request("/api/branding", send("PUT", { name: "  Atelier <Nord>  ", logoDataUrl: PNG, accent: "#AA3366" }));
    expect(saved.status).toBe(200);
    expect(((await saved.json()) as { branding: unknown }).branding).toEqual({
      name: "Atelier <Nord>",
      logoDataUrl: PNG,
      accent: "#aa3366",
    });

    const session = await demoSession(app);
    const html = await (await app.request(`/api/sessions/${session.id}/report.html`)).text();
    expect(html).toContain("Atelier &lt;Nord&gt;");
    expect(html).not.toContain("Atelier <Nord>");
    expect(html).toContain(`src="${PNG}"`);
    expect(html).toContain("--accent: #aa3366");
    expect(html).toContain("Prepared with Quorumind");

    const docx = await app.request(`/api/sessions/${session.id}/report.docx`);
    expect(docx.status).toBe(200);

    const reset = await app.request("/api/branding", send("PUT", { name: null, logoDataUrl: null, accent: null }));
    expect(((await reset.json()) as { branding: unknown }).branding).toEqual({ name: null, logoDataUrl: null, accent: null });
  });

  it("rejects an invalid color, a fake image and an unsupported type", async () => {
    const app = makeApp();
    const invalid = [
      { name: null, logoDataUrl: null, accent: "red" },
      { name: null, logoDataUrl: "data:image/png;base64,aGVsbG8=", accent: null },
      { name: null, logoDataUrl: "data:image/gif;base64,R0lGODlhAQABAAAAACw=", accent: null },
      { name: null, logoDataUrl: `data:image/png;base64,${"A".repeat(210 * 1024)}`, accent: null },
      { name: "x".repeat(200), logoDataUrl: null, accent: null },
    ];
    for (const body of invalid) {
      const response = await app.request("/api/branding", send("PUT", body));
      expect(response.status, JSON.stringify(body).slice(0, 80)).toBe(400);
    }
    expect((await app.request("/api/branding", { method: "PUT", body: "{", headers: { "Content-Type": "application/json" } })).status).toBe(
      400,
    );
  });

  it("persists in the settings table, through a path or an open database", () => {
    const dir = mkdtempSync(join(tmpdir(), "quorumind-branding-"));
    try {
      const path = join(dir, "quorumind.db");
      const sessions = new SessionStore(path);
      const writer = new BrandingStore(path);
      writer.set(null, { name: "Agency", logoDataUrl: null, accent: "#123456" });
      writer.set("ada", { name: "Ada Studio", logoDataUrl: null, accent: null });
      writer.close();
      const db = new DatabaseSync(path);
      expect(new BrandingStore(db).get()).toEqual({ name: "Agency", logoDataUrl: null, accent: "#123456" });
      expect(new BrandingStore(db).get("ada").name).toBe("Ada Studio");
      expect(db.prepare("SELECT key FROM settings ORDER BY key").all()).toEqual([{ key: "branding" }, { key: "branding:ada" }]);
      db.close();
      sessions.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
