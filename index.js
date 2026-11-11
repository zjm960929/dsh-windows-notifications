/**
 * Windows notifications for DeepSeek Harness.
 *
 * Raises a native Windows notification when one of these needs the user:
 *   - a turn finishes (completed, failed, or hit the output limit),
 *   - a tool approval is waiting,
 *   - a question is waiting for an answer,
 *   - the account requires sign-in.
 *
 * Transport order:
 *   1. `electron` — the DSH Desktop main process (toast attributed to DSH,
 *      click brings the Harness window back to the foreground).
 *   2. `toast`    — a WinRT toast launched through Windows PowerShell 5.1.
 *   3. `balloon`  — a tray balloon through System.Windows.Forms, used when the
 *      WinRT toast API is unavailable to this process.
 *
 * The Host also exposes `ctx.windowsNotifications` so other plugins can raise
 * their own notification and read the delivery status.
 */

import { spawn } from 'node:child_process'
import { appendFileSync, renameSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

export const name = 'windowsNotifications'

const DEFAULT_APP_USER_MODEL_ID = 'com.deepseek.dsh'
const POWERSHELL = process.env.SystemRoot
  ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
  : 'powershell.exe'
const TRANSPORTS = ['auto', 'electron', 'toast', 'balloon']

const TEXTS = {
  en: {
    turnComplete: 'Task complete',
    turnFailed: 'Task failed',
    turnLimit: 'Output limit reached',
    approval: 'Approval needed',
    question: 'Waiting for your answer',
    signIn: 'Sign-in required',
    signInBody: 'DeepSeek Harness needs you to sign in to your account.',
  },
  zh: {
    turnComplete: '任务完成',
    turnFailed: '任务出错',
    turnLimit: '输出达到上限',
    approval: '需要你的授权',
    question: '等待你的回答',
    signIn: '需要登录',
    signInBody: 'DeepSeek Harness 需要你登录账号后继续。',
  },
}

/**
 * Register the notification bridge.
 * @param {import('@deepseek-ai/cordis').Context} ctx owning fiber context.
 * @param {Record<string, unknown>} config the row's raw configuration.
 */
export function apply(ctx, config) {
  const notifier = new WindowsNotifier(ctx, config)

  const service = {
    /**
     * Raise a notification on behalf of another plugin.
     * @param {{ title?: string, body?: string, kind?: string }} input text to show.
     * @returns {Promise<{ ok: boolean, transport?: string, reason?: string }>} delivery result.
     */
    notify(input) {
      return notifier.send({
        kind: typeof input?.kind === 'string' && input.kind ? input.kind : 'plugin',
        title: typeof input?.title === 'string' ? input.title : '',
        body: typeof input?.body === 'string' ? input.body : '',
      })
    },
    /** @returns {Record<string, unknown>} transport and delivery diagnostics. */
    status() {
      return notifier.status()
    },
  }
  ctx.provide('windowsNotifications', service)

  // An observer must never break the flow it observes: a throw here would
  // reject the session append or the approval waterfall it is watching.
  const observe = (label, operation) => {
    try {
      operation()
    } catch (error) {
      notifier.log(`observer error label=${label} error=${clean(describeError(error))}`)
    }
  }

  // `session/event` is the durable turn boundary: use turn/end rather than
  // polling agent status, so one notification means one finished turn.
  ctx.on('session/event', (session, event) => {
    observe('session', () => notifier.onSessionEvent(session, event))
  }, { global: true })

  // Approval and question requests are waterfalls whose answerers claim the
  // request in their own listener. Registering first (prepend) keeps this
  // observer outside that claim, so it sees the request and then delegates.
  ctx.on('approval/request', (request, next) => {
    observe('approval', () => notifier.onApproval(request))
    return next()
  }, { prepend: true, global: true })

  ctx.on('user-questions/request', (request, next) => {
    observe('question', () => notifier.onQuestion(request))
    return next()
  }, { prepend: true, global: true })

  ctx.on('deepseek-account/model-sign-in-required', () => {
    observe('signin', () => notifier.onSignIn())
  }, { global: true })

  ctx.effect(() => () => notifier.dispose(), 'windows-notifications.lifecycle')
  registerNotificationTool(ctx, notifier)
}

/**
 * Register the model-facing `windows_notification` tool, which lets the agent
 * raise a notification that the automatic triggers would not cover.
 * @param {object} ctx owning context.
 * @param {WindowsNotifier} notifier delivery bridge.
 */
function registerNotificationTool(ctx, notifier) {
  const tools = ctx.get('tools')
  if (!tools || typeof tools.register !== 'function') return

  const definition = {
    name: 'windows_notification',
    description: 'Show a Windows notification to the user, for a heads-up the automatic end-of-turn notice would not cover.',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Notification headline: one short line, no trailing punctuation.',
        },
        body: {
          type: 'string',
          description: 'Supporting line of text; keep it to one or two sentences.',
        },
        channel: {
          type: 'string',
          enum: ['auto', 'electron', 'toast', 'balloon'],
          description: 'Channel for this notification only; omit to use the configured transport.',
        },
      },
      required: ['title'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean', description: 'Whether Windows accepted the notification.' },
          transport: { type: 'string', description: 'Channel that delivered it: electron, toast, or balloon.' },
          reason: { type: 'string', description: 'Why the notification was not delivered.' },
        },
        required: ['ok'],
        additionalProperties: false,
      },
      render(args, value) {
        if (value && value.ok) {
          return [{ type: 'text', text: `Windows notification shown through ${String(value.transport ?? 'the system')}.` }]
        }
        return [{ type: 'text', text: `Windows notification not shown: ${String(value?.reason ?? 'unknown reason')}.` }]
      },
    },
    async execute(args) {
      const title = typeof args?.title === 'string' && args.title.trim() ? args.title.trim() : 'DeepSeek Harness'
      const body = typeof args?.body === 'string' ? args.body : ''
      const channel = TRANSPORTS.includes(args?.channel) ? args.channel : undefined
      const result = await notifier.send({ kind: 'tool', title, body, force: true, transport: channel })
      if (result.ok) return { ok: true, transport: result.transport }
      return { ok: false, reason: String(result.reason ?? 'unavailable') }
    },
  }

  // Register once the tool registry exists; registration is owned by this fiber.
  ctx.effect(() => tools.register(definition), 'windows-notifications.tool')
}

