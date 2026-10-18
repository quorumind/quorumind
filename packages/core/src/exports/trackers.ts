import { chosenOption, reportSlug } from "../report.ts";
import type { Session } from "../session.ts";
import { toCsv } from "./csv.ts";

// The roadmap of a verdict as work items for an issue tracker: each phase becomes an epic (Jira), a phase issue
// (Linear) or a tracking issue (GitHub), and each step of a phase a story or an issue under it. The scaffolding is
// in English, like the coding-agent hand-off; the phases and steps stay as the arbiter wrote them.

/** The label every imported item carries, to find them again. */
export const TRACKER_LABEL = "quorumind";

export interface RoadmapStep {
  /** A short title, cut at a word boundary when the step is long. */
  title: string;
  /** The step as written. */
  text: string;
}

export interface RoadmapPhase {
  number: number;
  name: string;
  content: string;
  exitCriterion: string;
  steps: RoadmapStep[];
}

export interface RoadmapPlan {
  project: string;
  /** The recommended option's title, or null when none is feasible. */
  decision: string | null;
  sessionId: string;
  date: string;
  phases: RoadmapPhase[];
}

const BULLET = /^\s*(?:[-*•–]|\d+[.)])\s+/;
const COMMAS = /\s*[,，、،]\s*/;
const SENTENCE_END = /[.!?。！？]\s/;

/**
 * The steps of a phase, from its content: one per line or list item, else one per semicolon, else one per item
 * of a short enumeration ("Schedules, booking, passes, reminders"). Anything else is a single step.
 */
export function roadmapSteps(content: string): string[] {
  const clean = (items: string[]) => items.map((item) => item.replace(BULLET, "").trim()).filter(Boolean);
  const lines = clean(content.split(/\r?\n/));
  if (lines.length > 1) return lines;
  const single = lines[0] ?? "";
  const clauses = clean(single.split(/\s*[;；]\s*/));
  if (clauses.length > 1) return clauses;
  const items = clean(single.split(COMMAS)).map((item) => item.replace(/^(?:and|or)\s+/i, ""));
  // Three items at least, all short: an enumeration, not a sentence with a comma in it.
  if (items.length >= 3 && items.every((item) => item.length <= 60 && !SENTENCE_END.test(item))) return items;
  return single ? [single] : [];
}

