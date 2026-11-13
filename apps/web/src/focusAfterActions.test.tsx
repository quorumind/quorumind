/** @vitest-environment happy-dom */
import "./test/dom.ts";
import type { Session } from "@quorumind/core";
import { approveDecision } from "@quorumind/core/decisions";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeAll, describe, expect, it } from "vitest";
import { App } from "./App.tsx";
import { AccessContext, AccessLine, FULL_ACCESS } from "./access.tsx";
import type { SessionAccess, Share } from "./api.ts";
import { DecisionPanel } from "./Decisions.tsx";
import { RevisionBar } from "./Revisions.tsx";
import { SessionActions } from "./SessionActions.tsx";
import { failure, json, PAGE_TIMEOUT, stubApi } from "./test/dom.ts";
import { demoSession } from "./test/sessions.ts";

// Where the keyboard lands after an action replaces the button that started it: on the card's title or the work's
// status line, never on the page (WCAG 2.4.3). One test per place that does it.

let complete: Session;
beforeAll(async () => {
  complete = { ...(await demoSession("complete")), id: "s1" };
});

const focused = () => document.activeElement as HTMLElement;

describe("the focus after an action", () => {
  it("goes to the decision panel's title once the approval replaced the Approve button", async () => {
    stubApi({
      "GET /api/config": () => json({ typedNames: false }),
      "POST /api/sessions/s1/decision/approve": () => json({}),
    });
    const view = render(
      <AccessContext.Provider value={FULL_ACCESS}>
        <DecisionPanel session={complete} />
      </AccessContext.Provider>,
    );
    const approve = await screen.findByRole("button", { name: "Approve this version" });
    approve.focus();
    fireEvent.click(approve);
    // The session comes back approved: the button is gone.
    const approved = structuredClone(complete);
    approveDecision(approved, { id: null, name: null }, null, "2026-11-12T10:00:00.000Z");
    await waitFor(() => expect(screen.getByRole("button", { name: "Approve this version" }).getAttribute("aria-busy")).toBeNull());
    view.rerender(
      <AccessContext.Provider value={FULL_ACCESS}>
        <DecisionPanel session={approved} />
      </AccessContext.Provider>,
    );
    expect(screen.queryByRole("button", { name: "Approve this version" })).toBeNull();
    expect(focused().textContent).toBe("Decision");
    expect(focused().tagName).toBe("H2");
  });

  it("stays in the share dialog, on its title, when the link is created and when it is stopped", async () => {
    const share: Share = { token: "tok", public: false, createdAt: "", mode: "client", expiresAt: null, hasPassword: false };
    stubApi({
      "POST /api/sessions/s1/share": () => json({ share }),
      "DELETE /api/sessions/s1/share": () => json(null, 204),
    });
    function Actions() {
      const [current, setCurrent] = useState<Share | null>(null);
      return <SessionActions session={complete} share={current} onShare={setCurrent} />;
    }
    render(
      <AccessContext.Provider value={FULL_ACCESS}>
        <Actions />
      </AccessContext.Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    const create = await screen.findByRole("button", { name: "Create a read-only link" });
    create.focus();
    fireEvent.click(create);
    const stop = await screen.findByRole("button", { name: "Stop sharing" });
    expect(focused().id).toBe("share-title");
    stop.focus();
    fireEvent.click(stop);
    await screen.findByRole("button", { name: "Create a read-only link" });
    await waitFor(() => expect(focused().id).toBe("share-title"));
  });

  it("follows a revision asked again to its progress line", async () => {
    stubApi({ "POST /api/sessions/s1/revisions": () => json({ accepted: true, revision: 2 }) });
    const revising = {
      id: "r1",
      number: 2,
      reason: "edit" as const,
      inputs: { facts: [{ question: null, answer: "The budget was cut.", comment: null }], note: null, questionnaireId: null },
      basedOn: 1,
      by: null,
      startedAt: "2026-11-12T10:00:00.000Z",
      error: { code: "provider_error", message: "" },
    };
    const bar = (session: Session) => (
      <RevisionBar session={session} shown={1} onShow={() => undefined} canEdit providerCosts price={null} />
    );
    const view = render(bar({ ...complete, revising }));
    const retry = screen.getByRole("button", { name: "Try again" });
    retry.focus();
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByRole("button", { name: "Try again" }).getAttribute("aria-busy")).toBeNull());
    view.rerender(bar({ ...complete, revising: { ...revising, id: "r2", error: null } }));
    expect(focused().id).toBe("revision-progress");
  });

  it("stays on the button that makes a debate private, whose label then changes", async () => {
    stubApi({
      "PUT /api/sessions/s1/visibility": () => json({ access: { mine: true, canEdit: true, shared: true, private: true } }),
    });
    function Line() {
      const [access, setAccess] = useState<SessionAccess>({ mine: true, canEdit: true, shared: true, private: false });
      return <AccessLine id="s1" access={access} onChange={setAccess} />;
    }
    render(<Line />);
    const button = screen.getByRole("button", { name: "Make private" });
    button.focus();
    fireEvent.click(button);
    const shared = await screen.findByRole("button", { name: "Share with the workspace" });
    expect(focused()).toBe(shared);
  });
});

describe("a protected share link", () => {
  it("leaves the focus alone on opening, then gives it to the shared page's heading once the password is right", async () => {
    let unlocked = false;
    stubApi({
      "GET /api/shared/tok": () => (unlocked ? json({ share: { mode: "full" }, session: complete }) : failure(401, "password_required")),
      "POST /api/shared/tok/access": () => {
        unlocked = true;
        return json({ access: "a1", expiresAt: null });
      },
    });
    window.location.hash = "#/shared/tok";
    // The test's own change of address is not a navigation inside the app: let its event pass before the app listens.
    await new Promise((resolve) => setTimeout(resolve, 0));
    render(<App />);
    const password = await screen.findByLabelText("Password", {}, { timeout: PAGE_TIMEOUT });
    // Opened from outside: no navigation inside the app, so the heading of the locked page does not take the focus.
    expect(focused().tagName).not.toBe("H1");
    act(() => password.focus());
    fireEvent.change(password, { target: { value: "right one" } });
    fireEvent.click(screen.getByRole("button", { name: "Open the report" }));
    const heading = await screen.findByRole("heading", { level: 1, name: "Studio booking app" }, { timeout: PAGE_TIMEOUT });
    await waitFor(() => expect(focused()).toBe(heading));
  });
});
