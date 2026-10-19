import { type APIRequestContext, expect, type Page } from "@playwright/test";

/** The self-hosted server of the browser tests, and the hosted workspace (playwright.config.ts starts both). */
export const LOCAL = "http://127.0.0.1:8811";
export const HOSTED = "http://127.0.0.1:8812";

interface SessionLike {
  id: string;
  phase: string;
}

/** Starts a demo session through the API, as the person would from the home page. */
export async function startDemo(
  request: APIRequestContext,
  base = LOCAL,
  headers: Record<string, string> = {},
  locale = "en",
): Promise<string> {
  const response = await request.post(`${base}/api/sessions`, {
    headers,
    data: { locale, idea: "", demo: true, mode: "standard", template: null, complianceTemplates: [], europeanOnly: false },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return ((await response.json()) as { session: SessionLike }).session.id;
}

/** Waits until the session reaches a phase, polling the API. */
export async function waitForPhase(
  request: APIRequestContext,
  id: string,
  phase: string,
  base = LOCAL,
  headers: Record<string, string> = {},
) {
  await expect
    .poll(
      async () => {
        const response = await request.get(`${base}/api/sessions/${id}`, { headers });
        const body = (await response.json()) as { session: SessionLike; busy: boolean };
        return body.busy ? "busy" : body.session.phase;
      },
      { timeout: 60_000 },
    )
    .toBe(phase);
}

/** Takes a demo session to its verdict through the API: interview, requirements, the debate's questions. */
export async function demoToVerdict(
  request: APIRequestContext,
  base = LOCAL,
  headers: Record<string, string> = {},
  locale = "en",
): Promise<string> {
  const id = await startDemo(request, base, headers, locale);
  await waitForPhase(request, id, "interview", base, headers);
  await expect
    .poll(
      async () =>
        ((await (await request.get(`${base}/api/sessions/${id}`, { headers })).json()) as { session: { interview: unknown[] } }).session
          .interview.length,
      {
        timeout: 60_000,
      },
    )
    .toBeGreaterThan(0);
  await request.post(`${base}/api/sessions/${id}/interview`, { headers, data: { answers: [{ question: "Budget?", answer: "€15,000" }] } });
  await waitForPhase(request, id, "review", base, headers);
  const { session } = (await (await request.get(`${base}/api/sessions/${id}`, { headers })).json()) as { session: { sheet: unknown } };
  await request.put(`${base}/api/sessions/${id}/sheet`, { headers, data: { sheet: session.sheet } });
  await waitForPhase(request, id, "awaiting_answers", base, headers);
  await request.post(`${base}/api/sessions/${id}/answers`, { headers, data: { answers: [{ question: "Hosted?", answer: "Yes" }] } });
  await waitForPhase(request, id, "complete", base, headers);
  return id;
}

/** Fails the test on any error the page logs, React's key warnings included. */
export function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || /unique "key"/.test(message.text())) problems.push(message.text());
  });
  page.on("pageerror", (error) => problems.push(error.message));
  return problems;
}