class WindowsNotifier {
  constructor(ctx, rawConfig) {
    this.ctx = ctx
    this.settings = resolveSettings(rawConfig)
    this.electron = loadElectron()
    this.locale = resolveLanguage(this.settings.locale, this.electron)
    this.text = TEXTS[this.locale] ?? TEXTS.en
    this.shown = 0
    this.lastError = null
    this.toastBroken = false
    this.disposed = false
    this.retained = new Set()
    this.recent = new Map()
    this.logFile = resolveLogFile(this.settings)
    this.logWrites = 0
    this.supported = process.platform === 'win32'
    this.pending = 0
    this.chain = Promise.resolve()

    // Align the process identity with the installed Start-menu shortcut so a
    // Windows toast is attributed to DSH instead of an unknown sender.
    if (this.electron) {
      try {
        this.electron.app?.setAppUserModelId?.(this.settings.appUserModelId)
      } catch {
        // Older Electron builds or an already-finalized identity: toasts still
        // work through the shortcut when this call is unsupported.
      }
    }

    rotateLog(this.logFile)
    this.log(`start electron=${Boolean(this.electron)} locale=${this.locale} transport=${this.settings.transport} appId=${clean(this.settings.appUserModelId)}`)
    if (!this.supported) this.log(`unsupported platform=${process.platform}`)
  }

  /**
   * Append one diagnostics line. The log carries event kinds and delivery
   * outcomes only — never message text — and staying unavailable never blocks
   * a notification.
   * @param {string} message text to append without a trailing newline.
   */
  log(message) {
    if (!this.logFile) return
    try {
      appendFileSync(this.logFile, `${new Date().toISOString()} ${message}\n`, 'utf8')
      this.logWrites += 1
      if (this.logWrites >= 256) {
        this.logWrites = 0
        rotateLog(this.logFile)
      }
    } catch {
      // Diagnostics are best effort.
    }
  }

  status() {
    return {
      platform: process.platform,
      supported: this.supported,
      configuredTransport: this.settings.transport,
      electron: Boolean(this.electron),
      locale: this.locale,
      shown: this.shown,
      pending: this.pending,
      toastAvailable: !this.toastBroken,
      lastError: this.lastError,
      appUserModelId: this.settings.appUserModelId,
    }
  }

