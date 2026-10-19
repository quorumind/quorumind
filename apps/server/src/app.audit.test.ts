import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type AuditReport, auditOf, type ClientDeliverable, EMPTY_PROFILE, type Session } from "@quorumind/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AppHooks, createApp, type PricedSettings, type Purchase } from "./app.ts";
import { EventBus } from "./bus.ts";
import { BACKENDS, type Backend, type TestStorage } from "./testing.ts";

let backend: Backend;
let storage: TestStorage | null = null;

async function makeApp(hooks: AppHooks = {}) {
  storage = await backend.open();
  return createApp({
    store: storage.store,
    brandingStore: storage.brandingStore,
    bus: new EventBus(),
    env: {},
    mockDelayMs: 0,
    hooks: { ...SIGNED_IN, ...hooks },
  });
}

afterEach(async () => {
  await storage?.close();
  storage = null;
});

type App = Awaited<ReturnType<typeof makeApp>>;

const QUOTE = readFileSync(join(import.meta.dirname, "../../../bench/fixtures/web-agency-quote.md"), "utf8");
const DOCUMENTS = [
  { id: "quote", kind: "file", name: "Quote Q-2026-117.pdf", text: QUOTE },
  { id: "needs", kind: "text", name: "Our needs", text: "Members get SMS reminders." },
];
const USER = { "X-User": "ada" };
// Signed-in callers whose catalog is the demo model: live sessions that spend nothing.
const SIGNED_IN: AppHooks = {
  identify: async (request) => {
    const userId = request.headers.get("x-user");
    return userId ? { userId } : null;
  },
  catalog: async () => [{ provider: "mock", model: "mock", label: "Demo", local: false }],
};
const mock = { provider: "mock", model: "mock" };
const LINEUP = { interviewer: mock, arbiter: mock, seats: { A: mock, B: mock }, devil: mock };

const send = (method: string, body: unknown) => ({
  method,
  headers: { "Content-Type": "application/json", ...USER },
  body: JSON.stringify(body),
});

