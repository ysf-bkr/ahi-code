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
- Everything else is Turkish: code comments, `README.md`, `docs/**`, release
  and policy documents.
- User-facing application UI, including VS Code setting descriptions, is
  Turkish.
- Keep code comments short and explanatory: one or two lines that explain
  *why*, not a restatement of the code.
- Filenames, identifiers and log messages stay English so tooling and logs
  remain consistent.