  onSessionEvent(session, event) {
    if (this.disposed) return
    if (!event || event.type !== 'turn/end') return
    if (!this.settings.turnEnd) {
      this.log('skip kind=turn:end reason=disabled')
      return
    }
    const header = session?.header ?? {}
    const reason = event.data?.reason
    const kind = reason?.kind
    // Delegated children finish constantly; only root sessions interest the user.
    if (header.origin === 'subagent' || header.parentSession) {
      this.log(`turn/end origin=subagent reason=${clean(kind) || 'unknown'} skipped`)
      return
    }
    this.log(`turn/end origin=root reason=${clean(kind) || 'unknown'}`)

    let title
    let detail = ''
    if (kind === 'completed') {
      title = this.text.turnComplete
    } else if (kind === 'error') {
      title = this.text.turnFailed
      detail = truncate(collapse(reason?.error?.message), 160)
    } else if (kind === 'max-tokens') {
      title = this.text.turnLimit
    } else {
      // aborted, interrupted, blocked, forked: no user attention required.
      return
    }

    const label = this.sessionLabel(session)
    let body = label
    if (kind === 'completed' && this.settings.preview) {
      const preview = lastAssistantText(session, this.settings.previewLength)
      if (preview) body = joinLines(body, preview)
    }
    if (detail) body = joinLines(body, detail)

    this.emit({ kind: `turn:${kind}`, title, body })
  }

  onApproval(request) {
    this.log(`approval event tool=${clean(request?.toolName) || 'unknown'}`)
    if (this.disposed) return
    if (!this.settings.approval) {
      this.log('skip kind=approval reason=disabled')
      return
    }
    const session = this.sessionOf(request?.agent)
    const detail = pickLocalized(request?.displayReason, this.locale)
      || clean(request?.reason)
      || clean(request?.toolName)
    this.emit({
      kind: 'approval',
      title: this.text.approval,
      body: joinLines(this.sessionLabel(session), truncate(detail, 160)),
    })
  }

  onQuestion(request) {
    this.log('question event')
    if (this.disposed) return
    if (!this.settings.question) {
      this.log('skip kind=question reason=disabled')
      return
    }
    const questions = Array.isArray(request?.questions) ? request.questions : []
    const first = questions[0]
    const detail = pickLocalized(first?.intent?.display?.question, this.locale)
      || clean(first?.question)
    this.emit({
      kind: 'question',
      title: this.text.question,
      body: joinLines(this.sessionLabel(this.sessionOf(request?.agent)), truncate(detail, 160)),
    })
  }

  onSignIn() {
    if (this.disposed) return
    if (!this.settings.signIn) {
      this.log('skip kind=signin reason=disabled')
      return
    }
    this.emit({ kind: 'signin', title: this.text.signIn, body: this.text.signInBody })
  }

  emit(payload) {
    void this.send(payload).catch((error) => {
      this.log(`skip kind=${payload?.kind ?? 'notice'} reason=error ${clean(describeError(error))}`)
    })
  }

  async send(payload) {
    if (this.disposed) return { ok: false, reason: 'disposed' }
    const kind = payload?.kind ?? 'notice'
    const title = truncate(clean(payload?.title), 120)
    // Windows truncates long toast bodies anyway; bounding them keeps the
    // PowerShell command line and the notification readable.
    const body = truncate(String(payload?.body ?? '').trim(), 400)
    if (!title) return { ok: false, reason: 'title-required' }

    if (!payload?.force) {
      const key = `${kind}\u0000${title}\u0000${body}`
      const now = Date.now()
      const previous = this.recent.get(key)
      if (previous !== undefined && now - previous < this.settings.dedupeMs) {
        this.log(`skip kind=${kind} reason=duplicate`)
        return { ok: false, reason: 'duplicate' }
      }
      this.recent.set(key, now)
      if (this.recent.size > 64) {
        const oldest = this.recent.keys().next()
        if (!oldest.done) this.recent.delete(oldest.value)
      }

      if (this.settings.skipWhenFocused && isHarnessFocused(this.electron)) {
        this.log(`skip kind=${kind} reason=focused`)
        return { ok: false, reason: 'focused' }
      }
    }
    return this.deliver({ title, body, kind, transport: payload?.transport })
  }

