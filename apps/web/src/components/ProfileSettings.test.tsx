/** @vitest-environment happy-dom */
import "../test/dom.ts";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { json, stubApi } from "../test/dom.ts";
import { ProfileSettings } from "./ProfileSettings.tsx";

const saved = {
  name: "Acme",
  preferredTechnologies: [],
  forbiddenTechnologies: [],
  hosting: { euOnly: false, providers: [], onPremises: false, notes: "" },
  currency: "EUR",
  roles: [{ id: "r1", name: "Dev", dailyRate: 500 }],
  capacity: { people: null, typicalTeamSize: null },
  deliverables: [],
  guarantees: [],
  notes: "",
  updatedAt: "2026-01-02T00:00:00.000Z",
};

describe("the organisation profile form", () => {
  it("marks a role without a day rate, explains it under the field and moves the focus there", async () => {
    stubApi({ "GET /api/profile": () => json({ profile: { ...saved, roles: [] } }) });
    const { container } = render(<ProfileSettings defaultCurrency="EUR" />);
    await waitFor(() => expect((screen.getByRole("button", { name: /Add a role/ }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: /Add a role/ }));
    fireEvent.change(screen.getByLabelText("Role 1"), { target: { value: "Dev" } });
    expect(container.querySelector("form")?.noValidate).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Save the profile" }));
    const rate = screen.getByLabelText(/Day rate of role 1/);
    expect(rate.getAttribute("aria-invalid")).toBe("true");
    const message = document.getElementById(rate.getAttribute("aria-describedby") ?? "");
    expect(message?.textContent).toBe("Give every role a day rate above zero.");
    expect(document.activeElement).toBe(rate);
  });

  it("groups the currency and the rates under Pricing: the currency first, its scope said and tied to it", async () => {
    stubApi({ "GET /api/profile": () => json({ profile: saved }) });
    render(<ProfileSettings defaultCurrency="EUR" />);
    const group = (await screen.findByRole("group", { name: "Pricing" })) as HTMLFieldSetElement;
    const select = within(group).getByLabelText("Currency");
    const hint = document.getElementById(select.getAttribute("aria-describedby")?.split(" ")[0] ?? "");
    expect(hint?.textContent).toMatch(/New debates that follow this profile are costed in this currency/);
    expect(hint?.textContent).toMatch(/already under way keep theirs/);
    expect(hint?.textContent).toMatch(/not converted/);
    const roles = within(group).getByRole("group", { name: "Roles and day rates" });
    expect(group.contains(roles)).toBe(true);
    // The select comes before the nested roles group.
    expect(select.compareDocumentPosition(roles) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryAllByRole("group", { name: "Roles and day rates" })).toHaveLength(1);
  });

  it("shows the currency beside each day rate and follows a change of currency", async () => {
    stubApi({ "GET /api/profile": () => json({ profile: saved }) });
    const { container } = render(<ProfileSettings defaultCurrency="EUR" />);
    const rate = await screen.findByLabelText("Day rate of role 1, in EUR");
    const code = () => container.querySelector(".profile-rate-code");
    expect(code()?.textContent).toBe("EUR");
    expect(code()?.getAttribute("aria-hidden")).toBe("true");
    expect(code()?.querySelector("bdi")).not.toBeNull();
    await waitFor(() => expect((rate as HTMLInputElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText("Currency"), { target: { value: "CHF" } });
    expect(code()?.textContent).toBe("CHF");
    expect(screen.getByLabelText("Day rate of role 1, in CHF")).toBe(rate);
  });

  it("attaches a refusal of the server to the field it names", async () => {
    stubApi({
      "GET /api/profile": () => json({ profile: saved }),
      "PUT /api/profile": () => json({ error: "invalid_request", message: "bad", params: { field: "profile.name" } }, 400),
    });
    render(<ProfileSettings defaultCurrency="EUR" />);
    await waitFor(() => expect((screen.getByLabelText("Name") as HTMLInputElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Save the profile" }));
    const name = await screen.findByLabelText("Name");
    await waitFor(() => expect(name.getAttribute("aria-invalid")).toBe("true"));
    expect(document.getElementById(name.getAttribute("aria-describedby") ?? "")?.textContent).toBe(
      "This value is not accepted. Check it and try again.",
    );
  });

  it("asks before removing the profile, and removes it only when confirmed", async () => {
    const { calls } = stubApi({
      "GET /api/profile": () => json({ profile: saved }),
      "PUT /api/profile": () => json({ profile: null }),
    });
    render(<ProfileSettings defaultCurrency="EUR" />);
    const remove = await screen.findByRole("button", { name: "Remove the profile" });
    await waitFor(() => expect((remove as HTMLButtonElement).disabled).toBe(false));
    remove.focus();
    fireEvent.click(remove);
    expect(calls.some((call) => call.method === "PUT")).toBe(false);
    expect(document.querySelector("dialog")?.hasAttribute("open")).toBe(true);
    fireEvent.keyDown(document.querySelector("dialog") as Element, { key: "Escape" });
    expect(calls.some((call) => call.method === "PUT")).toBe(false);
    expect(document.activeElement).toBe(remove);
    fireEvent.click(remove);
    fireEvent.click(document.querySelector("dialog .button-danger") as Element);
    await waitFor(() => expect(calls.some((call) => call.method === "PUT")).toBe(true));
  });
});
