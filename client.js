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
`

    function createCard(t) {
      return function NotificationSettingsCard(props) {
        const [config, setConfig] = React.useState(null)
        const [error, setError] = React.useState('')
        const [saving, setSaving] = React.useState('')

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

        // The slot also asks for a one-line summary; the switches belong to the
        // page view only.
        if (props.view === 'summary') return null

        const toggle = (key) => {
          if (!config || saving) return
          const previous = config
          const next = { ...config, [key]: !config[key] }
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

        const rows = FLAGS.map((key) => {
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
              disabled: !config || saving === key,
              onClick: () => toggle(key),
            }, h('span', { className: 'dwn-thumb' })),
          )
        })

        return h('section', { className: 'dwn-card' },
          h('style', null, styles),
          h('div', { className: 'dwn-head' },
            h('span', { className: 'dwn-title' }, t('title')),
            h('span', { className: 'dwn-hint' }, t('hint')),
          ),
          config ? rows : h('span', { className: 'dwn-hint' }, t('loading')),
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
      },
    }
  },
})