  /**
   * Queue one delivery so a burst cannot spawn a PowerShell process per event.
   * @param {{ title: string, body: string, kind: string }} payload notification.
   * @returns {Promise<{ ok: boolean, transport?: string, reason?: string }>} result.
   */
  deliver(payload) {
    if (!this.supported) {
      this.log(`skip kind=${payload.kind} reason=unsupported-platform`)
      return Promise.resolve({ ok: false, reason: 'unsupported-platform' })
    }
    if (this.pending >= 8) {
      this.log(`skip kind=${payload.kind} reason=backlog`)
      return Promise.resolve({ ok: false, reason: 'backlog' })
    }
    this.pending += 1
    const run = this.chain
      .then(() => this.deliverNow(payload))
      .catch((error) => ({ ok: false, reason: describeError(error) }))
    this.chain = run
    run.then(() => { this.pending -= 1 })
    return run
  }

  /**
   * Decide the transport order for one delivery.
   * @param {string} [mode] configured transport, or the per-call override.
   * @returns {string[]} usable transports, most preferred first.
   */
  planTransports(mode = this.settings.transport) {
    const order = ['electron', 'toast', 'balloon']
    const usable = (transport) => {
      if (transport === 'electron') return Boolean(this.electron)
      if (transport === 'toast') return !this.toastBroken
      return true
    }
    let planned
    if (mode === 'auto') {
      planned = this.settings.fallback ? order : [this.electron ? 'electron' : 'toast']
    } else if (this.settings.fallback) {
      planned = [mode, ...order.filter((transport) => transport !== mode)]
    } else {
      planned = [mode]
    }
    return planned.filter(usable)
  }

  async deliverNow(payload) {
    const transports = this.planTransports(payload.transport)
    if (transports.length === 0) {
      this.log(`skip kind=${payload.kind} reason=no-transport`)
      return { ok: false, reason: 'no-transport' }
    }
    for (const transport of transports) {
      let result
      if (transport === 'electron') {
        result = await this.showElectron(payload)
      } else if (transport === 'toast') {
        result = await this.showToast(payload)
        if (result.broken) this.toastBroken = true
      } else {
        result = await this.showBalloon(payload)
      }
      if (result.ok) {
        this.shown += 1
        this.lastError = null
        this.log(`shown kind=${payload.kind} transport=${transport}`)
        return { ok: true, transport }
      }
      this.lastError = `${transport}: ${describeError(result.error)}`
      this.log(`failed kind=${payload.kind} transport=${transport} error=${clean(this.lastError)}`)
    }
    return { ok: false, reason: this.lastError ?? 'unavailable' }
  }

  showElectron(payload) {
    if (!this.electron || typeof this.electron.Notification !== 'function') {
      return Promise.resolve({ ok: false, error: 'electron-unavailable' })
    }
    return new Promise((resolve) => {
      let notification
      try {
        notification = new this.electron.Notification({
          title: payload.title,
          body: payload.body,
          silent: this.settings.silent,
        })
      } catch (error) {
        resolve({ ok: false, error })
        return
      }

      const retained = this.retained
      retained.add(notification)
      let settled = false
      const finish = (result) => {
        if (settled) return
        settled = true
        resolve(result)
      }
      const release = () => { retained.delete(notification) }

      try {
        notification.on('show', () => finish({ ok: true }))
        notification.on('failed', (_event, error) => {
          release()
          finish({ ok: false, error: error ?? 'electron-notification-failed' })
        })
        notification.on('close', release)
        notification.on('click', () => {
          focusHarnessWindow(this.electron)
          release()
        })
        notification.show()
        // Not every Windows path reports 'show'; absence of 'failed' is the
        // only signal we can rely on.
        afterDelay(this.ctx, () => finish({ ok: true }), 1500)
        afterDelay(this.ctx, release, 60_000)
      } catch (error) {
        release()
        finish({ ok: false, error })
      }
    })
  }

  async showToast(payload) {
    const script = buildToastScript({
      title: payload.title,
      body: singleLine(payload.body),
      appId: this.settings.appUserModelId,
      silent: this.settings.silent,
    })
    const result = await runPowerShell(script, 15_000)
    if (result.ok) return { ok: true }
    const report = `${result.stderr ?? ''}\n${result.stdout ?? ''}`
    const broken = /package identity|0x80073D54|no package|not registered|0x80040154/i.test(report)
    return {
      ok: false,
      broken,
      error: report.trim().slice(0, 400) || `powershell exit ${result.code}`,
    }
  }

