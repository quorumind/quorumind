# Quorumind MCP server

Lets a coding agent (Claude Code, Codex, Cursor, or any MCP client) run a Quorumind debate
before it writes code, then read the verdict and write the plan into the project.

It is a small stdio [MCP](https://modelcontextprotocol.io) server that talks to a running
Quorumind server over HTTP. It never calls a model provider itself: API keys, models and
costs stay on the Quorumind server.

## Requirements

- Node.js 22.18 or later (it runs the TypeScript sources directly).
- A clone of this repository with `npm install` done.
- A running Quorumind server (`npm start` at the repository root, http://127.0.0.1:8787 by
  default), or the hosted version and a personal API token (see [The hosted version](#the-hosted-version)).

The examples below use `/path/to/quorumind`: replace it with the absolute path of your clone.

## Configuration

| Variable | Purpose |
| --- | --- |
| `QUORUMIND_URL` | Quorumind server, default `http://127.0.0.1:8787`. |
| `QUORUMIND_TOKEN` | A personal API token of the hosted version (`qmd_...`), sent as `Authorization: Bearer <token>`. |
| `QUORUMIND_MCP_WAIT_SECONDS` | Longest a single tool call waits for the models, default `600`. After that the tool answers "still running" and the agent calls `quorumind_status` with `wait: true`. |
| `QUORUMIND_MCP_DEMO=1` | Replays the recorded demo debate instead of calling models: no key, no cost. To try the tools. |

A debate takes several minutes. Make sure your client's tool timeout is longer than
`QUORUMIND_MCP_WAIT_SECONDS`, or lower that value.

## The hosted version

To run the debates on [app.quorumind.com](https://app.quorumind.com) instead of your own
server, create a personal API token: in the account page (Account, API tokens), give it a
name and, if you like, an expiry. It starts with `qmd_` and is shown once: copy it into your
client's configuration, never into a file you commit. Then set:

| Variable | Value |
| --- | --- |
| `QUORUMIND_URL` | `https://app.quorumind.com` |
| `QUORUMIND_TOKEN` | `qmd_...`, your token |

With Claude Code, for instance:

```bash
claude mcp add --env QUORUMIND_URL=https://app.quorumind.com --env QUORUMIND_TOKEN=qmd_... \
  --transport stdio quorumind -- node /path/to/quorumind/apps/mcp/src/main.ts
```

The token acts as you, in the workspace it was created for (or your first workspace): the
debates it starts are that workspace's, billed to it like the ones you start in the browser,
and `quorumind_sessions` lists the workspace's shared history with each session's author. It
reaches the debates only, never your account, members or billing. The hosted version sells
each debate at a fixed price: the tools show that price instead of a provider cost, and a
debate the workspace cannot pay for is refused with what to do about it. Revoke a token from
the same page as soon as you no longer need it; a revoked or expired token gets an error that
names `QUORUMIND_TOKEN`.

## Claude Code

```bash
claude mcp add --env QUORUMIND_URL=http://127.0.0.1:8787 --transport stdio quorumind \
  -- node /path/to/quorumind/apps/mcp/src/main.ts
```

Add `--scope project` to share it with the team through `.mcp.json`, or write the file yourself:

```json
{
  "mcpServers": {
    "quorumind": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/quorumind/apps/mcp/src/main.ts"],
      "env": { "QUORUMIND_URL": "http://127.0.0.1:8787" }
    }
  }
}
```

Claude Code's default tool timeout is far above ten minutes; `MCP_TOOL_TIMEOUT` (milliseconds)
changes it.

## Codex

In `~/.codex/config.toml`:

```toml
[mcp_servers.quorumind]
command = "node"
args = ["/path/to/quorumind/apps/mcp/src/main.ts"]
env = { QUORUMIND_URL = "http://127.0.0.1:8787" }
# Codex stops a tool call after 60 s by default: give the debate time to run.
tool_timeout_sec = 660
```

## Cursor

In `.cursor/mcp.json` at the project root (or `~/.cursor/mcp.json` for every project):

```json
{
  "mcpServers": {
    "quorumind": {
      "command": "node",
      "args": ["/path/to/quorumind/apps/mcp/src/main.ts"],
      "env": { "QUORUMIND_URL": "http://127.0.0.1:8787" }
    }
  }
}
```

## Tools

| Tool | What it does |
| --- | --- |
| `quorumind_start` | Starts a session from an idea (mode, template, language, depth, rounds, cost cap, the user's own solution, up to 5 local text files as context, 100 000 characters each) and returns the interviewer's first questions with why they matter and example answers. |
| `quorumind_answer` | Sends the user's answers, to the interview or to the questions the debate paused on, and waits for the next stopping point. |
| `quorumind_review` | Shows the requirements sheet the interview produced. |
| `quorumind_confirm` | Confirms the sheet, with optional edits, and runs the debate until it needs the user or reaches the verdict. |
| `quorumind_status` | Phase, whether a model is working, cost so far (the price of the debate on the hosted version) and what is expected next; `wait: true` waits for the next stopping point. |
| `quorumind_resume` | Retries the step a failed session stopped on, with a higher cost cap (`budget_usd`) when the cap was reached (self-hosted servers). |
| `quorumind_stop` | Stops a running session at once, without spending more; `quorumind_resume` continues it. |
| `quorumind_verdict` | The verdict as a short summary, the full Markdown report, or an ADR. |
| `quorumind_handoff` | Writes `CLAUDE.md`, `AGENTS.md` and `PLAN.md` into a directory; never replaces an existing file unless `overwrite` is true. |
| `quorumind_adr` | Records the decision as an ADR in the repository's ADR folder, numbered after the last record; never replaces a file. See [Decision records](#decision-records). |
| `quorumind_issues` | Turns the roadmap into GitHub issues: prints the `gh` commands, or runs them with the GitHub CLI. See [GitHub issues](#github-issues). |
| `quorumind_scenario` | Tries a what-if on a finished debate (team size, budgets, deadline, new constraints, or a question in plain words) and returns its comparison with the version it branched from. Priced like an update of the verdict. |
| `quorumind_scenarios` | Lists the scenarios of a session, with their changes, their recommendation and the one adopted. |
| `quorumind_compare` | Two revisions or scenarios side by side, in Markdown, the differences in bold. |
| `quorumind_decisions` | The decision register: each decision's recommendation, status, approver and review date. |
| `quorumind_approve` | Records the user's approval of the version a session shows, or asks for it (`request_only`). Only when the user says so. |
| `quorumind_sessions` | Recent sessions (on the hosted version, the workspace's, with their author). |

Every tool answers in short Markdown that ends on what to do next, plus the same facts as
structured content. Long waits follow the session's live event stream (and poll every two
seconds if the stream is unavailable), and send MCP progress notifications when the client
asks for them.

The report of a finished session is also a resource: `quorumind://sessions/{id}/report`.

## Decision records

`quorumind_adr` writes the verdict of a finished session as an Architecture Decision Record (the
MADR sections: context, considered options, decision outcome, consequences, links) into the
repository given as `repository` (default: the directory the MCP server runs in):

- the folder is the one named by adr-tools' `.adr-dir` file, else the first of `docs/adr`,
  `docs/decisions`, `adr` and `doc/adr` that exists (the one with the most records when several
  do), else `docs/adr`, created;
- the record takes the highest existing number plus one, with as many digits as the existing
  records (four for the first one), and the `NNNN-title.md` convention: `name: "authentication"`
  next to `0006-use-postgresql.md` gives `0007-authentication.md`, titled `# 7. <decision>`;
- it never replaces a file: if the name is taken in the meantime, nothing is written.

## GitHub issues

`quorumind_issues` turns the roadmap of a finished session into GitHub issues: one issue per
step and one tracking issue per phase, whose task list links its steps, all labelled
`quorumind`. With `action: "print"` (the default) it returns a Bash script of `gh label create`
and `gh issue create` commands to review or run; with `action: "create"` it runs them with the
[GitHub CLI](https://cli.github.com) installed and signed in on the machine of the MCP server,
in `repo` (`owner/name`) or the repository of the directory the server runs in. The issues are
created as whoever is signed in to `gh`: no GitHub token is ever given to the MCP server or to
Quorumind. If `gh` is missing or signed out, the tool says so and returns the script instead;
if GitHub refuses an issue halfway, it lists the issues already created so that they are not
created twice.

## A typical run

1. The agent calls `quorumind_start` with the idea and, say, `context_files: ["README.md", "docs/architecture.md"]`.
2. It asks the user the interview questions and calls `quorumind_answer` until the requirements sheet is ready.
3. It shows the sheet, calls `quorumind_confirm` with the user's corrections, and relays any
   question the debate pauses on with `quorumind_answer`.
4. It reads `quorumind_verdict`, writes the plan with `quorumind_handoff` and records the decision
   with `quorumind_adr`, then codes.

## Development

```bash
QUORUMIND_MCP_DEMO=1 node apps/mcp/src/main.ts   # stdio server on the recorded demo
npx vitest run apps/mcp                         # drives a whole demo debate through the tools
```

The tests run the real Quorumind server in-process on the recorded demo and connect an MCP
client through the SDK's in-memory transport.