/** A title of at most `max` characters, cut at a word boundary. */
export function shortTitle(text: string, max = 120): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const upper = flat ? `${flat[0]?.toLocaleUpperCase() ?? ""}${flat.slice(1)}` : flat;
  if (upper.length <= max) return upper;
  const cut = upper.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, "")}…`;
}

/** The roadmap of a finished session as phases and steps. */
export function roadmapPlan(session: Session): RoadmapPlan {
  const chosen = chosenOption(session);
  return {
    project: session.sheet?.projectName ?? session.idea,
    decision: chosen?.proposal?.title ?? null,
    sessionId: session.id,
    date: session.updatedAt.slice(0, 10),
    phases: (session.verdict?.roadmap ?? []).map((phase, index) => {
      const steps = roadmapSteps(phase.content);
      return {
        number: index + 1,
        name: phase.phase.trim(),
        content: phase.content.trim(),
        exitCriterion: phase.exitCriterion.trim(),
        steps: (steps.length > 0 ? steps : [phase.phase]).map((text) => ({ title: shortTitle(text), text })),
      };
    }),
  };
}

const phaseTitle = (phase: RoadmapPhase) => shortTitle(`Phase ${phase.number}: ${phase.name}`, 200);
const source = (plan: RoadmapPlan) =>
  `Planned with Quorumind from decision session ${plan.sessionId} (${plan.date})${plan.decision ? `: ${plan.decision}` : ""}.`;

/**
 * Jira's CSV importer (System, External system import, CSV), one row per work item, epics first. Map the columns
 * as follows: Issue ID to Issue ID (Work item ID), Parent to Parent, Issue Type to Issue Type, Summary to Summary,
 * Description to Description, Acceptance Criteria to the project's acceptance criteria field when it has one
 * (the description repeats it otherwise), Epic Name to Epic Name on Jira versions that still have it, and
 * Labels to Labels. Issue IDs only link stories to their epic within the file; Jira gives its own keys.
 */
export const JIRA_COLUMNS = ["Issue ID", "Parent", "Issue Type", "Summary", "Description", "Acceptance Criteria", "Epic Name", "Labels"];

export function renderJiraCsv(session: Session): string {
  const plan = roadmapPlan(session);
  const epics: string[][] = [];
  const stories: string[][] = [];
  let id = 0;
  for (const phase of plan.phases) {
    const epicId = String(++id);
    const title = phaseTitle(phase);
    epics.push([
      epicId,
      "",
      "Epic",
      title,
      [phase.content, `Exit criterion: ${phase.exitCriterion}`, `Project: ${plan.project}. ${source(plan)}`].join("\n\n"),
      phase.exitCriterion,
      title,
      TRACKER_LABEL,
    ]);
    for (const step of phase.steps) {
      stories.push([
        String(++id),
        epicId,
        "Story",
        step.title,
        [step.text, `${title}. Phase exit criterion: ${phase.exitCriterion}`, source(plan)].join("\n\n"),
        phase.exitCriterion,
        "",
        TRACKER_LABEL,
      ]);
    }
  }
  return toCsv(JIRA_COLUMNS, [...epics, ...stories]);
}

/**
 * Linear's CSV format (Settings, Import/Export, the "Linear" CSV option of the CLI importer). It imports the
 * title, description (Markdown), status, priority and labels; it does not create projects. Each phase is an issue
 * of its own, followed by its steps, and every issue is labelled "quorumind" and "Phase N" so that each phase can be
 * selected and moved into a project in one go. The Project column names that project for the importers that read it.
 */
export const LINEAR_COLUMNS = ["Title", "Description", "Status", "Priority", "Labels", "Project"];

export function renderLinearCsv(session: Session): string {
  const plan = roadmapPlan(session);
  const rows: string[][] = [];
  for (const phase of plan.phases) {
    const labels = `${TRACKER_LABEL}, Phase ${phase.number}`;
    const project = shortTitle(`${plan.project}: ${phaseTitle(phase)}`, 80);
    const steps = phase.steps.map((step) => `- [ ] ${step.title}`).join("\n");
    rows.push([
      phaseTitle(phase),
      [phase.content, `**Exit criterion:** ${phase.exitCriterion}`, `**Steps**\n\n${steps}`, `_${source(plan)}_`].join("\n\n"),
      "Backlog",
      "No priority",
      labels,
      project,
    ]);
    for (const step of phase.steps) {
      rows.push([
        step.title,
        [step.text, `**${phaseTitle(phase)}.** Phase exit criterion: ${phase.exitCriterion}`, `_${source(plan)}_`].join("\n\n"),
        "Backlog",
        "No priority",
        labels,
        project,
      ]);
    }
  }
  return toCsv(LINEAR_COLUMNS, rows);
}

/** One GitHub issue of the bundle: `file` holds its body. */
export interface GithubIssue {
  title: string;
  body: string;
  file: string;
}

/** A phase's tracking issue: the step issues are listed under it, as a task list, once they exist. */
export interface GithubPhase extends GithubIssue {
  steps: GithubIssue[];
}

/** issues.json in the bundle, which the MCP server reads to create the issues. */
export interface GithubIssuePlan {
  project: string;
  sessionId: string;
  labels: string[];
  phases: GithubPhase[];
}

export function githubIssuePlan(session: Session): GithubIssuePlan {
  const plan = roadmapPlan(session);
  const footer = `---\n_${source(plan)}_`;
  return {
    project: plan.project,
    sessionId: plan.sessionId,
    labels: [TRACKER_LABEL],
    phases: plan.phases.map((phase) => ({
      title: phaseTitle(phase),
      file: `issues/phase-${phase.number}.md`,
      body: [
        `Phase ${phase.number} of ${plan.phases.length} of the roadmap of **${plan.project}**.`,
        phase.content,
        `## Exit criterion\n\n${phase.exitCriterion}`,
        footer,
      ].join("\n\n"),
      steps: phase.steps.map((step, index) => ({
        title: step.title,
        file: `issues/phase-${phase.number}-step-${index + 1}.md`,
        body: [step.text, `Part of **${phaseTitle(phase)}**.`, `## Phase exit criterion\n\n${phase.exitCriterion}`, footer].join("\n\n"),
      })),
    })),
  };
}

/** The task list that ends a tracking issue, with the step issues' links (or titles, before they exist). */
export function trackingSteps(items: string[]): string {
  return `\n\n## Steps\n\n${items.map((item) => `- [ ] ${item}`).join("\n")}`;
}

const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

/** A here-document delimiter that no line of the bodies matches. */
function delimiter(bodies: string[]): string {
  const lines = new Set(bodies.flatMap((body) => body.split("\n")));
  let name = "QUORUMIND_ISSUE_BODY";
  for (let n = 2; lines.has(name); n++) name = `QUORUMIND_ISSUE_BODY_${n}`;
  return name;
}

