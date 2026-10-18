# Integrations

What a finished decision can feed outside Quorumind: issue trackers, the repository's decision
records and team chat. Every integration is optional and off until used or configured.

## Issue trackers

The export menu of a finished session (and the API routes below) turns the verdict's roadmap
into work items. Each phase of the roadmap becomes an epic or a tracking issue, and each step of
a phase a story or an issue under it. Steps are read from the phase's content: one per line or
list item, else one per semicolon, else one per item of a short enumeration such as
"Schedules, booking, passes, reminders"; any other content is a single step. Every item is
labelled `quorumind`. The scaffolding (phase numbers, "Exit criterion", the source line) is in
English, like the coding-agent hand-off; the phases and steps stay in the session's language.

| Route | File |
| --- | --- |
| `GET /api/sessions/:id/jira.csv` | `<project>-jira.csv`, for Jira's CSV import |
| `GET /api/sessions/:id/linear.csv` | `<project>-linear.csv`, for Linear's CSV import |
| `GET /api/sessions/:id/github-issues.zip` | `<project>-github-issues.zip`, the GitHub issues bundle |

They answer 409 until the arbiter has ruled. The CSV files follow RFC 4180: every field is
quoted, quotes are doubled and line breaks stay inside their field. A field that starts with
`=`, `+`, `-`, `@`, a tab or a carriage return gets a leading apostrophe, so that a spreadsheet
opening the file never evaluates it as a formula (CSV injection).

### Jira

In Jira, System, External system import, CSV (or the project's import from CSV), choose the file,
then map the columns:

| CSV column | Jira field | Content |
| --- | --- | --- |
| `Issue ID` | Issue ID (Work item ID) | A number unique within the file, so that stories can name their epic. Jira gives its own keys. |
| `Parent` | Parent | Empty for an epic; the `Issue ID` of its epic for a story. |
| `Issue Type` | Issue Type | `Epic` for a phase, `Story` for a step. Epics come first, as Jira requires. |
| `Summary` | Summary | `Phase N: <phase>` for an epic; the step, cut to 120 characters at a word boundary, for a story. |
| `Description` | Description | The phase's content or the step in full, the phase's exit criterion and the decision session it comes from. |
| `Acceptance Criteria` | The project's acceptance criteria field, if it has one | The exit criterion of the phase. Leave it unmapped otherwise: the description already holds it. |
| `Epic Name` | Epic Name, on Jira versions that still have it | The epic's summary; empty for stories. Jira Cloud no longer needs it. |
| `Labels` | Labels | `quorumind`. |

Parent links need a company-managed project, or a team-managed one whose import supports the
Parent field.

### Linear

Linear imports CSV through its CLI importer (Settings, Administration, Import/Export, CLI import,
the "Linear" CSV option). The file uses the columns of Linear's own CSV format:

| CSV column | Content |
| --- | --- |
| `Title` | `Phase N: <phase>` for a phase's issue, the step for the issues that follow it. |
| `Description` | Markdown: the phase's content with its exit criterion and its steps as a checklist, or the step with the exit criterion of its phase. |
| `Status` | `Backlog`. |
| `Priority` | `No priority`. |
| `Labels` | `quorumind, Phase N`. |
| `Project` | `<project>: Phase N: <phase>`. |

Linear's CSV importer does not create projects. Each phase is therefore an issue of its own,
followed by its steps, all labelled `Phase N`: filter by that label and move the issues into a
project (or a project milestone) in one go.

### GitHub issues

The bundle holds one Markdown file per issue under `issues/` (a tracking issue per phase and an
issue per step), `issues.json` with their titles and labels, a `README.md`, and
`create-issues.sh`, which creates them with the [GitHub CLI](https://cli.github.com):

```bash
gh auth login                     # once, if the CLI is not signed in yet
bash create-issues.sh owner/repo  # or without an argument, from a clone of the repository
```

The script creates the `quorumind` label if it is missing, then each phase's steps, then the
phase's tracking issue, whose task list links them. The issues are created with the GitHub CLI's
own sign-in: Quorumind never asks for, sees or stores a GitHub credential.

## Decision records in the repository

`GET /api/sessions/:id/adr.md` returns the decision as an Architecture Decision Record (the
MADR sections: context, considered options, decision outcome, consequences, links), named
`0001-<project>.md`. With `?number=7`, the title is numbered the way ADR tools number theirs
(`# 7. <decision>`) and the file is named `0007-<project>.md`.
