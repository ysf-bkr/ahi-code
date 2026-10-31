# AhiCode Architecture and Developer Guide

**English** · [Türkçe](ARCHITECTURE.tr.md)

This document details the internal architecture, directory structure, data flow, developer toolchain, and testing strategy of the AhiCode extension.

---

## 1. Directory Structure

```text
ahi-code/                                 npm workspaces monorepo
├── src/                                  VS Code host layer (every vscode-API touch lives here)
│   ├── extension.ts                      Activation, command registry, view container setup
│   ├── shared/diffContentProvider.ts     Diff content provider (vscode Uri/EventEmitter)
│   ├── webview/                          Webview management
│   │   ├── SidebarProvider.ts            Webview lifecycle & message routing
│   │   ├── settingsStore.ts              Settings persistence & OS SecretStorage
│   │   ├── modelCatalog.ts               Provider model cataloging
│   │   ├── gitChanges.ts                 Git queries for the Changes view
│   │   ├── apiKeys.ts                    Key masking
│   │   └── webviewHtml.ts                CSP-secured HTML generation
│   └── core/                             vscode-bound runtime pieces of the agent
│       ├── agent/                        AgentCore, agentLoop, agentHost, toolPipeline
│       │                                 controller, session/workflow/verification
│       │                                 controllers, terminalExecution, SessionRegistry
│       ├── lsp/LspClient.ts              Real language-server client; structurally
│       │                                 satisfies @ahicode/core's LspClientPort
│       ├── mcp/McpHub.ts                 MCP hub wiring webview messaging to clients
│       ├── memory/HistoryManager.ts      Workspace persistence (vscode Memento)
│       └── workspace/workspaceRoot.ts    Active editor / workspace folder lookup
├── packages/
│   ├── core/                             @ahicode/core — the vscode-free engine
│   │   └── src/
│   │       ├── index.ts                  Barrel entry
│   │       ├── shared/                   Contracts (types, constants, version), command
│   │       │                             policy, redaction, text utils, agent registry
│   │       ├── providers/                LLM adapters (Ollama, EVREN, OpenRouter, OpenAI)
│   │       ├── tools/                    Tool implementations (SSRF guard, path jail,
│   │       │                             parsers, shell, git, knowledge, web)
│   │       ├── feedback/                 Opt-in GitHub error reporter
│   │       └── core/                     Engine services: toolRunner, prompts, permission,
│   │                                     context, knowledge, memory, callgraph, multiagent,
│   │                                     plan, verification, routing, audit, snapshot,
│   │                                     checkpoint, worktree, rules, skills, workflow,
│   │                                     hooks, git, spec, mcp client
│   │       └── core/lsp/port.ts          LspClientPort: the engine never sees vscode
│   └── cli/                              @ahicode/cli — terminal agent (`ahi`)
│       └── src/index.ts                  ReAct loop on @ahicode/core + readline UI
├── webview-ui/                           React 18 + Tailwind CSS + Lucide webview
│   ├── src/
│   │   ├── App.tsx                       Main view routing and message dispatcher
│   │   ├── index.css                     Design system: tokens, components, layout
│   │   ├── components/                   Screens, cards, composer, headers
│   │   ├── components/ui/                Button, IconButton, fields, Card, Toggle
│   │   ├── components/Markdown.tsx       Safe markdown renderer
│   │   └── utils/                        vscode postMessage bridge, plan progress
│   └── test/                             React component tests (JSDOM)
├── test/
│   ├── unit/                             Core unit tests
│   ├── support/                          VS Code API stubs and test runner hooks
│   └── e2e/                              Real VS Code integration tests
├── resources/                            Brand assets (logo, icon, favicon variants)
└── scripts/                              Lifecycle, verification, packaging scripts
```

---

## 2. ReAct Loop and Data Flow

AhiCode starts a supervised ReAct (Reasoning + Acting) loop as soon as it
receives a user request. The loop is tightly wrapped by approval gates and a
hash-chained audit log:

