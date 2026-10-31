# AhiCode Developer Guide

**English** · [Türkçe](DEVELOPMENT.tr.md)

This guide is intended for developers contributing to the AhiCode extension, inspecting its internals, or building and extending it locally.

---

## 1. Development Environment Setup

### Prerequisites
- **Node.js**: v22 or higher
- **npm**: v10 or higher
- **VS Code**: v1.106 or higher (or VSCodium / Cursor)
- **Git**: 2.30 or higher

### Cloning and Installing Dependencies
```bash
git clone https://github.com/ysf-bkr/ahi-code.git
cd ahi-code
npm ci
npm --prefix webview-ui ci
```

### Monorepo Layout (npm workspaces)
AhiCode is a single-repository npm workspace with three packages plus the
extension host. `npm ci` at the root links every workspace at once.

| Path | Package | Role |
| --- | --- | --- |
| `packages/core/` | `@ahicode/core` | The vscode-free engine: providers, tools, permission, context, knowledge, callgraph, multiagent. Never imports `vscode`. |
| `packages/cli/` | `@ahicode/cli` | The `ahi` terminal agent. Rides only on `@ahicode/core` (no VS Code). |
| `src/` | extension host | Every file that touches the `vscode` API (activation, webview, AgentCore runtime, real LSP client). |
| `webview-ui/` | React app | The chat webview. |

Import contract, enforced by `test/unit/architecture.test.ts`: `@ahicode/core`
may not import `vscode` or the extension `src/`; `@ahicode/cli` may not import
the extension `src/`. The engine reaches the language server through the
`LspClientPort` interface, which the host's `LspClient` satisfies structurally.
Run the terminal agent from source with `npm run cli -- --prompt "..."`.

### Build and Verification Scripts
AhiCode maintains a strict suite of verification scripts to guarantee code quality and test isolation:

| Command | Description |
| --- | --- |
| `npm run dev` | Builds the extension and launches a new VS Code Extension Development Host window. |
| `npm test` | Runs the full unit test suite across both backend (`test/unit/**`) and UI (`webview-ui/test/**`). |
| `npm run test:ui` | Executes webview (React) tests in JSDOM isolation. |
| `npm run typecheck` | Validates extension TypeScript types (`tsc --noEmit`). |
| `npm run typecheck:test` | Type-checks the test suite (`tsconfig.test.json`). |
| `npm run lint` | Runs ESLint static analysis. |
| `npm run format` | Formats all files with Prettier. |
| `npm run format:check` | Verifies formatting compliance. |
| `npm run check:version` | Checks version consistency across `package.json`, lockfiles, and `version.ts`. |
| `npm run check:test-isolation` | Ensures all test mutations are strictly quarantined inside `os.tmpdir()`. |
| `npm run check:language` | Ensures agent docs (`AGENTS.md`, `.agents/**`) are English and source comments are Turkish. |
| `npm run test:coverage` | Prints Node's built-in coverage report. |
| `npm run check:coverage` | Enforces the 75% line coverage floor. |
| `npm run check` | Full quality gate: format + type + lint + language + tests + coverage. |
| `npm run package` | Packages the production VSIX (`out/ahi-code-0.0.2.vsix`). |
| `npm run install:ext` | Builds, packages, and installs the extension into your local VS Code. |

---

## 2. Architecture & Modules

AhiCode is structured with a clean, unidirectional data flow:

```text
src/
├── extension.ts                  # VS Code entry point and command registrations
├── shared/                       # Shared contracts between the extension and webview
│   ├── types.ts                  # Typed postMessage protocol and domain models
│   ├── constants.ts              # System timeouts, paths, default endpoints
│   ├── version.ts                # Single source of truth for versioning
│   ├── commandPolicy.ts          # Command risk evaluation (blocked, risky, safe)
│   ├── languageMap.ts            # VS Code syntax highlighting language ID mapping
│   └── redaction.ts              # Secret and token sanitization
├── providers/                    # LLM Provider adapters (Ollama, EVREN, OpenRouter, OpenAI)
├── tools/                        # Agent tool implementations (file, shell, git, lsp, web)
│   ├── file.ts                   # Read, write, and patch files
│   ├── shell.ts                  # Terminal execution with command policies
│   ├── git.ts                    # Status, diff, log, commit inspection
│   ├── lsp.ts                    # VS Code language server diagnostic queries
│   └── pathSafety.ts             # Path traversal and symlink confinement
├── webview/                      # SidebarProvider, settingsStore, apiKeys, webviewHtml
└── core/                         # Autonomous agent engine
    ├── agent/                    # AgentCore, AgentLoop, Autonomy, Workflow progression
    ├── permission/               # Multi-level permission and allowlist engine
    ├── audit/                    # SHA-256 hash-chained immutable audit ledger
    ├── snapshot/                 # File snapshots and interactive diff rollback
    ├── checkpoint/               # Turn-level state rewind
    ├── callgraph/                # Structural call graph and reference index
    └── mcp/                      # Model Context Protocol client
```

