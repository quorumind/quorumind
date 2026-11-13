/** @vitest-environment happy-dom */
import "../test/dom.ts";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SourceRefs } from "./Sources.tsx";

afterEach(() => vi.unstubAllGlobals());

/** Clicks the reference "1" with a source on the page, and says how the page was asked to scroll to it. */
function scrollBehaviour(reduce: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query.includes("reduce"),
    addEventListener() {},
    removeEventListener() {},
  }));
  const scroll = vi.fn();
  render(
    <>
      <SourceRefs refs={[1]} />
      <div id="source-1">
        <a href="https://example.com">Example</a>
      </div>
    </>,
  );
  (document.getElementById("source-1") as HTMLElement).scrollIntoView = scroll;
  fireEvent.click(screen.getByRole("link", { name: "1" }));
  return scroll.mock.calls[0]?.[0];
}

describe("the scroll to a source", () => {
  it("glides for someone who accepts motion", () => {
    expect(scrollBehaviour(false)).toMatchObject({ behavior: "smooth" });
  });

  it("jumps for someone who asked for reduced motion", () => {
    expect(scrollBehaviour(true)).toMatchObject({ behavior: "auto" });
  });
});
