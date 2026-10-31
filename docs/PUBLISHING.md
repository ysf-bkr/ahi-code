# Marketplace Publishing Guide

**English** · [Türkçe](PUBLISHING.tr.md)

This repository contains a tag-triggered GitHub Actions workflow that publishes
to the Visual Studio Marketplace. Until the extension is published there, the
Marketplace install link stays unavailable.

## 1. Marketplace and GitHub project metadata

The Marketplace page uses metadata from the extension manifest and the
repository `README.md`. The core values are defined in this project:

| Field | Value / source |
| --- | --- |
| Extension ID | `ysf-bkr.ahi-code` (`publisher` + `name`) |
| Display name and short description | `displayName` and `description` in `package.json` |
| Publisher | `ysf-bkr` |
| Icon | `resources/icon.png` |
| License | `MIT` and the `LICENSE` file |
| Categories and search keywords | `categories` and `keywords` in `package.json` |
| Install, usage, privacy, and support info | Root `README.md` shown on GitHub and the Marketplace |
| Detailed data-handling notice | [`docs/PRIVACY.md`](./PRIVACY.md) |
| Change history | [`CHANGELOG.md`](../CHANGELOG.md) |
| Source code and issue tracker | `repository`, `homepage`, `bugs` in `package.json` |

The Marketplace listing is single-locale: it renders `displayName`,
`description` and the root `README.md` as-is, with no language switcher.
The product's audience is Turkish, so all three are Turkish-only; the
`README.md` at the repository root is the Turkish landing document for both
GitHub and the Marketplace. The English copy lives in `README.en.md` for
developers and international readers, and English search stays covered by
the `ai`, `coding-agent` and `autonomous-agent` keywords. Never put English
prose into `displayName` or `description`.

No PAT or secret is needed for this metadata. Only `VSCE_PAT`, required by the
release automation, is stored as a secret under **Settings → Secrets and
variables → Actions**; never put its value in the README, issues, or source code.

The Marketplace page should document installation steps, provider/data flow,
requirements, and a support address. Those sections live in the root README;
before publishing, re-check the description, publisher, icon, and license.

### Dependency security: the `@azure/msal-node` override

The `@azure/msal-node: ^7.1.1` entry in the `package.json` `overrides` block
fixes the vulnerable old 6.x line pulled by `@azure/identity`, a dependency of
the `@vscode/vsce` packager (keeping `npm audit` clean). The project does not use
Azure services directly at runtime.

## 2. Before the first release

1. Create a publisher in Visual Studio Marketplace Publisher Management, or
   verify the existing one.
2. The `publisher` value in `package.json` must match the publisher ID exactly.
   The verified ID is set to `ysf-bkr`.
3. Create a Personal Access Token in Azure DevOps with Marketplace publishing
   rights.
4. Add a repository secret named `VSCE_PAT` under **Settings → Secrets and
   variables → Actions**.
5. Never place the token in source files, commits, issues, or chat messages.

## 3. Local packaging and publishing

To build the package:

```bash
npm run package
```

The VSIX is written to `out/ahi-code-<version>.vsix`. With `VSCE_PAT` defined
locally, the publish command is:

```bash
npm run publish:ext
```

The command uses the manifest version and publishes the VSIX after building and
packaging. Unpublishing from the Marketplace is hard to reverse; verify the
publisher and version first.

## 4. Publishing with GitHub Actions

1. Review the changes and update the version together in `package.json`,
   `package-lock.json`, and `webview-ui/package.json`.
2. Create and push a tag matching the version, for example:

```bash
git tag v0.0.2
git push origin v0.0.2
```

3. A tag matching the `v<package.json version>` form starts the
   `.github/workflows/marketplace.yml` workflow. It runs the tests, builds the
   VSIX, and publishes it with `VSCE_PAT`.

Once a release is live and users install it from the Marketplace, VS Code's
automatic extension updates can deliver new versions. Manual VSIX installs do
not receive automatic updates by default.

## 5. Open VSX Registry (VSCodium, Gitpod, open-source editors)

Open-source VS Code derivatives such as VSCodium, Gitpod, and Eclipse Theia use
the [Open VSX Registry](https://open-vsx.org/) instead of the Microsoft
Marketplace.

To publish the same VSIX to Open VSX manually:

1. Create an account on `open-vsx.org` and claim a namespace named `ysf-bkr`.
2. Generate an Access Token and publish locally:

   ```bash
   npx ovsx publish out/ahi-code-0.0.2.vsix -p <OVSX_TOKEN>
   ```

3. Dual publishing (Marketplace + Open VSX) can be automated by adding an
   `OVSX_PAT` secret and an Open VSX step to the workflow. The current
   `.github/workflows/marketplace.yml` publishes to the Visual Studio
   Marketplace only, so this step is not wired up yet.

## 6. Installing from the Marketplace

After the first release, users can:

1. Open the **Extensions** view in VS Code and search for `AhiCode` or
   `ysf-bkr.ahi-code`.
2. Verify the publisher is `ysf-bkr` and click **Install**.
3. Or run `code --install-extension ysf-bkr.ahi-code` from a terminal.

Until the extension is published, neither the search nor the command works. Use
the local packaging steps in the README until then.
