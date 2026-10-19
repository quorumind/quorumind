import { inflateRawSync } from "node:zlib";
import { createSession, type PublicQuestionnaire, type Questionnaire, type Session } from "@quorumind/core";
import { afterEach, describe, expect, it } from "vitest";
import type { User } from "./app.ts";
import type { Notifier, NotifyReason } from "./notifier.ts";
import { QUESTIONNAIRE_RATE_LIMITS } from "./questionnaires.ts";
import { SHARE_ATTEMPT_LIMITS } from "./share.ts";
import type { StoredQuestionnaire } from "./store.ts";
import { BACKENDS, type TestStorage } from "./testing.ts";
import { as, detail, hostedHooks, openApp, ruled, send, type TestApp, waitFor } from "./testing-app.ts";

let storage: TestStorage | null = null;

afterEach(async () => {
  await storage?.close();
  storage = null;
});

/** The text of word/document.xml in a .docx: the first deflated entry with that name. */
function documentXml(archive: ArrayBuffer): string {
  const bytes = Buffer.from(archive);
  let offset = 0;
  while (offset < bytes.length - 30 && bytes.readUInt32LE(offset) === 0x04034b50) {
    const size = bytes.readUInt32LE(offset + 18);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extra = bytes.readUInt16LE(offset + 28);
    const name = bytes.toString("utf8", offset + 30, offset + 30 + nameLength);
    const start = offset + 30 + nameLength + extra;
    if (name === "word/document.xml") return inflateRawSync(bytes.subarray(start, start + size)).toString("utf8");
    offset = start + size;
  }
  throw new Error("No word/document.xml");
}

interface Sent {
  reason: NotifyReason;
  recipient: string | null;
  sessionId: string;
}

async function setup(backend: (typeof BACKENDS)[number], extra: Parameters<typeof hostedHooks>[0] = {}) {
  const sent: Sent[] = [];
  const submitted: { owner: User | null; questionnaire: Questionnaire }[] = [];
  const notifier: Notifier = {
    async notify(session, reason, recipient) {
      sent.push({ reason, recipient, sessionId: session.id });
    },
  };
  const opened = await openApp(
    backend,
    hostedHooks({
      notifyRecipient: async (user) => `${user.userId}@agency.example`,
      onQuestionnaireSubmitted: (owner, _session, questionnaire) => {
        submitted.push({ owner, questionnaire });
      },
      ...extra,
    }),
    notifier,
  );
  storage = opened.storage;
  await opened.storage.brandingStore.set("ada", { name: "Atelier Nord", logoDataUrl: null, accent: "#aa3366" });
  return { app: opened.app, sent, submitted };
}

async function createQuestionnaire(app: TestApp, session: Session, body: Record<string, unknown> = {}) {
  const response = await app.request(`/api/sessions/${session.id}/questionnaires`, send(body));
  expect(response.status).toBe(201);
  return ((await response.json()) as { questionnaire: Questionnaire }).questionnaire;
}

const open = (app: TestApp, token: string, headers: Record<string, string> = {}) => app.request(`/api/questionnaire/${token}`, { headers });
const answer = (app: TestApp, token: string, answers: unknown, headers: Record<string, string> = {}) =>
  app.request(`/api/questionnaire/${token}/answers`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ answers }),
  });

