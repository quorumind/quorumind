/** @vitest-environment happy-dom */
import "../test/dom.ts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { failure, json } from "../test/dom.ts";
import { ContextPicker } from "./ContextPicker.tsx";

const document = { id: "d1", name: "Notes", kind: "text", text: "hello", source: null, truncated: false };

/** Answers the first import with an error and the following ones with a document. */
function stubImports(first: Response) {
  let calls = 0;
  const fetch = vi.fn(async () => (calls++ === 0 ? first : json({ document })));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("the context picker after a failed import", () => {
  it("gives the pasted text back and retries it on request", async () => {
    const fetch = stubImports(failure(500, "error"));
    const onChange = vi.fn();
    render(<ContextPicker value={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Paste text" }));
    fireEvent.change(screen.getByLabelText("Text"), { target: { value: "my long notes" } });
    fireEvent.click(screen.getByRole("button", { name: "Add this text" }));
    await screen.findByRole("alert");

    // The text is still there for whoever opens the panel again.
    fireEvent.click(screen.getByRole("button", { name: "Paste text" }));
    expect((screen.getByLabelText("Text") as HTMLTextAreaElement).value).toBe("my long notes");

    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith([document]));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("gives the address back and retries it on request", async () => {
    stubImports(failure(502, "fetch_failed"));
    const onChange = vi.fn();
    render(<ContextPicker value={[]} onChange={onChange} />);
    const address = screen.getByLabelText("Web page or GitHub repository") as HTMLInputElement;
    fireEvent.change(address, { target: { value: "https://example.com/spec" } });
    fireEvent.keyDown(address, { key: "Enter" });
    await screen.findByRole("alert");
    expect(address.value).toBe("https://example.com/spec");

    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith([document]));
  });

  it("empties the fields once the import succeeded", async () => {
    stubImports(json({ document }));
    render(<ContextPicker value={[]} onChange={vi.fn()} />);
    const address = screen.getByLabelText("Web page or GitHub repository") as HTMLInputElement;
    fireEvent.change(address, { target: { value: "https://example.com/spec" } });
    fireEvent.keyDown(address, { key: "Enter" });
    await waitFor(() => expect(address.value).toBe(""));
  });
});
