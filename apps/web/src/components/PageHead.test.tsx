/** @vitest-environment happy-dom */
import "../test/dom.ts";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PageHead } from "./Page.tsx";

describe("PageHead", () => {
  it("opens a page with its title as the one h1, then the introduction, then the action", () => {
    render(<PageHead title="Gallery" lead="Debates to read." action={<a href="#/">Start</a>} />);
    const head = screen.getByRole("banner");
    expect(screen.getByRole("heading", { level: 1, name: "Gallery" })).toBeTruthy();
    expect(head.textContent).toBe("GalleryDebates to read.Start");
    expect(head.querySelector(".page-head > .lead")?.textContent).toBe("Debates to read.");
  });

  it("leaves out the introduction and the action when there are none", () => {
    render(<PageHead title="Settings" />);
    const head = screen.getByRole("banner");
    expect(head.querySelector(".lead")).toBeNull();
    expect(head.textContent).toBe("Settings");
  });
});
