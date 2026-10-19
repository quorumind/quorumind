# Contributing to Quorumind

Thank you for taking the time to contribute. This guide covers how to set up the project, what
a change must pass, and the conventions the codebase follows.

## Before you start

- For a bug, open an issue with the steps to reproduce it, what you expected and what happened.
  The recorded demo (no API key needed) is the easiest way to show it.
- For a new feature or a change of behaviour, open an issue first so we can agree on the
  approach before you spend time on code.
- Security issues are never reported in public issues: see [SECURITY.md](SECURITY.md).

## Setup

Requirements: Node.js 22.18 or later, git. ffmpeg is only needed to film the demo media.

```bash
git clone https://github.com/quorumind/quorumind.git
cd quorumind
npm install
cp .env.example .env    # optional: add at least one provider key, or use Ollama
npm run dev             # server on :8787 with reload, interface on :5173
```

Without any key, the interface offers the recorded demo, which exercises the whole flow.

## Checks

Every pull request must pass the same checks as CI:

```bash
npm run lint && npm run typecheck && npm test && npm run bench && npm run build
```

The interface's component tests (`apps/web/src/*.test.tsx`, on happy-dom with Testing Library) run with the
rest in `npm test`. Its browser tests run apart, as they build the interface and start servers:

```bash
npm run test:e2e
```

They live in `apps/web/e2e` and play the recorded demo on two servers started for them: a self-hosted one,
and a hosted workspace whose members are named by an `x-user` header (`apps/web/e2e/hosted-server.ts`). Locally
they use the installed Microsoft Edge; set `QUORUMIND_E2E_CHANNEL=chromium` to use Playwright's Chromium
instead (`npx playwright install chromium` once), as CI does. Ports 8811 and 8812 must be free.

`npm run format` fixes formatting. Run the bench after any change to prompts, schemas or the
debate engine: it replays reference projects end to end and checks what every verdict must
contain. `QUORUMIND_BENCH=live npm run bench` runs it on real models and costs money.

## Conventions

- **English everywhere** in the repository: code, comments, commit messages, issues and
  documentation.
- **No user-facing string in the code.** Interface text lives in `apps/web/src/locales/`, one
  file per language. A new key goes into all ten files; `apps/web/src/locales.test.ts` fails
  otherwise. If you cannot translate a string, copy the English text and say so in the pull
  request.
- **Right to left.** The interface supports Arabic: use logical CSS properties
  (`margin-inline-start`, `inset-inline-end`) rather than left and right.
- **Accessibility.** Interactive elements work with the keyboard, have a visible focus and an
  accessible name; animations stop when the user asks for reduced motion.
- **Dependencies** are pinned to exact versions. Add one only when it clearly pays for itself.
- **Commits** have a short imperative subject (`Add the Gemini provider`) and, when useful, a
  body that explains why.

## Pull requests

Keep a pull request focused on one change. Describe what it does and why, how you tested it,
and include a screenshot for any visible change. A maintainer reviews every pull request
before it is merged.

By contributing, you agree that your contribution is licensed under the
[GNU AGPL v3](LICENSE), the license of the project.
