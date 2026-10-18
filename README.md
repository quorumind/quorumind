# Quorumind

**Several AIs debate your project before you build it.**

[![CI](https://github.com/quorumind/quorumind/actions/workflows/ci.yml/badge.svg)](https://github.com/quorumind/quorumind/actions/workflows/ci.yml)
[![License: AGPL v3](https://img.shields.io/badge/license-AGPL%20v3-blue.svg)](LICENSE)

[Website](https://quorumind.com) · [MCP server](apps/mcp/README.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

Quorumind first interviews you to pin down what you actually need: goals, scope, budget,
existing infrastructure, team skills and hard constraints. Then several AI models (Claude,
OpenAI / Codex, Gemini, local models via Ollama) each propose a solution, criticise each
other's proposals and revise their own. An arbiter weighs every option against your
requirements and tells you what is feasible, what is not, and why.

You get a decision report: targeted goals, compared options with their verdict, recommended
infrastructure, risks and a roadmap.

> **Status:** pre-release. The full flow works end to end: interview, requirements sheet,
> blind proposals, critiques, revisions, verdict and report, with Claude, OpenAI, Gemini and
> Ollama, in ten languages. A recorded demo runs without any API key. Expect breaking changes
> until 1.0.

![The verdict of a debate: the recommended option and the decision matrix](docs/media/verdict.png)

| Interview | Requirements sheet | Debate |
| --- | --- | --- |
| ![The interview](docs/media/interview.png) | ![The requirements sheet, editable before the debate](docs/media/requirements.png) | ![The debate asks the user a question](docs/media/debate.png) |

## Quick start

Requirements: Node.js 22.18 or later.

```bash
npm install
cp .env.example .env     # add ANTHROPIC_API_KEY and/or OPENAI_API_KEY + OPENAI_MODEL
npm run build
npm start                # http://127.0.0.1:8787
```

Without any key, Quorumind starts in demo mode: click "Try the demo" to replay a recorded debate.

With Docker:

```bash
cp .env.example .env
docker compose up --build   # http://127.0.0.1:8787
```

The server has no user accounts yet: keep it on localhost or behind an authenticating
reverse proxy, never directly on the internet.

## Configuration

| Variable | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | Enables Claude. Every role defaults to `claude-opus-5-5` (`ANTHROPIC_MODEL` to change it, `ANTHROPIC_MODELS` for the models offered). |
| `OPENAI_API_KEY`, `OPENAI_MODEL` or `OPENAI_MODELS` | Enables OpenAI. With two vendors set, proposer B uses the second so two vendors debate. |
| `OPENAI_REASONING=1` | Sends the debate depth as `reasoning.effort`. Off by default: some models reject it. |
| `GEMINI_API_KEY`, `GEMINI_MODEL` or `GEMINI_MODELS` | Enables Google Gemini (`GEMINI_BASE_URL` to change the endpoint). |
| `OPENROUTER_API_KEY` | Enables OpenRouter: one key for the models of every maker (`OPENROUTER_BASE_URL` to change the endpoint). Names and prices come from OpenRouter's model list, and each call's exact cost from OpenRouter itself. Only endpoints that keep no data and follow the answer's JSON schema are used. |
| `OPENROUTER_MODELS` | The OpenRouter models offered, as comma-separated ids (`mistralai/mistral-large-4-0`). Defaults to the flagship and mid-tier models of Anthropic, OpenAI, Google and Mistral. |
| `OPENAI_PRICE_*`, `GEMINI_PRICE_*` (`_INPUT`, `_OUTPUT`) | USD per million tokens, applied to every listed model of that vendor, for cost tracking and the cost cap. |
| `OLLAMA_BASE_URL`, `OLLAMA_MODELS` | Enables local models through Ollama (free). Without `OLLAMA_MODELS`, the models Ollama has pulled are listed. |
| `QUORUMIND_LOCAL_ONLY=1` | 100 % local: only Ollama models are used, no data leaves the machine. |
| `QUORUMIND_EUROPEAN_ONLY` | `1` ticks "European models only" for new sessions, `required` imposes it: Mistral AI models on Mistral's EU endpoint, or local models. See [docs/compliance.md](docs/compliance.md). |
| `OPENROUTER_EU_BASE_URL` | Where European-only sessions reach OpenRouter, e.g. `https://eu.openrouter.ai/api/v1` (OpenRouter's EU region, Business plan). Without it, they use the usual address, whose servers may be outside the EU. |
| `QUORUMIND_INTERVIEWER`, `QUORUMIND_ARBITER`, `QUORUMIND_SEAT_A` to `QUORUMIND_SEAT_D`, `QUORUMIND_DEVIL` | Assign any model to any role, as `anthropic:<model>`, `openai:<model>`, `gemini:<model>`, `openrouter:<model>`, `ollama:<model>` or `mock`. Seats C, D and the devil's advocate are off unless set (`QUORUMIND_DEVIL=none`). |
| `PORT`, `HOST`, `QUORUMIND_DATA_DIR` | Server address and where sessions are stored (a SQLite file, created on first start). |
| `DATABASE_URL` or `DATABASE_URL_FILE` | Stores the sessions in PostgreSQL instead of SQLite, as `postgres://user:password@host:5432/database` (`DATABASE_URL_FILE`: the path of a file holding it, such as a Docker secret). The server waits for the database to answer at start-up and creates or updates its tables itself. Existing SQLite data is not copied over. |
| `QUORUMIND_SLACK_WEBHOOK_URL`, `QUORUMIND_TEAMS_WEBHOOK_URL` | Optional: a message in a Slack or Microsoft Teams channel, through an incoming webhook, when any session waits for answers, finishes or fails, with its title, its status and a link built from `QUORUMIND_PUBLIC_URL`. `_FILE` variants read the address from a file. See [docs/integrations.md](docs/integrations.md#chat-notifications). |
| `GITHUB_TOKEN` | Optional, for context import: raises the GitHub API limit and gives access to private repositories (read-only "Contents" and "Metadata" are enough). |
| `QUORUMIND_ALLOW_PRIVATE_URLS=1` | Lets context import fetch pages on private networks (intranet, localhost). Off by default: only public addresses are fetched. Set it only on an instance whose users you trust. |

### Context documents

A session can carry up to 5 documents of 100 000 characters each: a PDF or Word (.docx)
specification, a Markdown or text file, a web page, a GitHub repository (README, file tree,
manifests, architecture notes and ADRs) or pasted text. Files are read on the server (10 MB at
most; scanned PDFs need OCR first), web pages are fetched from public addresses only, through
at most 3 redirects. The interviewer and proposers read the documents, critics and the arbiter
an excerpt; they are always treated as data and masked like the rest when PII masking is on.
API request bodies are capped at 512 KB, except session creation (4 MB, to carry the
documents) and file uploads (10 MB).

### European models and compliance

A session can use European models only, and combine its project type with compliance templates (personal data, health
data, public sector, finance, consumer law) whose requirements the arbiter checks for each option; the report then has a
Compliance section. The proposers also get reference cloud prices of OVHcloud, Scaleway, AWS, Azure and Google Cloud in
Europe, dated in the report. What each one guarantees, and what it does not: [docs/compliance.md](docs/compliance.md).

### Integrations

A finished session exports its roadmap for issue trackers, from the export menu: a CSV file for
Jira (an epic per phase, a story per step), a CSV file for Linear, and a bundle of GitHub issues
with a script that creates them through the GitHub CLI. Sessions can also post to a Slack or
Microsoft Teams channel when they wait for answers, finish or fail. Column mappings, import
steps and the chat set-up: [docs/integrations.md](docs/integrations.md).

## From a coding agent (MCP)

Claude Code, Codex, Cursor and other MCP clients can run a debate before they code: the
`quorumind-mcp` server in [`apps/mcp`](apps/mcp/README.md) starts a session, relays the
interview to you, runs the debate on your Quorumind server and writes the verdict into the
project as `CLAUDE.md`, `AGENTS.md` and `PLAN.md`, and the decision as a numbered ADR in the
repository's ADR folder.

```bash
npm start   # the Quorumind server, keep it running
claude mcp add --transport stdio quorumind -- node /path/to/quorumind/apps/mcp/src/main.ts
```

Setup for Codex and Cursor, the tools and their options: [apps/mcp/README.md](apps/mcp/README.md).

## How it works

```mermaid
flowchart LR
    A[1. Scoping interview] --> B[2. Requirements sheet<br/>validated by the user]
    B --> C[3. Blind proposals]
    C --> D[4. Debate<br/>3 rounds]
    D -- missing information --> B
    D --> E[5. Verdict and report]
```

1. **Scoping interview.** One AI asks about goals, scope, users and load, budget, existing
   infrastructure, team skills, constraints (deadline, GDPR, imposed technologies) and
   priorities. Follow-up questions adapt to your answers.
2. **Requirements sheet.** A structured summary you correct and validate. It is the single
   source of truth for the rest of the session.
3. **Blind proposals.** Each proposer writes its solution without seeing the others, so
   nobody copies the first answer.
4. **Debate.** Cross-critiques (blocking, major, minor), a devil's advocate, then revisions.
   If a choice depends on information you did not give, the debate pauses and asks you.
5. **Verdict.** The arbiter marks each option feasible or not, scores it on your weighted
   priorities, and shows where the models still disagree.
6. **Revisions.** Send the open questions to your client as a questionnaire (a link that needs
   no account, or a Word file), then update the recommendation with the answers: only the
   arbiter rules again, and every report says which revision it shows and what changed.

## Roles

Roles are decoupled from models: any provider can play any role. Mixing models from different
vendors is the point, since they do not share the same blind spots.

| Role | Job |
| --- | --- |
| Interviewer | Runs the scoping interview, writes the requirements sheet |
| Proposers (2 to 4) | Each proposes a complete solution and defends it |
| Devil's advocate | Proposes nothing, attacks every option |
| Arbiter | Does not debate; checks each option against the requirements and rules |

## Architecture

```mermaid
flowchart TB
    subgraph Browser
        Q[Interview] ~~~ L[Live debate] ~~~ R[Report]
    end
    subgraph Server["Server (Node.js, TypeScript, Hono)"]
        O[Orchestrator<br/>state machine] ~~~ P[Roles and prompts] ~~~ V[Validation and cost tracking]
    end
    subgraph Providers["Providers (one common interface)"]
        C1[Claude] ~~~ C2[OpenAI / Codex] ~~~ C3[Gemini] ~~~ C4[Ollama]
    end
    Browser <-->|REST + SSE| Server
    Server --> Providers
    Server --> DB[(SQLite or PostgreSQL)]
```

- **Bring your own keys.** API keys stay server-side, in `.env`. A fully local debate with
  Ollama is possible: nothing leaves your machine.
- **Structured outputs.** Every role answers in a validated JSON schema; free text is for
  display, JSON drives the verdict and the report.
- **Cost cap.** Tokens and estimated cost are tracked per session and per model, with a
  configurable ceiling that stops the debate.

## Languages

The interface ships in ten languages from the start: English (source), French, Spanish,
Portuguese, Italian, German, Hindi, Japanese, Simplified Chinese and Arabic. The interview,
the debate and the report follow the user's language.

## Contributing

Issues and pull requests are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) explains how to set
up the project, the checks a change must pass and the conventions the codebase follows.

## Development

```bash
npm run dev         # server on :8787 with reload, interface on :5173
npm test            # unit and API tests
npm run typecheck
npm run lint
npm run bench       # quality bench on the recorded demo
npm run prices:check  # warns when the reference cloud prices are older than 90 days
QUORUMIND_BENCH=live npm run bench   # the same bench on real models (costs money)
npm run media       # screenshots and demo video in docs/media, filmed on the recorded demo (needs ffmpeg)
```

| Path | Content |
| --- | --- |
| `packages/core` | Debate engine, role prompts, schemas, provider adapters (Claude, OpenAI, Gemini, Ollama, demo), pricing, report and exports |
| `apps/server` | HTTP API, live event stream (SSE), SQLite or PostgreSQL storage, serves the interface |
| `apps/mcp` | MCP server for coding agents: runs a debate through the HTTP API and writes the hand-off files |
| `apps/web` | React interface, ten languages, light and dark themes |
| `bench` | Reference projects replayed end to end, with checks every verdict must pass |
| `media` | Films the recorded demo with Playwright for the README and the website |

Run the bench after any change to prompts, schemas or models: it is how we know whether a
change makes debates better or worse.

## Roadmap

Available today: the full debate with up to four proposers and a devil's advocate, any model
in any role (Claude, OpenAI, Gemini, Ollama), a cost cap, an interactive decision matrix, a
debate map, reports rewritten for a CTO, an executive or a client, exports (Markdown, PDF,
Word, ADR, coding-agent hand-off, Jira, Linear and GitHub issues), resumable and shareable sessions, context import (PDF or
Word specifications, web pages, GitHub repositories), client questionnaires, revisions of the
verdict, an editable client proposal (Word, PDF) and the MCP server.

Next:

1. **Fact reliability:** optional web search for prices and versions, with cited sources.
2. **Collaboration:** multi-user sessions and shared history.

## Hosted version

A hosted version (no API keys needed, pay as you go or team plans) is planned at
[quorumind.com](https://quorumind.com). This repository is and will stay the open source core.

## License

[GNU AGPL v3](LICENSE).
