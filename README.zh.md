# DSH Notification for Windows

[English](README.md) | 中文

DeepSeek Harness 的 Host 插件：会话需要你时弹出 Windows 系统通知，并且可以在插件详情页为每种通知类型单独开关，不必修改配置文件。

## 通知类型

| 场景 | 标题 | 内容 |
| --- | --- | --- |
| 一轮对话正常结束（`turn/end` = `completed`） | 任务完成 | 会话标题 + 回答开头 |
| 一轮对话出错（`error`） | 任务出错 | 会话标题 + 错误信息 |
| 输出达到上限（`max-tokens`） | 输出达到上限 | 会话标题 |
| 工具调用等待授权 | 需要你的授权 | 会话标题 + 授权原因（跟随界面语言） |
| 提问等待回答 | 等待你的回答 | 会话标题 + 问题摘要 |
| 账号需要登录 | 需要登录 | 登录提示 |
| 模型调用 `windows_notification` | 模型给定的标题 | 模型给定的正文 |

只对根会话发通知：子代理的每一轮结束不会打扰你；用户主动中止的轮次也不发。相同内容的通知在 1.5 秒内去重。

## 开关每种通知

打开插件详情页（设置 → 插件 → DSH Notification for Windows），页面会为每种类型显示一个开关：任务完成、等待授权、等待回答、需要登录。切换开关会把值写进 profile 配置并重载插件，立即生效。

不用界面时也可以直接配置：

```yaml
- id: windows-notifications
  name: dsh-windows-notifications
  config:
    turnEnd: false
    approval: true
    question: true
    signIn: false
```

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `turnEnd` | `true` | 一轮结束、出错或达到输出上限时通知 |
| `approval` | `true` | 等待工具授权时通知 |
| `question` | `true` | 等待回答时通知 |
| `signIn` | `true` | 需要登录时通知 |
| `preview` | `true` | 完成通知附带回答开头 |
| `previewLength` | `120` | 摘要字符上限（0–400） |
| `skipWhenFocused` | `false` | DSH 窗口在前台时不通知（仅 Host 能读到 Electron 窗口时生效） |
| `silent` | `false` | 静音 |
| `fallback` | `true` | 首选通道失败时尝试其余通道 |
| `transport` | `auto` | `auto` / `electron` / `toast` / `balloon` |
| `locale` | `auto` | `auto` / `zh` / `en` 通知文案语言 |
| `dedupeMs` | `1500` | 相同通知的去重窗口 |
| `appUserModelId` | `com.deepseek.dsh` | 通知来源使用的 Windows 应用标识 |
| `balloonAppUserModelId` | `true` | 托盘气泡兜底时也使用同一标识 |
| `diagnostics` | `true` | 写诊断日志 |
| `logFile` | `$DSH_HOME/windows-notifications.log` | 诊断日志路径 |

## 安装

在 DSH 插件管理器里安装，或：

```sh
dsh plugin add dsh-windows-notifications
```

## 投递通道

1. `toast` —— 通过 Windows PowerShell 5.1 发 WinRT Toast，DSH 桌面版实际使用的通道：通知来源显示为 DeepSeek Harness，并进入 Windows 通知中心。
2. `electron` —— 仅当 Host 能拿到 Electron API 时使用，点击通知可把窗口切回前台。
3. `balloon` —— 前两者不可用时的托盘气泡兜底，会借用 DSH 的应用标识，让来源名尽量保持 DeepSeek Harness。

`auto` 按上述顺序尝试。应用标识必须与已安装的开始菜单快捷方式一致，否则 Windows 会拒绝 Toast；插件会自动降级并记住该结果。

## 诊断

通知没出现时查看 `%USERPROFILE%\.dsh\windows-notifications.log`：

```
2026-11-11T17:33:58.885Z question event
2026-11-11T17:34:02.059Z shown kind=question transport=toast
```

日志只记录事件类型、通道和错误，不记录消息正文；超过 512 KiB 时轮转。也可以用 `windows_notification` 工具手动发送一条测试通知，返回值会说明用了哪条通道。

## 限制

- 通知是否显示最终由 Windows 决定：请勿打扰、专注助手或关闭该应用通知都会抑制横幅。
- 点击 Toast 不会把 DSH 窗口切回前台（没有注册 COM 激活器）。
- Host 暴露不出 Electron 窗口时，`skipWhenFocused` 不生效。
- 托盘气泡的来源由系统归属；显式应用标识被拒绝时，来源仍显示 Windows PowerShell。
- 插件不汇总多台 Host / 多设备上的会话。
