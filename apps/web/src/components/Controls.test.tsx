/** @vitest-environment happy-dom */
import "../test/dom.ts";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Segmented, Switch } from "./Controls.tsx";

function Filter() {
  const [mine, setMine] = useState<boolean | null>(null);
  return (
    <Segmented
      legend="Sessions shown"
      options={[
        { key: "all", value: null, label: "All" },
        { key: "everyone", value: false, label: "Everyone" },
        { key: "mine", value: true, label: "Mine" },
      ]}
      value={mine}
      onChange={setMine}
    />
  );
}

describe("a segmented control", () => {
  it("is a named group whose chosen button is pressed, whatever the type of its values", () => {
    render(<Filter />);
    expect(screen.getByRole("group", { name: "Sessions shown" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Mine" }));
    expect(screen.getByRole("button", { name: "Mine" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Everyone" }).getAttribute("aria-pressed")).toBe("false");
  });
});

describe("a switch", () => {
  it("is named by its label alone, described by its hint, and says whether it is on", () => {
    function Option() {
      const [on, setOn] = useState(false);
      return <Switch label="Mask personal data" hint="E-mails are replaced." checked={on} onChange={setOn} />;
    }
    render(<Option />);
    const toggle = screen.getByRole("switch", { name: "Mask personal data" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(document.getElementById(toggle.getAttribute("aria-describedby") ?? "")?.textContent).toBe("E-mails are replaced.");
    // The whole row is the label: a click on the text turns it on.
    fireEvent.click(screen.getByText("Mask personal data"));
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect((toggle as HTMLInputElement).checked).toBe(true);
  });
});
