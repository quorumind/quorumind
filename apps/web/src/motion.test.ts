import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(import.meta.dirname, "styles.css"), "utf8");

/** The rules outside any hover media query that style :hover (neutralisers of a busy or disabled state excepted). */
function looseHovers(source: string): string[] {
  const loose: string[] = [];
  let inHover = false;
  for (const line of source.split("\n")) {
    if (/^@media \(hover: hover\)/.test(line)) inHover = true;
    else if (/^\}/.test(line)) inHover = false;
    if (line.includes(":hover") && !inHover && !/aria-busy|aria-disabled|option:hover/.test(line)) loose.push(line.trim());
  }
  return loose;
}

// What a browser plays cannot be seen in a DOM test: these keep the motion rules that were decided.
describe("the motion rules", () => {
  it("styles :hover only where the pointer can hover, so a tap leaves nothing stuck", () => {
    expect(looseHovers(css)).toEqual([]);
  });

  it("asks for no tap highlight and no double-tap zoom on the controls", () => {
    expect(css).toMatch(/touch-action: manipulation;\s*-webkit-tap-highlight-color: transparent/);
  });

  it("shows the focus ring at once", () => {
    expect(css).not.toContain("focus-in");
    expect(/^:focus-visible \{([^}]*)\}/m.exec(css)?.[1]).not.toMatch(/animation|transition/);
  });

  it("keeps the verdict's glow still", () => {
    expect(css).not.toContain("@keyframes drift");
  });

  it("grows the weighted bar by a transform, from the side the text starts, without overshoot", () => {
    const bar = /\.weighted-bar i \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(bar).toContain("transform: scaleX(var(--v");
    expect(bar).toContain("transition: transform var(--dur-slow) var(--ease-out)");
    expect(css).toMatch(/\[dir="rtl"\] \.weighted-bar i \{\s*transform-origin: right/);
  });

  it("plays the verdict's entrance only for a verdict that has just arrived, and keeps its fill at 'backwards'", () => {
    expect(css).toMatch(/\.verdict-panel\[data-entering\] \{\s*animation: verdict-in var\(--dur-slow\) var\(--ease-out\) backwards/);
    expect(/\.verdict-panel \{([^}]*)\}/.exec(css)?.[1]).not.toContain("animation");
  });

  it("cuts every animation under reduced motion, the dialogs' backdrop included, but keeps a still sign of work", () => {
    const block = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}\n/.exec(css)?.[1] ?? "";
    expect(block).toContain("::backdrop");
    expect(block).toContain("animation: none !important");
    expect(block).toContain(".skeleton-line");
    expect(block).toContain("still-pulse");
    // Stale typing dots (--writing: paused) must still stop.
    expect(block).toContain("animation-play-state: var(--writing, running) !important");
    // The live dot itself pulses: its ::after has the dot's size and colour, so fading it shows nothing.
    expect(block).toContain('.progress li[data-live="true"] .progress-dot,');
  });
});
