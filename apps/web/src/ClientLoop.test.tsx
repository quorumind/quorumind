/** @vitest-environment happy-dom */
import "./test/dom.ts";
import type { Questionnaire, Session } from "@quorumind/core";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ClientLoop } from "./ClientLoop.tsx";
import { failure, json, stubApi } from "./test/dom.ts";
import { demoSession } from "./test/sessions.ts";

let complete: Session;
beforeAll(async () => {
  complete = { ...(await demoSession("complete")), id: "s1" };
});

const DAY = 86_400_000;
function questionnaire(change: Partial<Questionnaire> = {}): Questionnaire {
  return {
    id: "q1",
    sessionId: "s1",
    token: "qt",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    expiresAt: new Date(Date.now() + 10 * DAY).toISOString(),
    hasPassword: false,
    client: "Acme",
    message: null,
    questions: [{ id: "q1-1", text: "How many studios?", why: null, origin: "open_question" }],
    answers: [],
    status: "open",
    submittedAt: null,
    submittedBy: null,
    revision: 1,
    appliedRevision: null,
    ...change,
  } as Questionnaire;
}

const submitted = (change: Partial<Questionnaire> = {}) =>
  questionnaire({
    status: "submitted",
    submittedAt: "2026-10-02T00:00:00.000Z",
    submittedBy: "client",
    answers: [{ questionId: "q1-1", answer: "Twelve", comment: null }],
    ...change,
  });

/** The card's "Update the recommendation", not the one of the new facts form below it. */
const updateButton = () => document.querySelector<HTMLButtonElement>(".client-loop > .stack .button-primary");

describe("the client loop", () => {
  it("asks for one revision from the same answers, never a second paid one", async () => {
    let list = [submitted()];
    const { calls } = stubApi({
      "GET /api/sessions/s1/questionnaires": () => json({ questionnaires: list }),
      "POST /api/sessions/s1/questionnaires/q1/revision": () => json({ accepted: true, revision: 2 }),
    });
    const view = render(<ClientLoop session={complete} price={null} onClient={vi.fn()} />);
    await screen.findByText(/Answered on/);
    fireEvent.click(updateButton() as HTMLButtonElement);
    await waitFor(() => expect(calls.filter((call) => call.method === "POST")).toHaveLength(1));

    // The new revision arrives before the server recorded which questionnaire it came from: the list still shows the
    // answers as not applied, and the button must stay disabled.
    const revised = { ...complete, revisions: [...complete.revisions, { ...complete.revisions[0], number: 2 }] } as Session;
    view.rerender(<ClientLoop session={revised} price={null} onClient={vi.fn()} />);
    await waitFor(() => expect(calls.filter((call) => call.path.endsWith("/questionnaires")).length).toBeGreaterThan(1));
    expect(updateButton()?.disabled).toBe(true);
    fireEvent.click(updateButton() as HTMLButtonElement);
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);

    // Once the list says it was applied, the card says so and offers nothing more.
    list = [submitted({ appliedRevision: 2 })];
    act(() => window.dispatchEvent(new Event("focus")));
    await screen.findByText("Version 2 was made from these answers.");
    expect(updateButton()).toBeNull();
  });

  it("shows the client's answers without a reload of the page", async () => {
    let list = [questionnaire()];
    stubApi({ "GET /api/sessions/s1/questionnaires": () => json({ questionnaires: list }) });
    render(<ClientLoop session={complete} price={null} onClient={vi.fn()} />);
    await screen.findByText("Waiting for answers");
    list = [submitted()];
    act(() => window.dispatchEvent(new Event("focus")));
    await screen.findByText(/Answered on/);
  });

  it("extends an open questionnaire that expired, and removes its password", async () => {
    const { calls } = stubApi({
      "GET /api/sessions/s1/questionnaires": () =>
        json({ questionnaires: [questionnaire({ expiresAt: new Date(Date.now() - DAY).toISOString(), hasPassword: true })] }),
      "PATCH /api/sessions/s1/questionnaires/q1": () => json({ questionnaire: questionnaire() }),
    });
    render(<ClientLoop session={complete} price={null} onClient={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit the questions" }));
    fireEvent.change(screen.getByLabelText("Link valid for"), { target: { value: "7d" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Remove the password" }));
    fireEvent.click(screen.getByRole("button", { name: "Save the changes" }));
    await waitFor(() => expect(calls.find((call) => call.method === "PATCH")?.body).toMatchObject({ expiresIn: "7d", password: null }));
  });

  it("keeps the date of a questionnaire that is edited without extending it", async () => {
    const { calls } = stubApi({
      "GET /api/sessions/s1/questionnaires": () => json({ questionnaires: [questionnaire()] }),
      "PATCH /api/sessions/s1/questionnaires/q1": () => json({ questionnaire: questionnaire() }),
    });
    render(<ClientLoop session={complete} price={null} onClient={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit the questions" }));
    fireEvent.click(screen.getByRole("button", { name: "Save the changes" }));
    await waitFor(() => expect(calls.find((call) => call.method === "PATCH")).toBeTruthy());
    const body = calls.find((call) => call.method === "PATCH")?.body as Record<string, unknown>;
    expect(body).not.toHaveProperty("expiresIn");
    expect(body).not.toHaveProperty("password");
  });

  it("says when the questionnaires cannot be loaded, and tries again", async () => {
    let fail = true;
    stubApi({
      "GET /api/sessions/s1/questionnaires": () => (fail ? failure(500, "internal_error") : json({ questionnaires: [] })),
    });
    render(<ClientLoop session={complete} price={null} onClient={vi.fn()} />);
    await screen.findByRole("alert");
    expect(screen.queryByRole("button", { name: "Prepare a questionnaire" })).toBeNull();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("button", { name: "Prepare a questionnaire" });
  });
});
