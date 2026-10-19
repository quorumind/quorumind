import { createSession, DEMO_IDEA, DEMO_LINEUP, DebateEngine, MockProvider, providersFor, type Session } from "@quorumind/core";

// Real sessions for the component tests, made by the debate engine on the recorded demo: one per phase the
// interface shows differently.

export type Stage = "interview" | "review" | "awaiting_answers" | "complete";

export async function demoSession(stage: Stage, locale = "en"): Promise<Session> {
  const providers = providersFor(DEMO_LINEUP, {}, { mockDelayMs: 0 });
  const engine = new DebateEngine(
    { ...providers, devil: providers.devil ?? new MockProvider({ chunkDelayMs: 0 }) },
    { emit: () => undefined, save: () => undefined },
  );
  const session = createSession({ locale: locale as "en", idea: DEMO_IDEA, demo: true, budgetUsd: null, ...DEMO_LINEUP });
  await engine.startInterview(session);
  if (stage === "interview") return structuredClone(session);
  await engine.answerInterview(session, [{ question: "Budget?", answer: "€15,000 and €400 a month" }]);
  if (stage === "review" || !session.sheet) return structuredClone(session);
  await engine.confirmSheet(session, session.sheet);
  await engine.runDebate(session);
  if (stage === "awaiting_answers") return structuredClone(session);
  if (session.phase === "awaiting_answers") {
    await engine.answerDebate(session, [{ question: "Hosted platform?", answer: "Yes, if it fits the cap" }]);
    await engine.runDebate(session);
  }
  return structuredClone(session);
}
