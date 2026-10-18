import { createHash } from "node:crypto";
import { PRINT_SCRIPT, type Session } from "@quorumind/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AppHooks, createApp } from "./app.ts";
import { EventBus } from "./bus.ts";
import { BACKENDS, type Backend, type TestStorage } from "./testing.ts";

let backend: Backend;
let storage: TestStorage | null = null;

async function makeApp(hooks?: AppHooks) {
  storage = await backend.open();
  const { store, brandingStore } = storage;
  return createApp({ store, brandingStore, bus: new EventBus(), env: {}, mockDelayMs: 0, ...(hooks ? { hooks } : {}) });
}

afterEach(async () => {
  await storage?.close();
  storage = null;
});

type App = Awaited<ReturnType<typeof makeApp>>;

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

describe.each(BACKENDS)("on $name", (each) => {
  beforeEach(() => {
    backend = each;
  });

  describe("exports", () => {
    it("serves a self-contained report page, with the print call only when asked", async () => {
      const app = await makeApp();
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
      const app = await makeApp();
      const session = await demoSession(app, "ar");
      const html = await (await app.request(`/api/sessions/${session.id}/report.html`)).text();
      expect(html).toContain('<html lang="ar" dir="rtl">');
      expect(html).toContain("تقرير القرار");
    });

    it("downloads the Word report, the ADR and the hand-off bundle with slugged names", async () => {
      const app = await makeApp();
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

    it("numbers the ADR when asked, and refuses a number that is not one", async () => {
      const app = await makeApp();
      const session = await demoSession(app);
      const adr = await app.request(`/api/sessions/${session.id}/adr.md?number=7`);
      expect(adr.headers.get("content-disposition")).toBe('attachment; filename="0007-studio-booking-app.md"');
      expect(await adr.text()).toMatch(/^# 7\. /);
      const long = await app.request(`/api/sessions/${session.id}/adr.md?number=12345`);
      expect(long.headers.get("content-disposition")).toBe('attachment; filename="12345-studio-booking-app.md"');
      for (const number of ["0", "-1", "1.5", "seven", ""]) {
        expect((await app.request(`/api/sessions/${session.id}/adr.md?number=${number}`)).status, number).toBe(400);
      }
    });

    it("exports the roadmap for Jira, Linear and GitHub issues", async () => {
      const app = await makeApp();
      const session = await demoSession(app);

      const jira = await app.request(`/api/sessions/${session.id}/jira.csv`);
      expect(jira.headers.get("content-type")).toBe("text/csv; charset=utf-8");
      expect(jira.headers.get("content-disposition")).toBe('attachment; filename="studio-booking-app-jira.csv"');
      const csv = await jira.text();
      expect(csv.startsWith('"Issue ID","Parent","Issue Type","Summary"')).toBe(true);
      expect(csv).toContain('"Epic","Phase 1: First release"');

      const linear = await app.request(`/api/sessions/${session.id}/linear.csv`);
      expect(linear.headers.get("content-disposition")).toBe('attachment; filename="studio-booking-app-linear.csv"');
      expect((await linear.text()).startsWith('"Title","Description","Status","Priority","Labels","Project"\r\n')).toBe(true);

      const github = await app.request(`/api/sessions/${session.id}/github-issues.zip`);
      expect(github.headers.get("content-type")).toBe("application/zip");
      expect(github.headers.get("content-disposition")).toBe('attachment; filename="studio-booking-app-github-issues.zip"');
      const archive = new TextDecoder().decode(await github.arrayBuffer());
      for (const name of ["README.md", "create-issues.sh", "issues.json", "issues/phase-1.md", "issues/phase-1-step-1.md"]) {
        expect(archive).toContain(name);
      }
    });

    it("answers 404 for an unknown session and 409 before the verdict", async () => {
      const app = await makeApp();
      for (const path of ["report.html", "report.docx", "adr.md", "handoff.zip", "jira.csv", "linear.csv", "github-issues.zip"]) {
        const response = await app.request(`/api/sessions/nope/${path}`);
        expect(response.status).toBe(404);
        expect(((await response.json()) as { error: string }).error).toBe("not_found");
      }
      const session = await demoSession(app, "en", false);
      expect((await app.request(`/api/sessions/${session.id}/adr.md`)).status).toBe(409);
      for (const path of ["handoff.zip", "jira.csv", "linear.csv", "github-issues.zip"]) {
        expect((await app.request(`/api/sessions/${session.id}/${path}`)).status).toBe(409);
      }
      expect((await app.request(`/api/sessions/${session.id}/report.html`)).status).toBe(200);
    });

    it("serves a reader version only once it was written, and refuses unknown readers", async () => {
      const app = await makeApp();
      const session = await demoSession(app);
      expect((await app.request(`/api/sessions/${session.id}/report.html?audience=board`)).status).toBe(400);
      expect((await app.request(`/api/sessions/${session.id}/report.html?audience=executive`)).status).toBe(409);
      const stored = await storage?.store.get(session.id);
      if (!stored) throw new Error("The session is not stored.");
      stored.briefs.executive = {
        speech: "",
        headline: "Build the custom app",
        summary: "It fits the budget.",
        sections: [],
        nextSteps: ["Sign off"],
      };
      await storage?.store.save(stored);
      const page = await app.request(`/api/sessions/${session.id}/report.html?audience=executive`);
      expect(page.status).toBe(200);
      const html = await page.text();
      expect(html).toContain("Version for an executive");
      expect(html).toContain("<h1>Build the custom app</h1>");
    });

    it("keeps each account's exports and branding to itself in the hosted version", async () => {
      const app = await makeApp({
        identify: async (request) => (request.headers.has("x-user") ? { userId: request.headers.get("x-user") ?? "" } : null),
      });
      const as = (user: string, init: RequestInit = {}) => ({ ...init, headers: { ...init.headers, "x-user": user } });
      const created = await app.request("/api/sessions", as("ada", send("POST", { locale: "en", demo: true })));
      const { session } = (await created.json()) as { session: Session };

      expect((await app.request(`/api/sessions/${session.id}/report.html`, as("ada"))).status).toBe(200);
      for (const path of ["report.html", "report.docx", "adr.md", "handoff.zip", "jira.csv", "linear.csv", "github-issues.zip"]) {
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
      const app = await makeApp();
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
      const app = await makeApp();
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
      expect(
        (await app.request("/api/branding", { method: "PUT", body: "{", headers: { "Content-Type": "application/json" } })).status,
      ).toBe(400);
    });
  });
});
