import { DatabaseSync } from "node:sqlite";
import { type Costing, EMPTY_PROFILE, type OptionChecks, type OrgProfile, type Session } from "@quorumind/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AppHooks, createApp } from "./app.ts";
import { SqliteBrandingStore } from "./branding.ts";
import { EventBus } from "./bus.ts";
import { storedProfile } from "./profile.ts";
import { BACKENDS, type Backend, type TestStorage } from "./testing.ts";

let backend: Backend;
let storage: TestStorage | null = null;

async function makeApp(hooks: AppHooks = {}) {
  storage = await backend.open();
  return createApp({ store: storage.store, brandingStore: storage.brandingStore, bus: new EventBus(), env: {}, mockDelayMs: 0, hooks });
}

afterEach(async () => {
  await storage?.close();
  storage = null;
});

type App = Awaited<ReturnType<typeof makeApp>>;

const as = (userId: string) => ({ "X-User": userId });
const send = (method: string, body: unknown, headers: Record<string, string> = {}) => ({
  method,
  headers: { "Content-Type": "application/json", ...headers },
  body: JSON.stringify(body),
});
// Signed-in callers whose catalog is the demo model: live sessions that spend nothing.
const SIGNED_IN: AppHooks = {
  identify: async (request) => {
    const userId = request.headers.get("x-user");
    return userId ? { userId } : null;
  },
  catalog: async () => [{ provider: "mock", model: "mock", label: "Demo", local: false }],
};

const INPUT = {
  name: "Atelier Nord",
  preferredTechnologies: ["TypeScript", "PostgreSQL", "TypeScript", " "],
  forbiddenTechnologies: ["PHP"],
  hosting: { euOnly: true, providers: ["Scaleway"], onPremises: false, notes: "" },
  currency: "eur",
  roles: [
    { name: "Senior developer", dailyRate: 650 },
    { name: "Project manager", dailyRate: 750 },
    { name: "Developer", dailyRate: 500 },
  ],
  capacity: { people: 6, typicalTeamSize: 3 },
  deliverables: ["Technical documentation"],
  guarantees: ["Three-month warranty"],
  notes: "",
};

async function saveProfile(app: App, user: string, profile: unknown) {
  return app.request("/api/profile", send("PUT", { profile }, as(user)));
}

