import type { Session } from "@quorumind/core";
import { type AppHooks, createApp } from "./app.ts";
import { EventBus } from "./bus.ts";
import type { Notifier } from "./notifier.ts";
import type { Backend, TestStorage } from "./testing.ts";

// Helpers of the API tests that drive a session to its verdict as a hosted user would: through the routes, with the
// demo model standing in for a priced one, so the spending hooks are called.

export const as = (user: string) => ({ "x-user": user });

export const send = (body: unknown, user: string | null = "ada", method = "POST") => ({
  method,
  headers: { "Content-Type": "application/json", ...(user ? as(user) : {}) },
  body: JSON.stringify(body),
});

/** Identifies the caller by the x-user header, and offers the demo model as the hosted catalog. */
export const hostedHooks = (extra: AppHooks = {}): AppHooks => ({
  identify: async (request) => {
    const user = request.headers.get("x-user");
    return user ? { userId: user } : null;
  },
  catalog: async () => [{ provider: "mock", model: "mock", label: "Demo", local: false }],
  ...extra,
});

export async function openApp(backend: Backend, hooks: AppHooks, notifier: Notifier | null = null) {
  const storage: TestStorage = await backend.open();
  const app = createApp({
    store: storage.store,
    brandingStore: storage.brandingStore,
    bus: new EventBus(),
    env: {},
    mockDelayMs: 0,
    hooks,
    notifier,
  });
  return { app, storage };
}

export type TestApp = Awaited<ReturnType<typeof openApp>>["app"];

export interface SessionBody {
  session: Session;
  busy: boolean;
  price: unknown;
  revisionPrice: unknown;
}

export async function detail(app: TestApp, id: string, user = "ada"): Promise<SessionBody> {
  return (await (await app.request(`/api/sessions/${id}`, { headers: as(user) })).json()) as SessionBody;
}

export async function waitFor(app: TestApp, id: string, done: (session: Session) => boolean, user = "ada"): Promise<Session> {
  for (let i = 0; i < 400; i++) {
    const body = await detail(app, id, user);
    if (!body.busy && done(body.session)) return body.session;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out");
}

/** A live session (on the demo model) taken through the interview and the debate to its verdict. */
export async function ruled(app: TestApp, user = "ada", locale = "en"): Promise<Session> {
  const created = await app.request("/api/sessions", send({ locale, idea: "Online booking for 12 yoga studios" }, user));
  const { session } = (await created.json()) as { session: Session };
  await waitFor(app, session.id, (s) => s.interview.length === 1, user);
  await app.request(`/api/sessions/${session.id}/interview`, send({ answers: [{ question: "Budget?", answer: "€15,000" }] }, user));
  const review = await waitFor(app, session.id, (s) => s.phase === "review", user);
  await app.request(`/api/sessions/${session.id}/sheet`, send({ sheet: review.sheet }, user, "PUT"));
  await waitFor(app, session.id, (s) => s.phase === "awaiting_answers", user);
  await app.request(`/api/sessions/${session.id}/answers`, send({ answers: [{ question: "Hosted?", answer: "Yes" }] }, user));
  return waitFor(app, session.id, (s) => s.phase === "complete", user);
}