describe.each(BACKENDS)("questionnaires on $name", (backend) => {
  it("go to the client without an account, branded and in the session's language, and are answered once", async () => {
    const { app, sent, submitted } = await setup(backend);
    const session = await ruled(app, "ada", "fr");
    const questionnaire = await createQuestionnaire(app, session, { client: "Studio Collectif" });
    expect(questionnaire).toMatchObject({
      status: "open",
      hasPassword: false,
      client: "Studio Collectif",
      revision: 1,
      appliedRevision: null,
      questions: [{ id: "q1", text: "Which SMS provider meets the cost assumption?", why: null, origin: "open_question" }],
    });
    expect(JSON.stringify(questionnaire)).not.toContain("passwordHash");
    expect(Math.round((Date.parse(questionnaire.expiresAt) - Date.now()) / 86_400_000)).toBe(30);

    // The client's page: no account, the questions, the project, the agency's branding; never the session.
    const page = await open(app, questionnaire.token);
    expect(page.status).toBe(200);
    const body = (await page.json()) as { questionnaire: PublicQuestionnaire; branding: { name: string; accent: string } };
    expect(body.questionnaire).toMatchObject({
      locale: "fr",
      project: session.sheet?.projectName,
      status: "open",
      client: "Studio Collectif",
    });
    expect(body.branding).toMatchObject({ name: "Atelier Nord", accent: "#aa3366" });
    const text = JSON.stringify(body);
    for (const hidden of ["critiques", "usage", "€15,000", "Hosted?", session.id, "proposals"]) expect(text, hidden).not.toContain(hidden);

    const submittedResponse = await answer(app, questionnaire.token, [
      { questionId: "q1", answer: "Brevo, about €0.04 per SMS", comment: "Already under contract" },
      { questionId: "unknown", answer: "Ignored", comment: null },
    ]);
    expect(submittedResponse.status).toBe(200);
    expect(((await submittedResponse.json()) as { questionnaire: PublicQuestionnaire }).questionnaire).toMatchObject({
      status: "submitted",
      answers: [{ questionId: "q1", answer: "Brevo, about €0.04 per SMS", comment: "Already under contract" }],
    });
    const again = await answer(app, questionnaire.token, [{ questionId: "q1", answer: "Changed my mind", comment: null }]);
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: "already_submitted" });

    // The agency hears it by e-mail and through the host's hook.
    expect(sent).toEqual([expect.objectContaining({ reason: "answers_received", recipient: "ada@agency.example", sessionId: session.id })]);
    expect(submitted).toHaveLength(1);
    expect(submitted[0]?.owner).toEqual({ userId: "ada" });
    expect(submitted[0]?.questionnaire).toMatchObject({ status: "submitted", submittedBy: "client" });

    const listed = (await (await app.request(`/api/sessions/${session.id}/questionnaires`, { headers: as("ada") })).json()) as {
      questionnaires: Questionnaire[];
    };
    expect(listed.questionnaires.map((item) => [item.status, item.answers[0]?.answer])).toEqual([
      ["submitted", "Brevo, about €0.04 per SMS"],
    ]);
  });

  it("make a revision of the verdict from the answers, then can be reopened and answered again", async () => {
    const { app } = await setup(backend);
    const session = await ruled(app);
    const questionnaire = await createQuestionnaire(app, session, {
      questions: [
        { text: "Which SMS provider meets the cost assumption?", origin: "open_question" },
        { text: "Who approves the budget?", why: "We need one decision maker." },
      ],
    });
    expect(questionnaire.questions.map((question) => question.id)).toEqual(["q1", "q2"]);
    const early = await app.request(`/api/sessions/${session.id}/questionnaires/${questionnaire.id}/revision`, send({}));
    expect(await early.json()).toMatchObject({ error: "not_submitted" });

    await answer(app, questionnaire.token, [{ questionId: "q1", answer: "Brevo at €0.04", comment: null }]);
    const update = await app.request(`/api/sessions/${session.id}/questionnaires/${questionnaire.id}/revision`, send({}));
    expect(update.status).toBe(202);
    expect(await update.json()).toEqual({ accepted: true, revision: 2 });
    const revised = await waitFor(app, session.id, (s) => s.revisions.length === 2 && !s.revising);
    expect(revised.revisions[1]).toMatchObject({
      reason: "client_answers",
      by: "ada",
      inputs: {
        questionnaireId: questionnaire.id,
        facts: [{ question: "Which SMS provider meets the cost assumption?", answer: "Brevo at €0.04", comment: null }],
      },
    });
    const applied = async () =>
      (
        (await (await app.request(`/api/sessions/${session.id}/questionnaires`, { headers: as("ada") })).json()) as {
          questionnaires: Questionnaire[];
        }
      ).questionnaires[0];
    expect((await applied())?.appliedRevision).toBe(2);

    // Questions change only while it is open; reopened, the client may answer again, starting from their answers.
    const locked = await app.request(
      `/api/sessions/${session.id}/questionnaires/${questionnaire.id}`,
      send({ questions: [{ text: "Another question?" }] }, "ada", "PATCH"),
    );
    expect(await locked.json()).toMatchObject({ error: "already_submitted" });
    const reopened = await app.request(`/api/sessions/${session.id}/questionnaires/${questionnaire.id}/reopen`, send({}));
    expect(((await reopened.json()) as { questionnaire: Questionnaire }).questionnaire).toMatchObject({ status: "open" });
    const page = (await (await open(app, questionnaire.token)).json()) as { questionnaire: PublicQuestionnaire };
    expect(page.questionnaire.answers[0]?.answer).toBe("Brevo at €0.04");
    expect((await answer(app, questionnaire.token, [{ questionId: "q2", answer: "The owner", comment: null }])).status).toBe(200);
    expect((await applied())?.appliedRevision).toBeNull();
  });

  it("make one revision from the same answers, however many times and at once it is asked", async () => {
    const { app } = await setup(backend);
    const session = await ruled(app);
    const questionnaire = await createQuestionnaire(app, session, { questions: [{ text: "Who approves the budget?" }] });
    await answer(app, questionnaire.token, [{ questionId: "q1", answer: "The owner", comment: null }]);
    const apply = () => app.request(`/api/sessions/${session.id}/questionnaires/${questionnaire.id}/revision`, send({}));
    const [first, second] = await Promise.all([apply(), apply()]);
    expect([first.status, second.status].sort()).toEqual([202, 409]);
    await waitFor(app, session.id, (s) => s.revisions.length === 2 && !s.revising);
    const again = await apply();
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: "already_applied" });
    expect((await detail(app, session.id)).session.revisions).toHaveLength(2);
    // New answers make a new revision.
    await app.request(`/api/sessions/${session.id}/questionnaires/${questionnaire.id}/reopen`, send({}));
    await answer(app, questionnaire.token, [{ questionId: "q1", answer: "The board", comment: null }]);
    expect((await apply()).status).toBe(202);
    await waitFor(app, session.id, (s) => s.revisions.length === 3 && !s.revising);
  });

  it("never give a new question the id of a removed one, nor keep an answer to a question that changed", async () => {
    const { app } = await setup(backend);
    const session = await ruled(app);
    const questionnaire = await createQuestionnaire(app, session, {
      questions: [{ text: "Which SMS provider?" }, { text: "Who approves the budget?" }, { text: "When do you launch?" }],
    });
    await answer(app, questionnaire.token, [
      { questionId: "q1", answer: "Brevo", comment: null },
      { questionId: "q2", answer: "The owner", comment: null },
      { questionId: "q3", answer: "In June", comment: null },
    ]);
    await app.request(`/api/sessions/${session.id}/questionnaires/${questionnaire.id}/reopen`, send({}));
    const patch = async (questions: unknown[]) => {
      const patched = await app.request(
        `/api/sessions/${session.id}/questionnaires/${questionnaire.id}`,
        send({ questions }, "ada", "PATCH"),
      );
      return ((await patched.json()) as { questionnaire: Questionnaire }).questionnaire;
    };
    // q2 removed, q3 reworded, and a new question.
    let next = await patch([
      { id: "q1", text: "Which SMS provider?" },
      { id: "q3", text: "When do you open the first studio?" },
      { text: "Who approves the budget?" },
    ]);
    expect(next.questions.map((question) => question.id).slice(0, 2)).toEqual(["q1", "q3"]);
    expect(next.questions[2]?.id).not.toMatch(/^q[123]$/);
    expect(next.answers).toEqual([{ questionId: "q1", answer: "Brevo", comment: null }]);
    // A question that claims the id of the removed one gets a new id.
    next = await patch([...next.questions, { id: "q2", text: "Who signs the contract?" }]);
    const ids = next.questions.map((question) => question.id);
    expect(ids).not.toContain("q2");
    expect(new Set(ids).size).toBe(4);
  });

  it("ask for their password, expire, and stop guessing and flooding", async () => {
    const { app } = await setup(backend);
    const session = await ruled(app);
    const questionnaire = await createQuestionnaire(app, session, { password: "open sesame", expiresIn: "7d" });
    expect(questionnaire.hasPassword).toBe(true);
    expect(Math.round((Date.parse(questionnaire.expiresAt) - Date.now()) / 86_400_000)).toBe(7);

    const locked = await open(app, questionnaire.token);
    expect(locked.status).toBe(401);
    expect(await locked.json()).toMatchObject({ error: "password_required" });
    expect((await answer(app, questionnaire.token, [])).status).toBe(401);
    const access = async (password: string) =>
      app.request(`/api/questionnaire/${questionnaire.token}/access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
    expect(await (await access("open sesam")).json()).toMatchObject({ error: "wrong_password" });
    const granted = (await (await access("open sesame")).json()) as { access: string };
    const headers = { "X-Questionnaire-Access": granted.access };
    expect((await open(app, questionnaire.token, headers)).status).toBe(200);
    const word = await app.request(
      `/api/questionnaire/${questionnaire.token}/questionnaire.docx?access=${encodeURIComponent(granted.access)}`,
    );
    expect(word.status).toBe(200);

    // A new password revokes the access given before.
    await app.request(`/api/sessions/${session.id}/questionnaires/${questionnaire.id}`, send({ password: "another one" }, "ada", "PATCH"));
    expect((await open(app, questionnaire.token, headers)).status).toBe(401);
    for (let i = 0; i < SHARE_ATTEMPT_LIMITS.caller.perWindow - 1; i++) expect((await access(`guess ${i}`)).status).toBe(401);
    expect(await (await access("another one")).json()).toMatchObject({ error: "too_many_attempts" });

    // Guesses sent all at once are counted before any is checked.
    const other = await createQuestionnaire(app, session, { password: "open sesame" });
    const guesses = await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        app.request(`/api/questionnaire/${other.token}/access`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: `guess ${i}` }),
        }),
      ),
    );
    expect(guesses.filter((response) => response.status === 401)).toHaveLength(SHARE_ATTEMPT_LIMITS.caller.perWindow);

    // An expired link answers 410, until the agency reopens it for another 30 days.
    const stored = (await storage?.store.questionnaire({ id: questionnaire.id })) as StoredQuestionnaire;
    await storage?.store.saveQuestionnaire({ ...stored, passwordHash: null, expiresAt: new Date(Date.now() - 1_000).toISOString() });
    const expired = await open(app, questionnaire.token);
    expect(expired.status).toBe(410);
    expect(await expired.json()).toMatchObject({ error: "questionnaire_expired" });
    await app.request(`/api/sessions/${session.id}/questionnaires/${questionnaire.id}/reopen`, send({}));
    expect((await open(app, questionnaire.token)).status).toBe(200);

    // Reads are counted per link and caller: a page opened too often is refused, the caller's other links are not.
    for (let i = 0; i < QUESTIONNAIRE_RATE_LIMITS.reads.perWindow; i++) await open(app, questionnaire.token);
    const flooded = await open(app, questionnaire.token);
    expect(flooded.status).toBe(429);
    expect(await flooded.json()).toMatchObject({ error: "rate_limited" });
    expect((await open(app, other.token)).status).toBe(401);
    // And per caller across links, against a scan of tokens.
    for (let i = 0; i < QUESTIONNAIRE_RATE_LIMITS.readsPerCaller.perWindow; i++) await open(app, `unknown-${i}`);
    expect((await open(app, other.token)).status).toBe(429);
  });

  it("belong to their agency: only those who may change the session manage them", async () => {
    const { app } = await setup(backend);
    const session = await ruled(app);
    const questionnaire = await createQuestionnaire(app, session);
    expect((await app.request(`/api/sessions/${session.id}/questionnaires`, send({}, "bob"))).status).toBe(404);
    expect((await app.request(`/api/sessions/${session.id}/questionnaires`, { headers: as("bob") })).status).toBe(404);
    expect((await app.request(`/api/sessions/${session.id}/questionnaires/${questionnaire.id}/reopen`, send({}, "bob"))).status).toBe(404);
    expect((await app.request(`/api/sessions/${session.id}/questionnaires/${questionnaire.id}`, send({}, "ada", "PATCH"))).status).toBe(
      200,
    );

    // Another session of the same agency does not reach it.
    const other = await ruled(app);
    expect((await app.request(`/api/sessions/${other.id}/questionnaires/${questionnaire.id}/reopen`, send({}))).status).toBe(404);

    // Answers received by e-mail, recorded by the agency.
    const recorded = await app.request(
      `/api/sessions/${session.id}/questionnaires/${questionnaire.id}/answers`,
      send({ answers: [{ questionId: "q1", answer: "Brevo", comment: null }] }, "ada", "PUT"),
    );
    expect(((await recorded.json()) as { questionnaire: Questionnaire }).questionnaire).toMatchObject({
      status: "submitted",
      submittedBy: "agency",
    });

    const word = await app.request(`/api/sessions/${session.id}/questionnaires/${questionnaire.id}/questionnaire.docx`, {
      headers: as("ada"),
    });
    expect(word.headers.get("Content-Type")).toContain("wordprocessingml");
    const xml = documentXml(await word.arrayBuffer());
    expect(xml).toContain("Atelier Nord");
    expect(xml).toContain("Which SMS provider meets the cost assumption?");
    expect(xml).toContain(`/#/q/${questionnaire.token}`);

    expect(
      (await app.request(`/api/sessions/${session.id}/questionnaires/${questionnaire.id}`, { method: "DELETE", headers: as("ada") }))
        .status,
    ).toBe(204);
    expect((await open(app, questionnaire.token)).status).toBe(404);
    // Deleting the session deletes its questionnaires.
    const kept = await createQuestionnaire(app, session);
    await app.request(`/api/sessions/${session.id}`, { method: "DELETE", headers: as("ada") });
    expect(await storage?.store.questionnaire({ id: kept.id })).toBeNull();
  });

  it("need a verdict and at least one question", async () => {
    const { app } = await setup(backend);
    const created = await app.request("/api/sessions", send({ locale: "en", idea: "A CRM" }));
    const { session } = (await created.json()) as { session: Session };
    await waitFor(app, session.id, (s) => s.interview.length === 1);
    expect(await (await app.request(`/api/sessions/${session.id}/questionnaires`, send({}))).json()).toMatchObject({
      error: "wrong_phase",
    });
    const ruledSession = await ruled(app);
    const invalid = await app.request(`/api/sessions/${ruledSession.id}/questionnaires`, send({ questions: [] }));
    expect(await invalid.json()).toMatchObject({ error: "invalid_request", params: { field: "questions" } });
    expect((await detail(app, ruledSession.id)).session.phase).toBe("complete");
  });
});