async function waitFor(app: App, id: string, done: (session: Session, busy: boolean) => boolean) {
  for (let i = 0; i < 400; i++) {
    const { session, busy } = (await (await app.request(`/api/sessions/${id}`, { headers: USER })).json()) as {
      session: Session;
      busy: boolean;
    };
    if (done(session, busy)) return session;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out");
}

/** An audit of the fictional quote through the API, from its creation to the verdict. */
async function audit(app: App, body: Record<string, unknown> = {}) {
  const created = await app.request(
    "/api/sessions",
    send("POST", { locale: "en", idea: "Is this quote sound?", mode: "audit", lineup: LINEUP, context: DOCUMENTS, ...body }),
  );
  expect(created.status).toBe(201);
  const { session } = (await created.json()) as { session: Session };
  await waitFor(app, session.id, (s, busy) => s.interview.length === 1 && !busy);
  await app.request(`/api/sessions/${session.id}/interview`, send("POST", { answers: [{ question: "Budget?", answer: "€15,000" }] }));
  const review = await waitFor(app, session.id, (s, busy) => s.phase === "review" && !busy);
  await app.request(`/api/sessions/${session.id}/sheet`, send("PUT", { sheet: review.sheet }));
  await waitFor(app, session.id, (s, busy) => (s.phase === "awaiting_answers" || s.phase === "complete") && !busy);
  await app.request(
    `/api/sessions/${session.id}/answers`,
    send("POST", { answers: [{ question: "Maintain it?", answer: "The agency." }] }),
  );
  return waitFor(app, session.id, (s, busy) => s.phase === "complete" && !busy);
}

describe.each(BACKENDS)("audits on $name", (each) => {
  beforeEach(() => {
    backend = each;
  });

  it("need a document to audit", async () => {
    const app = await makeApp();
    const response = await app.request(
      "/api/sessions",
      send("POST", { locale: "en", idea: "Is it sound?", mode: "audit", lineup: LINEUP }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "audit_document_missing" });
  });

  it("audit the document named, against the need, without the organisation profile, and keep it across a restart", async () => {
    const app = await makeApp();
    await app.request("/api/profile", send("PUT", { profile: { ...EMPTY_PROFILE, name: "Ada Studio", forbiddenTechnologies: ["PHP"] } }));
    const session = await audit(app, { audit: { documentIds: ["quote"], alternative: true } });
    expect(session.profile).toBeNull();
    expect(session.audit).toMatchObject({ documentIds: ["quote"], alternative: true });
    expect(session.audit?.extraction?.total.amount).toBe(38_000);
    expect(session.debate.some((entry) => entry.kind === "proposal" && entry.seat === "A")).toBe(true);
    const report = auditOf(session.verdict) as AuditReport;
    expect(report.opinion).toBe("not_sound");
    expect(report.findings.some((finding) => finding.quote)).toBe(true);

    const restarted = await storage?.reopen().find(session.id);
    expect(restarted?.session.audit?.extraction?.title).toBe(session.audit?.extraction?.title);
    expect(auditOf(restarted?.session.verdict)?.questions).toEqual(report.questions);
  });

  it("export the audit report in Markdown, HTML and Word", async () => {
    const app = await makeApp();
    const session = await audit(app);
    const markdown = await (await app.request(`/api/sessions/${session.id}/report.md`, { headers: USER })).text();
    expect(markdown).toContain("_Audit report · ");
    expect(markdown).toContain("## Questions to ask the provider");
    const html = await app.request(`/api/sessions/${session.id}/report.html?print=1`, { headers: USER });
    expect(html.status).toBe(200);
    expect(await html.text()).toContain("<title>Audit report: ");
    const docx = await app.request(`/api/sessions/${session.id}/report.docx`, { headers: USER });
    expect(docx.status).toBe(200);
    expect(docx.headers.get("content-type")).toContain("wordprocessingml");
  });

  it("share the audit with a client: the findings and the questions, not the document", async () => {
    const app = await makeApp();
    const session = await audit(app);
    const shared = await app.request(`/api/sessions/${session.id}/share`, send("POST", {}));
    const { share } = (await shared.json()) as { share: { token: string } };
    const view = (await (await app.request(`/api/shared/${share.token}`)).json()) as { deliverable: ClientDeliverable };
    expect(view.deliverable.audit?.questions.length).toBeGreaterThan(3);
    expect(view.deliverable.audit?.check?.totalGap).toBe(1_400);
    expect(JSON.stringify(view.deliverable)).not.toContain("Members get SMS reminders.");
    const markdown = await (await app.request(`/api/shared/${share.token}/report.md`)).text();
    expect(markdown).toContain("## Points to negotiate");
    expect(markdown).not.toContain("## Your need");
  });

  it("are priced and authorized as an audit, a standard one unless deep", async () => {
    const quoted: PricedSettings[] = [];
    const purchases: { mode: Session["mode"]; depth: Session["depth"]; purchase: Purchase | undefined }[] = [];
    const app = await makeApp({
      quote: async (_user, settings) => {
        quoted.push(settings);
        return { amount: settings.depth === "deep" ? 9 : 5, currency: "EUR", label: `${settings.mode} ${settings.depth}` };
      },
      authorizeSpend: async (_user, session, _estimate, purchase) => {
        purchases.push({ mode: session.mode, depth: session.depth, purchase });
        return { ok: true };
      },
    });
    const estimate = await app.request(
      "/api/estimate",
      send("POST", { lineup: LINEUP, rounds: 1, mode: "audit", depth: "deep", locale: "en", audit: { alternative: true } }),
    );
    expect(((await estimate.json()) as { price: { label: string } }).price.label).toBe("audit deep");
    const session = await audit(app);
    expect(quoted).toContainEqual(expect.objectContaining({ mode: "audit", depth: "standard" }));
    expect(purchases.length).toBeGreaterThan(0);
    expect(purchases.every((entry) => entry.mode === "audit" && entry.purchase?.kind !== "revision")).toBe(true);
    const fetched = (await (await app.request(`/api/sessions/${session.id}`, { headers: USER })).json()) as { price: { label: string } };
    expect(fetched.price.label).toBe("audit standard");
  });

  it("start again from an audit with the same document and settings", async () => {
    const app = await makeApp();
    const session = await audit(app, { audit: { documentIds: ["quote"], alternative: true } });
    const forked = await app.request(`/api/sessions/${session.id}/fork`, send("POST", {}));
    const { session: copy } = (await forked.json()) as { session: Session };
    expect(copy.mode).toBe("audit");
    expect(copy.audit).toEqual({ documentIds: ["quote"], alternative: true, extraction: null });
    expect(copy.phase).toBe("review");
  });
});