  async showBalloon(payload) {
    const script = buildBalloonScript({
      title: payload.title,
      body: singleLine(payload.body),
      icon: process.execPath,
      appId: this.settings.appUserModelId,
      explicitAumid: this.settings.balloonAppUserModelId,
    })
    // Compiling the AUMID helper can take a couple of seconds on a cold start.
    const result = await runPowerShell(script, 20_000)
    const marker = /(?:^|[\r\n])AUMID=([^\r\n]*)/.exec(result.stdout ?? '')
    if (marker) this.log(`balloon aumid hr=${clean(marker[1])}`)
    if (result.ok) return { ok: true }
    return {
      ok: false,
      error: String(result.stderr ?? '').trim().slice(0, 400) || `powershell exit ${result.code}`,
    }
  }

  sessionOf(agent) {
    if (!agent || typeof agent.id !== 'string') return undefined
    try {
      return this.ctx.get('sessions')?.get?.(agent.id)
    } catch {
      return undefined
    }
  }

  sessionLabel(session) {
    if (!session) return ''
    try {
      const snapshot = this.ctx.get('sessionTitle')?.get?.(session)
      if (snapshot && typeof snapshot.title === 'string' && snapshot.title.trim()) {
        return snapshot.title.trim()
      }
    } catch {
      // A title fold is optional; fall back to the working directory.
    }
    const cwd = session.header?.cwd
    if (typeof cwd === 'string' && cwd) return basename(cwd)
    return ''
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    for (const notification of this.retained) {
      try { notification.close?.() } catch { /* already gone */ }
    }
    this.retained.clear()
    this.recent.clear()
  }
}

function resolveSettings(raw) {
  const config = raw && typeof raw === 'object' ? raw : {}
  const flag = (key, fallback) => (typeof config[key] === 'boolean' ? config[key] : fallback)
  const count = (key, fallback, min, max) => {
    const value = Number(config[key])
    if (!Number.isFinite(value)) return fallback
    return Math.min(max, Math.max(min, Math.round(value)))
  }
  const choice = (key, allowed, fallback) => (allowed.includes(config[key]) ? config[key] : fallback)
  const appUserModelId = typeof config.appUserModelId === 'string' && config.appUserModelId.trim()
    ? config.appUserModelId.trim()
    : DEFAULT_APP_USER_MODEL_ID
  return {
    turnEnd: flag('turnEnd', true),
    approval: flag('approval', true),
    question: flag('question', true),
    signIn: flag('signIn', true),
    preview: flag('preview', true),
    previewLength: count('previewLength', 120, 0, 400),
    skipWhenFocused: flag('skipWhenFocused', false),
    silent: flag('silent', false),
    fallback: flag('fallback', true),
    transport: choice('transport', TRANSPORTS, 'auto'),
    locale: choice('locale', ['auto', 'zh', 'en'], 'auto'),
    dedupeMs: count('dedupeMs', 1500, 0, 60_000),
    diagnostics: flag('diagnostics', true),
    logFile: typeof config.logFile === 'string' ? config.logFile.trim() : '',
    appUserModelId,
    balloonAppUserModelId: flag('balloonAppUserModelId', true),
  }
}

/**
 * Resolve the diagnostics log path: explicit configuration, else
 * `$DSH_HOME/windows-notifications.log`.
 * @param {ReturnType<typeof resolveSettings>} settings resolved configuration.
 * @returns {string | null} absolute path, or null when diagnostics are off.
 */
function resolveLogFile(settings) {
  if (!settings.diagnostics) return null
  if (settings.logFile) return settings.logFile
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'windows-notifications.log')
}

/**
 * Keep the diagnostics log bounded by renaming it once it passes 512 KiB.
 * @param {string | null} file log path.
 */
function rotateLog(file) {
  if (!file) return
  try {
    if (statSync(file).size > 512 * 1024) renameSync(file, `${file}.1`)
  } catch {
    // Missing file or unwritable directory: nothing to rotate.
  }
}

function loadElectron() {
  if (!process.versions?.electron) return null
  try {
    const require = createRequire(import.meta.url)
    const electron = require('electron')
    if (electron && typeof electron.Notification === 'function') return electron
  } catch {
    // Running outside the Electron main process: use a PowerShell transport.
  }
  return null
}

