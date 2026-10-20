/** @vitest-environment happy-dom */
import "./test/dom.ts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AccessContext, FULL_ACCESS } from "./access.tsx";
import { Interview } from "./Interview.tsx";
import { json, stubApi } from "./test/dom.ts";
import { demoSession } from "./test/sessions.ts";

async function renderInterview() {
  const session = await demoSession("interview");
  render(
    <AccessContext.Provider value={FULL_ACCESS}>
      <Interview session={session} live={{}} />
    </AccessContext.Provider>,
  );
  return session;
}

describe("the interview's questions", () => {
  it("name each topic once, above its questions", async () => {
    await renderInterview();
    expect(screen.getByText("Budget")).toBeTruthy();
    expect(screen.getByText("Team")).toBeTruthy();
    expect(screen.getByText("0 of 3 answered", { exact: false })).toBeTruthy();
  });

  it("add the example answers picked to the answer, and take them back when picked again", async () => {
    await renderInterview();
    const answer = screen.getByLabelText("Are there constraints you cannot negotiate?") as HTMLTextAreaElement;
    const eu = screen.getByRole("button", { name: "Member data must stay in the EU" });
    const september = screen.getByRole("button", { name: "Must launch before September" });

    fireEvent.click(eu);
    fireEvent.click(september);
    expect(answer.value).toBe("Member data must stay in the EU\nMust launch before September");
    expect(eu.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(eu);
    expect(answer.value).toBe("Must launch before September");
    expect(eu.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByText("1 of 3 answered", { exact: false })).toBeTruthy();
  });

  it("keep one example on a question with one possible answer, and what the person wrote", async () => {
    await renderInterview();
    const answer = screen.getByLabelText("Who will build and maintain it?") as HTMLTextAreaElement;
    fireEvent.change(answer, { target: { value: "Ideally by June" } });
    fireEvent.click(screen.getByRole("button", { name: "An agency" }));
    fireEvent.click(screen.getByRole("button", { name: "Nobody technical in-house" }));
    expect(answer.value).toBe("Ideally by June\nNobody technical in-house");
    expect(screen.getByRole("button", { name: "An agency" }).getAttribute("aria-pressed")).toBe("false");
    // Only the questions whose examples combine say so.
    expect(screen.getAllByText("Several answers possible")).toHaveLength(1);
  });

  it("let “I don't know” replace the answer, and give it back when picked again", async () => {
    await renderInterview();
    const answer = screen.getByLabelText("Who will build and maintain it?") as HTMLTextAreaElement;
    fireEvent.change(answer, { target: { value: "Two developers, maybe a freelancer" } });
    const unknown = screen.getAllByRole("button", { name: "I don't know" })[1] as HTMLElement;
    fireEvent.click(unknown);
    expect(answer.value).toBe("I don't know");
    fireEvent.click(unknown);
    expect(answer.value).toBe("Two developers, maybe a freelancer");
  });

  it("treat the examples of a question that does not say whether they combine as one choice", async () => {
    const session = await demoSession("interview");
    const asked = session.interview[0];
    if (asked?.kind !== "interviewer") throw new Error("The demo starts with the interviewer.");
    // A session stored before questions said whether their examples combine.
    asked.data.questions = asked.data.questions.map(({ multiple: _, ...question }) => question);
    render(
      <AccessContext.Provider value={FULL_ACCESS}>
        <Interview session={session} live={{}} />
      </AccessContext.Provider>,
    );
    const answer = screen.getByLabelText("Are there constraints you cannot negotiate?") as HTMLTextAreaElement;
    fireEvent.click(screen.getByRole("button", { name: "Member data must stay in the EU" }));
    fireEvent.click(screen.getByRole("button", { name: "None" }));
    expect(answer.value).toBe("None");
    expect(screen.queryByText("Several answers possible")).toBeNull();
  });

  it("recognise a picked example whatever its punctuation, and show “I don't know” pressed only when it is the answer", async () => {
    const session = await demoSession("interview");
    const asked = session.interview[0];
    if (asked?.kind !== "interviewer") throw new Error("The demo starts with the interviewer.");
    const [budget] = asked.data.questions;
    if (!budget) throw new Error("The demo asks about the budget first.");
    asked.data.questions[0] = { ...budget, examples: ["€15,000 to build; €400 a month", "As little as possible"] };
    render(
      <AccessContext.Provider value={FULL_ACCESS}>
        <Interview session={session} live={{}} />
      </AccessContext.Provider>,
    );
    const answer = screen.getByLabelText("What can you spend to build it, and each month to run it?") as HTMLTextAreaElement;
    const example = screen.getByRole("button", { name: "€15,000 to build; €400 a month" });
    fireEvent.click(example);
    expect(example.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(example);
    expect(answer.value).toBe("");

    const unknown = screen.getAllByRole("button", { name: "I don't know" })[0] as HTMLElement;
    fireEvent.change(answer, { target: { value: "Two devs\nI don't know" } });
    expect(unknown.getAttribute("aria-pressed")).toBe("false");
  });

  it("never let a picked example make an answer longer than the server takes", async () => {
    await renderInterview();
    const answer = screen.getByLabelText("Are there constraints you cannot negotiate?") as HTMLTextAreaElement;
    const long = "x".repeat(3_990);
    fireEvent.change(answer, { target: { value: long } });
    fireEvent.click(screen.getByRole("button", { name: "Member data must stay in the EU" }));
    expect(answer.value).toBe(long);
  });

  it("keep what “I don't know” replaced in the draft, to give it back after a reload", async () => {
    localStorage.clear();
    const session = await demoSession("interview");
    const view = () => (
      <AccessContext.Provider value={FULL_ACCESS}>
        <Interview session={session} live={{}} />
      </AccessContext.Provider>
    );
    const first = render(view());
    fireEvent.change(screen.getByLabelText("Who will build and maintain it?"), { target: { value: "Two developers" } });
    fireEvent.click(screen.getAllByRole("button", { name: "I don't know" })[1] as HTMLElement);
    first.unmount();

    render(view());
    const answer = screen.getByLabelText("Who will build and maintain it?") as HTMLTextAreaElement;
    expect(answer.value).toBe("I don't know");
    fireEvent.click(screen.getAllByRole("button", { name: "I don't know" })[1] as HTMLElement);
    expect(answer.value).toBe("Two developers");
  });

  it("drop the draft once the interview is over", async () => {
    const session = await demoSession("review");
    localStorage.setItem(`quorumind.interviewDraft.${session.id}`, JSON.stringify({ turn: 0, answers: { team: "An agency" } }));
    render(
      <AccessContext.Provider value={FULL_ACCESS}>
        <Interview session={session} live={{}} />
      </AccessContext.Provider>,
    );
    expect(localStorage.getItem(`quorumind.interviewDraft.${session.id}`)).toBeNull();
  });

  it("keep the answers being written in the browser until they are sent", async () => {
    localStorage.clear();
    const session = await demoSession("interview");
    const view = () => (
      <AccessContext.Provider value={FULL_ACCESS}>
        <Interview session={session} live={{}} />
      </AccessContext.Provider>
    );
    const first = render(view());
    fireEvent.click(screen.getByRole("button", { name: "An agency" }));
    first.unmount();

    render(view());
    expect((screen.getByLabelText("Who will build and maintain it?") as HTMLTextAreaElement).value).toBe("An agency");
    stubApi({ [`POST /api/sessions/${session.id}/interview`]: () => json({}) });
    fireEvent.keyDown(screen.getByLabelText("Who will build and maintain it?"), { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(localStorage.getItem(`quorumind.interviewDraft.${session.id}`)).toBeNull());
  });

  it("show the answers sent under the topics of their questions", async () => {
    const session = await demoSession("review");
    // The answers as the form sends them: one per question asked, by its text.
    session.interview[1] = {
      kind: "user",
      answers: [
        { question: "What can you spend to build it, and each month to run it?", answer: "€15,000 and €400 a month" },
        { question: "Who will build and maintain it?", answer: "An agency" },
      ],
    };
    render(
      <AccessContext.Provider value={FULL_ACCESS}>
        <Interview session={session} live={{}} />
      </AccessContext.Provider>,
    );
    const sent = screen.getByText("€15,000 and €400 a month").closest(".bubble") as HTMLElement;
    expect([...sent.querySelectorAll(".question-topic")].map((topic) => topic.textContent)).toEqual(["Budget", "Team"]);
  });

  it("send the questions left blank as “I don't know”", async () => {
    const session = await renderInterview();
    const { calls } = stubApi({ [`POST /api/sessions/${session.id}/interview`]: () => json({}) });
    fireEvent.click(screen.getByRole("button", { name: "An agency" }));
    fireEvent.click(screen.getByRole("button", { name: /Send answers/ }));
    await waitFor(() => expect(calls).toHaveLength(1));
    const body = calls[0]?.body as { answers: { answer: string }[] } | undefined;
    expect(body?.answers.map((entry) => entry.answer)).toEqual(["I don't know", "An agency", "I don't know"]);
  });
});
