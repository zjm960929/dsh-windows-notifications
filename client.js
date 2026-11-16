/**
 * Client half of DSH Notification for Windows.
 *
 * Renders the per-type switches on the plugin's own page, under the bundle
 * configuration slot, and persists them through the Host settings route.
 */

window.__ModuleLoader__.load({
  id: 'dsh-windows-notifications',

  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'dsh-windows-notifications'
    const API = '/windows-notifications/api'
    const FLAGS = ['turnEnd', 'approval', 'question', 'signIn']

    const zh = {
      title: '通知类型',
      hint: '选择哪些事件弹出 Windows 通知；保存后立即生效。',
      turnEnd: '任务完成',
      turnEndHint: '任意会话的一轮对话结束时提醒。',
      approval: '等待授权',
      approvalHint: '工具调用等待你授权时提醒。',
      question: '等待回答',
      questionHint: '有提问等待你回答时提醒。',
      signIn: '需要登录',
      signInHint: '账号需要重新登录时提醒。',
      updateCheck: '更新提示',
      updateCheckHint: '启动时检查 npm 上的新版本并提醒。',
      repeatReminder: '重复提醒',
      repeatReminderHint: '等待授权、等待回答或任务完成时，按间隔重复提醒。',
      interval: '提醒间隔',
      intervalHint: '拖动滑块设置提醒间隔。',
      minutes: '分钟',
      save: '保存',
      on: '开',
      off: '关',
      loading: '正在读取设置…',
      loadFailed: '读取设置失败。',
      saveFailed: '保存失败，请重试。',
      retry: '重试',
    }

    const en = {
      title: 'Notification types',
      hint: 'Choose which events raise a Windows notification. Changes apply immediately.',
      turnEnd: 'Turn finished',
      turnEndHint: 'A turn in any session finishes.',
      approval: 'Approval needed',
      approvalHint: 'A tool call waits for your permission.',
      question: 'Question waiting',
      questionHint: 'A question waits for your answer.',
      signIn: 'Sign-in required',
      signInHint: 'The account needs you to sign in again.',
      updateCheck: 'Update alerts',
      updateCheckHint: 'Check npm for a newer version at startup and notify you.',
      repeatReminder: 'Repeat reminders',
      repeatReminderHint: 'Remind you at the interval while an approval, a question, or a finished task waits.',
      interval: 'Reminder interval',
      intervalHint: 'Drag the slider to set the reminder interval.',
      minutes: 'min',
      save: 'Save',
      on: 'On',
      off: 'Off',
      loading: 'Loading settings…',
      loadFailed: 'Could not load settings.',
      saveFailed: 'Could not save. Try again.',
      retry: 'Retry',
    }

    const styles = `
.dwn-card{display:flex;flex-direction:column;gap:14px;padding:16px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);font:inherit}
.dwn-head{display:flex;flex-direction:column;gap:4px}
.dwn-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dwn-hint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dwn-row{display:flex;align-items:center;justify-content:space-between;gap:16px}
.dwn-text{display:flex;flex-direction:column;gap:2px;min-width:0}
.dwn-label{font-size:13px;color:var(--dsw-alias-label-primary)}
.dwn-desc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dwn-switch{position:relative;flex:none;width:36px;height:20px;padding:0;border:0;border-radius:999px;background:var(--dsw-alias-border-l2);cursor:pointer;transition:background .15s ease}
.dwn-switch[aria-checked="true"]{background:var(--dsw-alias-state-business-primary)}
.dwn-switch:disabled{opacity:.55;cursor:default}
.dwn-thumb{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-switch-thumb);transition:transform .15s ease;box-shadow:0 1px 2px rgba(0,0,0,.18)}
.dwn-switch[aria-checked="true"] .dwn-thumb{transform:translateX(16px)}
.dwn-error{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-state-error-primary)}
.dwn-retry{padding:2px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}
.dwn-sep{height:1px;background:var(--dsw-alias-border-l1)}
.dwn-intervalBox{display:flex;align-items:center;gap:6px}
.dwn-range{width:160px;accent-color:var(--dsw-alias-state-business-primary)}
.dwn-saveBtn{height:28px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer}
.dwn-saveBtn:disabled{opacity:.5;cursor:default}
.dwn-unit{font-size:12px;color:var(--dsw-alias-label-tertiary)}
`

    function createCard(t) {
      return function NotificationSettingsCard(props) {
        const [config, setConfig] = React.useState(null)
        const [error, setError] = React.useState('')
        const [saving, setSaving] = React.useState('')
        const [minutes, setMinutes] = React.useState('')

        const load = React.useCallback(() => {
          setError('')
          fetch(`${API}/config`, { headers: { accept: 'application/json' } })
            .then(response => response.json())
            .then((data) => {
              if (data && data.ok && data.config) setConfig(data.config)
              else setError(t('loadFailed'))
            })
            .catch(() => setError(t('loadFailed')))
        }, [])

        React.useEffect(() => { load() }, [])

        React.useEffect(() => {
          if (config) setMinutes(String(config.repeatIntervalMinutes ?? 5))
        }, [config && config.repeatIntervalMinutes])

        // The slot also asks for a one-line summary; the switches belong to the
        // page view only.
        if (props.view === 'summary') return null

        const save = (next, key) => {
          if (!config) return
          const previous = config
          setConfig(next)
          setSaving(key)
          setError('')
          fetch(`${API}/config`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(next),
          })
            .then(response => response.json())
            .then((data) => {
              if (!data || !data.ok) throw new Error('save-failed')
              if (data.config) setConfig(data.config)
            })
            .catch(() => {
              setConfig(previous)
              setError(t('saveFailed'))
            })
            .finally(() => setSaving(''))
        }

        const toggle = (key) => {
          if (!config || saving) return
          save({ ...config, [key]: !config[key] }, key)
        }

        const renderRow = (key) => {
          const checked = Boolean(config && config[key])
          return h('div', { className: 'dwn-row', key },
            h('div', { className: 'dwn-text' },
              h('span', { className: 'dwn-label' }, t(key)),
              h('span', { className: 'dwn-desc' }, t(`${key}Hint`)),
            ),
            h('button', {
              type: 'button',
              role: 'switch',
              className: 'dwn-switch',
              'aria-checked': checked,
              'aria-label': `${t(key)}: ${checked ? t('on') : t('off')}`,
              disabled: !config || Boolean(saving) || saving === key,
              onClick: () => toggle(key),
            }, h('span', { className: 'dwn-thumb' })),
          )
        }

        const typeRows = FLAGS.map(renderRow)
        const optionRows = ['updateCheck', 'repeatReminder'].map(renderRow)
        const parsedMinutes = Number(minutes)
        const minutesValid = Number.isFinite(parsedMinutes) && parsedMinutes >= 1 && parsedMinutes <= 60
        const minutesDirty = Boolean(config) && minutesValid
          && Math.round(parsedMinutes) !== config.repeatIntervalMinutes

        // The interval is an explicit save: the slider does not write the config.
        const commitMinutes = () => {
          if (!config) return
          if (!minutesValid) {
            setMinutes(String(config.repeatIntervalMinutes ?? 5))
            return
          }
          const rounded = Math.min(60, Math.max(1, Math.round(parsedMinutes)))
          setMinutes(String(rounded))
          if (rounded !== config.repeatIntervalMinutes) {
            save({ ...config, repeatIntervalMinutes: rounded }, 'repeatIntervalMinutes')
          }
        }

        const intervalRow = config && config.repeatReminder
          ? h('div', { className: 'dwn-row', key: 'interval' },
              h('div', { className: 'dwn-text' },
                h('span', { className: 'dwn-label' }, t('interval')),
                h('span', { className: 'dwn-desc' }, t('intervalHint')),
              ),
              h('div', { className: 'dwn-intervalBox' },
                h('input', {
                  type: 'range',
                  className: 'dwn-range',
                  min: 1,
                  max: 60,
                  step: 1,
                  value: minutes,
                  'aria-label': t('interval'),
                  onChange: event => setMinutes(event.target.value),
                }),
                h('span', { className: 'dwn-unit' }, `${minutes || '1'} ${t('minutes')}`),
                h('button', {
                  type: 'button',
                  className: 'dwn-saveBtn',
                  disabled: !minutesDirty || Boolean(saving),
                  onClick: commitMinutes,
                }, t('save')),
              ),
            )
          : null

        return h('section', { className: 'dwn-card' },
          h('style', null, styles),
          h('div', { className: 'dwn-head' },
            h('span', { className: 'dwn-title' }, t('title')),
            h('span', { className: 'dwn-hint' }, t('hint')),
          ),
          config
            ? h(React.Fragment, null,
                typeRows,
                h('div', { className: 'dwn-sep', key: 'sep' }),
                optionRows,
                intervalRow,
              )
            : h('span', { className: 'dwn-hint' }, t('loading')),
          error
            ? h('div', { className: 'dwn-error' },
                h('span', null, error),
                h('button', { type: 'button', className: 'dwn-retry', onClick: load }, t('retry')),
              )
            : null,
        )
      }
    }

    return {
      inject: ['slots', 'locale'],

      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'windows-notifications: dictionaries')
        const t = ctx.locale.bind(NS)
        const Card = createCard(t)
        ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
          name: 'plugins.bundle.config',
          id: 'dsh-windows-notifications-config',
          key: 'dsh-windows-notifications',
          locale: NS,
          order: 10,
        }, Card))

        // Tell the Host which session the page shows and whether it has focus,
        // so a focused session stops asking for reminders.
        const uiWorkspace = ctx.get('uiWorkspace')
        const sessions = ctx.get('sessions')
        const currentSessionId = () => {
          try {
            const id = uiWorkspace?.mainReference?.sessionId
              || uiWorkspace?.selection?.getSnapshot?.()?.sessionId
              || sessions?.list?.getSnapshot?.()?.current
            return typeof id === 'string' ? id : ''
          } catch {
            return ''
          }
        }
        let lastSignature = ''
        const reportActive = () => {
          const sessionId = currentSessionId()
          if (!sessionId) return
          const focused = typeof document !== 'undefined' && document.hasFocus()
          const signature = `${sessionId}|${focused ? 1 : 0}`
          if (signature === lastSignature) return
          lastSignature = signature
          fetch(`${API}/active`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId, focused }),
          }).catch(() => {})
        }
        const reportTimer = setInterval(reportActive, 3000)
        window.addEventListener('focus', reportActive)
        window.addEventListener('blur', reportActive)
        document.addEventListener('visibilitychange', reportActive)
        ctx.effect(() => () => {
          clearInterval(reportTimer)
          window.removeEventListener('focus', reportActive)
          window.removeEventListener('blur', reportActive)
          document.removeEventListener('visibilitychange', reportActive)
        }, 'windows-notifications: active-session reporter')
        reportActive()
      },
    }
  },
})
