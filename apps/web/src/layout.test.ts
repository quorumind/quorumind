import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(import.meta.dirname, "styles.css"), "utf8");

// The layout rules a browser decides cannot be seen in a DOM test: these keep the rules that fix known overflow defects.
describe("the layout rules for narrow screens and right-to-left", () => {
  it("opens the Export menu as a sheet fixed to the window on a phone, above the decision panel", () => {
    const rule = /@media \(max-width: 480px\) \{\s*\.export-list \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toContain("position: fixed");
    expect(rule).toContain("inset-inline: var(--space-4)");
    expect(Number(/z-index: (\d+)/.exec(rule)?.[1])).toBeGreaterThan(50);
  });

  it("keeps the first column of a wide table in view, on the start side in both directions", () => {
    expect(css).toMatch(/\.table-wrap :where\(tr > :first-child\) \{[^}]*position: sticky;[^}]*inset-inline-start: 0/);
  });

  it("aligns the columns of a two-column grid at the top", () => {
    expect(/\.two-col \{[^}]*align-items: start/.test(css)).toBe(true);
  });

  it("keeps the first column's own look: no box-shadow or specific background on every sticky cell", () => {
    expect(css).toMatch(/\.table-wrap :where\(tr > :first-child\) \{[^}]*position: sticky/);
    // The edge is a gradient beside the cell: a box-shadow here would replace the best option's inset bar.
    expect(css).toMatch(/\.table-wrap :where\(tr > :first-child\)::after \{[^}]*linear-gradient/);
    expect(/\.table-wrap\[data-edges[^{]*\{[^}]*box-shadow/.test(css)).toBe(false);
  });

  it("tells the browser the colours of the page's surface for its bar, in both themes", () => {
    const html = readFileSync(join(import.meta.dirname, "..", "index.html"), "utf8");
    const tokens = readFileSync(join(import.meta.dirname, "tokens.css"), "utf8");
    const light = /--surface: (#[0-9a-f]{6});/i.exec(tokens)?.[1];
    const dark = /prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{\s*--surface: (#[0-9a-f]{6});/i.exec(tokens)?.[1];
    expect(html).toContain(`media="(prefers-color-scheme: light)" content="${light}"`);
    expect(html).toContain(`media="(prefers-color-scheme: dark)" content="${dark}"`);
  });
});
