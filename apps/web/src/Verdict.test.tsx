/** @vitest-environment happy-dom */
import "./test/dom.ts";
import type { Session, Verdict as VerdictData, VerdictRevision } from "@quorumind/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { AccessContext, FULL_ACCESS } from "./access.tsx";
import { BrandingSettings } from "./components/BrandingSettings.tsx";
import { ProfileSettings } from "./components/ProfileSettings.tsx";
import { failure, json, stubApi } from "./test/dom.ts";
import { demoSession } from "./test/sessions.ts";
import { Verdict } from "./Verdict.tsx";

let complete: Session;
beforeAll(async () => {
  complete = { ...(await demoSession("complete")), id: "s1" };
});

const routes = {
  "GET /api/sessions/s1/questionnaires": () => json({ questionnaires: [] }),
  "GET /api/config": () => json({ typedNames: false }),
};

function renderVerdict(
  session: Session,
  feedback: { kind: "rating" | "error"; helpful: boolean | null; comment: string; createdAt: string }[] = [],
) {
  return render(
    <AccessContext.Provider value={FULL_ACCESS}>
      <Verdict session={session} feedback={feedback} />
    </AccessContext.Provider>,
  );
}

/** The session with a scenario (revision 2) branching from the verdict, adopted or not, and later revisions. */
function withRevisions(session: Session, adopted: number | null, extra: VerdictRevision[] = []): Session {
  const first = session.revisions[0] as VerdictRevision;
  const scenario: VerdictRevision = {
    ...first,
    number: 2,
    reason: "scenario",
    basedOn: 1,
    scenario: { title: "Smaller team", question: null, changes: [{ kind: "team", delta: -1 }] },
  } as VerdictRevision;
  return { ...session, revisions: [first, scenario, ...extra], adopted };
}

describe("the entrance of the ruling", () => {
  const panel = () => document.querySelector(".verdict-panel");
  const open = (session: Session, arrival: boolean) =>
    render(
      <AccessContext.Provider value={FULL_ACCESS}>
        <Verdict session={session} arrival={arrival} />
      </AccessContext.Provider>,
    );

  it("is at rest when the page opens on a verdict that was already there", () => {
    stubApi(routes);
    open({ ...complete, id: "rest" }, false);
    expect(panel()?.hasAttribute("data-entering")).toBe(false);
  });

  it("plays once for a verdict rendered while the page was open, not when the tab is shown again", () => {
    stubApi(routes);
    const first = open({ ...complete, id: "fresh" }, true);
    expect(panel()?.getAttribute("data-entering")).toBe("true");
    first.unmount();
    // The person went to another tab and came back: the panel is mounted again, with the same arrival flag.
    open({ ...complete, id: "fresh" }, true);
    expect(panel()?.hasAttribute("data-entering")).toBe(false);
  });
});

describe("the feedback box", () => {
  it("does not ask again whoever already rated, even when the feedback arrives after the verdict", async () => {
    stubApi(routes);
    const view = renderVerdict(complete);
    expect(screen.getAllByText("Did this verdict help you?").length).toBeGreaterThan(0);
    view.rerender(
      <AccessContext.Provider value={FULL_ACCESS}>
        <Verdict session={complete} feedback={[{ kind: "rating", helpful: true, comment: "", createdAt: "" }]} />
      </AccessContext.Provider>,
    );
    expect(screen.queryAllByText("Did this verdict help you?")).toHaveLength(0);
  });

  it("says why a rating could not be sent", async () => {
    stubApi({ ...routes, "POST /api/sessions/s1/feedback": () => failure(429, "rate_limited") });
    renderVerdict(complete);
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Too many requests. Try again in a few minutes.");
  });
});