/**
 * A Bash script that creates the issues with the GitHub CLI, signed in as whoever runs it: Quorumind never sees a
 * GitHub credential. Steps first, then each phase's tracking issue listing them. Bodies go through quoted
 * here-documents and titles through single quotes, so nothing in them is expanded by the shell.
 */
export function githubIssueScript(plan: GithubIssuePlan): string {
  const end = delimiter(plan.phases.flatMap((phase) => [phase.body, ...phase.steps.map((step) => step.body)]));
  const labels = plan.labels.flatMap((label) => ["--label", shellQuote(label)]).join(" ");
  const create = (title: string) => `gh issue create \${repo[@]+"\${repo[@]}"} --title ${shellQuote(title)} ${labels} --body "$body"`;
  const lines = [
    "#!/usr/bin/env bash",
    `# Creates the roadmap of ${plan.project.replace(/\s+/g, " ")} as GitHub issues, with the GitHub CLI signed in as you.`,
    "# Usage: bash create-issues.sh [owner/repo]   (default: the repository of the current directory)",
    "set -euo pipefail",
    "repo=()",
    'if [ "$#" -gt 0 ]; then repo=(--repo "$1"); fi',
    ...plan.labels.map(
      (label) =>
        `gh label create ${shellQuote(label)} \${repo[@]+"\${repo[@]}"} --color 4b5bd6 --description 'Planned with Quorumind' --force >/dev/null`,
    ),
    "",
  ];
  const body = (text: string) => [`body=$(cat <<'${end}'`, text, end, ")"];
  plan.phases.forEach((phase, p) => {
    const names: string[] = [];
    phase.steps.forEach((step, s) => {
      const name = `step_${p + 1}_${s + 1}`;
      names.push(name);
      lines.push(...body(step.body), `${name}=$(${create(step.title)})`, `echo "$${name}"`, "");
    });
    const list = names.map((name) => `- [ ] $${name}`).join("\n");
    lines.push(
      ...body(phase.body),
      `body="$body\n\n## Steps\n\n${list}"`,
      `phase_${p + 1}=$(${create(phase.title)})`,
      `echo "$phase_${p + 1}"`,
      "",
    );
  });
  return `${lines.join("\n").trimEnd()}\n`;
}

/** The GitHub issues as a bundle: one Markdown body per issue, issues.json, the script and a README. */
export function renderGithubIssues(session: Session): { path: string; content: string }[] {
  const plan = githubIssuePlan(session);
  const index = plan.phases.flatMap((phase) => [
    `- **${phase.title}** (\`${phase.file}\`)`,
    ...phase.steps.map((step) => `  - ${step.title} (\`${step.file}\`)`),
  ]);
  const readme = [
    `# GitHub issues: ${plan.project}`,
    "",
    "The roadmap of the Quorumind decision as GitHub issues: one issue per step, and one tracking issue per phase",
    `that lists its steps as a task list. Every issue is labelled \`${TRACKER_LABEL}\`.`,
    "",
    "## Create them",
    "",
    "With the [GitHub CLI](https://cli.github.com), signed in (`gh auth login`), from a clone of the repository:",
    "",
    "```bash",
    "bash create-issues.sh            # the repository of the current directory",
    "bash create-issues.sh owner/repo # another repository",
    "```",
    "",
    "Or from a coding agent, with the `quorumind_issues` tool of the Quorumind MCP server. Either way, the issues are",
    "created with your own GitHub sign-in: Quorumind never sees a GitHub credential. To create them by hand, each",
    "file under `issues/` is the body of one issue; `issues.json` lists them with their titles.",
    "",
    "## Issues",
    "",
    ...index,
    "",
  ].join("\n");
  return [
    { path: "README.md", content: readme },
    { path: "create-issues.sh", content: githubIssueScript(plan) },
    { path: "issues.json", content: `${JSON.stringify(plan, null, 2)}\n` },
    ...plan.phases.flatMap((phase) => [
      { path: phase.file, content: `${phase.body}${trackingSteps(phase.steps.map((step) => step.title))}\n` },
      ...phase.steps.map((step) => ({ path: step.file, content: `${step.body}\n` })),
    ]),
  ];
}

/** File names of the tracker exports. */
export const trackerFileName = (session: Session, kind: "jira" | "linear" | "github") =>
  `${reportSlug(session)}-${kind === "github" ? "github-issues.zip" : `${kind}.csv`}`;
