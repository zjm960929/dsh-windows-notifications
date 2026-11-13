# dsh-windows-notifications

**DeepSeek Harness 的 Windows 系统通知插件 —— 会话需要你时提醒你，每种通知都能在插件页单独开关。**

[![npm version](https://img.shields.io/npm/v/dsh-windows-notifications.svg)](https://www.npmjs.com/package/dsh-windows-notifications)
[![npm downloads](https://img.shields.io/npm/dm/dsh-windows-notifications.svg)](https://www.npmjs.com/package/dsh-windows-notifications)
[![license](https://img.shields.io/npm/l/dsh-windows-notifications.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-339933)](https://nodejs.org/)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-0.2.x-4F46E5)](https://github.com/deepseek-ai/deepseek-harness)

[English](README.md) | 中文

`dsh-windows-notifications` 是 DeepSeek Harness 的 Host 插件：一轮对话结束、工具调用等待授权、提问等待回答，或账号需要重新登录时，它会弹出 Windows 系统通知。每种通知在插件详情页都有独立开关，不需要修改配置文件就能关掉某一类提醒。

它适合开着长任务、然后去看别的事情的人：通知进入 Windows 通知中心，来源显示为 DeepSeek Harness，点开通知不会抢走当前焦点。

> **来源：** DeepSeek Harness · **主要通道：** Windows Toast · **范围：** 仅根会话

## 目录

- [功能](#功能)
- [环境要求](#环境要求)
- [安装](#安装)
- [使用](#使用)
- [通知类型](#通知类型)
- [设置](#设置)
- [投递通道](#投递通道)
- [诊断](#诊断)
- [手动通知工具](#手动通知工具)
- [工作原理](#工作原理)
- [安全与限制](#安全与限制)
- [开发](#开发)
- [发布](#发布)
- [参与贡献](#参与贡献)
- [许可](#许可)

## 功能

- **四类可开关的通知** —— 任务完成、等待授权、等待回答、需要登录，在插件详情页各有一个开关。
- **保存即生效** —— 切换开关会写入 profile 配置并重载插件，不需要重启 DSH。
- **原生 Windows 通知** —— 真正进入通知中心的 Toast，来源显示为 DeepSeek Harness，可静音。
- **不打扰子代理** —— 只对根会话发通知，子代理的每一轮结束不会弹窗。
- **内容带上下文** —— 完成通知带会话标题和回答开头；出错通知带错误信息。
- **三条投递通道** —— Windows PowerShell 的 WinRT Toast、Host 可用时的 Electron 通知、以及最后的托盘气泡兜底。
- **中英双语** —— 通知文案和设置卡片跟随 DSH 当前语言。
- **可诊断** —— 一个日志文件记录事件类型、通道和错误，不记录消息正文。
- **额外的手动工具** —— 模型可以调用 `windows_notification` 主动发一条自动触发覆盖不到的提醒。
- **无运行时依赖** —— 只用 Node.js 内置模块和 Windows 自带的 PowerShell 5.1。

## 环境要求

- **DeepSeek Harness** `0.2.x`（桌面版或 Web 版）。当前验证目标是桌面版 `0.2.2-rc.1`。
- **Windows 10 或 11**，且能调用 PowerShell 5.1（`powershell.exe`）。
- **Node.js** `22+`（Host 侧）；浏览器侧运行在 DSH 页面里。
- 无需额外运行时依赖。

## 安装

### 从 DSH 插件页安装

打开 DSH 的 **插件** 页，搜索 `dsh-windows-notifications` 并安装；安装后刷新一次页面，让浏览器侧模块加载。

### 从命令行安装

```bash
dsh plugin --profile desktop add dsh-windows-notifications
```

`--profile` 用你实际运行的 profile，例如 `desktop`。

### 从本地构建安装

```bash
pnpm pack
dsh plugin --profile desktop add ./dsh-windows-notifications-<version>.tgz
```

安装 tarball 是复制包、不是软链接；它会临时替换同名 npm 安装，测完恢复正式版即可。

## 使用

1. 打开 **设置 → 插件**，选中 **DSH Notification for Windows**。
2. 插件页会显示 **通知类型** 区域，每种类型一个开关。
3. 切换后继续工作即可：开关立即保存，插件随即重载并采用新值。

日常控制用开关就够了；下面配置表里的键用于高级选项或无界面的 profile。

## 通知类型

| 场景 | 标题 | 内容 |
| --- | --- | --- |
| 一轮对话正常结束（`turn/end` = `completed`） | 任务完成 | 会话标题 + 回答开头 |
| 一轮对话出错（`error`） | 任务出错 | 会话标题 + 错误信息 |
| 输出达到上限（`max-tokens`） | 输出达到上限 | 会话标题 |
| 工具调用等待授权 | 需要你的授权 | 会话标题 + 授权原因（跟随界面语言） |
| 提问等待回答 | 等待你的回答 | 会话标题 + 问题 |
| 账号需要登录 | 需要登录 | 登录提示 |
| 模型调用 `windows_notification` | 模型给定的标题 | 模型给定的正文 |

用户主动中止或被打断的轮次不发通知；相同内容在 1.5 秒内去重。

## 设置

四个开关对应前四个键，其余键也可以直接写进配置：

```yaml
- id: windows-notifications
  name: dsh-windows-notifications
  config:
    turnEnd: true
    approval: true
    question: false
    signIn: true
```

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `turnEnd` | `true` | 一轮结束、出错或达到输出上限时通知 |
| `approval` | `true` | 等待工具授权时通知 |
| `question` | `true` | 等待回答时通知 |
| `signIn` | `true` | 需要登录时通知 |
| `preview` | `true` | 完成通知附带回答开头 |
| `previewLength` | `120` | 摘要字符上限（0–400） |
| `skipWhenFocused` | `false` | DSH 窗口在前台时不提醒；仅 Host 能读到 Electron 窗口时生效 |
| `silent` | `false` | 静音 |
| `fallback` | `true` | 首选通道失败时尝试其余通道 |
| `transport` | `auto` | `auto` / `electron` / `toast` / `balloon` |
| `locale` | `auto` | `auto` / `zh` / `en` 通知文案语言 |
| `dedupeMs` | `1500` | 相同通知的去重窗口 |
| `appUserModelId` | `com.deepseek.dsh` | 通知来源使用的 Windows 应用标识 |
| `balloonAppUserModelId` | `true` | 托盘气泡兜底时也使用同一标识 |
| `diagnostics` | `true` | 写诊断日志 |
| `logFile` | `$DSH_HOME/windows-notifications.log` | 诊断日志路径 |

## 投递通道

1. **`toast`** —— 由 Windows PowerShell 5.1 发起的 WinRT Toast，也是桌面版实际使用的通道：通知来源显示为 DeepSeek Harness，并进入通知中心。
2. **`electron`** —— 仅当 Host 自身能拿到 Electron API 时使用；点击通知可把窗口切回前台。
3. **`balloon`** —— 前两者都失败时的托盘气泡兜底。它会借用 DSH 的应用标识，Windows 接受时来源名仍是 DeepSeek Harness。

`auto` 按上述顺序尝试。应用标识必须与已安装的开始菜单快捷方式一致，否则 Windows 会拒绝 Toast；插件会自动降级并记住结果。

## 诊断

通知没出现时查看 `%USERPROFILE%\.dsh\windows-notifications.log`：

```text
2026-11-11T17:33:58.885Z question event
2026-11-11T17:34:02.059Z shown kind=question transport=toast
```

日志只记录事件类型、通道和错误，不记录消息正文；超过 512 KiB 轮转为 `windows-notifications.log.1`。被开关关掉的类型会记录成 `skip kind=question reason=disabled`。

## 手动通知工具

Host 注册了 `windows_notification` 工具，模型可以主动发一条自动触发覆盖不到的提醒：

```json
{ "title": "构建完成", "body": "Windows 包已签名。", "channel": "toast" }
```

`channel` 可选（`auto` / `electron` / `toast` / `balloon`）。工具结果会说明实际使用的通道，或没发出去的原因。

## 工作原理

插件分 Host 和浏览器两半：

```text
┌────────────────────────────────────┐
│ 插件页（React 开关）               │
│ 完成 / 授权 / 提问 / 登录          │
└───────────────┬────────────────────┘
                │ 仅 owner 可用的 HTTP
┌───────────────▼────────────────────┐
│ Host 接口                          │
│ /windows-notifications/api/config  │
│ 读取 + 通过 configEditor 保存      │
└───────────────┬────────────────────┘
                │ PowerShell 5.1
┌───────────────▼────────────────────┐
│ Toast / Electron / 托盘气泡        │
└────────────────────────────────────┘
```

- 浏览器模块把卡片注册进 `plugins.bundle.config` 槽位，`key` 是包名，所以只渲染在本插件页面。
- Host 侧在 `connection.admit()` 和 owner 校验之后提供 `GET`/`POST /windows-notifications/api/config`；保存走 DSH 的 `configEditor`，它会改写 profile 中的配置行并重载插件。
- 通知投递在插件内串行排队，最多积压 8 条，事件密集时不会一次拉起大量 PowerShell 进程。
- 没有构建步骤；`index.js` 和 `client.js` 就是随包发布的文件。

## 安全与限制

### 安全

- 所有设置请求都先过 `connection.admit()` 并要求 owner 身份；未认证请求返回 `403`，不会尝试保存。
- 页面只能提交四个类型开关；未知键和非布尔值会被忽略。
- HTTP 路由只在同源、已有 DSH 服务上注册，插件不额外开端口。
- 插件不保存消息正文；诊断日志只记录事件类型和投递结果。

### 限制

- 通知是否显示最终由 Windows 决定：请勿打扰、专注助手或关闭该应用通知都会抑制横幅。
- 点击 Toast 不会把 DSH 窗口切回前台，因为插件没有注册 COM 激活器。
- Host 暴露不出 Electron 窗口时，`skipWhenFocused` 不生效（目前的桌面版就是这种情况）。
- 托盘气泡的来源由系统归属；显式应用标识被拒绝时，来源仍显示 Windows PowerShell。
- 插件不汇总多台 Host 或多设备上的会话。
- 内部 HTTP 路由可能随小版本调整。

## 开发

### 仓库结构

```text
index.js            Host 侧：事件、投递、设置接口、工具
client.js           浏览器侧：通知类型开关
cordis.patch.yml    插入 DSH profile 的 bundle 行
locale/
  en.json           插件页显示元数据
  zh.json
icon.svg            插件图标
README.md           英文文档
README.zh.md        中文文档
```

没有构建步骤。改 `index.js` 后插件会重载；改 `client.js` 后刷新页面即可。

### 检查

```bash
node --check index.js
node --check client.js
```

### 本地打包冒烟测试

```bash
pnpm pack
dsh plugin --profile <profile> add ./dsh-windows-notifications-<version>.tgz
```

tarball 安装会替换同名 npm 安装；测完恢复正式版。

## 发布

推送 `v*` 标签时由 `.github/workflows/publish.yml` 发布：先校验标签与 `package.json` 版本一致，再用仓库的 `NPM_TOKEN` 以 npm provenance 发布。

```bash
npm version patch
git push --follow-tags
```

不要在本地手动 `npm publish`，交给 workflow。

## 参与贡献

欢迎提 Issue 和 PR。一次只改一个插件，先跑上面的检查；行为或界面文案变化时，同时更新 `README.md` 与 `README.zh.md`。

## 许可

[MIT](LICENSE)
