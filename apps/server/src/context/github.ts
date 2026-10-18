import { ContextError } from "./errors.ts";
import { type ImportedDocument, makeDocument } from "./text.ts";

const API = "https://api.github.com";
const RAW = "https://raw.githubusercontent.com";
const TIMEOUT_MS = 20_000;

/** How much of a repository is imported. The whole document is then capped like any other. */
export const GITHUB_LIMITS = {
  treeDepth: 2,
  treeEntries: 300,
  readmeChars: 30_000,
  manifestChars: 6_000,
  /** Architecture notes and other documentation, most relevant first. */
  docs: 6,
  docChars: 8_000,
  /** Architecture decision records: the most recent ones are read, the others listed. */
  adrs: 6,
  adrChars: 4_000,
  adrList: 40,
  /** Files larger than this are listed but never downloaded. */
  fileBytes: 1024 * 1024,
} as const;

/** Files that tell how a codebase is built and run, looked for in the imported folder. */
export const MANIFESTS = [
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "go.mod",
  "Cargo.toml",
  "composer.json",
  "Gemfile",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "Dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
  "compose.yaml",
];

/** First path segments of github.com pages that are not accounts. */
const RESERVED = new Set(
  "about apps blog codespaces collections contact customer-stories enterprise events explore features issues join login marketplace new notifications orgs organizations pricing pulls readme search security settings signup site sponsors topics trending".split(
    " ",
  ),
);

export interface GithubTarget {
  owner: string;
  repo: string;
  /** Branch, tag or commit from a /tree/ or /blob/ address; null for the default branch. */
  ref: string | null;
  /** Folder inside the repository, without leading or trailing slash; "" for the root. */
  path: string;
}

/** Recognises a repository address: github.com/owner/repo, optionally /tree/<ref>/<folder> or /blob/<ref>/<file>. */
export function parseGithubUrl(input: string): GithubTarget | null {
  let url: URL;
  try {
    const trimmed = input.trim();
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  if (!/^(www\.)?github\.com$/i.test(url.hostname) || (url.protocol !== "https:" && url.protocol !== "http:")) return null;
  let segments: string[];
  try {
    segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return null;
  }
  if (segments.some((segment) => segment === "." || segment === ".." || segment.includes("/"))) return null;
  const [owner, rawRepo, view, ref, ...rest] = segments;
  if (!owner || !rawRepo || RESERVED.has(owner.toLowerCase())) return null;
  const repo = rawRepo.replace(/\.git$/i, "");
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) return null;
  if ((view === "tree" || view === "blob") && ref) {
    // A /blob/ address points to a file: import the folder that holds it.
    const folder = view === "blob" ? rest.slice(0, -1) : rest;
    return { owner, repo, ref, path: folder.join("/") };
  }
  return { owner, repo, ref: null, path: "" };
}

