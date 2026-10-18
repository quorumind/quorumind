import type { ClientDeliverable, Session } from "@quorumind/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { EventBus } from "./bus.ts";
import { AttemptLimiter, accessToken, hashPassword, SHARE_ATTEMPT_LIMITS, validAccess, verifyPassword } from "./share.ts";
import { BACKENDS, type Backend, type TestStorage } from "./testing.ts";

describe("share passwords", () => {
  it("are kept as a salted scrypt hash", async () => {
    const hash = await hashPassword("correct horse");
    expect(hash).toMatch(/^scrypt\$16384\$8\$1\$[\w-]+\$[\w-]+$/);
    expect(hash).not.toContain("correct horse");
    expect(await hashPassword("correct horse")).not.toBe(hash);
    expect(await verifyPassword("correct horse", hash)).toBe(true);
    expect(await verifyPassword("correct horsE", hash)).toBe(false);
    expect(await verifyPassword("correct horse", "plain")).toBe(false);
  });

  it("give an access token signed with the hash, for a few hours", async () => {
    const hash = await hashPassword("secret");
    const now = Date.parse("2026-10-18T10:00:00Z");
    const { access, expiresAt } = accessToken("token", hash, now);
    expect(expiresAt).toBe("2026-10-18T22:00:00.000Z");
    expect(validAccess(access, "token", hash, now + 3_600_000)).toBe(true);
    expect(validAccess(access, "other", hash, now)).toBe(false);
    expect(validAccess(access, "token", await hashPassword("secret"), now)).toBe(false);
    expect(validAccess(access, "token", hash, now + 13 * 3_600_000)).toBe(false);
    expect(validAccess(`${now + 10 ** 9}.${access.split(".")[1]}`, "token", hash, now)).toBe(false);
    expect(validAccess(undefined, "token", hash, now)).toBe(false);
  });

  it("are refused once too many wrong ones were tried", () => {
    let now = 0;
    const limiter = new AttemptLimiter({ perWindow: 2, windowMs: 1_000 }, () => now);
    limiter.fail("a");
    expect(limiter.allows("a")).toBe(true);
    limiter.fail("a");
    expect(limiter.allows("a")).toBe(false);
    expect(limiter.allows("b")).toBe(true);
    now = 1_000;
    expect(limiter.allows("a")).toBe(true);
  });
});

let backend: Backend;
let storage: TestStorage | null = null;

async function makeApp() {
  storage = await backend.open();
  return createApp({ store: storage.store, brandingStore: storage.brandingStore, bus: new EventBus(), env: {}, mockDelayMs: 0 });
}

afterEach(async () => {
  await storage?.close();
  storage = null;
});

type App = Awaited<ReturnType<typeof makeApp>>;

const json = (body: unknown, headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "Content-Type": "application/json", ...headers },
  body: JSON.stringify(body),
});

