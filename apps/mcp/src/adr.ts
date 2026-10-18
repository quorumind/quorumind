import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

// Where a repository keeps its Architecture Decision Records, and the name of the next one. The usual
// folders are tried in this order; adr-tools' .adr-dir file, when present, names the folder instead.
// Records are numbered NNNN-title.md: the next one takes the highest number plus one, with as many digits
// as the existing ones (four when there is none yet).

export const ADR_DIRECTORIES = ["docs/adr", "docs/decisions", "adr", "doc/adr"] as const;
const DEFAULT_DIRECTORY = "docs/adr";
const NUMBERED = /^(\d+)-.+\.md$/i;

export class AdrError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdrError";
  }
}

export interface AdrTarget {
  /** Absolute path of the ADR folder. */
  directory: string;
  /** The folder relative to the repository root, with forward slashes. */
  relativeDirectory: string;
  /** False when the folder does not exist yet. */
  exists: boolean;
  /** Numbered records already there. */
  count: number;
  number: number;
  width: number;
}

export const isDirectory = (path: string) =>
  stat(path).then(
    (info) => info.isDirectory(),
    () => false,
  );

async function numbers(directory: string): Promise<string[]> {
  const names = await readdir(directory).catch(() => [] as string[]);
  return names.flatMap((name) => NUMBERED.exec(name)?.[1] ?? []);
}

/** The folder named by adr-tools' .adr-dir file, when it stays inside the repository. */
async function adrDirFile(root: string): Promise<string | null> {
  const content = await readFile(join(root, ".adr-dir"), "utf8").catch(() => null);
  const folder = content?.trim();
  if (!folder) return null;
  const inside = relative(root, resolve(root, folder));
  if (!inside || inside.startsWith("..") || isAbsolute(inside)) throw new AdrError(`.adr-dir points outside the repository (${folder}).`);
  return inside;
}

/** The ADR folder of the repository at `root` and the number of its next record. */
export async function findAdrTarget(root: string): Promise<AdrTarget> {
  const named = await adrDirFile(root);
  const candidates = named ? [named] : [...ADR_DIRECTORIES];
  let best: { folder: string; found: string[] } | null = null;
  for (const folder of candidates) {
    if (!(await isDirectory(join(root, folder)))) continue;
    const found = await numbers(join(root, folder));
    // The first existing folder, unless a later one holds more records.
    if (!best || found.length > best.found.length) best = { folder, found };
  }
  const folder = best?.folder ?? named ?? DEFAULT_DIRECTORY;
  const found = best?.found ?? [];
  const highest = found.reduce((max, digits) => Math.max(max, Number(digits)), 0);
  const width = found.reduce((max, digits) => Math.max(max, digits.length), 0) || 4;
  return {
    directory: join(root, folder),
    relativeDirectory: folder.replaceAll("\\", "/"),
    exists: best !== null,
    count: found.length,
    number: highest + 1,
    width,
  };
}

/** A file-name slug: lower case, accents folded, words joined by hyphens. */
export function adrSlug(text: string): string {
  return (
    text
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 60)
      .replace(/^-+|-+$/g, "") || "decision"
  );
}

export const adrFileName = (number: number, width: number, slug: string) => `${String(number).padStart(width, "0")}-${slug}.md`;

/** Writes the record, creating the folder if needed; never replaces a file. Returns its absolute path. */
export async function writeAdr(target: AdrTarget, slug: string, content: string | Uint8Array): Promise<string> {
  await mkdir(target.directory, { recursive: true });
  const path = join(target.directory, adrFileName(target.number, target.width, slug));
  try {
    await writeFile(path, content, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new AdrError(`${path} already exists. Nothing was written.`);
    throw error;
  }
  return path;
}
