import { randomUUID } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve } from "node:path";
import type { ContextDocument } from "@quorumind/core";

// The server's limits, MAX_CONTEXT_DOCUMENTS and MAX_CONTEXT_CHARS in @quorumind/core, copied so that
// this package runs without the core at runtime; a test keeps them in step. Five files at their longest
// fit in the 4 MB the server accepts for a new session.

/** Files attached to one session. */
export const MAX_FILES = 5;
/** Characters kept from one file, marker included: the rest is cut, and the agent is told. */
export const MAX_FILE_CHARS = 100_000;
const CUT_MARKER = "\n[…truncated]";
/** Larger files are refused outright rather than read into memory. */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

/**
 * Names of files that hold secrets: environment files, private keys, credentials. The agent may be steered by
 * text it read elsewhere (a prompt injection) into attaching them, and the documents go to the server and to model
 * providers.
 */
const SECRET_NAMES = [
  /^\.env(\..*)?$/i,
  /^\.npmrc$/i,
  /^\.netrc$/i,
  /^\.pgpass$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /\.(pem|key|p12|pfx|keystore|jks)$/i,
  /^credentials(\.json)?$/i,
];

export class ContextFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContextFileError";
  }
}

export interface ReadOptions {
  /** Reads files outside the project directory too (QUORUMIND_MCP_ALLOW_OUTSIDE=1). */
  allowOutside?: boolean;
}

const inside = (root: string, path: string) => {
  const within = relative(root, path);
  return within === "" || (!within.startsWith("..") && !isAbsolute(within));
};

/**
 * Reads local text files to attach to a session as context documents. Only files inside the project directory (`cwd`)
 * are read, once symbolic links are resolved, and never a file named like a secret (.env, a private key): the agent
 * picks the paths, and what it attaches leaves the machine.
 */
export async function readContextFiles(
  paths: string[],
  cwd: string,
  options: ReadOptions = {},
): Promise<{ documents: ContextDocument[]; notes: string[] }> {
  if (paths.length > MAX_FILES) throw new ContextFileError(`Attach at most ${MAX_FILES} files.`);
  const root = await realpath(cwd).catch(() => resolve(cwd));
  const documents: ContextDocument[] = [];
  const notes: string[] = [];
  for (const path of paths) {
    const absolute = resolve(cwd, path);
    const real = await realpath(absolute).catch(() => null);
    const info = real ? await stat(real).catch(() => null) : null;
    if (!real || !info?.isFile()) throw new ContextFileError(`${path} is not a readable file.`);
    if (!options.allowOutside && !inside(root, real)) {
      throw new ContextFileError(`${path} is outside the project directory (${root}): only files of the project can be attached.`);
    }
    if (SECRET_NAMES.some((pattern) => pattern.test(basename(real)) || pattern.test(basename(absolute)))) {
      throw new ContextFileError(`${path} looks like a file of secrets: it is not attached.`);
    }
    if (info.size > MAX_FILE_BYTES)
      throw new ContextFileError(`${path} is too large (${Math.round(info.size / 1024)} KB): attach an excerpt instead.`);
    const bytes = await readFile(real);
    if (bytes.includes(0)) throw new ContextFileError(`${path} is a binary file: only text files can be attached.`);
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new ContextFileError(`${path} is not UTF-8 text.`);
    }
    const truncated = text.length > MAX_FILE_CHARS;
    if (truncated) {
      const kept = MAX_FILE_CHARS - CUT_MARKER.length;
      notes.push(`${path} was cut to its first ${kept} characters (of ${text.length}).`);
      text = `${text.slice(0, kept)}${CUT_MARKER}`;
    }
    // Outside the project, only the file name is sent: a home directory path says nothing useful.
    const name = inside(root, real) ? relative(root, real).replaceAll("\\", "/") : basename(absolute);
    documents.push({ id: randomUUID(), kind: "file", name, text, source: name, truncated });
  }
  return { documents, notes };
}
