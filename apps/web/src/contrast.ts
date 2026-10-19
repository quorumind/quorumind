// Contrast as WCAG 2 measures it, for the colors an agency brings: its accent must stay readable as text and links on
// the page's surfaces, in the light theme and in the dark one, and so must the text written on it.

type Rgb = [number, number, number];

/** WCAG's AA minimum for text of normal size. */
export const TEXT_CONTRAST = 4.5;

const HEX = /^#[0-9a-f]{6}$/i;

export const isHexColor = (value: string | null | undefined): value is string => typeof value === "string" && HEX.test(value);

function rgb(hex: string): Rgb {
  return [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16)) as Rgb;
}

function hexOf([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`;
}

/** The relative luminance of a color, from 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const linear = (value: number) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = rgb(hex).map(linear) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The contrast ratio of two colors, from 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/** The color of text written on a fill: white or black, whichever reads better. */
export function textOn(fill: string): "#ffffff" | "#000000" {
  return contrastRatio(fill, "#ffffff") >= contrastRatio(fill, "#000000") ? "#ffffff" : "#000000";
}

/** A color mixed with another one; `amount` 0 keeps it, 1 gives the other. */
function mix(hex: string, other: Rgb, amount: number): string {
  const [r, g, b] = rgb(hex);
  return hexOf([r + (other[0] - r) * amount, g + (other[1] - g) * amount, b + (other[2] - b) * amount]);
}

/** Two colors blended, as `color-mix(in srgb, …)` does: `amount` of `other`, the rest of `hex`. */
export function blend(hex: string, other: string, amount: number): string {
  return mix(hex, rgb(other), amount);
}

/**
 * The accent as text on these surfaces: the accent itself when it reads well enough on every one, otherwise the
 * closest shade that does, darker on light surfaces and lighter on dark ones.
 */
export function readableOn(accent: string, surfaces: string[], minimum = TEXT_CONTRAST): string {
  const enough = (color: string) => surfaces.every((surface) => contrastRatio(color, surface) >= minimum);
  if (enough(accent)) return accent;
  const dark = surfaces.reduce((sum, surface) => sum + luminance(surface), 0) / surfaces.length < 0.5;
  const toward: Rgb = dark ? [255, 255, 255] : [0, 0, 0];
  for (let step = 1; step <= 50; step++) {
    const shade = mix(accent, toward, step / 50);
    if (enough(shade)) return shade;
  }
  return hexOf(toward);
}
