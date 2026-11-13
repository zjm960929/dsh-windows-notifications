# DSH Notification for Windows

English | [中文](README.zh.md)

A DeepSeek Harness Host plugin that raises native Windows notifications when a
session needs you, and lets you switch each notification type on or off from the
plugin page — no configuration file editing required.

## Notification types

| Event | Title | Body |
| --- | --- | --- |
| A turn finishes normally (`turn/end` = `completed`) | Task complete | Session title + the start of the answer |
| A turn fails (`error`) | Task failed | Session title + the error message |
| The output limit is reached (`max-tokens`) | Output limit reached | Session title |
| A tool call waits for approval | Approval needed | Session title + the reason (in the UI language) |
| A question waits for an answer | Waiting for your answer | Session title + the question |
| The account needs sign-in | Sign-in required | A sign-in hint |
| The model calls `windows_notification` | The given title | The given body |

Only root sessions notify: turns of delegated subagents stay quiet. Aborted or
interrupted turns stay quiet too. Identical notifications are de-duplicated
within 1.5 seconds.

## Switch notification types on or off

Open the plugin page (Settings → Plugins → DSH Notification for Windows). The
page shows one switch per type: turn finished, approval needed, question
waiting, sign-in required. Toggling a switch writes the value into the profile
configuration and reloads the plugin, so it takes effect immediately.

The same flags can be set without the UI:

```yaml
- id: windows-notifications
  name: dsh-windows-notifications
  config:
    turnEnd: false
    approval: true
    question: true
    signIn: false
```

| Key | Default | Meaning |
| --- | --- | --- |
| `turnEnd` | `true` | Notify when a turn finishes, fails, or hits the output limit |
| `approval` | `true` | Notify while a tool approval waits |
| `question` | `true` | Notify while a question waits |
| `signIn` | `true` | Notify when the account needs sign-in |
| `preview` | `true` | Include the start of the answer in completion notifications |
| `previewLength` | `120` | Preview length limit (0–400) |
| `skipWhenFocused` | `false` | Stay quiet while the DSH window is focused (only when the Host exposes Electron windows) |
| `silent` | `false` | Do not play the notification sound |
| `fallback` | `true` | Try the remaining channels when the preferred one fails |
| `transport` | `auto` | `auto` / `electron` / `toast` / `balloon` |
| `locale` | `auto` | `auto` / `zh` / `en` notification language |
| `dedupeMs` | `1500` | De-duplication window for identical notifications |
| `appUserModelId` | `com.deepseek.dsh` | Windows app identity used for the notification source |
| `balloonAppUserModelId` | `true` | Stamp the same identity on the tray-balloon fallback |
| `diagnostics` | `true` | Write the diagnostics log |
| `logFile` | `$DSH_HOME/windows-notifications.log` | Diagnostics log path |

## Install

Install the package from the DSH plugin manager, or:

```sh
dsh plugin add dsh-windows-notifications
```

## Delivery channels

1. `toast` — a WinRT toast through Windows PowerShell 5.1. This is the channel
   the DSH Desktop actually uses: the notification is attributed to
   DeepSeek Harness and lands in the Windows notification center.
2. `electron` — used only when the Host itself can reach the Electron API; it
   also focuses the window when the toast is clicked.
3. `balloon` — a tray balloon through `System.Windows.Forms`, used when both
   above fail; it borrows DSH's app identity so the source name stays
   DeepSeek Harness.

`auto` tries the channels in that order. The app identity must match the
installed Start-menu shortcut, or Windows rejects the toast; the plugin then
falls back and remembers that result.

## Diagnostics

Check `%USERPROFILE%\.dsh\windows-notifications.log` when a notification does
not appear:

```
2026-11-11T17:33:58.885Z question event
2026-11-11T17:34:02.059Z shown kind=question transport=toast
```

The log records event kinds, channels and errors only — never message text. It
rotates at 512 KiB. The same delivery path is available manually through the
`windows_notification` tool, whose result reports the channel it used.

## Limitations

- Whether a toast appears is up to Windows: Do Not Disturb, focus assist, or a
  disabled app entry can suppress it.
- A clicked toast does not focus the DSH window (no COM activator registered).
- `skipWhenFocused` has no effect when the Host exposes no Electron window.
- The tray-balloon fallback is attributed by the OS; when the explicit app
  identity is refused, the source still reads Windows PowerShell.
- The plugin does not aggregate sessions across multiple Hosts or devices.
