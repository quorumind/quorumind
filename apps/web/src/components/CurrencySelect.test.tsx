/** @vitest-environment happy-dom */
import "../test/dom.ts";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { COMMON_CURRENCIES, CurrencySelect } from "./CurrencySelect.tsx";

function Picker({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <label htmlFor="currency">Currency</label>
      <CurrencySelect id="currency" value={value} onChange={setValue} />
    </>
  );
}

describe("the currency picker", () => {
  it("offers the common currencies first, then the others, each named in the interface's language", () => {
    render(<Picker initial="EUR" />);
    const select = screen.getByLabelText("Currency") as HTMLSelectElement;
    const [common, others] = within(select).getAllByRole("group");
    expect(common?.getAttribute("label")).toBe("Common currencies");
    expect(
      within(common as HTMLElement)
        .getAllByRole("option")
        .map((option) => (option as HTMLOptionElement).value),
    ).toEqual([...COMMON_CURRENCIES]);
    expect(within(common as HTMLElement).getByRole("option", { name: "EUR — Euro" })).toBeTruthy();
    expect(others?.getAttribute("label")).toBe("Other currencies");
    expect(within(others as HTMLElement).getByRole("option", { name: /^NZD — / })).toBeTruthy();
    expect(within(others as HTMLElement).queryByRole("option", { name: /^EUR/ })).toBeNull();
    expect(select.value).toBe("EUR");
    expect(select.getAttribute("aria-invalid")).toBeNull();
  });

  it("keeps a value that is not a currency in the list, marked, until another one is chosen", () => {
    render(<Picker initial="DOL" />);
    const select = screen.getByLabelText("Currency") as HTMLSelectElement;
    expect(select.value).toBe("DOL");
    expect(screen.getByRole("option", { name: "DOL (not a currency)" })).toBeTruthy();
    expect(select.getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(select, { target: { value: "USD" } });
    expect(select.value).toBe("USD");
    expect(screen.queryByRole("option", { name: "DOL (not a currency)" })).toBeNull();
    expect(select.getAttribute("aria-invalid")).toBeNull();
  });
});
