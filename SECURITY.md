# Security Policy

AhiCode is a VS Code extension that can read and write files and run terminal
commands on your machine. We take reports about the following classes of issues
seriously:

- Path traversal or symlink escapes outside the workspace root
- Bypasses of the permission/approval flow or the plan-mode tool lock
- Command injection, shell chaining bypasses, or sandbox escapes
- Secret leakage (API keys, `.env`, private keys, audit log redaction)
- Prompt-injection paths that can trigger writes or command execution without approval
- Server-Side Request Forgery (SSRF) in `web_fetch` / `web_search`
- Privilege escalation through `.ahi/permissions.json` or hooks

## Reporting a vulnerability

Please do **not** open a public GitHub issue for security problems.

1. Use GitHub's private vulnerability reporting:
   <https://github.com/ysf-bkr/ahi-code/security/advisories/new>
2. If that is unavailable, email **ybekar@msn.com** with the subject
   `AhiCode security report`.

Include:

- A description of the issue and its impact
- Steps to reproduce (a minimal workspace or command is ideal)
- Affected version/commit and platform
- Any suggested fix, if you have one

We aim to acknowledge reports within 72 hours and to publish a fix or mitigation
as soon as practical. Please allow us reasonable time to ship a fix before any
public disclosure.

## Scope

In scope:

- The extension in this repository (`src/`, `webview-ui/`, `scripts/`)
- The bundled CLI (`dist/cli.js`)

Out of scope:

- Vulnerabilities in third-party model providers or MCP servers you configure
- Issues that require an already-compromised machine or a malicious VS Code installation
- Risks that the README explicitly documents as known limitations
  (for example, `execute_command` changes are not covered by snapshots)

## Security model summary

- Workspace path jail with symlink checks.
- Deny rules and sensitive-file protection always apply, including in untrusted workspaces.
- A repository's `.ahi/permissions.json` cannot widen the global `autoApprove`
  switches. Project `allow` lists are filters applied only when the user already
  enabled the matching switch; they never turn a manual approval back off.
- Repository hooks in `.ahi/hooks.json` follow the same contract as project
  MCP servers: they require an explicit, fingerprint-scoped user approval and
  are never loaded in an untrusted workspace.
- Project permissions are not applied at all in an untrusted workspace.
- Writes and commands require approval unless the user explicitly opted in.
- Plan mode removes and rejects write/command tools.
- API keys are stored in VS Code `SecretStorage`.

Known limitation: snapshots and checkpoints only cover files changed directly by
`write_file` / `edit_file`. Files created or modified by `execute_command` cannot
be reverted by the undo feature.

## Dependency security

- Development dependencies are pinned and regularly audited.
- The `overrides` entry for `@azure/msal-node: ^7.1.1` in `package.json` mitigates known
  vulnerabilities in older 6.x versions pulled transitively by `@vscode/vsce` via `@azure/identity`.
  The project does not consume Azure services at runtime.

## Supported versions

Only the latest published version receives security fixes. If you are running
from source, make sure you are on the latest commit of `main`.