```text
Webview UI (React)
   │  postMessage (SEND_MESSAGE / APPROVE_TOOL / CANCEL / ...)
   ▼
SidebarProvider (VS Code WebviewView)
   ▼
AgentCore
   │
   ├── ModelProvider (Ollama / EVREN / OpenRouter / OpenAI-compatible)
   │     └── Streaming SSE + Tool Calls
   │
   ├── ToolPipelineController (tool gate chain)
   │     ├── PermissionManager (allow / deny / approval)
   │     ├── CommandPolicy (safe / risky / blocked)
   │     └── SnapshotManager (automatic backup before writes)
   │
   ├── VerificationController (automatic repair & verification)
   │     ├── Quick verification (type check / lint)
   │     └── End-of-task verification (test suite run)
   │
   ├── AuditLog (SHA-256 hash chain)
   │     └── immutable records in .ahi/audit.log
   │
   └── TaskState updates → Webview UI
```

---

## 3. Sessions and Background Work

A chat is not a view state: it is a live `AgentCore` instance.

- `SessionRegistry` keeps one core per chat. Switching chats (or opening a new
  one) only changes which core is **active**; the previous core keeps running
  its turn and its subagents in the background.
- Heavy, single-instance services are shared through `SharedServices`
  (`McpHub`, `LspClient`, `CallGraphManager`, `KnowledgeStore`, spec store,
  worktree and git managers), so a second chat does not spawn another MCP
  stack or rebuild the index.
- Per-session state stays inside the core: plan, module map, snapshots,
  checkpoints, verification baseline and abort controller.
- State updates are tagged with a `sessionKey`; the webview renders only the
  active session and shows other running chats in a strip above the chat area.
- Background chats only surface warnings and errors, so subagent progress does
  not spam the active conversation.
- Deleting a chat first closes its core, so a deleted session cannot keep
  writing its own record back to history.

---

## 4. Reliability and Security Contracts

| Topic                        | Design choice and behavior                                                                                                               |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Cancellation and timeout** | A streaming response can be canceled immediately; the connection times out after two minutes without data.                               |
| **Token counter**            | Streaming requests use the `include_usage` flag to obtain exact token counts from the provider.                                          |
| **Audit log**                | Sensitive key patterns such as `Bearer`, `sk-` and `api_key=` are redacted before commands are recorded.                                 |
| **Docker sandbox**           | When sandbox mode is selected, the agent never silently falls back to the host; it raises an error instead.                              |
| **Editor context**           | Only the active file and selections **inside** the workspace are added to the prompt context.                                            |
| **Tool lock**                | Plan mode removes write/command tools from the schema and rejects the call if the model still invokes them.                              |
| **Session isolation**        | Starting a new session resets snapshot/checkpoint directories so sessions never mix.                                                     |
| **Plan progress**            | A started step is marked `in_progress` and completes at the end of a turn that produced file changes, tool activity, or task completion. |

---

## 5. Developer Scripts and Toolchain

| Command                        | Description                                                                                  |
| ------------------------------ | -------------------------------------------------------------------------------------------- |
| `npm run dev`                  | Builds the extension and opens a new Extension Development Host window.                      |
| `npm run check`                | Full quality gate: format + type + lint + language + tests + coverage.                       |
| `npm run typecheck`            | Extension TypeScript type check (`tsc --noEmit`).                                            |
| `npm run typecheck:test`       | Type check for test files (`tsconfig.test.json`).                                            |
| `npm run lint`                 | ESLint static analysis (src, test, scripts).                                                 |
| `npm run format`               | Formats the codebase with Prettier.                                                          |
| `npm run format:check`         | Verifies formatting is intact (CI gate).                                                     |
| `npm test`                     | Runs core and webview unit tests together.                                                   |
| `npm run test:ui`              | Runs only the webview (React) tests.                                                         |
| `npm run test:coverage`        | Prints Node's built-in coverage report.                                                      |
| `npm run check:coverage`       | Enforces the 75% line coverage floor.                                                        |
| `npm run check:version`        | Verifies `package.json`, lockfiles and `version.ts` agree.                                   |
| `npm run check:test-isolation` | Verifies tests keep temporary files under `os.tmpdir()`.                                     |
| `npm run check:language`       | Verifies agent docs (`AGENTS.md`, `.agents/**`) are English and source comments are Turkish. |
| `npm run build`                | All gates + webview build + minified extension and CLI bundles.                              |
| `npm run compile`              | Bundles only the extension with esbuild.                                                     |
| `npm run build:ui`             | Builds only the webview application with Vite.                                               |
| `npm run build:cli`            | Builds only the CLI bundle.                                                                  |
| `npm run package`              | Produces the `out/ahi-code-<version>.vsix` package.                                          |
| `npm run audit:verify`         | Verifies the `.ahi/audit.log` hash chain (`-- --workspace <path>`).                          |
| `npm run cli`                  | Runs the headless terminal CLI from source.                                                  |
| `npm run test:e2e`             | Builds and runs end-to-end tests in a real VS Code window.                                   |

