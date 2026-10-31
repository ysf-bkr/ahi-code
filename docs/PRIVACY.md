# Privacy Notice

**English** · [Türkçe](PRIVACY.tr.md)

**Last updated:** October 30, 2026

AhiCode is an open-source Visual Studio Code extension independently developed
by Yusuf BEKAR. This notice explains which data the extension processes while
it runs and where that data can travel. Model providers have their own privacy
and retention terms; this document does not guarantee their practices.

## 1. Data processed by the extension

- Chat messages, task instructions, model responses, and prompt context.
- Provider, model, and endpoint settings chosen by the user.
- Task history and session transcripts.
- Names, decisions, and redacted arguments of the tools the agent executes.
- Files opened by the user, and metadata created under `.ahi/` (memory,
  checkpoints, audit ledger, verification baseline).

The extension can read files the agent is permitted to access. If file content
is added to the model context, it may be sent to the selected model provider.
Before sending sensitive data, check the workspace, the selected provider, and
the extension's permission settings.

## 2. Transmission to model providers

When a request is dispatched, chat messages, model context, and the relevant
tool schemas are sent to the selected provider. If tool output or file content
has been added to the context, that content may be sent as well.

- **Ollama (default):** Requests go to the Ollama address you configured;
  the default is `http://localhost:11434` and runs entirely locally.
- **EVREN LLM (SSYZ):** Requests are sent to the EVREN API endpoint with the
  credentials you supplied.
- **OpenRouter:** Requests go to `https://openrouter.ai/api/v1` and may be
  routed from there to the selected model provider. OpenRouter's and the target
  provider's terms apply.
- **OpenAI-compatible endpoint:** Requests are sent to the base URL you
  configured. If you use a remote server, that server's operator can access the
  requests.

AhiCode does not determine how long these third parties store data or whether
they use it for model training. Review your provider's current terms.

## 3. Web search, URL fetching, and MCP

- The `web_search` tool sends the query to Tavily or Brave (when the relevant
  API key is present in the environment) or to DuckDuckGo.
- When `web_fetch` runs, a network request is made to the requested URL. The
  retrieved page content may be added to the task context and can therefore be
  sent to the model provider.
- MCP servers are configured by the user. Arguments passed to an MCP tool and
  the project data required by the call may be transmitted to that MCP server.
  Only add servers you trust and review their own privacy terms.

## 4. Local storage

- Provider API keys are stored in VS Code `SecretStorage`; they are never
  written to plain-text user settings.
- Settings are kept in the VS Code extension state. Task history and messages
  are stored locally in VS Code `workspaceState`.
- Project memory, the audit log, checkpoints, and the verification baseline may
  be kept in the workspace's `.ahi/` folder. Its contents can be committed to
  Git depending on your project settings; the repository `.gitignore` excludes
  most of these local files.
- Diagnostic messages may be written to the VS Code Output channel. API keys
  and message contents are deliberately never sent as application telemetry.

You can delete task history from the extension's history screen. Removing or
keeping the `.ahi/` records inside a project is up to the user and the project
maintainer.

## 5. Telemetry and automatic error reports

The codebase contains no analytics or usage telemetry operated by AhiCode: no
usage counters, session recordings, or profiling data are collected or sent.

There is one narrow outbound feature, and it is not analytics: **automatic
error reports**. When the extension hits an error it shows the user, it can
open a GitHub issue in the public AhiCode repository
(`ysf-bkr/ahi-code`) so the maintainer can fix it.

- Control: `ahiCode.reportErrors` (on by default). Turning it off disables
  every outbound call of this feature.
- Transport: reports are created with your own `gh` (GitHub CLI) session on
  your machine. If `gh` is not installed or not signed in, nothing is sent.
  The extension holds no GitHub credentials of its own for this feature.
- Content: only the error message itself plus coarse environment facts
  (extension version, app name, platform, timestamp). Before sending, file
  paths, API-key-like strings, UUIDs, long hex ids and large numbers are
  masked, and the text is truncated. Chat transcripts, file contents and
  code are never included.
- Deduplication: each error gets a content fingerprint stored locally and
  embedded in the issue body; the same error never creates a second issue.
- Budget: at most five new issues per extension session, with a cooldown
  between them.

If you consider even a masked error text sensitive, set
`ahiCode.reportErrors` to `false`.

The data practices of VS Code, model providers, web search services, MCP
servers, or any other service you configure are outside the scope of this
notice.

## 6. Security and children's privacy

Do not put API keys, access tokens, or private code into public GitHub issues or
logs. The extension does not provide end-to-end encryption for data sent to a
provider, nor does it guarantee that the provider will not store it. AhiCode is
not specifically designed for children.

## 7. Contact and changes

For privacy questions, email [ybekar@msn.com](mailto:ybekar@msn.com) or open an
issue on [GitHub Issues](https://github.com/ysf-bkr/ahi-code/issues). Do not
share sensitive data in public issues. This notice will be updated as the
extension's data handling changes.