---

## 3. Design System & Theming

All UI variables, colors, spacing and component styles are centralized in `webview-ui/src/index.css`. Components (`webview-ui/src/components/ui/*`) only compose those classes; JSX never carries raw colors, pixel values or long repeated utility strings.

### Theme Fidelity
- UI colors come from the user's VS Code theme: `--vscode-*` variables are mapped onto `--ahi-*` tokens.
- Navigation, links, focus rings and primary buttons use theme variables (`textLink`, `button`, `focusBorder`), so a red, green or high-contrast theme is never forced back to brand blue.
- The brand palette (`--primary`, `--secondary`, `--accent`, `--brand-gradient`) is reserved for the logo and promotional surfaces.
- Status colors (`--status-*`) are derived from theme variables and verified in light, dark and high-contrast themes.

### Typography and Font Scaling
- Uses `rem` to adapt dynamically to user-defined VS Code editor and terminal font sizes.
- Text tokens: `--ahi-text-2xs` (0.82rem), `--ahi-text-xs` (0.88rem), `--ahi-text-sm` (0.96rem), `--ahi-text-md` (1rem), `--ahi-text-lg` (1.18rem), `--ahi-text-xl` (1.35rem).
- Chat body and markdown content use `--ahi-text-md` through `ahi-prose`; markdown headings use `ahi-md-h1`…`ahi-md-h6`.
- Components take typography from `ahi-heading`, `ahi-title`, `ahi-label`, `ahi-caption` and `ahi-overline`.

### Icon Scale
- Every lucide icon is sized from one scale: `ahi-icon-xs` (12px), `ahi-icon-sm` (14px), `ahi-icon-md` (16px), `ahi-icon-lg` (20px), `ahi-icon-xl` (24px), `ahi-icon-2xl` (32px).
- Icons are driven by `var(--ahi-icon-*)`, so JSX never uses raw `h-3 w-3` size utilities.

### Color Helpers
- Text: `ahi-text-fg`, `ahi-text-muted`, `ahi-text-brand`, `ahi-text-info`, `ahi-text-success`, `ahi-text-warning`, `ahi-text-error`, `ahi-text-on-accent`.
- Surfaces and borders: `ahi-bg-base`, `ahi-bg-raised`, `ahi-bg-surface`, `ahi-bg-input`, `ahi-bg-brand-soft`, `ahi-border-base`, `ahi-border-surface`, `ahi-border-brand` and `ahi-border-{info,success,warning,error}`.
- Status surfaces: `ahi-bg-{info,success,warning,error}`.
- Raw hex colors (`#123456`) are never used; always `var(--vscode-*)` or `var(--ahi-*)`.

### Fonts
- UI text inherits `var(--vscode-font-family)`.
- Code, terminal and monospace elements use `var(--vscode-editor-font-family)` and the user's editor font size setting.

### Module map in the UI
The composer dock renders `ModuleStrip` above the plan: modules are grouped by
layer and ordered bottom-up, each showing its owning role, owned paths and the
status of the plan step bound to it. The strip shows a `kod öncesi` (pre-code)
marker until the plan is approved.

---

## 4. MCP (Model Context Protocol) Support

AhiCode supports the Model Context Protocol to integrate external developer
tools and data sources dynamically. The client lives in
`packages/core/src/core/mcp/` (the vscode-free engine side) and speaks
JSON-RPC over stdio or HTTP/SSE transports.

### Configuration

Servers are read, in order, from:

1. `.ahi/mcp_config.json` (recommended)
2. `mcp_config.json` in the workspace root
3. `.mcp.json` in the workspace root

The file schema is `{ "mcpServers": { "<name>": { ... } } }`. A server entry
defines either a local process or a remote endpoint:

```json
{
  "mcpServers": {
    "local-tool": {
      "command": "node",
      "args": ["./tools/server.js"],
      "env": { "TOKEN": "<value>" }
    },
    "remote-tool": {
      "type": "sse",
      "url": "https://example.com/mcp"
    }
  }
}
```

### Safety rules

- Environment variables inherited by a server are filtered; secret-looking
  values are not passed through. A server that needs a key must receive it
  explicitly through the `env` field.
- Server commands run on your machine, so project MCP servers require an
  explicit, fingerprint-scoped approval and are never loaded in an untrusted
  workspace.
- Tool arguments sent to an MCP server and the project data required by the call
  may leave your machine. Only add servers you trust.

