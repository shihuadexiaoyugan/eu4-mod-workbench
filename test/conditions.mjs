/**
 * Condition builder: owns vs controls, dynamic placeholders, province picker,
 * and the `{ condition, value }` payload contract.
 */
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { TRIGGER_OPTIONS } from '../lib/eu4-dictionary.js'
import { buildRawPreview } from '../lib/nl2code.js'
import { buildAIPayload } from '../lib/ai.js'

const here = path.dirname(fileURLToPath(import.meta.url))
let failed = 0
const check = (name, ok, detail = '') => {
  console.log((ok ? '  ok  ' : 'FAIL') + ' ' + name + (detail ? ' — ' + detail : ''))
  if (!ok) failed++
}

const owns = TRIGGER_OPTIONS.find((item) => item.value === 'owns')
const controls = TRIGGER_OPTIONS.find((item) => item.value === 'controls')
check('owns option exists', Boolean(owns) && owns.label === '拥有省份', JSON.stringify(owns))
check('controls is a separate option', Boolean(controls) && controls.label === '控制省份' && controls.value !== owns.value, JSON.stringify(controls))

const preview = buildRawPreview({
  event: {
    id: 'x.1', kind: 'country_event', title: '', desc: '',
    conditions: [{ condition: 'controls', op: '=', value: '2664' }], options: [],
  },
})
check('controls generation is not rewritten to owns', preview.includes('controls = 2664') && !/^\s*owns\s*=/m.test(preview), preview.split('\n').filter((line) => /controls|owns/.test(line)).join(' | '))

const ownsPreview = buildRawPreview({
  event: {
    id: 'x.2', kind: 'country_event', title: '', desc: '',
    conditions: [{ condition: 'owns', op: '=', value: '2664' }], options: [],
  },
})
check('owns stays owns', ownsPreview.includes('owns = 2664') && !/\bcontrols\s*=/m.test(ownsPreview), '')

const payload = buildAIPayload('event', 'create', {
  file: 'events/x.txt', id: 'x.1', kind: 'country_event', title: 'T', desc: 'D',
  conditions: [{ condition: 'controls', op: '=', value: '2664' }], options: [],
})
check('AI payload keeps condition field', payload.prompt.includes('"condition": "controls"'), '')
check('AI prompt forbids owns rewrite', payload.prompt.includes('controls') && payload.prompt.includes('NEVER be rewritten as `owns`'), '')

/* ------------------------------ client UI ------------------------------ */
const candidates = [path.join(process.env.DSH_PROFILE_DIR || '', 'package.json'), path.join(here, '..', 'package.json'), path.join(process.env.USERPROFILE || '', '.dsh', 'profiles', 'desktop', 'package.json')]
let React = null
let ReactDOMServer = null
for (const manifest of candidates) {
  if (!manifest || !existsSync(manifest)) continue
  try { const req = createRequire(manifest); React = req('react'); ReactDOMServer = req('react-dom/server'); break } catch { React = null }
}
if (React) {
  let factory = null
  globalThis.window = { __ModuleLoader__: { load(definition) { factory = definition.factory } } }
  await import('../client.js')
  const plugin = factory((name) => { if (name === 'react') return React; throw new Error(name) })
  const internals = plugin.testInternals
  const t = (key) => ({
    'cond.provincePlaceholder': '请输入省份 ID（如 2664）',
    'cond.tagPlaceholder': '请输入 3 位字母 Tag（如 TBO）',
    'cond.yearPlaceholder': '请输入年份（如 1437）',
    'cond.flagPlaceholder': '请输入 flag 名（如 tbo_reform）',
    'cond.valuePlaceholder': '值：省份 ID / 年份 / TAG / flag / 脚本',
  }[key] || key)
  check('controls placeholder mentions province ID', internals.conditionPlaceholder('controls', t).includes('省份 ID'), '')
  check('tag placeholder mentions 3-letter TAG', internals.conditionPlaceholder('tag', t).includes('3 位字母 Tag'), '')
  check('year placeholder mentions year', internals.conditionPlaceholder('is_year', t).includes('年份'), '')
  const mapped = internals.conditionPayload({ type: 'controls', op: '=', value: '2664' })
  check('payload shape is {condition, op, value}', mapped.condition === 'controls' && mapped.value === '2664' && mapped.type === undefined, JSON.stringify(mapped))

  internals.updateFormMemory('eventForm', {
    file: 'events/x.txt', id: 'x.1', kind: 'country_event', namespace: 'x',
    title: 'T', desc: 'D', triggerMode: 'normal',
    conditions: [{ type: 'controls', op: '=', value: '2664' }],
    options: [{ name: 'x.1.a', effects: [] }], isNew: true,
  })
  internals.updateFormMemory('eventForm.isNew', true)
  const html = internals.renderTabForTest('EventsTab', React, ReactDOMServer, { state: { currentStartDate: '1437.1.1' } })
  check('controls renders a searchable province picker', html.includes('搜索省份：中文 / 英文 / ID'), '')
  check('no generic mixed placeholder for controls', !html.includes('值：省份 ID / 年份 / TAG / flag / 脚本'), '')
}

if (failed) process.exit(1)