async function waitFor(app: App, id: string, done: (session: Session, busy: boolean) => boolean) {
  for (let i = 0; i < 300; i++) {
    const { session, busy } = (await (await app.request(`/api/sessions/${id}`)).json()) as { session: Session; busy: boolean };
    if (done(session, busy)) return session;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out");
}

async function completeDemo(app: App) {
  const created = await app.request(
    "/api/sessions",
    json({ locale: "en", demo: true, context: [{ id: "1", kind: "text", name: "brief.txt", text: "Confidential" }] }),
  );
  const { session } = (await created.json()) as { session: Session };
  await waitFor(app, session.id, (s, busy) => s.interview.length === 1 && !busy);
  await app.request(`/api/sessions/${session.id}/interview`, json({ answers: [{ question: "Budget?", answer: "15k" }] }));
  const review = await waitFor(app, session.id, (s, busy) => s.phase === "review" && !busy);
  await app.request(`/api/sessions/${session.id}/sheet`, { ...json({ sheet: review.sheet }), method: "PUT" });
  await waitFor(app, session.id, (s, busy) => s.phase === "awaiting_answers" && !busy);
  await app.request(`/api/sessions/${session.id}/answers`, json({ answers: [{ question: "Hosted?", answer: "Yes" }] }));
  return waitFor(app, session.id, (s, busy) => s.phase === "complete" && !busy);
}

interface ShareBody {
  share: { token: string; mode: string; expiresAt: string | null; hasPassword: boolean; public: boolean };
}

describe.each(BACKENDS)("share links on $name", (each) => {
  beforeEach(() => {
    backend = each;
  });

  it("show a client only the decision, with the brief written for a client", async () => {
    const app = await makeApp();
    const session = await completeDemo(app);
    const created = await app.request(`/api/sessions/${session.id}/share`, json({}));
    const { share } = (await created.json()) as ShareBody;
    expect(share).toMatchObject({ mode: "client", hasPassword: false, public: false });
    // A new link works for 30 days.
    expect(Date.parse(share.expiresAt ?? "") - Date.now()).toBeGreaterThan(29.9 * 86_400_000);
    const withBrief = await waitFor(app, session.id, (s, busy) => Boolean(s.briefs.client) && !busy);

    const response = await app.request(`/api/shared/${share.token}`);
    const body = (await response.json()) as { share: { mode: string }; deliverable: ClientDeliverable; session?: unknown };
    expect(body.share.mode).toBe("client");
    expect(body.session).toBeUndefined();
    const { deliverable } = body;
    expect(deliverable).toMatchObject({ complete: true, recommendation: { seat: "A" } });
    expect(deliverable.options.length).toBeGreaterThan(1);
    expect(deliverable.options[0]?.weightedScore).toEqual(expect.any(Number));
    expect(deliverable.risks.length).toBeGreaterThan(0);
    expect(deliverable.roadmap.length).toBeGreaterThan(0);
    expect(deliverable.brief?.headline).toBe(withBrief.briefs.client?.headline);
    const text = JSON.stringify(body);
    for (const hidden of ["Confidential", "brief.txt", "15k", "Hosted?", "usage", "budgetUsd", "interview", "mustHave", "critiques"]) {
      expect(text, hidden).not.toContain(hidden);
    }

    const report = await (await app.request(`/api/shared/${share.token}/report.md`)).text();
    expect(report).toContain("## Recommendation");
    expect(report).toContain("## Version for a client");
    expect(report).toContain("## Roadmap");
    expect(report).not.toContain("## Final proposals");
    expect(report).not.toContain("Detailed requirements");
    expect(report).not.toContain("15k");

    // The same link turned into a full one shows the session, still without documents or costs.
    await app.request(`/api/sessions/${session.id}/share`, json({ mode: "full" }));
    const full = (await (await app.request(`/api/shared/${share.token}`)).json()) as { session: Session };
    expect(full.session.debate.length).toBeGreaterThan(0);
    expect(JSON.stringify(full.session)).not.toContain("Confidential");
    expect(full.session).toMatchObject({ usage: [], budgetUsd: null });
    expect(await (await app.request(`/api/shared/${share.token}/report.md`)).text()).toContain("## Final proposals");
  });

  it("ask for their password, and give a few hours of access once it is given", async () => {
    const app = await makeApp();
    const session = await completeDemo(app);
    const created = await app.request(`/api/sessions/${session.id}/share`, json({ mode: "full", password: "open sesame", public: true }));
    const { share } = (await created.json()) as ShareBody;
    expect(share.hasPassword).toBe(true);
    expect(JSON.stringify(await (await app.request(`/api/sessions/${session.id}`)).json())).not.toContain("scrypt");
    // A protected link stays out of the gallery.
    expect(((await (await app.request("/api/gallery")).json()) as { sessions: unknown[] }).sessions).toEqual([]);

    const locked = await app.request(`/api/shared/${share.token}`);
    expect(locked.status).toBe(401);
    expect(await locked.json()).toMatchObject({ error: "password_required" });
    expect((await app.request(`/api/shared/${share.token}/report.md`)).status).toBe(401);

    const wrong = await app.request(`/api/shared/${share.token}/access`, json({ password: "open sesam" }));
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toMatchObject({ error: "wrong_password" });

    const granted = await app.request(`/api/shared/${share.token}/access`, json({ password: "open sesame" }));
    const { access } = (await granted.json()) as { access: string };
    const page = await app.request(`/api/shared/${share.token}`, { headers: { "X-Share-Access": access } });
    expect(page.status).toBe(200);
    expect(((await page.json()) as { session: Session }).session.verdict).toBeTruthy();
    const download = await app.request(`/api/shared/${share.token}/report.md?access=${encodeURIComponent(access)}`);
    expect(download.status).toBe(200);

    // Removing the password opens the link; a new password revokes the access given before.
    await app.request(`/api/sessions/${session.id}/share`, json({ password: "another one" }));
    expect((await app.request(`/api/shared/${share.token}`, { headers: { "X-Share-Access": access } })).status).toBe(401);
    await app.request(`/api/sessions/${session.id}/share`, json({ password: null }));
    expect((await app.request(`/api/shared/${share.token}`)).status).toBe(200);
  });

  it("stop guessing after too many wrong passwords", async () => {
    const app = await makeApp();
    const session = await completeDemo(app);
    const { share } = (await (await app.request(`/api/sessions/${session.id}/share`, json({ password: "right one" }))).json()) as ShareBody;
    for (let i = 0; i < SHARE_ATTEMPT_LIMITS.caller.perWindow; i++) {
      expect((await app.request(`/api/shared/${share.token}/access`, json({ password: `guess ${i}` }))).status).toBe(401);
    }
    const limited = await app.request(`/api/shared/${share.token}/access`, json({ password: "right one" }));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ error: "too_many_attempts" });
  });

  it("expire, and can be made to last", async () => {
    const app = await makeApp();
    const session = await completeDemo(app);
    const { share } = (await (await app.request(`/api/sessions/${session.id}/share`, json({ expiresIn: "7d" }))).json()) as ShareBody;
    expect(Math.round((Date.parse(share.expiresAt ?? "") - Date.now()) / 86_400_000)).toBe(7);
    await storage?.store.share(session.id, { expiresAt: new Date(Date.now() - 1_000).toISOString() });
    const expired = await app.request(`/api/shared/${share.token}`);
    expect(expired.status).toBe(410);
    expect(await expired.json()).toMatchObject({ error: "share_expired" });
    expect((await app.request(`/api/shared/${share.token}/report.md`)).status).toBe(410);

    const forever = (await (await app.request(`/api/sessions/${session.id}/share`, json({ expiresIn: "never" }))).json()) as ShareBody;
    expect(forever.share).toMatchObject({ token: share.token, expiresAt: null, mode: "client" });
    expect((await app.request(`/api/shared/${share.token}`)).status).toBe(200);

    const invalid = await app.request(`/api/sessions/${session.id}/share`, json({ expiresIn: "1y" }));
    expect(await invalid.json()).toMatchObject({ error: "invalid_request", params: { field: "expiresIn" } });
  });

  it("show a client link of an unfinished session empty, then with the verdict", async () => {
    const app = await makeApp();
    const created = await app.request("/api/sessions", json({ locale: "en", demo: true }));
    const { session } = (await created.json()) as { session: Session };
    await waitFor(app, session.id, (s, busy) => s.interview.length === 1 && !busy);
    const { share } = (await (await app.request(`/api/sessions/${session.id}/share`, json({}))).json()) as ShareBody;
    const early = (await (await app.request(`/api/shared/${share.token}`)).json()) as { deliverable: ClientDeliverable };
    expect(early.deliverable).toMatchObject({ complete: false, recommendation: null, options: [], brief: null });
    expect(JSON.stringify(early)).not.toContain(session.idea.slice(0, 40));
  });
});
