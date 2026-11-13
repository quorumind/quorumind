/** @vitest-environment happy-dom */
import "./test/dom.ts";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ClientQuestionnaire } from "./ClientQuestionnaire.tsx";
import { json, stubApi } from "./test/dom.ts";

const view = (status: "open" | "submitted", answers: { questionId: string; answer: string; comment: null }[] = []) => ({
  questionnaire: {
    id: "q1",
    locale: "en",
    project: "Studio booking",
    client: "Acme",
    message: null,
    status,
    expiresAt: "2030-01-01T00:00:00.000Z",
    submittedAt: status === "submitted" ? "2029-01-01T00:00:00.000Z" : null,
    questions: [
      { id: "a", text: "How many studios?", why: null },
      { id: "b", text: "Which payment provider?", why: null },
    ],
    answers,
  },
  branding: { name: null, accent: null, logoDataUrl: null },
});

function stub() {
  let sent: unknown = null;
  stubApi({
    "GET /api/questionnaire/tok": () => json(view("open")),
    "POST /api/questionnaire/tok/answers": ({ body }) => {
      sent = body;
      return json({ questionnaire: view("submitted", [{ questionId: "a", answer: "Twelve", comment: null }]).questionnaire });
    },
  });
  return () => sent;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("the client's questionnaire", () => {
  it("keeps the draft for later visits, not only for the tab", async () => {
    stub();
    render(<ClientQuestionnaire token="tok" />);
    fireEvent.change((await screen.findAllByLabelText("Your answer"))[0] as HTMLElement, { target: { value: "Twelve" } });
    cleanup();
    // A new tab the next day: sessionStorage is gone, localStorage is not.
    sessionStorage.clear();
    render(<ClientQuestionnaire token="tok" />);
    expect(((await screen.findAllByLabelText("Your answer"))[0] as HTMLTextAreaElement).value).toBe("Twelve");
  });

  it("forgets a draft left for too long", async () => {
    stub();
    localStorage.setItem(
      "quorumind.questionnaire.tok.draft",
      JSON.stringify({ savedAt: Date.now() - 90 * 86_400_000, answers: { a: { answer: "Old", comment: "" } } }),
    );
    render(<ClientQuestionnaire token="tok" />);
    expect(((await screen.findAllByLabelText("Your answer"))[0] as HTMLTextAreaElement).value).toBe("");
  });

  it("asks before sending answers left empty, and sends them only when confirmed", async () => {
    const sent = stub();
    render(<ClientQuestionnaire token="tok" />);
    fireEvent.change((await screen.findAllByLabelText("Your answer"))[0] as HTMLElement, { target: { value: "Twelve" } });
    fireEvent.click(screen.getByRole("button", { name: "Send my answers" }));
    const dialog = await screen.findByRole("dialog", { name: /Some questions have no answer/ });
    expect(sent()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Send anyway" }));
    await waitFor(() => expect(sent()).not.toBeNull());
    expect(dialog).toBeTruthy();
  });

  it("sends complete answers without a question, and moves the focus to the thanks", async () => {
    const sent = stub();
    render(<ClientQuestionnaire token="tok" />);
    const fields = await screen.findAllByLabelText("Your answer");
    fireEvent.change(fields[0] as HTMLElement, { target: { value: "Twelve" } });
    fireEvent.change(fields[1] as HTMLElement, { target: { value: "Stripe" } });
    fireEvent.click(screen.getByRole("button", { name: "Send my answers" }));
    await waitFor(() => expect(sent()).not.toBeNull());
    const thanks = await screen.findByText(/Thank you: your answers were sent/);
    await waitFor(() => expect(document.activeElement).toBe(thanks.closest("[tabindex]")));
    expect(localStorage.getItem("quorumind.questionnaire.tok.draft")).toBeNull();
  });
});

describe("the top of the client's page", () => {
  it("names the agency and lets the client read the page in another language, for this link only", async () => {
    stubApi({
      "GET /api/questionnaire/tok": () => json({ ...view("open"), branding: { name: "Atelier Nord", accent: null, logoDataUrl: null } }),
    });
    render(<ClientQuestionnaire token="tok" />);
    const bar = (await screen.findByText("Atelier Nord")).closest("header") as HTMLElement;
    const language = screen.getByRole("combobox", { name: "Language" }) as HTMLSelectElement;
    expect(bar.contains(language)).toBe(true);
    expect(language.value).toBe("en");
    fireEvent.change(language, { target: { value: "fr" } });
    await waitFor(() => expect(document.documentElement.lang).toBe("fr"));
    // Kept for this link in the tab, never as the app's language.
    expect(sessionStorage.getItem("quorumind.questionnaire.tok.language")).toBe("fr");
    expect(localStorage.getItem("quorumind.locale")).toBeNull();
    cleanup();
    await waitFor(() => expect(document.documentElement.lang).toBe("en"));
  });

  it("says a link that leads nowhere no longer works, with a heading, and who to ask", async () => {
    stubApi({ "GET /api/questionnaire/tok": () => json({ error: "not_found", message: "gone" }, 404) });
    render(<ClientQuestionnaire token="tok" />);
    expect(await screen.findByRole("heading", { level: 1, name: "This link no longer works" })).toBeTruthy();
    expect(screen.getByText(/Ask the person who sent it to you for a new one/)).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
