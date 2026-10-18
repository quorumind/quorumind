// White-label branding of the exported documents: an agency's name, logo and accent color shown
// instead of Quorumind's. Browser-safe, so the settings form validates with the same rules.

export interface Branding {
  name: string | null;
  /** A PNG, JPEG or SVG image as a base64 data URL. */
  logoDataUrl: string | null;
  /** A #rrggbb color. */
  accent: string | null;
}

export const DEFAULT_BRANDING: Branding = { name: null, logoDataUrl: null, accent: null };

/** Quorumind's own accent, the thesis blue of the "Contrepoint" palette. */
export const QUORUMIND_ACCENT = "#2b44c4";

export const LOGO_TYPES = ["image/png", "image/jpeg", "image/svg+xml"] as const;
export type LogoType = (typeof LOGO_TYPES)[number];

/** Longest logo data URL stored: 200 KB, so a save stays under the API's 256 KB request limit. */
export const LOGO_MAX_DATA_URL = 200 * 1024;
/** Largest logo file accepted (150 kB): base64 grows it by a third, which still fits in LOGO_MAX_DATA_URL. */
export const LOGO_MAX_FILE_BYTES = 150_000;
export const BRAND_NAME_MAX = 80;

export const isAccent = (value: string): boolean => /^#[0-9a-f]{6}$/i.test(value);

function decodeBase64(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 !== 0) return null;
  try {
    return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

const startsWith = (bytes: Uint8Array, prefix: number[]) => prefix.every((value, index) => bytes[index] === value);

/**
 * Checks a logo data URL: an allowed type, base64 content whose bytes match that type, and the size
 * limit. Returns the decoded image, or null when anything is off.
 */
export function parseLogo(dataUrl: string): { type: LogoType; bytes: Uint8Array } | null {
  if (dataUrl.length > LOGO_MAX_DATA_URL) return null;
  const match = /^data:(image\/(?:png|jpeg|svg\+xml));base64,(.*)$/s.exec(dataUrl);
  if (!match) return null;
  const type = match[1] as LogoType;
  const bytes = decodeBase64(match[2] as string);
  if (!bytes || bytes.length === 0) return null;
  if (type === "image/png" && !startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return null;
  if (type === "image/jpeg" && !startsWith(bytes, [0xff, 0xd8, 0xff])) return null;
  // An SVG shown through <img> cannot run scripts; it only has to be an SVG document.
  if (type === "image/svg+xml" && !/<svg[\s>]/i.test(new TextDecoder().decode(bytes.subarray(0, 4096)))) return null;
  return { type, bytes };
}

/** Pixel size of a PNG or JPEG, read from its header, to keep the logo's proportions in Word. */
export function imageSize(type: LogoType, bytes: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (type === "image/png" && bytes.length >= 24) return { width: view.getUint32(16), height: view.getUint32(20) };
  if (type === "image/jpeg") {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) return null;
      const marker = bytes[offset + 1] as number;
      const length = view.getUint16(offset + 2);
      // Start-of-frame markers carry the dimensions; C4, C8 and CC are not frames.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: view.getUint16(offset + 7), height: view.getUint16(offset + 5) };
      }
      offset += 2 + length;
    }
  }
  return null;
}
