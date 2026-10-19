/** @vitest-environment happy-dom */
import "./test/dom.ts";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Settings } from "./Settings.tsx";
import { json, stubApi } from "./test/dom.ts";

const hosted = (profilePage: { url: string; canEdit: boolean } | null) =>
  stubApi({
    "GET /api/config": () =>
      json({
        catalog: [],
        live: null,
        demo: { lineup: null, idea: "" },
        templates: [],
        personas: [],
        providerCosts: false,
        profileSettings: false,
        profilePage,
      }),
    "GET /api/branding": () => json({ branding: { name: null, logoDataUrl: null, accent: null } }),
  });

describe("the organisation profile a host provides", () => {
  it("links its owners and admins to where it is edited", async () => {
    hosted({ url: "/account/#/profile", canEdit: true });
    render(<Settings />);
    const link = await screen.findByRole("link", { name: "Open the organisation profile" });
    expect(link.getAttribute("href")).toBe("/account/#/profile");
  });

  it("tells the other members who can change it", async () => {
    hosted({ url: "/account/#/profile", canEdit: false });
    render(<Settings />);
    expect(await screen.findByText(/Only the workspace's owners and admins can change it/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Open the organisation profile" })).toBeNull();
  });

  it("says the host manages it when the host names no page", async () => {
    hosted(null);
    render(<Settings />);
    expect(await screen.findByText(/managed by its owners and admins/)).toBeTruthy();
  });
});
