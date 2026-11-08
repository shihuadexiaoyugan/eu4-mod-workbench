/**
 * UI language-pack test: required keys exist, values are non-empty Chinese
 * strings, and a missing key is absent (so `t()` falls back to the key).
 */
import { UI_DEFAULT_LOCALE, UI_MESSAGES, uiMessages } from '../lib/ui-locales.js'

const required = [
  'app.title', 'app.subtitle', 'tab.workspace', 'tab.gui',
  'ws.pathsTitle', 'map.details', 'mission.nodeProps', 'event.form',
  'gui.tooltipText', 'gui.visibility', 'validate.run', 'tools.colStatus',
  'header.event_id', 'ai.generate',
  'religion.hussite', 'government.monarchy', 'disaster.title', 'modifier.title',
]
const checks = []
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail })
  if (!ok) throw new Error('failed: ' + name + (detail ? ' (' + detail + ')' : ''))
}

check('default locale', UI_DEFAULT_LOCALE === 'zh')
check('messages object', UI_MESSAGES && typeof UI_MESSAGES === 'object')
for (const key of required) {
  const value = UI_MESSAGES[key]
  check('has ' + key, typeof value === 'string' && value.length > 0, String(value))
}
check('missing key absent', UI_MESSAGES['does.not.exist'] === undefined)
check('copy is independent', uiMessages() !== UI_MESSAGES)

const cjk = /[\u4e00-\u9fa5]/
const chineseSamples = ['app.title', 'tab.gui', 'event.form', 'header.event_id', 'religion.hussite']
for (const key of chineseSamples) check('chinese ' + key, cjk.test(UI_MESSAGES[key] || ''))

console.log(checks.map((c) => `ok  ${c.name}`).join('\n'))
