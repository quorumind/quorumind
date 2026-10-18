import { spawn } from "node:child_process";
import type { GithubIssuePlan } from "@quorumind/core";

// Creates the GitHub issues of a roadmap with the GitHub CLI (gh), as whoever is signed in to it on this
// machine. Quorumind never asks for, sees or stores a GitHub credential: gh keeps its own. Arguments are
// passed without a shell and bodies through standard input, so nothing in them is interpreted.

export interface CommandResult {
  /** Null when the command could not be started (not installed). */
  code: number | null;
  stdout: string;
  stderr: string;
}

export type RunCommand = (command: string, args: string[], options: { cwd: string; input?: string }) => Promise<CommandResult>;

/** Runs a command and collects its output. */
export const runCommand: RunCommand = (command, args, options) =>
  new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(command, args, { cwd: options.cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => resolve({ code: null, stdout, stderr: error.message }));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.stdin.on("error", () => {
      // The command ended before reading its input: its exit code says why.
    });
    child.stdin.end(options.input ?? "");
  });

/** owner/name, as gh's --repo takes it; neither part may start like an option. */
export const GITHUB_REPO = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.][A-Za-z0-9_.-]*$/;

export class GithubCliError extends Error {
  /** The issues created before the failure. */
  readonly created: CreatedIssue[];
  constructor(message: string, created: CreatedIssue[] = []) {
    super(message);
    this.name = "GithubCliError";
    this.created = created;
  }
}

export interface CreatedIssue {
  title: string;
  url: string;
}

const firstLine = (text: string) => text.trim().split("\n")[0] ?? "";

/** Whether gh is installed and signed in; an error that says what to do otherwise. */
export async function checkGithubCli(run: RunCommand, cwd: string): Promise<void> {
  const version = await run("gh", ["--version"], { cwd });
  if (version.code === null) throw new GithubCliError("The GitHub CLI (gh) is not installed here: https://cli.github.com.");
  const auth = await run("gh", ["auth", "status"], { cwd });
  if (auth.code !== 0) throw new GithubCliError("The GitHub CLI is not signed in: ask the user to run `gh auth login`, then try again.");
}

/** Creates the label, then each phase's steps, then the phase's tracking issue that lists them. */
export async function createGithubIssues(
  plan: GithubIssuePlan,
  run: RunCommand,
  options: { cwd: string; repo: string | null },
): Promise<CreatedIssue[]> {
  const repo = options.repo ? ["--repo", options.repo] : [];
  for (const label of plan.labels) {
    const result = await run(
      "gh",
      ["label", "create", label, ...repo, "--color", "4b5bd6", "--description", "Planned with Quorumind", "--force"],
      { cwd: options.cwd },
    );
    if (result.code !== 0) throw new GithubCliError(`gh could not create the label "${label}": ${firstLine(result.stderr)}`);
  }
  const created: CreatedIssue[] = [];
  const create = async (title: string, body: string) => {
    const labels = plan.labels.flatMap((label) => ["--label", label]);
    const result = await run("gh", ["issue", "create", ...repo, "--title", title, ...labels, "--body-file", "-"], {
      cwd: options.cwd,
      input: body,
    });
    const url = result.stdout.trim().split("\n").at(-1)?.trim() ?? "";
    if (result.code !== 0 || !/^https?:\/\//.test(url)) {
      throw new GithubCliError(`gh could not create the issue "${title}": ${firstLine(result.stderr) || "no issue URL returned"}`, created);
    }
    created.push({ title, url });
    return url;
  };
  for (const phase of plan.phases) {
    const steps: string[] = [];
    for (const step of phase.steps) steps.push(await create(step.title, step.body));
    await create(phase.title, `${phase.body}\n\n## Steps\n\n${steps.map((url) => `- [ ] ${url}`).join("\n")}`);
  }
  return created;
}
