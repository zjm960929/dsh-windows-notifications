# Windows 通知（dsh-windows-notifications）

DSH 的 Host 插件：当客户端里**一轮对话结束**、**有工具调用在等你授权**、**有提问在等你回答**，或**账号需要重新登录**时，直接弹出 Windows 系统通知（进通知中心，不依赖 DSH 窗口在前台）。

- 只对根会话的一轮结束发通知；子代理（subagent）每轮结束不打扰你。
- 插件本身不联网、不改 profile、不写配置；安装动作由插件管理器完成。
- 另外提供一个 `windows_notification` 工具，模型可以主动给你发一条提醒。

## 触发时机

| 场景 | 通知标题 | 内容 |
| --- | --- | --- |
| 一轮对话正常结束（`turn/end` = `completed`） | 任务完成 | 会话标题 + 回答开头的一小段文字 |
| 一轮对话出错（`error`） | 任务出错 | 会话标题 + 错误信息 |
| 输出达到上限（`max-tokens`） | 输出达到上限 | 会话标题 |
| 工具调用等待授权（`approval/request`） | 需要你的授权 | 会话标题 + 授权原因（跟随界面语言） |
| 提问等待回答（`user-questions/request`） | 等待你的回答 | 会话标题 + 问题摘要 |
| 账号需要登录（`model-sign-in-required`） | 需要登录 | 提示登录 |
| 模型主动调用 `windows_notification` | 模型给定的标题 | 模型给定的正文 |

用户主动中止（`aborted` / `interrupted`）不发通知。相同内容的通知在 1.5 秒内只发一次。

## 安装

在插件管理器里 **插件 → 添加插件** 填写包名，或者用命令行安装：

```bash
dsh plugin add dsh-windows-notifications
```

也可以直接从 GitHub 安装（不经过 npm）：

```bash
dsh plugin add github:zjm960929/dsh-windows-notifications
```

本地开发时可以直接安装本目录（绝对路径），或让 Agent 用 `install_bundle`。三种方式都会向当前 profile 加入一行 `windows-notifications`，不改动任何 DSH 自带组件。

## 配置

在 profile 的 `cordis.patch.yml` 里给这一行加 `config`（未写的字段用默认值）：

```yaml
- id: windows-notifications
  name: dsh-windows-notifications
  config:
    skipWhenFocused: true    # 只在 DSH 窗口不在前台时提醒
    silent: true             # 静音通知
    preview: false           # 完成通知不附带回答摘要
    transport: toast         # 只用 WinRT Toast
```

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `turnEnd` | `true` | 一轮结束时通知 |
| `approval` | `true` | 等待授权时通知 |
| `question` | `true` | 等待回答时通知 |
| `signIn` | `true` | 需要登录时通知 |
| `preview` | `true` | 完成通知里附带回答开头 |
| `previewLength` | `120` | 摘要字符上限（0–400） |
| `skipWhenFocused` | `false` | DSH 窗口在前台时不通知；仅在 Host 能读到 Electron 窗口状态时生效 |
| `silent` | `false` | 静音，不播放提示音 |
| `fallback` | `true` | 首选通道失败时依次尝试其它通道；设为 `false` 时只用当前可用的首条通道 |
| `transport` | `auto` | `auto` / `electron` / `toast` / `balloon` |
| `locale` | `auto` | `auto` / `zh` / `en`，通知文案语言 |
| `dedupeMs` | `1500` | 相同内容去重窗口（毫秒） |
| `appUserModelId` | `com.deepseek.dsh` | 通知来源的应用标识，对应 DSH 桌面版的开始菜单快捷方式 |
| `balloonAppUserModelId` | `true` | 托盘气泡兜底时尝试把该 AUMID 打到 PowerShell 进程上，让来源显示为 DeepSeek Harness |
| `diagnostics` | `true` | 写诊断日志 |
| `logFile` | `$DSH_HOME/windows-notifications.log` | 诊断日志路径 |

## 传输通道

1. `toast`：通过 Windows PowerShell 5.1 发 WinRT Toast。这是 DSH 桌面版实际使用的通道，通知来源显示为 DeepSeek Harness，进入 Windows 通知中心。
2. `electron`：只有当 Host 进程本身能拿到 Electron API 时才可用，会额外支持点击通知把窗口切回前台。
3. `balloon`：前两者不可用时用系统托盘气泡兜底；部分 Windows 版本会把它记进通知中心，部分只显示气泡。气泡由临时 `powershell.exe` 进程持有，默认会先尝试把 DSH 的 AUMID 打到该进程上（`balloonAppUserModelId`），成功时来源显示为 DeepSeek Harness，系统不接受时仍是 Windows PowerShell。

也可以用 `windows_notification` 的 `channel` 参数（`auto` / `electron` / `toast` / `balloon`）对单条通知指定通道，用来对比不同通道的实际效果。

`auto` 按上面的顺序尝试。`appUserModelId` 必须与已安装的开始菜单快捷方式一致，Toast 才会被 Windows 接受；进程没有包标识的机器上 WinRT Toast 会被系统拒绝，此时自动降级并记住该结果。

同一条通知只发送一次：投递在插件内串行执行，最多排队 8 条，超出时丢弃新通知并记 `backlog`，避免会话密集时一次性拉起大量 PowerShell 进程。标题截到 120 字、正文截到 400 字。非 Windows 平台插件仍可加载，但投递返回 `unsupported-platform`。

## 诊断

通知没出现时看 `%USERPROFILE%\.dsh\windows-notifications.log`：

```
2026-11-11T17:33:58.885Z question event
2026-11-11T17:34:02.059Z shown kind=question transport=toast
```

日志只记录事件类型、通道和错误，不记录消息正文；启动时和每 256 行检查一次大小，超过 512 KiB 时轮转成 `.log.1`。也可以用 `windows_notification` 工具发一条测试通知，返回值会说明走了哪个通道。

`ctx.windowsNotifications.status()` 会返回 `platform`、`supported`、`electron`、`locale`、`shown`、`pending`、`toastAvailable`、`lastError` 和 `appUserModelId`。

## 给其它插件使用

Host 上会注册 `ctx.windowsNotifications`：

```js
await ctx.windowsNotifications.notify({ title: '部署完成', body: '测试环境已更新' })
ctx.windowsNotifications.status() // { platform, electron, locale, shown, toastAvailable, ... }
```

## 已知限制

- 通知是否显示最终由系统决定：Windows「请勿打扰」/ 专注助手开启、DSH 的通知被关闭时不会出现横幅。
- 走 Toast 通道时点击通知不会把 DSH 窗口切回前台（没有注册 COM 激活器）；只提醒，不导航。
- 托盘气泡由 `powershell.exe` 显示：是否接受 DSH 的 AUMID 取决于系统，不接受时来源名仍是 Windows PowerShell；日志里的 `balloon aumid hr=` 记录了该尝试的返回值（`0` 表示成功）。
- 插件不感知多台 Host，也不汇总跨设备的会话。
