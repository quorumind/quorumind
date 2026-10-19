/** @vitest-environment happy-dom */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { brandStyle } from "./ClientQuestionnaire.tsx";
import { blend, contrastRatio, luminance, readableOn, TEXT_CONTRAST, textOn } from "./contrast.ts";

const LIGHT = ["#ffffff", "#f6f7fb"];
const DARK = ["#0e1121", "#161a2e"];

describe("contrast", () => {
  it("measures luminance and ratios as WCAG 2 does", () => {
    expect(luminance("#000000")).toBe(0);
    expect(luminance("#ffffff")).toBe(1);
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBe(1);
    // Reference values: #767676 is the lightest grey with 4.5:1 on white.
    expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
    expect(contrastRatio("#2fa84f", "#ffffff")).toBeCloseTo(3.07, 1);
  });

  it("writes on a mid-tone accent in black, where white would fail", () => {
    for (const accent of ["#2fa84f", "#e07b00", "#ff6a3d", "#f2c200"]) {
      expect(textOn(accent), accent).toBe("#000000");
      expect(contrastRatio(textOn(accent), accent)).toBeGreaterThanOrEqual(TEXT_CONTRAST);
    }
    expect(textOn("#2b44c4")).toBe("#ffffff");
  });

  it("keeps an accent that reads well, and finds the closest readable shade of one that does not", () => {
    expect(readableOn("#2b44c4", LIGHT)).toBe("#2b44c4");
    const yellow = readableOn("#f2c200", LIGHT);
    expect(yellow).not.toBe("#f2c200");
    for (const surface of LIGHT) expect(contrastRatio(yellow, surface)).toBeGreaterThanOrEqual(TEXT_CONTRAST);
    // Darker, not black: still the agency's hue.
    expect(luminance(yellow)).toBeGreaterThan(0.05);
    const navy = readableOn("#141a3a", DARK);
    for (const surface of DARK) expect(contrastRatio(navy, surface)).toBeGreaterThanOrEqual(TEXT_CONTRAST);
    expect(luminance(navy)).toBeGreaterThan(luminance("#141a3a"));
  });

  it("blends colors as color-mix does", () => {
    expect(blend("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(blend("#123456", "#ffffff", 0)).toBe("#123456");
  });
});

describe("an agency's accent on its client's page", () => {
  const style = (accent: string) => brandStyle({ name: null, logoDataUrl: null, accent }) as Record<string, string>;

  it("is readable as text in both themes, whatever the accent", () => {
    for (const accent of ["#f2c200", "#2fa84f", "#ff6a3d", "#141a3a", "#ffffff", "#000000", "#8ea0f5"]) {
      const colors = style(accent);
      for (const surface of LIGHT)
        expect(contrastRatio(colors["--brand-text-light"] as string, surface), accent).toBeGreaterThanOrEqual(4.5);
      for (const surface of DARK) expect(contrastRatio(colors["--brand-text-dark"] as string, surface), accent).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(colors["--brand-on-fill"] as string, accent)).toBeGreaterThanOrEqual(4.5);
      expect(colors["--brand-fill"]).toBe(accent);
    }
  });

  it("is left out when it is not a color", () => {
    expect(brandStyle({ name: null, logoDataUrl: null, accent: "red; background: url(x)" })).toBeUndefined();
    expect(brandStyle({ name: null, logoDataUrl: null, accent: null })).toBeUndefined();
  });
});

describe("the interface's own colors", () => {
  const css = readFileSync(join(import.meta.dirname, "styles.css"), "utf8");
  /** The custom properties of the first rule with this selector, color values resolved through var(). */
  const tokens = (selector: string): Record<string, string> => {
    const start = css.indexOf(`${selector} {`);
    const body = css.slice(start, css.indexOf("}", start));
    return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [match[1], (match[2] ?? "").trim()]));
  };
  const light = tokens(":root");
  const dark = { ...light, ...tokens(':root[data-theme="dark"]') };
  const value = (theme: Record<string, string>, name: string): string => {
    const raw = theme[name] ?? "";
    const reference = /^var\((--[\w-]+)\)$/.exec(raw);
    return reference ? value(theme, reference[1] as string) : raw;
  };

  it("writes on the main action's fill at 4.5:1 or more, in both themes", () => {
    for (const theme of [light, dark]) {
      expect(contrastRatio(value(theme, "--on-primary"), value(theme, "--primary"))).toBeGreaterThanOrEqual(TEXT_CONTRAST);
    }
  });

  it("gives the dark theme's main action a fill of its own, not the pastel of its text color", () => {
    expect(value(dark, "--primary")).not.toBe(value(dark, "--thesis"));
    expect(luminance(value(dark, "--primary"))).toBeLessThan(luminance(value(dark, "--thesis")));
  });
});
