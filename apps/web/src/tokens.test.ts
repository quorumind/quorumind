import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const tokens = readFileSync(join(import.meta.dirname, "tokens.css"), "utf8");
const css = readFileSync(join(import.meta.dirname, "styles.css"), "utf8");

describe("the design tokens", () => {
  it("are imported by the stylesheet, which does not redeclare them", () => {
    expect(css).toMatch(/^@import "\.\/tokens\.css";/m);
    expect(css).not.toMatch(/^\s*--(surface|ink|primary|dur|ease-out|fs-md):/m);
  });

  it("carry the type scale and the motion set shared with the site and the hosted screens", () => {
    for (const [name, value] of [
      ["--fs-xs", "12px"],
      ["--fs-sm", "13px"],
      ["--fs-md", "14px"],
      ["--fs-base", "16px"],
      ["--fs-lg", "18px"],
      ["--fs-xl", "22px"],
      ["--fs-2xl", "28px"],
      ["--fs-3xl", "36px"],
      ["--dur-fast", "160ms"],
      ["--dur", "280ms"],
      ["--dur-slow", "640ms"],
      ["--ease-out", "cubic-bezier(0.16, 1, 0.3, 1)"],
    ] as const) {
      expect(tokens, name).toContain(`${name}: ${value};`);
    }
  });

  it("are the only place of a font size, a duration or a curve", () => {
    expect(css.match(/font-size: (?!var\(|clamp\(var\()[^;]*;/g) ?? []).toEqual([]);
    expect(css).not.toContain("cubic-bezier");
    // Delays and loops (an animation that repeats) may keep their own numbers; a duration of 100ms or more may not.
    const literal = css
      .split("\n")
      .filter((line) => /\d{3,}ms/.test(line) && !/delay|infinite|^\s*\/?\*|var\(--ease[\w-]*\) \d+ms/.test(line));
    expect(literal).toEqual([]);
  });

  it("styles the figures in Plex Mono with figures of one width", () => {
    expect(/\.figure \{([^}]*)\}/.exec(css)?.[1]).toMatch(/var\(--font-mono\)[\s\S]*tabular-nums/);
  });
});
