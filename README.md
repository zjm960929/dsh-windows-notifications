# dsh-windows-notifications

**Windows notifications for DeepSeek Harness — know when a session needs you, and switch each notification type from the plugin page.**

[![npm version](https://img.shields.io/npm/v/dsh-windows-notifications.svg)](https://www.npmjs.com/package/dsh-windows-notifications)
[![npm downloads](https://img.shields.io/npm/dm/dsh-windows-notifications.svg)](https://www.npmjs.com/package/dsh-windows-notifications)
[![license](https://img.shields.io/npm/l/dsh-windows-notifications.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-339933)](https://nodejs.org/)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-0.2.x-4F46E5)](https://github.com/deepseek-ai/deepseek-harness)

English | [中文](README.zh.md)

`dsh-windows-notifications` is a DeepSeek Harness Host plugin that raises a native Windows notification when a turn finishes, a tool approval waits, a question waits, or the account needs sign-in. Each type has its own switch on the plugin page, so you do not have to edit a configuration file to mute one kind of alert.

It is for people who start long-running sessions and then look away: the notification lands in the Windows notification center, attributed to DeepSeek Harness, and clicking the toast does not steal focus.

> **Source:** DeepSeek Harness · **Primary channel:** Windows toast · **Scope:** root sessions only

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Usage](#usage)
- [Notification types](#notification-types)
- [Settings](#settings)
- [Delivery channels](#delivery-channels)
- [Diagnostics](#diagnostics)
- [Manual notification tool](#manual-notification-tool)
- [How it works](#how-it-works)
- [Safety and limitations](#safety-and-limitations)
- [Development](#development)
- [Releasing](#releasing)
- [Contributing](#contributing)
- [License](#license)

## Features

- **Four switchable notification types** — turn finished, approval needed, question waiting, sign-in required; each one is a switch on the plugin page.
- **Changes apply immediately** — toggling a switch writes the value into the profile configuration and reloads the plugin; no DSH restart.
- **Native Windows surface** — real toasts in the notification center, attributed to DeepSeek Harness, with sound control.
- **Quiet about delegation** — only root sessions notify; turns of delegated subagents never interrupt you.
- **Turn-aware content** — completion notices carry the session title and the start of the answer; failures carry the error message.
- **Three delivery channels** — a WinRT toast through Windows PowerShell, an Electron notification when the Host exposes it, and a tray balloon as the last resort.
- **Bilingual text** — notifications and the settings card follow the active DSH language (Chinese / English).
- **Diagnostics on demand** — one log file records event kinds, channel and errors, never message text.
- **A manual tool as well** — the model can call `windows_notification` to raise a heads-up the automatic triggers would not cover.
- **No runtime dependencies** — only Node.js built-ins and Windows PowerShell 5.1, which ships with Windows.

## Requirements

- **DeepSeek Harness** `0.2.x` (Desktop or Web). The verification target is `0.2.2-rc.1` on Desktop.
- **Windows 10 or 11** with PowerShell 5.1 (`powershell.exe`) available.
- **Node.js** `22+` for the Host half; the browser half runs in the DSH page.
- No additional runtime dependencies.

## Installation

### From the DSH Plugins page

Open **Plugins** in DSH, search for `dsh-windows-notifications`, and install it. Reload the page once so the browser half loads.

### From the CLI

```bash
dsh plugin --profile desktop add dsh-windows-notifications
```

Use the profile you actually run, for example `--profile desktop`.

### From a local build

```bash
pnpm pack
dsh plugin --profile desktop add ./dsh-windows-notifications-<version>.tgz
```

A tarball install is a package copy, not a symlink. It replaces a same-name npm install until you restore the published package.

## Usage

1. Open **Settings → Plugins** and select **DSH Notification for Windows**.
2. The plugin page shows **Notification types** with one switch per type.
3. Toggle a type and keep working; the switch saves right away and the plugin reloads with the new value.

The switches are the normal way to control this plugin. You only need the configuration table below for advanced options or for a headless profile.

## Notification types

| Event | Title | Body |
| --- | --- | --- |
| A turn finishes normally (`turn/end` = `completed`) | Task complete | Session title, then the start of the answer |
| A turn fails (`error`) | Task failed | Session title, then the error message |
| The output limit is reached (`max-tokens`) | Output limit reached | Session title |
| A tool call waits for approval | Approval needed | Session title, then the reason in the UI language |
| A question waits for an answer | Waiting for your answer | Session title, then the question |
| The account needs sign-in | Sign-in required | A sign-in hint |
| The model calls `windows_notification` | The given title | The given body |

Aborted or interrupted turns stay quiet, and identical notifications are de-duplicated within 1.5 seconds.

## Settings

The four switches map to the first four keys; every key can also be set by hand:

```yaml
- id: windows-notifications
  name: dsh-windows-notifications
  config:
    turnEnd: true
    approval: true
    question: false
    signIn: true
```

| Key | Default | Meaning |
| --- | --- | --- |
| `turnEnd` | `true` | Notify when a turn finishes, fails, or hits the output limit |
| `approval` | `true` | Notify while a tool approval waits |
| `question` | `true` | Notify while a question waits |
| `signIn` | `true` | Notify when the account needs sign-in |
| `preview` | `true` | Include the start of the answer in completion notices |
| `previewLength` | `120` | Preview limit in characters (0–400) |
| `skipWhenFocused` | `false` | Stay quiet while the DSH window is focused; only works when the Host exposes Electron windows |
| `silent` | `false` | Do not play the notification sound |
| `fallback` | `true` | Try the remaining channels when the preferred one fails |
| `transport` | `auto` | `auto` / `electron` / `toast` / `balloon` |
| `locale` | `auto` | `auto` / `zh` / `en` notification language |
| `dedupeMs` | `1500` | De-duplication window for identical notices |
| `appUserModelId` | `com.deepseek.dsh` | Windows app identity used as the notification source |
| `balloonAppUserModelId` | `true` | Stamp the same identity on the tray-balloon fallback |
| `diagnostics` | `true` | Write the diagnostics log |
| `logFile` | `$DSH_HOME/windows-notifications.log` | Diagnostics log path |

## Delivery channels

1. **`toast`** — a WinRT toast raised by Windows PowerShell 5.1. This is what DSH Desktop uses: the notification is attributed to DeepSeek Harness and appears in the notification center.
2. **`electron`** — used only when the Host itself can reach the Electron API; it also brings the window forward when the toast is clicked.
3. **`balloon`** — a tray balloon through `System.Windows.Forms`, used when both channels above fail. It borrows DSH's app identity so the source name stays DeepSeek Harness when Windows accepts it.

`auto` tries the channels in that order. The app identity must match the installed Start-menu shortcut, or Windows rejects the toast; the plugin then falls back and remembers the result.

## Diagnostics

When a notification does not appear, read `%USERPROFILE%\.dsh\windows-notifications.log`:

```text
2026-11-11T17:33:58.885Z question event
2026-11-11T17:34:02.059Z shown kind=question transport=toast
```

The log records event kinds, channel and errors only, never message text. It rotates at 512 KiB to `windows-notifications.log.1`. A suppressed type shows up as `skip kind=question reason=disabled`.

## Manual notification tool

The Host registers a `windows_notification` tool so the model can raise a heads-up the automatic triggers would not cover:

```json
{ "title": "Build finished", "body": "The Windows package is signed.", "channel": "toast" }
```

`channel` is optional (`auto` / `electron` / `toast` / `balloon`). The tool result reports the channel that delivered the notice, or why it was not delivered.

## How it works

The plugin has a Host half and a browser half:

```text
┌────────────────────────────────────┐
│ Plugin page (React switches)       │
│ turn / approval / question / login │
└───────────────┬────────────────────┘
                │ owner-only HTTP
┌───────────────▼────────────────────┐
│ Host API                           │
│ /windows-notifications/api/config  │
│ read + save via configEditor       │
└───────────────┬────────────────────┘
                │ PowerShell 5.1
┌───────────────▼────────────────────┐
│ Windows toast / Electron / balloon │
└────────────────────────────────────┘
```

- The browser half registers a card in the `plugins.bundle.config` slot, keyed by the package name, so it renders only on this plugin's page.
- The Host half serves `GET`/`POST /windows-notifications/api/config` behind `connection.admit()` and an owner check; a save goes through DSH's `configEditor`, which rewrites the profile row and reloads the plugin.
- Notification delivery runs through one serialized queue, capped at eight pending notices, so a burst of events cannot spawn a PowerShell process per event.
- There is no build step; `index.js` and `client.js` are the shipped files.

## Safety and limitations

### Safety

- Every settings request passes `connection.admit()` and requires an owner peer; unauthenticated requests get `403` and a save is never attempted.
- Only the four type flags are accepted from the page; unknown keys and non-boolean values are ignored.
- The HTTP route is same-origin only and is registered on the existing DSH server; the plugin opens no additional port.
- The plugin never reads message content for its own storage; the diagnostics log records event kinds and delivery outcomes only.

### Limitations

- Whether a toast appears is up to Windows: Do Not Disturb, focus assist, or a disabled app entry can suppress it.
- A clicked toast does not focus the DSH window, because no COM activator is registered.
- `skipWhenFocused` has no effect when the Host exposes no Electron window, which is the case on DSH Desktop today.
- The tray-balloon fallback is attributed by the OS; when the explicit app identity is refused, the source still reads Windows PowerShell.
- The plugin does not aggregate sessions across multiple Hosts or devices.
- The internal HTTP route may change between minor releases.

## Development

### Repository layout

```text
index.js            Host half: events, delivery, settings route, tool
client.js           browser half: notification-type switches
cordis.patch.yml    bundle row inserted into the DSH profile
locale/
  en.json           Plugins-page display metadata
  zh.json
icon.svg            plugin icon
README.md           English documentation
README.zh.md        Chinese documentation
```

There is no build step. Edit `index.js` or `client.js` directly and reload the page after a client change; a Host change reloads the plugin.

### Checks

```bash
node --check index.js
node --check client.js
```

### Local package smoke test

```bash
pnpm pack
dsh plugin --profile <profile> add ./dsh-windows-notifications-<version>.tgz
```

A tarball install replaces a same-name npm install; restore the published package when the smoke test is done.

## Releasing

Releases are published by `.github/workflows/publish.yml` when a `v*` tag is pushed. The workflow checks that the tag matches `package.json` and publishes with npm provenance using the `NPM_TOKEN` repository secret.

```bash
npm version patch
git push --follow-tags
```

Do not publish manually from a workstation; let the workflow own the release.

## Contributing

Issues and pull requests are welcome. Keep changes focused on this plugin, run the checks above, and update `README.md` and `README.zh.md` together when behavior or UI text changes.

## License

[MIT](LICENSE)
