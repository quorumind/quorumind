import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEMO_LINEUP } from "../config.ts";
import { DEMO_SCRIPT, DEMO_SHEET } from "../demo.ts";
import { renderAdr } from "../report.ts";
import { createSession, type Session } from "../session.ts";
import { csvField, toCsv } from "./csv.ts";
import {
  githubIssuePlan,
  githubIssueScript,
  JIRA_COLUMNS,
  LINEAR_COLUMNS,
  renderGithubIssues,
  renderJiraCsv,
  renderLinearCsv,
  roadmapPlan,
  roadmapSteps,
  shortTitle,
} from "./trackers.ts";

/** A finished session whose roadmap is the given phases. */
function finished(roadmap = DEMO_SCRIPT.verdict.roadmap): Session {
  const session = createSession({ locale: "en", idea: "A booking app", demo: true, ...DEMO_LINEUP });
  session.sheet = DEMO_SHEET;
  session.debate.push({ kind: "proposal", round: 0, seat: "A", data: DEMO_SCRIPT.proposals.A! });
  session.verdict = { ...DEMO_SCRIPT.verdict, roadmap };
  session.phase = "complete";
  return session;
}

/** A small RFC 4180 reader, to check what an importer would read back. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\r" && text[i + 1] === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
    } else field += char;
  }
  return rows;
}

const TRICKY = [
  { phase: "Launch", content: 'Say "hello", then\nwire payments', exitCriterion: '=HYPERLINK("http://evil")' },
  { phase: "+Grow", content: "-1 bugs; @team review; plain step", exitCriterion: "Revenue, at last" },
];

describe("roadmap steps", () => {
  it("splits lists, lines, semicolons and short enumerations, and keeps sentences whole", () => {
    expect(roadmapSteps("Schedules, booking, passes, reminders")).toEqual(["Schedules", "booking", "passes", "reminders"]);
    expect(roadmapSteps("- Set up CI\n- Deploy the API\n\n1. Load test")).toEqual(["Set up CI", "Deploy the API", "Load test"]);
    expect(roadmapSteps("Auth; billing; admin")).toEqual(["Auth", "billing", "admin"]);
    expect(roadmapSteps("CI, the database, and auth")).toEqual(["CI", "the database", "auth"]);
    expect(roadmapSteps("予約、決済、通知")).toEqual(["予約", "決済", "通知"]);
    expect(roadmapSteps("Build the API, including auth and billing")).toEqual(["Build the API, including auth and billing"]);
    expect(roadmapSteps("  ")).toEqual([]);
  });

  it("cuts long titles at a word boundary", () => {
    const long = `ship ${"the booking flow ".repeat(20)}`;
    const title = shortTitle(long, 50);
    expect(title.length).toBeLessThanOrEqual(50);
    expect(title).toMatch(/^Ship the booking flow .*…$/);
    expect(shortTitle("short")).toBe("Short");
  });

  it("numbers the phases and names the decision", () => {
    const plan = roadmapPlan(finished());
    expect(plan.project).toBe(DEMO_SHEET.projectName);
    expect(plan.decision).toBe(DEMO_SCRIPT.proposals.A?.title);
    expect(plan.phases.map((phase) => phase.number)).toEqual([1, 2]);
    expect(plan.phases[0]?.steps.map((step) => step.title)).toEqual(["Schedules", "Booking", "Passes", "Reminders"]);
  });
});

describe("CSV", () => {
  it("quotes every field, doubles quotes and neutralises formulas", () => {
    expect(csvField("plain")).toBe('"plain"');
    expect(csvField('a "b"')).toBe('"a ""b"""');
    for (const start of ["=", "+", "-", "@", "\t", "\r"]) expect(csvField(`${start}1+1`)).toBe(`"'${start}1+1"`);
    expect(csvField("x=1")).toBe('"x=1"');
    expect(toCsv(["A", "B"], [["1", "two\nlines"]])).toBe('"A","B"\r\n"1","two\nlines"\r\n');
  });
});

describe("Jira CSV", () => {
  it("imports epics first, then stories linked to them, labelled quorumind", () => {
    const rows = parseCsv(renderJiraCsv(finished()));
    expect(rows[0]).toEqual(JIRA_COLUMNS);
    const records = rows.slice(1).map((row) => Object.fromEntries(JIRA_COLUMNS.map((column, i) => [column, row[i] ?? ""])));
    const epics = records.filter((record) => record["Issue Type"] === "Epic");
    const stories = records.filter((record) => record["Issue Type"] === "Story");
    expect(records.slice(0, epics.length).every((record) => record["Issue Type"] === "Epic")).toBe(true);
    expect(epics.map((epic) => epic.Summary)).toEqual(["Phase 1: First release", "Phase 2: After launch"]);
    expect(epics[0]?.["Epic Name"]).toBe("Phase 1: First release");
    expect(epics[0]?.["Acceptance Criteria"]).toBe("All 12 studios take bookings online");
    expect(stories).toHaveLength(4 + 1);
    expect(stories[0]).toMatchObject({
      Summary: "Schedules",
      Parent: epics[0]?.["Issue ID"],
      "Acceptance Criteria": "All 12 studios take bookings online",
    });
    expect(stories.at(-1)?.Parent).toBe(epics[1]?.["Issue ID"]);
    expect(records.every((record) => record.Labels === "quorumind")).toBe(true);
    expect(new Set(records.map((record) => record["Issue ID"])).size).toBe(records.length);
  });

  it("survives quotes, line breaks and formulas", () => {
    const csv = renderJiraCsv(finished(TRICKY));
    const rows = parseCsv(csv);
    expect(rows.every((row) => row.length === JIRA_COLUMNS.length)).toBe(true);
    const cells = rows.flat();
    expect(cells.some((cell) => /^[=+\-@]/.test(cell))).toBe(false);
    expect(cells).toContain(`'=HYPERLINK("http://evil")`);
    expect(cells).toContain("Phase 2: +Grow");
    expect(cells).toContain("'-1 bugs");
    expect(cells).toContain("'@team review");
    expect(cells).toContain('Say "hello", then');
  });
});

describe("Linear CSV", () => {
  it("lists each phase then its steps, with the phase as a label", () => {
    const rows = parseCsv(renderLinearCsv(finished()));
    expect(rows[0]).toEqual(LINEAR_COLUMNS);
    const records = rows.slice(1).map((row) => Object.fromEntries(LINEAR_COLUMNS.map((column, i) => [column, row[i] ?? ""])));
    expect(records.map((record) => record.Title)).toEqual([
      "Phase 1: First release",
      "Schedules",
      "Booking",
      "Passes",
      "Reminders",
      "Phase 2: After launch",
      "Waiting lists and teacher substitution",
    ]);
    expect(records[0]?.Description).toContain("**Exit criterion:** All 12 studios take bookings online");
    expect(records[0]?.Description).toContain("- [ ] Schedules");
    expect(records.every((record) => record.Status === "Backlog" && record.Priority === "No priority")).toBe(true);
    expect(records[1]?.Labels).toBe("quorumind, Phase 1");
    expect(records.at(-1)?.Labels).toBe("quorumind, Phase 2");
    expect(records[0]?.Project).toBe(`${DEMO_SHEET.projectName}: Phase 1: First release`);
  });

  it("neutralises formulas in titles", () => {
    const rows = parseCsv(renderLinearCsv(finished(TRICKY)));
    expect(rows.flat().some((cell) => /^[=+\-@]/.test(cell))).toBe(false);
  });
});

const bash = spawnSync("bash", ["--version"]).status === 0;

describe("GitHub issues", () => {
  it("bundles one body per issue, the plan and a script", () => {
    const files = renderGithubIssues(finished());
    const paths = files.map((file) => file.path);
    expect(paths.slice(0, 3)).toEqual(["README.md", "create-issues.sh", "issues.json"]);
    expect(paths).toContain("issues/phase-1.md");
    expect(paths).toContain("issues/phase-1-step-4.md");
    const tracking = files.find((file) => file.path === "issues/phase-1.md")?.content ?? "";
    expect(tracking).toContain("## Exit criterion\n\nAll 12 studios take bookings online");
    expect(tracking).toContain("## Steps\n\n- [ ] Schedules\n- [ ] Booking");
    const plan = JSON.parse(files.find((file) => file.path === "issues.json")?.content ?? "{}");
    expect(plan).toMatchObject({
      labels: ["quorumind"],
      phases: [{ title: "Phase 1: First release" }, { title: "Phase 2: After launch" }],
    });
  });

  // Runs the script with a real bash, one process per issue: slow on a loaded machine, hence its own timeout.
  it.skipIf(!bash)(
    "creates steps, then tracking issues that list them, without expanding anything",
    () => {
      const session = finished([
        ...TRICKY,
        { phase: "It's $(touch pwned) time", content: "Run `rm -rf /`\nQUORUMIND_ISSUE_BODY\n$HOME", exitCriterion: "Done" },
      ]);
      const dir = mkdtempSync(join(tmpdir(), "quorumind-gh-"));
      try {
        // A fake gh that records each call and answers with an issue URL.
        const log = join(dir, "calls.log");
        writeFileSync(
          join(dir, "gh"),
          [
            "#!/usr/bin/env bash",
            `printf '%s\\n' "$*" >> '${log.replaceAll("\\", "/")}'`,
            'if [ "$1" = issue ]; then echo x >> "$0.count"; n=$(( $(wc -l < "$0.count") )); echo "https://github.com/o/r/issues/$n"; fi',
          ].join("\n"),
        );
        chmodSync(join(dir, "gh"), 0o755);
        const script = join(dir, "create-issues.sh");
        writeFileSync(script, githubIssueScript(githubIssuePlan(session)));
        const out = execFileSync("bash", [script, "o/r"], {
          cwd: dir,
          encoding: "utf8",
          env: { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH}` },
        });
        const urls = out.trim().split("\n");
        // Each phase: its steps, then its tracking issue.
        expect(urls).toHaveLength(2 + 1 + (3 + 1) + (3 + 1));
        const calls = readFileSync(log, "utf8");
        expect(calls).toMatch(/^label create quorumind --repo o\/r/);
        expect(calls).toContain("--title Phase 3: It's $(touch pwned) time");
        expect(calls).toContain("QUORUMIND_ISSUE_BODY\n$HOME");
        expect(calls).toContain("Run `rm -rf /`");
        expect(calls).toContain("- [ ] https://github.com/o/r/issues/1\n- [ ] https://github.com/o/r/issues/2");
        expect(existsSync(join(dir, "pwned"))).toBe(false);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    30_000,
  );
});

describe("numbered ADR", () => {
  it("titles the record with its number, and keeps the unnumbered title otherwise", () => {
    const session = finished();
    expect(renderAdr(session, { number: 7 })).toMatch(/^# 7\. Custom React app with managed EU hosting\n/);
    expect(renderAdr(session)).toMatch(/^# Architecture decision record: Custom React app with managed EU hosting\n/);
  });
});
