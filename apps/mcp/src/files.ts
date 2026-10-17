import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve } from "node:path";
import type { ContextDocument } from "@quorumind/core";

/** Characters kept from one file: the rest is cut, and the agent is told. */
export const MAX_FILE_CHARS = 40_000;
/** Characters sent for all files together: the server caps a request body at 256 KB. */
export const MAX_TOTAL_CHARS = 120_000;
export const MAX_FILES = 10;
/** Larger files are refused outright rather than read into memory. */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

export class ContextFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContextFileError";
  }
}

/** Reads local text files to attach to a session as context documents. */
export async function readContextFiles(paths: string[], cwd: string): Promise<{ documents: ContextDocument[]; notes: string[] }> {
  if (paths.length > MAX_FILES) throw new ContextFileError(`Attach at most ${MAX_FILES} files.`);
  const documents: ContextDocument[] = [];
  const notes: string[] = [];
  let total = 0;
  for (const path of paths) {
    const absolute = resolve(cwd, path);
    const info = await stat(absolute).catch(() => null);
    if (!info?.isFile()) throw new ContextFileError(`${path} is not a readable file.`);
    if (info.size > MAX_FILE_BYTES)
      throw new ContextFileError(`${path} is too large (${Math.round(info.size / 1024)} KB): attach an excerpt instead.`);
    const bytes = await readFile(absolute);
    if (bytes.includes(0)) throw new ContextFileError(`${path} is a binary file: only text files can be attached.`);
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new ContextFileError(`${path} is not UTF-8 text.`);
    }
    if (text.length > MAX_FILE_CHARS) {
      notes.push(`${path} was cut to its first ${MAX_FILE_CHARS} characters (of ${text.length}).`);
      text = `${text.slice(0, MAX_FILE_CHARS)}\n[…truncated]`;
    }
    total += text.length;
    if (total > MAX_TOTAL_CHARS) {
      throw new ContextFileError(`The attached files exceed ${MAX_TOTAL_CHARS} characters together: attach fewer or shorter files.`);
    }
    // Outside the project, only the file name is sent: a home directory path says nothing useful.
    const inside = relative(cwd, absolute);
    const name = inside && !inside.startsWith("..") && !isAbsolute(inside) ? inside : basename(absolute);
    documents.push({ id: randomUUID(), kind: "text", name, text });
  }
  return { documents, notes };
}
