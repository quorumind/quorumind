/** @vitest-environment happy-dom */
import "../test/dom.ts";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BusyButton } from "./BusyButton.tsx";

describe("a busy button", () => {
  it("is an ordinary button while idle", () => {
    const onClick = vi.fn();
    render(<BusyButton onClick={onClick}>Save</BusyButton>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button.getAttribute("aria-busy")).toBeNull();
    expect(button.getAttribute("type")).toBe("button");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("keeps a real disabled for an action not available yet", () => {
    render(<BusyButton disabled>Save</BusyButton>);
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("says what it is doing, with a mark at work, and stays focusable", () => {
    render(
      <BusyButton busy busyLabel="Saving…" disabled>
        Save
      </BusyButton>,
    );
    const button = screen.getByRole("button", { name: "Saving…" }) as HTMLButtonElement;
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.disabled).toBe(false);
    expect(button.querySelector('.mark[data-busy="true"]')).toBeTruthy();
    button.focus();
    expect(document.activeElement).toBe(button);
  });

  it("announces its waiting label politely, only while busy, unless told not to", () => {
    const view = render(<BusyButton busy>Save</BusyButton>);
    expect(screen.getByRole("status").textContent).toBe("Working…");
    view.rerender(<BusyButton>Save</BusyButton>);
    expect(screen.getByRole("status").textContent).toBe("");
    view.rerender(
      <BusyButton busy announce={false}>
        Save
      </BusyButton>,
    );
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("falls back to the generic waiting label", () => {
    render(<BusyButton busy>Save</BusyButton>);
    expect(screen.getByRole("button", { name: "Working…" })).toBeTruthy();
  });

  it("ignores clicks and does not submit its form while busy", () => {
    const onClick = vi.fn();
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <BusyButton busy type="submit" onClick={onClick}>
          Send
        </BusyButton>
      </form>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