---

## 6. Industrial Module Flow

Code is never written straight from the plan. The agent first builds a layered
module map, so "what goes where" and "in which order" are explicit before any
file is touched:

1. **Spec** (`write_spec`) — goal, scope, out-of-scope, assumptions and
   acceptance criteria. Approval requires criteria covering three dimensions:
   happy path, error handling, and edge cases.
2. **Module map** (`update_module_plan`) — every module declares a layer
   (`shared`, `domain`, `infrastructure`, `application`, `interface`, `test`,
   `docs`), the paths it owns, a one-line responsibility, its dependencies and
   the owning specialist. Dependencies must point toward the domain; layering
   violations and cycles are rejected before any code exists.
3. **Plan** (`update_plan`) — steps reference a `moduleId` and the acceptance
   criteria they satisfy. A plan without a module map is rejected.
4. **Build** — modules are written in layer order (shared → domain →
   infrastructure → application → interface); a module may only use modules it
   depends on. Each write is snapshotted and diff-previewed first.
5. **Verify** — tests, lint and type checks run; a skipped verification only
   satisfies the done gate when there is no workspace at all, so a missing test
   command can no longer close a task silently.

The module map is shown in the composer dock, so the write order and the
current module are visible while the task runs.

Review-stage findings and the agent's self-assessment are **advisory**: they
summarize what the agent checked and could not check. Final authority always
belongs to the user — nothing is presented as verified unless the underlying
test or command actually ran and passed.

---

## 7. UI Development and Design System Principles

- **Central style definition (`webview-ui/src/index.css`):**
  The typography scale (`--ahi-text-*`), radii, control heights, surface colors and card styles live in one file.
- **Reusable UI components (`webview-ui/src/components/ui/`):**
  `Button`, `IconButton`, `Input`, `Textarea`, `Select`, `Checkbox`, `TextField`, `SelectField`, `TextareaField`, `SearchField`, `Toggle`, `Card`, `Section`, `SectionTitle`, `EmptyState`, `Badge`, `Chip`, `Segmented`, `ListButton`, `NavButton`, `Disclosure`, `Drawer` and `Popover`.
- **No hard-coded styles:**
  Components must not use literal pixel colors (`#123456`) or arbitrary sizes such as `text-[9px]`. When a new need arises, add a semantic token to `index.css` first.
- **Theme fidelity:**
  Navigation, links, focus rings and primary buttons read VS Code theme variables, so custom themes are never forced back to brand blue. See [DEVELOPMENT.md](./DEVELOPMENT.md).
- **Natural scaling:**
  Font sizes are bound to `rem`, so the UI scales with the user's VS Code font size.

---

## 8. Test Architecture and Coverage

The suite currently holds 646 tests (542 core + 104 webview) across three layers:

1. **Unit tests (`test/unit/`):** Run in milliseconds with Node's built-in test runner (`node:test`) and a fake VS Code bridge (`test/support/`), no external dependencies.
2. **Webview UI tests (`webview-ui/test/`):** Simulate every screen and component interaction in JSDOM with React Testing Library.
3. **End-to-end tests (`test/e2e/`):** Start a real VS Code instance through `@vscode/test-electron` and verify manifest compatibility, command registration and settings synchronization.
