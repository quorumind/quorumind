import { type ContextDocument, MAX_CONTEXT_CHARS } from "@quorumind/core";
import { ContextError } from "./errors.ts";

export const CUT_MARKER = "\n\n[…document cut: only the beginning was imported]";
const MAX_NAME_CHARS = 200;

/** What the import routes answer: the document the session will carry, and its size for the interface. */
export type ImportedDocument = ContextDocument & { chars: number; truncated: boolean };

/**
 * Normalises whitespace without losing the structure: line breaks become \n, runs of spaces
 * inside a line shrink to one, indentation (nested lists, code) survives up to 16 columns,
 * trailing spaces go, and no more than one blank line separates two blocks.
 */
export function cleanWhitespace(text: string): string {
  return (
    text
      .replace(/\r\n?|[\u2028\u2029\u0085]/g, "\n")
      // Control characters other than tab and newline, and the zero-width ones, carry nothing.
      // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point.
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f\u200b\ufeff]/g, "")
      .split("\n")
      .map((line) => {
        const [, lead = "", rest = ""] = /^(\s*)(.*)$/.exec(line) ?? [];
        const body = rest.replace(/\s+/g, " ").trimEnd();
        return body ? lead.replace(/\t/g, "  ").replace(/\s/g, " ").slice(0, 16) + body : "";
      })
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/^\n+|\n+$/g, "")
  );
}

/** Keeps the first `max` characters, cut at a line break when one is close, with a visible marker. */
export function capText(text: string, max = MAX_CONTEXT_CHARS): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  let end = max - CUT_MARKER.length;
  const lineBreak = text.lastIndexOf("\n", end);
  if (lineBreak > end - 2_000) end = lineBreak;
  // Never split a surrogate pair.
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return { text: text.slice(0, end).trimEnd() + CUT_MARKER, truncated: true };
}

export function cleanName(name: string, fallback: string): string {
  const cleaned = name.replace(/\s+/g, " ").trim().slice(0, MAX_NAME_CHARS);
  return cleaned || fallback;
}

export interface DocumentInput {
  kind: ContextDocument["kind"];
  name: string;
  raw: string;
  source?: string;
  fallbackName?: string;
  /** Said when nothing is left once the whitespace is cleaned. */
  emptyMessage?: string;
  emptyCode?: "empty" | "scanned";
  /** The extractor already left part of the source out (PDF pages beyond the cap, for instance). */
  partial?: boolean;
}

/** Builds the document, refusing one without any text. */
export function makeDocument({
  kind,
  name,
  raw,
  source,
  fallbackName = "Document",
  emptyMessage,
  emptyCode = "empty",
  partial = false,
}: DocumentInput): ImportedDocument {
  const cleaned = cleanWhitespace(raw);
  if (!cleaned) throw new ContextError(emptyCode, emptyMessage ?? "No text could be found in this document.");
  const { text, truncated } = capText(cleaned);
  return {
    id: globalThis.crypto.randomUUID(),
    kind,
    name: cleanName(name, fallbackName),
    text,
    ...(source ? { source: source.slice(0, 2_000) } : {}),
    truncated: truncated || partial,
    chars: text.length,
  };
}