function resolveLanguage(setting, electron) {
  if (setting === 'zh' || setting === 'en') return setting
  let locale = ''
  try {
    locale = electron?.app?.getLocale?.() ?? ''
  } catch {
    locale = ''
  }
  if (!locale) {
    try {
      locale = Intl.DateTimeFormat().resolvedOptions().locale
    } catch {
      locale = 'en'
    }
  }
  return /^zh/i.test(locale) ? 'zh' : 'en'
}

function isHarnessFocused(electron) {
  if (!electron) return false
  try {
    const windows = electron.BrowserWindow?.getAllWindows?.() ?? []
    return windows.some(win => {
      if (!win || win.isDestroyed?.()) return false
      return win.isVisible?.() !== false && win.isFocused?.() === true
    })
  } catch {
    return false
  }
}

function focusHarnessWindow(electron) {
  try {
    const windows = electron.BrowserWindow?.getAllWindows?.() ?? []
    for (const win of windows) {
      if (!win || win.isDestroyed?.()) continue
      if (win.isMinimized?.()) win.restore()
      if (win.isVisible?.() === false) win.show()
      win.focus?.()
      return true
    }
  } catch {
    // Focusing is best effort; the notification itself already succeeded.
  }
  return false
}

/**
 * Run a callback later, through the fiber-owned timer when the timer service is
 * present so it is cleared when the plugin unloads.
 * @param {object} ctx owning context.
 * @param {() => void} callback work to run.
 * @param {number} delay milliseconds.
 * @returns {() => void} cancel function.
 */
function afterDelay(ctx, callback, delay) {
  try {
    if (ctx && typeof ctx.timeout === 'function') return ctx.timeout(callback, delay)
  } catch {
    // Fall through to a plain timer.
  }
  const timer = setTimeout(callback, delay)
  timer.unref?.()
  return () => clearTimeout(timer)
}

function pickLocalized(value, locale) {  if (!value || typeof value !== 'object') return ''
  const language = String(locale).split('-')[0]
  for (const key of [locale, language, 'en']) {
    if (key && typeof value[key] === 'string' && value[key].trim()) return value[key].trim()
  }
  for (const key of Object.keys(value)) {
    if (typeof value[key] === 'string' && value[key].trim()) return value[key].trim()
  }
  return ''
}

function lastAssistantText(session, limit) {
  if (!limit) return ''
  try {
    const seq = Number(session?.seq ?? 0)
    const events = session?.snapshotEvents?.(Math.max(0, seq - 80)) ?? []
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index]
      if (!event || event.type !== 'assistant/message') continue
      const text = messageText(event.data?.message)
      if (text) return truncate(collapse(text), limit)
    }
  } catch {
    // A preview is optional; never let it break the notification.
  }
  return ''
}