describe.each(BACKENDS)("the questionnaire store on $name", (backend) => {
  it("records answers once even when two submissions race", async () => {
    storage = await backend.open();
    const session = createSession({
      locale: "en",
      idea: "Race",
      demo: true,
      interviewer: { provider: "mock", model: "mock" },
      arbiter: { provider: "mock", model: "mock" },
      seats: { A: { provider: "mock", model: "mock" } },
    });
    await storage.store.save(session);
    const now = new Date().toISOString();
    const questionnaire: StoredQuestionnaire = {
      id: "q-race",
      sessionId: session.id,
      token: "token-race",
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      passwordHash: null,
      client: "Client \0 name",
      message: null,
      questions: [{ id: "q1", text: "Budget?", why: null, origin: "agency" }],
      answers: [],
      status: "open",
      submittedAt: null,
      submittedBy: null,
      revision: 1,
      appliedRevision: null,
    };
    await storage.store.saveQuestionnaire(questionnaire);
    const submission = (answer: string) => ({
      answers: [{ questionId: "q1", answer, comment: null }],
      submittedAt: new Date().toISOString(),
      submittedBy: "client" as const,
    });
    const results = await Promise.all([
      storage.store.submitQuestionnaire("q-race", submission("first")),
      storage.store.submitQuestionnaire("q-race", submission("second")),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const stored = await storage.reopen().questionnaire({ token: "token-race" });
    expect(stored).toMatchObject({ status: "submitted", submittedBy: "client", questions: questionnaire.questions });
    expect(["first", "second"]).toContain(stored?.answers[0]?.answer);
    expect(await storage.store.questionnairesOf(session.id)).toHaveLength(1);
    expect(await storage.store.questionnaire({ id: "missing" })).toBeNull();
  });
});
