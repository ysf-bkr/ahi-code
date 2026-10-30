# AhiCode Visual and Brand Assets

[🇹🇷 Türkçe](README.tr.md) | **English**

This directory holds the official visual assets used by the AhiCode extension,
web interface, and promotional channels.

## 1. Core Extension Assets (VS Code)

| File | Size / Format | Usage |
| --- | --- | --- |
| `icon.png` | 128×128 PNG | VS Code Marketplace extension icon |
| `icon.svg` | Vector SVG (monochrome) | VS Code secondary sidebar view icon |
| `icon-color.svg` | Vector SVG (color) | Color AhiCode emblem vector source |
| `logo.png` | 900×589 PNG (dark wordmark) | Logo with transparent, cropped background for light themes |
| `logo-dark.png` | 900×589 PNG (light wordmark) | Logo with transparent, cropped background for dark themes |
| `logo.svg` | SVG | Emblem and wordmark vector wrapper |

## 2. High-Resolution Promotional Assets

For social media, newsletters, documentation, and presentations:

- `logo-light-1800.png` / `logo-light-2700.png`: High-resolution logos with a dark wordmark for light backgrounds (1800px and 2700px).
- `logo-dark-1800.png` / `logo-dark-2700.png`: High-resolution logos with a light wordmark for dark backgrounds (1800px and 2700px).
- `icon-256.png` / `icon-512.png` / `icon-1024.png`: High-resolution application and store icons.

## 3. Web and Favicon Assets

For the webview and web interface:

- `favicon.ico`: Standard multi-resolution web favicon (also copied to `webview-ui/public/favicon.ico`).
- `favicon-16.png`, `favicon-32.png`, `favicon-48.png`, `favicon-64.png`, `favicon-180.png`: Standard PNG favicons for different devices and screen densities.

The webview only ships the variants it references: `webview-ui/public/` contains
`favicon.ico`, `favicon_16x16.png`, `favicon_32x32.png`, and `favicon_180x180.png`
(see `webview-ui/index.html`).