function messageText(message) {
  const blocks = message?.content ?? message?.blocks
  if (typeof blocks === 'string') return blocks
  if (!Array.isArray(blocks)) return ''
  const parts = []
  for (const block of blocks) {
    if (block && block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join(' ')
}

function buildToastScript({ title, body, appId, silent }) {
  const audio = silent ? "$audio = '<audio silent=\"true\" />'" : "$audio = ''"
  return [
    "$ErrorActionPreference = 'Stop'",
    `$title = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${base64(title)}'))`,
    `$body = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${base64(body)}'))`,
    `$appId = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${base64(appId)}'))`,
    '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null',
    '[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType=WindowsRuntime] | Out-Null',
    '$first = [System.Security.SecurityElement]::Escape($title)',
    '$second = [System.Security.SecurityElement]::Escape($body)',
    "$text = '<text>' + $first + '</text>'",
    "if ($second) { $text = $text + '<text>' + $second + '</text>' }",
    audio,
    "$xml = '<toast><visual><binding template=\"ToastGeneric\">' + $text + '</binding></visual>' + $audio + '</toast>'",
    '$doc = New-Object Windows.Data.Xml.Dom.XmlDocument',
    '$doc.LoadXml($xml)',
    '$toast = New-Object Windows.UI.Notifications.ToastNotification $doc',
    '[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)',
    "Write-Output 'OK'",
  ].join('\r\n')
}

function buildBalloonScript({ title, body, icon, appId, explicitAumid }) {
  const lines = [
    "$ErrorActionPreference = 'Stop'",
    `$title = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${base64(title)}'))`,
    `$body = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${base64(body)}'))`,
    `$iconPath = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${base64(icon)}'))`,
  ]

  // A tray balloon is attributed to the process that owns the icon, so try to
  // wear DSH's AppUserModelID before the icon is registered. The HRESULT is
  // printed for diagnostics; a failure never blocks the balloon.
  if (explicitAumid) {
    lines.push(
      `$appId = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${base64(appId)}'))`,
      '$signature = @"',
      'using System.Runtime.InteropServices;',
      'public static class DshAumid {',
      '  [DllImport("shell32.dll", CharSet = CharSet.Unicode)]',
      '  public static extern int SetCurrentProcessExplicitAppUserModelID(string appId);',
      '}',
      '"@',
      'try {',
      '  Add-Type -TypeDefinition $signature -ErrorAction Stop',
      '  $hr = [DshAumid]::SetCurrentProcessExplicitAppUserModelID($appId)',
      '  Write-Output ("AUMID=" + $hr)',
      '} catch {',
      '  Write-Output "AUMID=error"',
      '}',
    )
  }

  lines.push(
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    '$balloon = New-Object System.Windows.Forms.NotifyIcon',
    '$handle = $null',
    'if ($iconPath) { try { $handle = [System.Drawing.Icon]::ExtractAssociatedIcon($iconPath) } catch { $handle = $null } }',
    'if ($handle -ne $null) { $balloon.Icon = $handle } else { $balloon.Icon = [System.Drawing.SystemIcons]::Information }',
    "$balloon.Text = 'DeepSeek Harness'",
    '$balloon.Visible = $true',
    '$balloon.BalloonTipTitle = $title',
    '$balloon.BalloonTipText = $body',
    "$balloon.BalloonTipIcon = 'Info'",
    '$balloon.ShowBalloonTip(5000)',
    "Write-Output 'OK'",
    'Start-Sleep -Milliseconds 6000',
    '$balloon.Dispose()',
  )

  return lines.join('\r\n')
}

function runPowerShell(script, timeoutMs) {
  return new Promise((resolve) => {
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    let child
    try {
      child = spawn(POWERSHELL, [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-WindowStyle',
        'Hidden',
        '-EncodedCommand',
        encoded,
      ], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      resolve({ ok: false, stderr: describeError(error) })
      return
    }

    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      resolve(result)
    }
    const timer = setTimeout(() => {
      try { child.kill() } catch { /* already exited */ }
      finish({ ok: false, stderr: stderr || 'powershell timed out' })
    }, timeoutMs)

    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
      if (hasOkLine(stdout)) {
        clearTimeout(timer)
        finish({ ok: true, stdout })
        try { child.unref() } catch { /* already detached */ }
      }
    })
    child.stderr?.on('data', (chunk) => { stderr += String(chunk) })
    child.on('error', (error) => {
      clearTimeout(timer)
      finish({ ok: false, stderr: describeError(error) })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (settled) return
      finish({ ok: code === 0 && hasOkLine(stdout), stdout, stderr, code })
    })
    try { child.unref() } catch { /* already detached */ }
  })
}

/**
 * Whether a script printed the success marker on its own line.
 * @param {string} text captured standard output.
 * @returns {boolean} true when the marker line is present.
 */
function hasOkLine(text) {
  return /(?:^|[\r\n])OK(?:[\r\n]|$)/.test(text)
}

function base64(text) {
  return Buffer.from(String(text ?? ''), 'utf8').toString('base64')
}

function clean(text) {
  return collapse(text)
}

/**
 * Collapse arbitrary text into one trimmed line.
 * Control characters are removed because XML 1.0 forbids them: one stray
 * `\u0001` in a model-supplied body would make the toast XML unparsable.
 * @param {unknown} text raw value.
 * @returns {string} single-line text.
 */
function collapse(text) {
  return String(text ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function singleLine(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\s*\n+\s*/g, ' · ')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function joinLines(...parts) {
  return parts.map(part => String(part ?? '').trim()).filter(Boolean).join('\n')
}

function truncate(text, max) {
  const value = String(text ?? '')
  if (!max || value.length <= max) return value
  if (max <= 1) return value.slice(0, max)
  let end = max - 1
  // Never cut between the two halves of a surrogate pair: the orphaned half is
  // not valid XML and would make the toast XML unparsable.
  const unit = value.charCodeAt(end - 1)
  if (unit >= 0xd800 && unit <= 0xdbff) end -= 1
  return `${value.slice(0, end)}…`
}

function describeError(error) {
  if (!error) return 'unknown error'
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}