async function waitFor(app: App, id: string, user: string, done: (session: Session, busy: boolean) => boolean) {
  for (let i = 0; i < 300; i++) {
    const { session, busy } = (await (await app.request(`/api/sessions/${id}`, { headers: as(user) })).json()) as {
      session: Session;
      busy: boolean;
    };
    if (done(session, busy)) return session;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out");
}

/** A live session on the demo model, up to its requirements review. */
async function toReview(app: App, user: string) {
  const created = await app.request("/api/sessions", send("POST", { locale: "en", idea: "Studio booking" }, as(user)));
  expect(created.status).toBe(201);
  const { session } = (await created.json()) as { session: Session };
  await waitFor(app, session.id, user, (s, busy) => s.interview.length === 1 && !busy);
  await app.request(
    `/api/sessions/${session.id}/interview`,
    send("POST", { answers: [{ question: "Budget?", answer: "€15,000" }] }, as(user)),
  );
  return waitFor(app, session.id, user, (s, busy) => s.phase === "review" && !busy);
}

describe.each(BACKENDS)("the organisation profile on $name", (each) => {
  beforeEach(() => {
    backend = each;
  });

  it("is kept per owner in the settings, with the time it was saved", async () => {
    await makeApp();
    const settings = storage!.brandingStore;
    expect(await settings.profile()).toBeNull();
    const profile: OrgProfile = { ...EMPTY_PROFILE, name: "Local agency", updatedAt: "2026-10-01T09:00:00.000Z" };
    expect(await settings.setProfile(null, profile)).toEqual(profile);
    await settings.setProfile("ada", { ...EMPTY_PROFILE, name: "Ada Studio", updatedAt: null });
    expect(await settings.profile()).toEqual(profile);
    const ada = await settings.profile("ada");
    expect(ada?.name).toBe("Ada Studio");
    expect(ada?.updatedAt).not.toBeNull();
    // The branding lives next to it, untouched.
    await settings.set("ada", { name: "Ada", logoDataUrl: null, accent: null });
    await settings.delete("ada");
    expect(await settings.profile("ada")).toBeNull();
    expect((await settings.get("ada")).name).toBeNull();
    expect(await settings.setProfile(null, null)).toBeNull();
    expect(await settings.profile()).toBeNull();
  });

  it("is validated, cleaned and given role ids when saved from the settings", async () => {
    const app = await makeApp(SIGNED_IN);
    expect(
      ((await (await app.request("/api/config", { headers: as("ada") })).json()) as { profileSettings: boolean }).profileSettings,
    ).toBe(true);
    expect((await (await app.request("/api/profile", { headers: as("ada") })).json()) as unknown).toEqual({ profile: null });

    const wrong = await saveProfile(app, "ada", { ...INPUT, currency: "euros" });
    expect(wrong.status).toBe(400);
    expect(((await wrong.json()) as { params: { field: string } }).params.field).toBe("profile.currency");
    // Three letters that are no currency, as the person typed them before the currency was a list.
    expect((await saveProfile(app, "ada", { ...INPUT, currency: "DOL" })).status).toBe(400);
    expect((await saveProfile(app, "ada", { ...INPUT, roles: [{ name: "Developer", dailyRate: -1 }] })).status).toBe(400);

    const saved = await saveProfile(app, "ada", INPUT);
    expect(saved.status).toBe(200);
    const { profile } = (await saved.json()) as { profile: OrgProfile };
    expect(profile.currency).toBe("EUR");
    expect(profile.preferredTechnologies).toEqual(["TypeScript", "PostgreSQL"]);
    expect(profile.roles.map((role) => role.id)).toEqual(["senior_developer", "project_manager", "developer"]);
    expect(profile.updatedAt).not.toBeNull();
    expect(((await (await app.request("/api/profile", { headers: as("ada") })).json()) as { profile: OrgProfile }).profile).toEqual(
      profile,
    );
    // Each owner has their own.
    expect(((await (await app.request("/api/profile", { headers: as("bob") })).json()) as { profile: null }).profile).toBeNull();

    expect(((await (await saveProfile(app, "ada", null)).json()) as { profile: null }).profile).toBeNull();
  });

  it("is copied into a new session, which keeps its copy when the profile changes later", async () => {
    const app = await makeApp(SIGNED_IN);
    await saveProfile(app, "ada", INPUT);
    const review = await toReview(app, "ada");
    expect(review.profile?.name).toBe("Atelier Nord");
    expect(review.profile?.forbiddenTechnologies).toEqual(["PHP"]);

    await saveProfile(app, "ada", { ...INPUT, name: "Atelier Sud", forbiddenTechnologies: ["Java"] });
    const later = await waitFor(app, review.id, "ada", () => true);
    expect(later.profile?.name).toBe("Atelier Nord");

    // Starting again from it is a new debate: it follows the profile in force now.
    const fork = await app.request(`/api/sessions/${review.id}/fork`, send("POST", {}, as("ada")));
    expect(((await fork.json()) as { session: Session }).session.profile?.name).toBe("Atelier Sud");

    // The recorded demo follows no profile: its script could not.
    const demo = await app.request("/api/sessions", send("POST", { locale: "en", demo: true }, as("ada")));
    expect(((await demo.json()) as { session: Session }).session.profile).toBeNull();
  });

  it("prices the options with the profile, unless the session sets it aside", async () => {
    const app = await makeApp(SIGNED_IN);
    await saveProfile(app, "ada", { ...INPUT, currency: "CHF" });

    const kept = await toReview(app, "ada");
    await app.request(`/api/sessions/${kept.id}/sheet`, send("PUT", { sheet: kept.sheet }, as("ada")));
    await waitFor(app, kept.id, "ada", (s, busy) => s.phase === "awaiting_answers" && !busy);
    const priced = (await (await app.request(`/api/sessions/${kept.id}`, { headers: as("ada") })).json()) as {
      session: Session;
      costings: Record<string, Costing>;
    };
    expect(priced.session.currency).toBe("CHF");
    expect(priced.costings.A?.rates).toBe("profile");
    expect(priced.costings.A?.currency).toBe("CHF");

    const aside = await toReview(app, "ada");
    await app.request(`/api/sessions/${aside.id}/sheet`, send("PUT", { sheet: aside.sheet, ignoreProfile: true }, as("ada")));
    await waitFor(app, aside.id, "ada", (s, busy) => s.phase === "awaiting_answers" && !busy);
    await app.request(`/api/sessions/${aside.id}/answers`, send("POST", { answers: [{ question: "Hosted?", answer: "Yes" }] }, as("ada")));
    await waitFor(app, aside.id, "ada", (s, busy) => s.phase === "complete" && !busy);
    const detail = (await (await app.request(`/api/sessions/${aside.id}`, { headers: as("ada") })).json()) as {
      session: Session;
      costings: Record<string, Costing>;
      checks: Record<string, OptionChecks>;
    };
    expect(detail.session.ignoreProfile).toBe(true);
    expect(detail.session.currency).toBe("EUR");
    expect(detail.costings.A).toMatchObject({ rates: "estimated", total: { low: 12_300, high: 15_500 } });
    expect(detail.checks.A?.build).toEqual({ status: "at_risk", budget: 15_000, currency: "EUR", by: 500 });
    const report = await (await app.request(`/api/sessions/${aside.id}/report.md`, { headers: as("ada") })).text();
    expect(report).toContain("## Costing");
    expect(report).not.toContain("Atelier Nord");
  });

  it("comes from the host when it provides one, and the settings routes are closed", async () => {
    const asked: string[] = [];
    const app = await makeApp({
      ...SIGNED_IN,
      profile: async (user, session) => {
        asked.push(`${user.userId}:${session.id}`);
        return { ...EMPTY_PROFILE, name: `Workspace of ${user.userId}`, forbiddenTechnologies: ["PHP"], updatedAt: null };
      },
    });
    expect(
      ((await (await app.request("/api/config", { headers: as("ada") })).json()) as { profileSettings: boolean }).profileSettings,
    ).toBe(false);
    expect((await app.request("/api/profile", { headers: as("ada") })).status).toBe(404);
    expect((await saveProfile(app, "ada", INPUT)).status).toBe(404);
    const review = await toReview(app, "ada");
    expect(review.profile?.name).toBe("Workspace of ada");
    expect(asked).toEqual([`ada:${review.id}`]);
  });
});

describe("a profile stored before currencies were checked against the known codes", () => {
  it("is read with the euro rather than lost", () => {
    const { currency: _, ...rest } = INPUT;
    expect(storedProfile({ ...rest, currency: "DOL" }, null)?.currency).toBe("EUR");
    expect(storedProfile({ ...rest, currency: "chf" }, null)?.currency).toBe("CHF");
  });
});

describe("the SQLite settings stored before profiles", () => {
  it("gain the time of each save, and keep the branding they had", async () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(
      "branding",
      JSON.stringify({ name: "Agency", logoDataUrl: null, accent: null }),
    );
    const settings = new SqliteBrandingStore(db);
    expect((await settings.get()).name).toBe("Agency");
    const saved = await settings.setProfile(null, { ...EMPTY_PROFILE, name: "Agency", updatedAt: "2026-10-01T09:00:00.000Z" });
    expect(await settings.profile()).toEqual(saved);
    expect(db.prepare("SELECT key, updated_at FROM settings ORDER BY key").all()).toEqual([
      { key: "branding", updated_at: null },
      { key: "profile", updated_at: "2026-10-01T09:00:00.000Z" },
    ]);
    db.close();
  });
});
