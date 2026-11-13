/** @vitest-environment happy-dom */
import "../test/dom.ts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api.ts";
import { failureText } from "../errors.ts";
import { ConfirmDialog, focusNeighbour, useConfirm } from "./ConfirmDialog.tsx";

function Page({ onConfirm }: { onConfirm: () => void }) {
  const confirm = useConfirm<string>();
  return (
    <>
      <button type="button" onClick={() => confirm.ask("Bob")}>
        Remove Bob
      </button>
      <ConfirmDialog confirm={confirm} title={`Remove ${confirm.target}?`} confirmLabel={`Remove ${confirm.target}`} onConfirm={onConfirm}>
        <p>He loses access at once.</p>
      </ConfirmDialog>
    </>
  );
}

describe("the confirmation dialog", () => {
  it("names the thing and the consequence, with a button that says what it does", () => {
    render(<Page onConfirm={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Bob" }));
    const dialog = screen.getByRole("dialog", { hidden: true });
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(dialog.getAttribute("aria-labelledby")).toBeTruthy();
    expect(dialog.querySelector("h2")?.textContent).toBe("Remove Bob?");
    expect(dialog.textContent).toContain("He loses access at once.");
    expect(dialog.querySelector(".button-danger")?.textContent).toBe("Remove Bob");
  });

  it("does nothing until the person confirms, and does it once they do", () => {
    const onConfirm = vi.fn();
    render(<Page onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Bob" }));
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(document.querySelector(".button-danger") as Element);
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(document.querySelector("dialog")?.hasAttribute("open")).toBe(false);
  });

  it("closes on Cancel without doing anything and gives the focus back to the trigger", () => {
    const onConfirm = vi.fn();
    render(<Page onConfirm={onConfirm} />);
    const trigger = screen.getByRole("button", { name: "Remove Bob" });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Cancel", hidden: true }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(document.querySelector("dialog")?.hasAttribute("open")).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it("closes on Escape without doing anything and gives the focus back to the trigger", () => {
    const onConfirm = vi.fn();
    render(<Page onConfirm={onConfirm} />);
    const trigger = screen.getByRole("button", { name: "Remove Bob" });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.keyDown(document.querySelector("dialog") as Element, { key: "Escape" });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(document.querySelector("dialog")?.hasAttribute("open")).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });
});

describe("the confirmation dialog for one of several things", () => {
  afterEach(() => vi.restoreAllMocks());

  function People() {
    const confirm = useConfirm<string>();
    return (
      <>
        {["Bob", "Ann"].map((name) => (
          <button key={name} type="button" onClick={(event) => confirm.ask(name, event.currentTarget)}>
            Ask about {name}
          </button>
        ))}
        <ConfirmDialog confirm={confirm} title={`Remove ${confirm.target}?`} confirmLabel={`Remove ${confirm.target}`} onConfirm={() => {}}>
          <p>{confirm.target} loses access at once.</p>
        </ConfirmDialog>
      </>
    );
  }

  it("opens once it names the person asked about, so that its name is never empty or someone else's", () => {
    // What the dialog says at the moment it opens is what a screen reader announces.
    const announced: string[] = [];
    vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function (this: HTMLDialogElement) {
      announced.push(`${this.querySelector("h2")?.textContent} ${this.querySelector(".button-danger")?.textContent}`);
      this.setAttribute("open", "");
    });
    render(<People />);
    fireEvent.click(screen.getByRole("button", { name: "Ask about Bob" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel", hidden: true }));
    fireEvent.click(screen.getByRole("button", { name: "Ask about Ann" }));
    expect(announced).toEqual(["Remove Bob? Remove Bob", "Remove Ann? Remove Ann"]);
  });

  it("shows the error and stays usable when the action throws at once", async () => {
    let fail = true;
    const onConfirm = vi.fn(() => {
      if (fail) throw new Error("x");
    });
    function Throwing() {
      const confirm = useConfirm<string>();
      return (
        <>
          <button type="button" onClick={(event) => confirm.ask("Bob", event.currentTarget)}>
            Remove Bob
          </button>
          <ConfirmDialog
            confirm={confirm}
            title="Remove?"
            confirmLabel="Remove it"
            errorText={() => "It could not be removed."}
            onConfirm={onConfirm}
          />
        </>
      );
    }
    render(<Throwing />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Bob" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove it", hidden: true }));
    const alert = await screen.findByRole("alert", { hidden: true });
    expect(alert.textContent).toBe("It could not be removed.");
    expect(document.querySelector("dialog")?.hasAttribute("open")).toBe(true);
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Remove it", hidden: true }));
    await waitFor(() => expect(document.querySelector("dialog")?.hasAttribute("open")).toBe(false));
    expect(onConfirm).toHaveBeenCalledTimes(2);
  });
});

/** A list of rows, each with its remove button: the dialog asks, the action takes a while, and may fail or remove the row. */
function Rows({ action }: { action: () => Promise<unknown> }) {
  const confirm = useConfirm<string>();
  const [rows, setRows] = useState(["a", "b", "c"]);
  return (
    <>
      <h1 tabIndex={-1} id="heading">
        Rows
      </h1>
      <table>
        <tbody>
          {rows.map((row) => (
            <tr key={row}>
              <td>
                <button type="button" onClick={(event) => confirm.ask(row, event.currentTarget)}>
                  Remove {row}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ConfirmDialog
        confirm={confirm}
        title="Remove?"
        confirmLabel="Remove it"
        busyLabel="Removing…"
        errorText={() => "It could not be removed."}
        focusAfter={focusNeighbour("tr", () => document.getElementById("heading"))}
        onConfirm={async () => {
          await action();
          setRows((current) => current.filter((row) => row !== confirm.target));
        }}
      >
        <p>It goes at once.</p>
      </ConfirmDialog>
    </>
  );
}

describe("the confirmation dialog around an action that takes time", () => {
  it("describes itself to assistive technology with its consequence", () => {
    render(<Page onConfirm={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Bob" }));
    const dialog = document.querySelector("dialog") as HTMLDialogElement;
    expect(document.getElementById(dialog.getAttribute("aria-describedby") ?? "")?.textContent).toBe("He loses access at once.");
  });

  it("stays open with the button at work while the action runs, ignores Escape, and closes once it succeeds", async () => {
    let finish: () => void = () => {};
    render(<Rows action={() => new Promise<void>((resolve) => (finish = resolve))} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove b" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove it", hidden: true }));
    const working = await screen.findByRole("button", { name: "Removing…", hidden: true });
    expect(working.getAttribute("aria-busy")).toBe("true");
    expect((screen.getByRole("button", { name: "Cancel", hidden: true }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(document.querySelector("dialog") as Element, { key: "Escape" });
    expect(document.querySelector("dialog")?.hasAttribute("open")).toBe(true);
    finish();
    await waitFor(() => expect(document.querySelector("dialog")?.hasAttribute("open")).toBe(false));
  });

  it("shows the error inside the dialog, which stays open and can be tried again", async () => {
    const action = vi.fn().mockRejectedValueOnce(new Error("x")).mockResolvedValueOnce(undefined);
    render(<Rows action={action} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove b" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove it", hidden: true }));
    const alert = await screen.findByRole("alert", { hidden: true });
    expect(alert.textContent).toBe("It could not be removed.");
    expect(document.querySelector("dialog")?.hasAttribute("open")).toBe(true);
    expect(screen.queryByRole("button", { name: "Remove b" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove it", hidden: true }));
    await waitFor(() => expect(document.querySelector("dialog")?.hasAttribute("open")).toBe(false));
    expect(action).toHaveBeenCalledTimes(2);
  });

  it("moves the focus to the next row once the row that opened it is gone, else the previous one, else the heading", async () => {
    render(<Rows action={async () => {}} />);
    const remove = async (name: string) => {
      fireEvent.click(screen.getByRole("button", { name: `Remove ${name}` }));
      fireEvent.click(screen.getByRole("button", { name: "Remove it", hidden: true }));
      await waitFor(() => expect(screen.queryByRole("button", { name: `Remove ${name}` })).toBeNull());
    };
    await remove("b");
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Remove c"));
    await remove("c");
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Remove a"));
    await remove("a");
    await waitFor(() => expect(document.activeElement?.id).toBe("heading"));
  });
});

describe("the confirmation dialog around a request the server never answers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function Reset() {
    const { t } = useTranslation();
    const confirm = useConfirm<null>();
    return (
      <>
        <button type="button" onClick={() => confirm.ask(null)}>
          Reset
        </button>
        <ConfirmDialog
          confirm={confirm}
          title="Reset the profile?"
          confirmLabel="Reset the profile"
          errorText={(caught) => failureText(t, caught)}
          onConfirm={() => api.saveProfile(null)}
        />
      </>
    );
  }

  it("shows the request's error and unlocks once the request times out", async () => {
    // The request hangs until its signal ends it; the timeout is ended by hand instead of waiting for it.
    const timeout = new AbortController();
    const asked = vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason))),
      ),
    );
    render(<Reset />);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    const action = screen.getByRole("button", { name: "Reset the profile", hidden: true });
    fireEvent.click(action);
    await waitFor(() => expect(action.getAttribute("aria-busy")).toBe("true"));
    expect(screen.getByRole("button", { name: "Cancel", hidden: true }).hasAttribute("disabled")).toBe(true);
    expect(asked).toHaveBeenCalledWith(30_000);

    timeout.abort(new DOMException("The operation timed out.", "TimeoutError"));
    const alert = await screen.findByRole("alert", { hidden: true });
    expect(alert.textContent).toBe("The request failed. Check your connection and try again.");
    expect(action.getAttribute("aria-busy")).toBeNull();
    expect(screen.getByRole("button", { name: "Cancel", hidden: true }).hasAttribute("disabled")).toBe(false);
    expect(document.querySelector("dialog")?.hasAttribute("open")).toBe(true);
  });
});
