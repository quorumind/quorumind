/** @vitest-environment happy-dom */
import "../test/dom.ts";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ScrollRegion } from "./ScrollRegion.tsx";

const table = (
  <table>
    <tbody>
      <tr>
        <th scope="row">A</th>
        <td>1</td>
      </tr>
    </tbody>
  </table>
);

/** Gives every element a width, as a layout engine would: the DOM here has none. */
function size(scrollWidth: number, clientWidth: number) {
  Object.defineProperty(HTMLElement.prototype, "scrollWidth", { configurable: true, get: () => scrollWidth });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => clientWidth });
}

describe("a table that scrolls sideways", () => {
  afterEach(() => {
    // biome-ignore lint/performance/noDelete: restores the prototype's own getters.
    delete (HTMLElement.prototype as { scrollWidth?: number }).scrollWidth;
    // biome-ignore lint/performance/noDelete: restores the prototype's own getters.
    delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
  });

  it("is a focusable region with a name when it is wider than its frame", () => {
    size(900, 300);
    render(<ScrollRegion label="Decision matrix">{table}</ScrollRegion>);
    const region = screen.getByRole("region", { name: "Decision matrix" });
    expect(region.getAttribute("tabindex")).toBe("0");
    expect(region.getAttribute("data-edges")).toBe("end");
  });

  it("is not a tab stop or a landmark when it fits", () => {
    size(300, 300);
    const { container } = render(<ScrollRegion label="Decision matrix">{table}</ScrollRegion>);
    expect(screen.queryByRole("region")).toBeNull();
    expect(container.querySelector(".table-wrap")?.hasAttribute("tabindex")).toBe(false);
  });
});
