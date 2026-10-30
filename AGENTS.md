# AhiCode Project Guidelines (AGENTS.md)

This file defines the core principles that the AhiCode agent must follow when writing code and running tests in this project.

## 1. Architectural Principles
- Code should be modular and readable.
- Type safety (TypeScript) is a priority.
- Avoid adding unnecessary external libraries.

## 2. Testing Standards
- Run and verify tests after every change.
- Code must pass `npm run lint` (ESLint) and `npm run typecheck`.

## 3. Language Policy
- Agent-facing instructions stay in English: `AGENTS.md` and every `.md`
  file under `.agents/**`. These files are read by the agent itself, so an
  English-only rule keeps them unambiguous.
- User-facing project documentation is bilingual. English canonical files
  keep their standard names (`README.md`, `docs/*.md`, `SECURITY.md`,
  `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`) so GitHub and the Marketplace
  auto-detect them; Turkish counterparts live next to them (`*.tr.md`) and
  must stay in sync with the English source.
- Turkish is also the language of code comments, `CHANGELOG.md`, release
  notes and policy documents written for the user. When an English and a
  Turkish document disagree, the English canonical file is the source of
  truth, so update both in the same change.
- User-facing application UI, including VS Code setting descriptions, is
  Turkish.
- Keep code comments short and explanatory: one or two lines that explain
  *why*, not a restatement of the code.
- Filenames, identifiers and log messages stay English so tooling and logs
  remain consistent.

## 4. Workspace Hygiene and Cleanup
- Keep every artifact inside the project directory. Do not create files,
  logs, scratch scripts or reports outside the repository (no `~/`, `/tmp`,
  `Desktop` or `$TMPDIR` leftovers), except for throwaway data that an
  external tool forces on us.
- Audit, review, investigation and profiling work is temporary by definition.
  When the task ends, delete the scratch material it produced: probe scripts,
  evidence JSON files, captured logs, generated patches and the report folder
  that only served the investigation.
- If a durable finding must survive the cleanup, move the distilled result
  into an existing project document (`docs/**`, `CHANGELOG.md`, code comment or
  test) instead of leaving a standalone audit folder behind. A regression test
  is the preferred home for a fixed finding.
- Before finishing a task, check `git status` for new untracked files and
  remove everything the task does not need. Never leave build logs, coverage
  dumps or temporary worktrees in the tree.
- Deleting is irreversible for untracked files, so confirm with the user before
  removing something that is not obviously scratch material.
