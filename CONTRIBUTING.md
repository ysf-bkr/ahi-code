# Contributing to AhiCode

> [!NOTE]
> This is the English canonical document. Turkish version:
> [CONTRIBUTING.tr.md](./CONTRIBUTING.tr.md).

Thanks for your interest in improving AhiCode. This project is a VS Code
extension with a React webview and a headless CLI.

## Prerequisites

- Node.js 22+
- npm 10+
- VS Code 1.106+

## Setup

```bash
npm ci
npm --prefix webview-ui ci
```

## Before opening a pull request

Run the full verification pipeline:

```bash
npm run build
npm test
```

`npm run build` runs version consistency checks, both TypeScript type checks,
ESLint, the webview build, the extension bundle, and the CLI bundle. Do not open
a PR if any step fails.

Useful individual commands:

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | Extension type check |
| `npm run typecheck:test` | Test type check |
| `npm run lint` | ESLint |
| `npm test` | Core + webview tests |
| `npm run dev` | Launch an Extension Development Host |
| `npm run cli -- --prompt "..."` | Run the headless CLI |

## Code guidelines

- Keep code modular and readable; TypeScript type safety is a priority.
- Do not add external dependencies unless strictly necessary.
- All tool calls must validate arguments and honour the workspace path jail.
- Never weaken the permission/approval flow. New tools need an explicit
  `requiresApproval` decision and a deny-rule check.
- Do not log secrets. Audit log arguments are redacted by key name; keep it that way.
- Add or update tests for behaviour changes. Security-sensitive changes require a
  regression test.

## Language policy

- Agent-facing instructions stay in English: `AGENTS.md` and every `.md`
  file under `.agents/**`.
- `README.md`, `CHANGELOG.md`, files under `docs/**`, code comments, and
  user-facing application UI (including VS Code setting descriptions) are in Turkish.
- Code identifiers, tests, logs, and filenames stay in English so tooling,
  automation, and security channels remain consistent.
- Root community documents are bilingual: the English canonical files keep their
  standard names (`SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`) so
  GitHub auto-detects them, and Turkish counterparts live next to them
  (`SECURITY.tr.md`, `CONTRIBUTING.tr.md`, `CODE_OF_CONDUCT.tr.md`).

## Commit messages

Use conventional prefixes such as `feat:`, `fix:`, `docs:`, `test:`, `chore:`,
and `refactor:`. Keep the subject under ~72 characters and explain the *why* in
the body when the change is not obvious.

## Reporting security issues

Do not open a public issue. See [SECURITY.md](./SECURITY.md).
