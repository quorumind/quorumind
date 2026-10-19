/** @vitest-environment happy-dom */
import "../test/dom.ts";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { json, stubApi } from "../test/dom.ts";
import { BrandingSettings } from "./BrandingSettings.tsx";

const saved = { name: "Atelier Nord", logoDataUrl: null, accent: "#0f766e" };

function stub() {
  return stubApi({
    "GET /api/branding": () => json({ branding: saved }),
    "PUT /api/branding": ({ body }) => json({ branding: body }),
  });
}

describe("the branding of the exports", () => {
  it("takes an accent from a preset or as a hex code, and refuses one that is not a color", async () => {
    const { calls } = stub();
    render(<BrandingSettings />);
    const hex = (await screen.findByLabelText("Accent color code")) as HTMLInputElement;
    await waitFor(() => expect(hex.value).toBe("#0f766e"));
    expect(screen.getByRole("button", { name: "Use #0F766E" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Use #7C45B0" }));
    expect(hex.value).toBe("#7c45b0");
    expect(screen.getByRole("button", { name: "Use #7C45B0" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.change(hex, { target: { value: "#12" } });
    expect(hex.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText(/six hexadecimal digits/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(hex, { target: { value: "#B23A1E" } });
    expect(hex.getAttribute("aria-invalid")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.some((call) => call.method === "PUT")).toBe(true));
    expect(calls.find((call) => call.method === "PUT")?.body).toEqual({ ...saved, accent: "#b23a1e" });
  });

  it("shows the name and the accent in the preview of a report's header", async () => {
    stub();
    render(<BrandingSettings />);
    const preview = await screen.findByRole("figure", { name: "Preview of a report's header" });
    await waitFor(() => expect(within(preview).getByText("Atelier Nord")).toBeTruthy());
    expect(within(preview).getByText("Decision report").style.borderColor).toBe("#0f766e");
  });

  it("explains a logo it refuses, and names the one it takes", async () => {
    stub();
    render(<BrandingSettings />);
    await screen.findByText("No logo");
    const input = document.querySelector<HTMLInputElement>('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["GIF89a"], "logo.gif", { type: "image/gif" })] } });
    expect((await screen.findByRole("alert")).textContent).toBe("Choose a PNG, JPEG or SVG image.");
    const choose = screen.getByRole("button", { name: "Choose a logo" });
    expect(choose.getAttribute("aria-describedby")).toContain(screen.getByRole("alert").id);

    fireEvent.change(input, {
      target: { files: [new File(["<svg xmlns='http://www.w3.org/2000/svg'/>"], "atelier.svg", { type: "image/svg+xml" })] },
    });
    expect(await screen.findByText("atelier.svg")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Replace the logo" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove the logo" }));
    expect(screen.getByText("No logo")).toBeTruthy();
  });

  it("asks before restoring Quorumind's branding", async () => {
    const { calls } = stub();
    // happy-dom's dialogs: showModal opens them as the browser does.
    const showModal = vi.spyOn(HTMLDialogElement.prototype, "showModal");
    render(<BrandingSettings />);
    await waitFor(() =>
      expect((screen.getByRole("button", { name: "Restore Quorumind's branding" }) as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "Restore Quorumind's branding" }));
    expect(showModal).toHaveBeenCalled();
    expect(calls.some((call) => call.method === "PUT")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Restore", hidden: true }));
    await waitFor(() => expect(calls.find((call) => call.method === "PUT")?.body).toEqual({ name: null, logoDataUrl: null, accent: null }));
  });
});