describe("the revision shown", () => {
  it("follows the session once a scenario is adopted, to any later revision", async () => {
    stubApi({ ...routes, "PUT /api/sessions/s1/adopted": () => json({ adopted: 2, decision: null }) });
    const view = renderVerdict(withRevisions(complete, null));
    fireEvent.change(screen.getByLabelText("Version shown"), { target: { value: "2" } });
    fireEvent.click(await screen.findByRole("button", { name: "Adopt this scenario as the decision" }));
    // The adoption reaches the page, then new facts make revision 3, the new current one.
    view.rerender(
      <AccessContext.Provider value={FULL_ACCESS}>
        <Verdict session={withRevisions(complete, 2)} />
      </AccessContext.Provider>,
    );
    const third = { ...(complete.revisions[0] as VerdictRevision), number: 3, reason: "edit", basedOn: 2 } as VerdictRevision;
    view.rerender(
      <AccessContext.Provider value={FULL_ACCESS}>
        <Verdict session={withRevisions(complete, null, [third])} />
      </AccessContext.Provider>,
    );
    await waitFor(() => expect((screen.getByLabelText("Version shown") as HTMLSelectElement).value).toBe("3"));
    expect(screen.queryByText(/You are reading revision/)).toBeNull();
  });
});

describe("saved settings that cannot be loaded", () => {
  it("keep the profile form disabled, so that saving cannot erase them", async () => {
    let fail = true;
    stubApi({ "GET /api/profile": () => (fail ? failure(500, "internal_error") : json({ profile: null })) });
    render(<ProfileSettings defaultCurrency="EUR" />);
    await screen.findByRole("alert");
    expect((screen.getByRole("button", { name: "Save the profile" }) as HTMLButtonElement).disabled).toBe(true);
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Save the profile" }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("keep the branding form disabled too", async () => {
    stubApi({ "GET /api/branding": () => failure(503, "internal_error") });
    render(<BrandingSettings />);
    await screen.findByRole("alert");
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Restore Quorumind's branding" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

/** The session with its verdict, and every revision's, changed the same way. */
function withVerdict(session: Session, change: (verdict: VerdictData) => VerdictData): Session {
  const verdict = change(session.verdict as VerdictData);
  return { ...session, verdict, revisions: session.revisions.map((revision) => ({ ...revision, verdict: change(revision.verdict) })) };
}

describe("what the models wrote", () => {
  it("keeps the paragraphs of the rationale", () => {
    stubApi(routes);
    const rationale = "Option A meets every hard constraint.\n\nOption B needs a second developer.";
    renderVerdict(withVerdict(complete, (verdict) => ({ ...verdict, recommendation: { ...verdict.recommendation, rationale } })));
    const shown = screen.getByText((_, element) => element?.tagName === "P" && element.textContent === rationale);
    expect(shown.className).toContain("model-text");
  });
});

describe("the open questions", () => {
  it("are listed even when the verdict makes no key claim", () => {
    stubApi(routes);
    renderVerdict(
      withVerdict(complete, (verdict) => ({
        ...verdict,
        claims: [],
        openQuestions: ["Can members pay at the desk, as option B assumes?"],
      })),
    );
    expect(screen.getByRole("heading", { name: "Open questions" })).toBeTruthy();
    expect(screen.getByText("Can members pay at the desk, as option B assumes?")).toBeTruthy();
  });
});

describe("the versions for another reader", () => {
  it("say only their card changes, announce the version shown, and give the focus to a version written once it arrives", async () => {
    stubApi({ ...routes, "POST /api/sessions/s1/brief": () => json({}) });
    const cto = { headline: "Ship the monolith first", summary: "One codebase, one deploy.", sections: [], nextSteps: [] };
    const unwritten = { ...complete, briefs: {} };
    const view = renderVerdict(unwritten);
    expect(screen.queryByText(/Only this version changes/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "CTO" }));
    expect(screen.getByText("Only this version changes; the rest of the verdict stays the same.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Write this version" }));
    // The version arrives with the session's next event.
    view.rerender(
      <AccessContext.Provider value={FULL_ACCESS}>
        <Verdict session={{ ...unwritten, briefs: { cto } }} feedback={[]} />
      </AccessContext.Provider>,
    );
    await waitFor(() => expect(document.activeElement?.id).toBe("brief-headline"));
    expect(document.activeElement?.textContent).toBe(cto.headline);
    expect(screen.getAllByRole("status").some((status) => status.textContent === "CTO version shown")).toBe(true);
  });
});
