// Reads the text of a Word document (.docx). The file is a zip of XML parts: only the main document
// part is inflated, with a hard cap on its size, so a zip bomb costs nothing. Headings, list items and
// table rows keep enough structure for a model to follow.

import { inflateRawSync } from "node:zlib";
import { ContextError } from "./errors.ts";
import { decodeEntities } from "./html.ts";

/** Largest XML part inflated: a 300-page specification is about 5 MB of document.xml. */
const MAX_PART_BYTES = 32 * 1024 * 1024;
const MAX_ENTRIES = 5_000;

const CFB_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const startsWith = (bytes: Uint8Array, signature: number[]) => signature.every((byte, i) => bytes[i] === byte);

/** An OLE compound file: a legacy .doc, or a .docx encrypted with a password (Office wraps those in one). */
export const isCompoundFile = (bytes: Uint8Array) => startsWith(bytes, CFB_SIGNATURE);

interface ZipEntry {
  method: number;
  flags: number;
  compressedSize: number;
  localOffset: number;
}

/** The central directory of a zip file, by entry name. */
function readDirectory(bytes: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = new Map<string, ZipEntry>();
  // The end-of-central-directory record sits in the last 64 KB (its comment is at most 65 535 bytes).
  for (let end = bytes.byteLength - 22; end >= Math.max(0, bytes.byteLength - 22 - 0xffff); end--) {
    if (view.getUint32(end, true) !== 0x06054b50) continue;
    const count = Math.min(view.getUint16(end + 10, true), MAX_ENTRIES);
    let offset = view.getUint32(end + 16, true);
    for (let i = 0; i < count; i++) {
      if (offset + 46 > bytes.byteLength || view.getUint32(offset, true) !== 0x02014b50) break;
      const nameLength = view.getUint16(offset + 28, true);
      const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
      entries.set(name, {
        flags: view.getUint16(offset + 8, true),
        method: view.getUint16(offset + 10, true),
        compressedSize: view.getUint32(offset + 20, true),
        localOffset: view.getUint32(offset + 42, true),
      });
      offset += 46 + nameLength + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
    }
    return entries;
  }
  return entries;
}

function readPart(bytes: Uint8Array, entry: ZipEntry): string {
  if (entry.flags & 1)
    throw new ContextError("encrypted", "This Word document is protected by a password. Remove the protection and try again.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const local = entry.localOffset;
  if (local + 30 > bytes.byteLength || view.getUint32(local, true) !== 0x04034b50) throw unreadable();
  const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
  const data = bytes.subarray(start, start + entry.compressedSize);
  let inflated: Uint8Array;
  if (entry.method === 0) {
    inflated = data;
  } else if (entry.method === 8) {
    try {
      inflated = inflateRawSync(data, { maxOutputLength: MAX_PART_BYTES });
    } catch (error) {
      if (error instanceof RangeError) throw new ContextError("too_large", "This Word document is too large once unpacked.");
      throw unreadable();
    }
  } else {
    throw unreadable();
  }
  if (inflated.byteLength > MAX_PART_BYTES) throw new ContextError("too_large", "This Word document is too large once unpacked.");
  return new TextDecoder().decode(inflated);
}

const unreadable = () => new ContextError("unsupported_type", "This Word document could not be read.");

/** Where the main document part is: word/document.xml in every file Word writes, but the package says. */
function mainPartName(bytes: Uint8Array, entries: Map<string, ZipEntry>): string {
  const rels = entries.get("_rels/.rels");
  if (rels) {
    const xml = readPart(bytes, rels);
    for (const match of xml.matchAll(/<Relationship\b[^>]*>/g)) {
      const tag = match[0];
      if (!/Type="[^"]*\/officeDocument"/.test(tag)) continue;
      const target = /Target="([^"]+)"/.exec(tag)?.[1];
      if (target) return decodeEntities(target).replace(/^\//, "");
    }
  }
  return "word/document.xml";
}

const HEADING = /^(?:heading|titre|berschrift|ttulo|titolo|kop)\s*(\d)$/i;

interface Paragraph {
  text: string;
  heading: number;
  list: boolean;
}

interface Row {
  cells: string[];
  cell: string[];
}

/** Turns WordprocessingML into text: one block per paragraph, "#" for headings, "-" for list items, " | " between cells. */
export function wordText(xml: string): string {
  // Text boxes are written twice, as DrawingML and as a VML fallback: keep one copy.
  const body = xml.replace(/<mc:Fallback\b[\s\S]*?<\/mc:Fallback>/g, "");
  const blocks: string[] = [];
  const paragraphs: Paragraph[] = [];
  const rows: Row[] = [];
  let inText = false;
  let previousList = false;

  const emit = (line: string, list: boolean) => {
    const row = rows.at(-1);
    if (row) {
      row.cell.push(line);
      return;
    }
    if (!line.trim()) return;
    // List items follow each other line by line; other blocks are separated by a blank line.
    if (list && previousList && blocks.length > 0) blocks[blocks.length - 1] += `\n${line}`;
    else blocks.push(line);
    previousList = list;
  };

  for (const match of body.matchAll(/<(\/?)([\w:]+)([^>]*?)(\/?)>|([^<]+)/g)) {
    const [, closing, tag, attributes = "", selfClosing, text] = match;
    const paragraph = paragraphs.at(-1);
    if (text !== undefined) {
      if (inText && paragraph) paragraph.text += decodeEntities(text);
      continue;
    }
    switch (tag) {
      case "w:p":
        if (closing) {
          const done = paragraphs.pop();
          if (done) {
            const prefix = done.heading ? `${"#".repeat(Math.min(done.heading, 6))} ` : done.list ? "- " : "";
            emit(done.text.trim() ? prefix + done.text.trim() : "", done.list);
          }
        } else if (!selfClosing) {
          paragraphs.push({ text: "", heading: 0, list: false });
        }
        break;
      case "w:t":
        inText = !closing && !selfClosing;
        break;
      case "w:tab":
        if (paragraph && !closing) paragraph.text += "\t";
        break;
      case "w:br":
      case "w:cr":
        if (paragraph && !closing) paragraph.text += "\n";
        break;
      case "w:pStyle": {
        const style = /w:val="([^"]*)"/.exec(attributes)?.[1] ?? "";
        const level = HEADING.exec(style)?.[1];
        if (paragraph) paragraph.heading = level ? Number(level) : /^title$/i.test(style) ? 1 : paragraph.heading;
        break;
      }
      case "w:numPr":
        if (paragraph && !closing) paragraph.list = true;
        break;
      case "w:tr":
        if (closing) {
          const row = rows.pop();
          if (row) emit(row.cells.filter(Boolean).join(" | "), false);
        } else if (!selfClosing) {
          rows.push({ cells: [], cell: [] });
        }
        break;
      case "w:tc": {
        const row = rows.at(-1);
        if (closing && row) {
          row.cells.push(row.cell.filter(Boolean).join(" ").replace(/\s+/g, " ").trim());
          row.cell = [];
        }
        break;
      }
    }
  }
  return blocks.join("\n\n");
}

/** Extracts the text of a .docx file. */
export function docxText(bytes: Uint8Array): string {
  if (isCompoundFile(bytes)) {
    throw new ContextError("encrypted", "This Word document is protected by a password. Remove the protection and try again.");
  }
  if (!startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) throw new ContextError("unsupported_type", "This file is not a valid Word document.");
  const entries = readDirectory(bytes);
  const main = entries.get(mainPartName(bytes, entries));
  if (!main) throw new ContextError("unsupported_type", "This file is not a valid Word document.");
  return wordText(readPart(bytes, main));
}
