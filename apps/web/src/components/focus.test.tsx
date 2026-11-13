/** @vitest-environment happy-dom */
import "../test/dom.ts";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useRefocus } from "./focus.ts";

function Card({ approved }: { approved: boolean }) {
  useRefocus(approved, () => document.getElementById("card-title"));
  return (
    <section>
      <h2 id="card-title">Decision</h2>
      <input aria-label="Comment" />
      {approved ? <p>Approved</p> : <button type="button">Approve</button>}
    </section>
  );
}

describe("the focus after an action replaces its button", () => {
  it("goes to the card's title rather than falling to the page", () => {
    const view = render(<Card approved={false} />);
    (view.getByRole("button", { name: "Approve" }) as HTMLButtonElement).focus();
    view.rerender(<Card approved />);
    expect(document.activeElement?.id).toBe("card-title");
    expect(document.activeElement?.getAttribute("tabindex")).toBe("-1");
  });

  it("stays on a control the person chose meanwhile", () => {
    const view = render(<Card approved={false} />);
    const comment = view.getByRole("textbox", { name: "Comment" });
    comment.focus();
    view.rerender(<Card approved />);
    expect(document.activeElement).toBe(comment);
  });

  it("does nothing on the first render", () => {
    render(<Card approved />);
    expect(document.activeElement).toBe(document.body);
  });
});