export interface GithubOptions {
  /** GITHUB_TOKEN: a higher rate limit, and private repositories. */
  token?: string | undefined;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

interface RepoInfo {
  full_name: string;
  html_url: string;
  description: string | null;
  default_branch: string;
  homepage: string | null;
  topics?: string[];
  license: { spdx_id: string | null; name: string } | null;
  archived: boolean;
  fork: boolean;
  stargazers_count: number;
  pushed_at: string | null;
}

interface TreeEntry {
  path: string;
  type: "blob" | "tree" | "commit";
  size?: number;
}

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max).trimEnd()}\n[…cut]` : text);
const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

const TEXT_FILE = /\.(md|markdown|mdx|rst|adoc|txt)$/i;
const KEY_DOC = /^(architecture|design|overview|spec|specification|technical[-_ ]?design)(\.[a-z]+)?$/i;
const DOCS_FOLDER = /^(docs?|documentation)\//i;
const ADR_FOLDER = /(^|\/)(adrs?|decisions|architecture[-_ ]?decisions?|decision[-_ ]?records?)\//i;
const RELEVANT_DOC = /architecture|overview|design|index|readme|introduction|getting[-_ ]?started|setup|deploy|infra|stack/i;

/** Picks the documentation worth reading: key documents at the root, then docs/, most relevant names first. */
export function pickDocs(paths: string[]): { docs: string[]; adrs: string[] } {
  const texts = paths.filter((path) => TEXT_FILE.test(path) && !/(^|\/)(changelog|license|code_of_conduct)/i.test(path));
  const adrs = texts.filter((path) => ADR_FOLDER.test(path)).sort((a, b) => a.localeCompare(b));
  const depth = (path: string) => path.split("/").length;
  const name = (path: string) => path.split("/").at(-1) ?? path;
  const root = texts.filter((path) => !path.includes("/") && KEY_DOC.test(name(path)));
  const folder = texts
    .filter((path) => DOCS_FOLDER.test(path) && !ADR_FOLDER.test(path) && depth(path) <= 3)
    .sort((a, b) => Number(RELEVANT_DOC.test(name(b))) - Number(RELEVANT_DOC.test(name(a))) || depth(a) - depth(b) || a.localeCompare(b));
  return { docs: [...root, ...folder].slice(0, GITHUB_LIMITS.docs), adrs };
}

/** Describes an existing codebase from GitHub: what it is, its languages, its layout, its README, manifests and key documents. */
export async function fetchGithub(input: string, options: GithubOptions = {}): Promise<ImportedDocument> {
  const target = parseGithubUrl(input);
  if (!target) throw new ContextError("unsupported_type", "This is not the address of a GitHub repository.");
  const doFetch = options.fetch ?? globalThis.fetch;
  const signal = AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS);
  const auth: Record<string, string> = options.token ? { Authorization: `Bearer ${options.token}` } : {};

  const get = async (url: string, accept: string, headers: Record<string, string> = {}): Promise<Response | null> => {
    let response: Response;
    try {
      response = await doFetch(url, { headers: { Accept: accept, "User-Agent": "Quorumind", ...headers }, signal });
    } catch {
      throw new ContextError("fetch_failed", signal.aborted ? "GitHub did not answer in time." : "GitHub could not be reached.");
    }
    if (response.ok) return response;
    if (response.status === 404 || response.status === 409) return null; // missing, or an empty repository
    if (response.status === 429 || (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0")) {
      throw new ContextError("rate_limited", "GitHub's request limit is reached. Try again in an hour, or set GITHUB_TOKEN on the server.");
    }
    if (response.status === 401) throw new ContextError("fetch_failed", "GitHub refused the token set in GITHUB_TOKEN.");
    throw new ContextError("fetch_failed", `GitHub answered with error ${response.status}.`);
  };
  const base = `/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}`;
  const api = async <T>(path: string): Promise<T | null> => {
    const response = await get(`${API}${path}`, "application/vnd.github+json", { "X-GitHub-Api-Version": "2022-11-28", ...auth });
    return response ? ((await response.json()) as T) : null;
  };
  // Without a token, file contents come from raw.githubusercontent.com, which does not count against the
  // API's hourly limit. With one, they come from the API, which also serves private repositories.
  const file = async (ref: string, path: string, max: number): Promise<string | null> => {
    const response = options.token
      ? await get(`${API}${base}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`, "application/vnd.github.raw+json", auth)
      : await get(`${RAW}/${target.owner}/${target.repo}/${encodePath(ref)}/${encodePath(path)}`, "text/plain");
    return response ? cut(await response.text(), max) : null;
  };

  const repo = await api<RepoInfo>(base);
  if (!repo) {
    throw new ContextError(
      "not_found",
      "This repository does not exist, or it is private (set GITHUB_TOKEN to import private repositories).",
    );
  }

  // A branch name can contain slashes: /tree/feature/login/src is either ref "feature" or "feature/login".
  const candidates: Array<{ ref: string; path: string }> = [];
  if (target.ref) {
    const parts = [target.ref, ...target.path.split("/").filter(Boolean)];
    for (let i = 1; i <= Math.min(parts.length, 3); i++)
      candidates.push({ ref: parts.slice(0, i).join("/"), path: parts.slice(i).join("/") });
  } else {
    candidates.push({ ref: repo.default_branch, path: "" });
  }
  let tree: { tree: TreeEntry[]; truncated: boolean } | null = null;
  let chosen = candidates[0] as { ref: string; path: string };
  for (const candidate of candidates) {
    tree = await api<{ tree: TreeEntry[]; truncated: boolean }>(`${base}/git/trees/${encodeURIComponent(candidate.ref)}?recursive=1`);
    chosen = candidate;
    if (tree) break;
  }
  if (!tree && target.ref) throw new ContextError("not_found", `The branch or folder "${target.ref}" does not exist in this repository.`);
  const { ref, path } = chosen;
  const prefix = path ? `${path}/` : "";
  const entries = (tree?.tree ?? []).filter((entry) => entry.path.startsWith(prefix) && entry.path !== path);
  if (path && tree && entries.length === 0) throw new ContextError("not_found", `The folder "${path}" does not exist in this repository.`);

  const relative = (entry: TreeEntry) => entry.path.slice(prefix.length);
  const shallow = entries
    .filter((entry) => relative(entry).split("/").length <= GITHUB_LIMITS.treeDepth)
    .sort((a, b) => a.path.localeCompare(b.path));
  const shown = shallow.slice(0, GITHUB_LIMITS.treeEntries);
  const treeLines = shown.map((entry) => {
    const parts = relative(entry).split("/");
    return `${"  ".repeat(parts.length - 1)}${parts.at(-1)}${entry.type === "blob" ? "" : "/"}`;
  });
  const blobs = entries.filter((entry) => entry.type === "blob" && (entry.size ?? 0) <= GITHUB_LIMITS.fileBytes);
  const topFiles = new Map(
    blobs.filter((entry) => !relative(entry).includes("/")).map((entry) => [relative(entry).toLowerCase(), entry.path]),
  );
  const readmeKey =
    [...topFiles.keys()].find((name) => /^readme\.(md|markdown)$/.test(name)) ??
    [...topFiles.keys()].find((name) => /^readme(\.\w+)?$/.test(name));
  const readmePath = readmeKey ? topFiles.get(readmeKey) : undefined;
  const manifests = MANIFESTS.map((name) => topFiles.get(name.toLowerCase())).filter((found): found is string => Boolean(found));
  const picked = pickDocs(blobs.map(relative).filter((name) => name.toLowerCase() !== readmeKey));
  const docs = picked.docs.map((name) => prefix + name);
  const adrs = picked.adrs.map((name) => prefix + name);
  const adrsRead = adrs.slice(-GITHUB_LIMITS.adrs);
  const workflows = (tree?.tree ?? [])
    .filter((entry) => entry.type === "blob" && /^\.github\/workflows\/[^/]+\.ya?ml$/.test(entry.path))
    .map((entry) => entry.path.slice(".github/workflows/".length));

  const [languageBytes, readme, manifestTexts, docTexts, adrTexts] = await Promise.all([
    api<Record<string, number>>(`${base}/languages`),
    readmePath ? file(ref, readmePath, GITHUB_LIMITS.readmeChars) : Promise.resolve(null),
    Promise.all(manifests.map((name) => file(ref, name, GITHUB_LIMITS.manifestChars))),
    Promise.all(docs.map((name) => file(ref, name, GITHUB_LIMITS.docChars))),
    Promise.all(adrsRead.map((name) => file(ref, name, GITHUB_LIMITS.adrChars))),
  ]);

  const total = Object.values(languageBytes ?? {}).reduce((sum, bytes) => sum + bytes, 0);
  const languageLine = Object.entries(languageBytes ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, bytes]) => `${name} ${((bytes / total) * 100).toFixed(bytes / total < 0.01 ? 1 : 0)} %`)
    .join(", ");
  const section = (title: string, text: string | null | undefined) => (text ? `\n## ${title}\n\n${text}` : null);
  const listed = adrs.slice(-GITHUB_LIMITS.adrList);
  const address = `${repo.html_url}${path || ref !== repo.default_branch ? `/tree/${ref}${path ? `/${path}` : ""}` : ""}`;

  const lines = [
    `# GitHub repository ${repo.full_name}${path ? `, folder ${path}` : ""}`,
    "",
    repo.description ? `Description: ${repo.description}` : null,
    `Branch: ${ref}${ref === repo.default_branch ? " (default)" : `, default branch ${repo.default_branch}`}`,
    languageLine ? `Languages: ${languageLine}` : null,
    repo.topics?.length ? `Topics: ${repo.topics.join(", ")}` : null,
    repo.license
      ? `License: ${repo.license.spdx_id && repo.license.spdx_id !== "NOASSERTION" ? repo.license.spdx_id : repo.license.name}`
      : null,
    repo.homepage ? `Website: ${repo.homepage}` : null,
    `Stars: ${repo.stargazers_count}${repo.pushed_at ? `, last push ${repo.pushed_at.slice(0, 10)}` : ""}${repo.archived ? ", archived" : ""}${repo.fork ? ", fork" : ""}`,
    "",
    `## Files (${GITHUB_LIMITS.treeDepth} levels${shallow.length > shown.length ? `, first ${shown.length} of ${shallow.length} entries` : ""}${tree?.truncated ? ", the repository is too large to be listed fully" : ""})`,
    "",
    treeLines.length ? treeLines.join("\n") : "(empty)",
    workflows.length ? `\n## CI workflows (.github/workflows)\n\n${workflows.map((name) => `- ${name}`).join("\n")}` : null,
    readmePath ? section(readmePath, readme) : null,
    ...manifests.map((name, i) => section(name, manifestTexts[i])),
    ...docs.map((name, i) => section(name, docTexts[i])),
    adrs.length
      ? `\n## Architecture decision records (${adrs.length}${adrs.length > listed.length ? `, the last ${listed.length} listed` : ""})\n\n${listed.map((name) => `- ${name}`).join("\n")}`
      : null,
    ...adrsRead.map((name, i) => section(name, adrTexts[i])),
  ];
  return makeDocument({
    kind: "github",
    name: `${repo.full_name}${path ? `/${path}` : ""}`,
    raw: lines.filter((line) => line !== null).join("\n"),
    source: address,
    fallbackName: repo.full_name,
  });
}
