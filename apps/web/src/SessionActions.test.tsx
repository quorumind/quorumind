/** @vitest-environment happy-dom */
import "./test/dom.ts";
import type { Session } from "@quorumind/core";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import i18n from "i18next";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { AccessContext, FULL_ACCESS } from "./access.tsx";
import type { Share } from "./api.ts";
import { SessionActions } from "./SessionActions.tsx";
import { failure, json, stubApi } from "./test/dom.ts";
import { demoSession } from "./test/sessions.ts";

let complete: Session;
beforeAll(async () => {
  complete = { ...(await demoSession("complete")), id: "s1" };
});

const share: Share = { token: "tok", public: false, createdAt: "", mode: "client", expiresAt: null, hasPassword: false };

/** The dialog open on screen. */
function openDialog(): HTMLDialogElement {
  const dialog = document.querySelector<HTMLDialogElement>("dialog[open]");
  if (!dialog) throw new Error("No dialog is open");
  return dialog;
}

function renderActions(current: Share | null = null, onShare = vi.fn()) {
  render(
    <AccessContext.Provider value={FULL_ACCESS}>
      <SessionActions session={complete} share={current} onShare={onShare} />
    </AccessContext.Provider>,
  );
  return onShare;
}

describe("the actions of a session", () => {
  it("shows a failed deletion in its dialog", async () => {
    stubApi({ "DELETE /api/sessions/s1": () => failure(500, "internal_error") });
    renderActions();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = openDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete for good", hidden: true }));
    const alert = await within(dialog).findByRole("alert", { hidden: true });
    expect(alert.textContent).toBe(i18n.t("errors.internal_error"));
  });

  it("shows a failed fork next to its button, in the person's language", async () => {
    stubApi({ "POST /api/sessions/s1/fork": () => failure(409, "wrong_phase") });
    renderActions();
    fireEvent.click(screen.getByRole("button", { name: "Start again from here" }));
    const alerts = await screen.findAllByRole("alert");
    const visible = alerts.filter((alert) => !alert.closest("dialog"));
    expect(visible).toHaveLength(1);
    expect(visible[0]?.textContent).not.toBe("wrong_phase");
    expect(visible[0]?.textContent?.length).toBeGreaterThan(0);
  });

  it("keeps the error of one action out of the others' dialogs", async () => {
    stubApi({ "POST /api/sessions/s1/fork": () => failure(409, "wrong_phase") });
    renderActions(share);
    fireEvent.click(screen.getByRole("button", { name: "Start again from here" }));
    await screen.findAllByRole("alert");
    for (const dialog of document.querySelectorAll("dialog")) expect(within(dialog).queryByRole("alert", { hidden: true })).toBeNull();
  });

  it("applies the share password when Enter is pressed, and keeps the dialog open", async () => {
    const { calls } = stubApi({ "POST /api/sessions/s1/share": () => json({ share: { ...share, hasPassword: true } }) });
    const onShare = renderActions(share);
    fireEvent.click(screen.getByRole("button", { name: "Shared" }));
    const dialog = openDialog();
    const field = within(dialog).getByLabelText("Password");
    fireEvent.change(field, { target: { value: "s3cret" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(calls).toEqual([{ method: "POST", path: "/api/sessions/s1/share", body: { password: "s3cret" } }]));
    await waitFor(() => expect(onShare).toHaveBeenCalledWith(expect.objectContaining({ hasPassword: true })));
    expect(dialog.open).toBe(true);
  });

  it("creates a protected link when Enter is pressed before the link exists", async () => {
    const { calls } = stubApi({ "POST /api/sessions/s1/share": () => json({ share: { ...share, hasPassword: true } }) });
    renderActions(null);
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    const field = within(openDialog()).getByLabelText("Password");
    fireEvent.change(field, { target: { value: "s3cret" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(calls[0]?.body).toEqual({ mode: "client", expiresIn: "30d", password: "s3cret" }));
  });

  it("selects the link for the person to copy when the page has no clipboard", async () => {
    stubApi({});
    vi.stubGlobal("navigator", { ...navigator, clipboard: undefined });
    renderActions(share);
    fireEvent.click(screen.getByRole("button", { name: "Shared" }));
    const dialog = openDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Copy", hidden: true }));
    expect(await within(dialog).findByText("Could not copy: the link is selected, copy it with your keyboard.")).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog).getByLabelText("Link"));
  });

  it("gives the focus back to the button that opened a dialog", async () => {
    stubApi({});
    renderActions();
    const opener = screen.getByRole("button", { name: "Delete" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = openDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel", hidden: true }));
    await waitFor(() => expect(dialog.open).toBe(false));
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});
