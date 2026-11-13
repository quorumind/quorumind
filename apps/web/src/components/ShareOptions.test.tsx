/** @vitest-environment happy-dom */
import "../test/dom.ts";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Share } from "../api.ts";
import { ShareOptions } from "./ShareOptions.tsx";

describe("the share options while a request is in flight", () => {
  it("makes the button that started it wait, and no other", () => {
    const onApply = vi.fn();
    const view = render(<ShareOptions share={null} pending={false} onApply={onApply} />);
    fireEvent.click(screen.getByRole("button", { name: "Create a read-only link" }));
    expect(onApply).toHaveBeenCalledOnce();
    view.rerender(<ShareOptions share={null} pending onApply={onApply} />);
    const busy = screen.getByRole("button", { name: "Working…" });
    expect(busy.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(busy);
    expect(onApply).toHaveBeenCalledOnce();
  });

  it("waits on the password button that was pressed, not on the removal", () => {
    const share = { id: "x", mode: "client", expiresAt: null, hasPassword: true } as unknown as Share;
    const onApply = vi.fn();
    const view = render(<ShareOptions share={share} pending={false} onApply={onApply} />);
    fireEvent.change(document.querySelector('input[type="password"]') as HTMLInputElement, { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Set the password" }));
    view.rerender(<ShareOptions share={share} pending onApply={onApply} />);
    expect(screen.getByRole("button", { name: "Saving…" }).getAttribute("aria-busy")).toBe("true");
    expect(document.querySelectorAll('[aria-busy="true"]')).toHaveLength(1);
  });
});
