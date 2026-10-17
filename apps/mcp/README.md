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
  default), or the hosted version and its token.

The examples below use `/path/to/quorumind`: replace it with the absolute path of your clone.

## Configuration

| Variable | Purpose |
| --- | --- |
| `QUORUMIND_URL` | Quorumind server, default `http://127.0.0.1:8787`. |
| `QUORUMIND_TOKEN` | Sent as `Authorization: Bearer <token>`, for the hosted version. |
| `QUORUMIND_MCP_WAIT_SECONDS` | Longest a single tool call waits for the models, default `600`. After that the tool answers "still running" and the agent calls `quorumind_status` with `wait: true`. |
| `QUORUMIND_MCP_DEMO=1` | Replays the recorded demo debate instead of calling models: no key, no cost. To try the tools. |

A debate takes several minutes. Make sure your client's tool timeout is longer than
`QUORUMIND_MCP_WAIT_SECONDS`, or lower that value.

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
| `quorumind_start` | Starts a session from an idea (mode, template, language, depth, rounds, cost cap, the user's own solution, local text files as context) and returns the interviewer's first questions with why they matter and example answers. |
| `quorumind_answer` | Sends the user's answers, to the interview or to the questions the debate paused on, and waits for the next stopping point. |
| `quorumind_review` | Shows the requirements sheet the interview produced. |
| `quorumind_confirm` | Confirms the sheet, with optional edits, and runs the debate until it needs the user or reaches the verdict. |
| `quorumind_status` | Phase, whether a model is working, cost so far and what is expected next; `wait: true` waits for the next stopping point. |
| `quorumind_resume` | Retries the step a failed session stopped on. |
| `quorumind_verdict` | The verdict as a short summary, the full Markdown report, or an ADR. |
| `quorumind_handoff` | Writes `CLAUDE.md`, `AGENTS.md` and `PLAN.md` into a directory; never replaces an existing file unless `overwrite` is true. |
| `quorumind_sessions` | Recent sessions. |

Every tool answers in short Markdown that ends on what to do next, plus the same facts as
structured content. Long waits follow the session's live event stream (and poll every two
seconds if the stream is unavailable), and send MCP progress notifications when the client
asks for them.

The report of a finished session is also a resource: `quorumind://sessions/{id}/report`.

## A typical run

1. The agent calls `quorumind_start` with the idea and, say, `context_files: ["README.md", "docs/architecture.md"]`.
2. It asks the user the interview questions and calls `quorumind_answer` until the requirements sheet is ready.
3. It shows the sheet, calls `quorumind_confirm` with the user's corrections, and relays any
   question the debate pauses on with `quorumind_answer`.
4. It reads `quorumind_verdict` and writes the plan with `quorumind_handoff`, then codes.

## Development

```bash
QUORUMIND_MCP_DEMO=1 node apps/mcp/src/main.ts   # stdio server on the recorded demo
npx vitest run apps/mcp                         # drives a whole demo debate through the tools
```

The tests run the real Quorumind server in-process on the recorded demo and connect an MCP
client through the SDK's in-memory transport.
