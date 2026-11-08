/**
 * Event start trigger: title/desc are localisation keys, Chinese text goes to
 * the .yml, and the forced trigger is a country-history date block (never an
 * on_startup sweep / mean_time_to_happen).
 */
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildAIPayload, normalizeEffectForPayload } from '../lib/ai.js'
import { buildRawPreview } from '../lib/nl2code.js'
import { buildBatchPrompt } from '../lib/batch.js'

const here = path.dirname(fileURLToPath(import.meta.url))
let failed = 0
const check = (name, ok, detail = '') => {
  console.log((ok ? '  ok  ' : 'FAIL') + ' ' + name + (detail ? ' — ' + detail : ''))
  if (!ok) failed++
}

const data = {
  file: 'events/hussite_events.txt',
  id: 'hus_event.1',
  kind: 'country_event',
  namespace: 'hus_event',
  title: '布拉格之战',
  desc: '1437 年冬，胡斯派在布拉格集结。',
  picture: '',
  triggerMode: 'startup',
  targetTag: 'TBO',
  bindDate: '1437.1.1',
  localisationFile: 'localisation/zz_eu4_workbench_l_simp_chinese.yml',
  activeLanguage: 'l_english',
  fireOnlyOnce: true,
  major: false,
  conditions: [{ type: 'tag', op: '=', value: 'TBO' }],
  options: [{ name: 'hus_event.1.a', effects: [{ effect: 'add_prestige', value: '10' }] }],
}

const built = buildAIPayload('event', 'create', data)
const payload = built.payload || {}
check('title key derived', payload.title_key === 'hus_event.1.t', payload.title_key)
check('desc key derived', payload.desc_key === 'hus_event.1.d', payload.desc_key)
check('chinese title carried', payload.title_zh === '布拉格之战', payload.title_zh)
check('startup payload flag', payload.trigger_mode === 'startup' && payload.is_triggered_only === true)
check('history file resolved', payload.history_file === 'history/countries/TBO.txt', payload.history_file)
check('history line exact', payload.history_line === '1437.1.1 = { country_event = { id = hus_event.1 days = 0 } }', payload.history_line)
check('localisation file carried', payload.localisation_file === data.localisationFile, payload.localisation_file)

check('prompt quotes title key', built.prompt.includes('title = "hus_event.1.t"') && built.prompt.includes('desc = "hus_event.1.d"'), '')
check('prompt forbids Chinese in txt', /NEVER put Chinese text inside the event \.txt/i.test(built.prompt))
check('prompt localisation write', built.prompt.includes('hus_event.1.t:0 "') && built.prompt.includes('l_simp_chinese') && built.prompt.includes('zz_eu4_workbench_l_simp_chinese.yml'))
check('prompt is_triggered_only', built.prompt.includes('is_triggered_only = yes'))
check('prompt forbids mtth', /Do NOT write a `mean_time_to_happen` block/i.test(built.prompt))
check('prompt history append', built.prompt.includes('1437.1.1 = { country_event = { id = hus_event.1 days = 0 } }') && built.prompt.includes('history/countries/TBO.txt'))
check('prompt required instruction verbatim', built.prompt.includes("Generate an event with is_triggered_only = yes. Ensure title is 'hus_event.1.t'") && built.prompt.includes("merge 'country_event = { id = hus_event.1 days = 0 }' into it"))

const normal = buildAIPayload('event', 'create', { ...data, triggerMode: 'normal' })
check('normal mode has no startup flag', normal.payload.is_triggered_only === false && normal.payload.trigger_mode === 'normal')
check('normal mode has no history instruction', !normal.prompt.includes('history/countries/TBO.txt'), '')
check('normal mode still writes keys', normal.prompt.includes('title = "hus_event.1.t"') && normal.prompt.includes('l_simp_chinese'))

/* Raw preview must emit the keys and the startup flag, never mtth. */
const preview = buildRawPreview({ event: data })
check('preview title key', preview.includes('title = "hus_event.1.t"'), '')
check('preview desc key', preview.includes('desc = "hus_event.1.d"'), '')
check('preview is_triggered_only', preview.includes('is_triggered_only = yes'))
check('preview no mtth', !preview.includes('mean_time_to_happen'))
check('preview starts with event shell', preview.startsWith('country_event = {'))
check('preview has no history comment', !preview.includes('# startup bind'))
check('preview no chinese', !/布拉格之战/.test(preview))

/* Batch prompt: the queued event carries the same contract. */
const batch = buildBatchPrompt([{
  id: 'q1', targetType: 'event', action: 'create', targetId: 'hus_event.1',
  targetFile: 'events/hussite_events.txt', data,
}])
check('batch title key rule', batch.prompt.includes('`title = "hus_event.1.t"`'))
check('batch localisation text', batch.prompt.includes('hus_event.1.t:0 "布拉格之战"') && batch.prompt.includes('hus_event.1.d:0'))
check('batch startup flag', batch.prompt.includes('is_triggered_only = yes') && batch.prompt.includes('mean_time_to_happen'))
check('batch history append', batch.prompt.includes('history/countries/TBO.txt') && batch.prompt.includes('1437.1.1 = { country_event = { id = hus_event.1 days = 0 } }'))
check('batch required instruction', batch.prompt.includes("Generate an event with is_triggered_only = yes. Ensure title is 'hus_event.1.t'") && batch.prompt.includes('merge'))

check('years normalize to days', normalizeEffectForPayload({ effect: 'add_country_modifier', params: { name: 'x', years: '5', duration: '200' } }).params.duration === '1825')
check('text duration normalizes', normalizeEffectForPayload({ effect: 'add_country_modifier', params: { name: 'x', duration: '5年' } }).params.duration === '1825')
check('ui metadata stripped', (() => { const p = normalizeEffectForPayload({ effect: 'add_country_modifier', params: { name: 'x', years: '5' } }).params; return p.years === undefined && p.daysText === undefined })())

/* ------------------------------ client UI ------------------------------ */
const candidates = []
if (process.env.DSH_PROFILE_DIR) candidates.push(path.join(process.env.DSH_PROFILE_DIR, 'package.json'))
candidates.push(path.join(here, '..', 'package.json'))
candidates.push(path.join(process.env.USERPROFILE || '', '.dsh', 'profiles', 'desktop', 'package.json'))
let React = null
let ReactDOMServer = null
for (const manifest of candidates) {
  if (!manifest || !existsSync(manifest)) continue
  try {
    const req = createRequire(manifest)
    React = req('react')
    ReactDOMServer = req('react-dom/server')
    break
  } catch { React = null }
}
if (!React) {
  console.log('skipped client checks: react not resolvable')
} else {
  let factory = null
  globalThis.window = { __ModuleLoader__: { load(definition) { factory = definition.factory } } }
  await import('../client.js')
  const plugin = factory((name) => {
    if (name === 'react') return React
    throw new Error('unexpected require: ' + name)
  })
  const internals = plugin.testInternals
  internals.updateFormMemory('eventForm', { ...data, isNew: true })
  internals.updateFormMemory('eventForm.isNew', true)
  const html = internals.renderTabForTest('EventsTab', React, ReactDOMServer)
  check('ui shows chinese title', html.includes('value="布拉格之战"'), '')
  check('ui trigger select', html.includes('value="startup"') && html.includes('开局强制触发'), '')
  check('ui target tag', html.includes('value="TBO"'))
  check('ui normalizes years', internals.normalizePayloadEffects([{ effect: 'add_country_modifier', params: { name: 'x', years: '5', duration: '200' } }])[0].params.duration === '1825')
  check('ui effective tag fallback', internals.effectiveTargetTag({ triggerMode: 'startup' }, 'TBO') === 'TBO')
  check('ui bind date', html.includes('value="1437.1.1"'))
  check('ui startup hint', html.includes('history/countries/TBO.txt') && html.includes('1437.1.1 = { country_event = { id = hus_event.1 days = 0 } }'))
  check('ui key hint', html.includes('hus_event.1.t') && html.includes('hus_event.1.d'))

  internals.updateFormMemory('eventForm', { ...data, triggerMode: 'normal', isNew: true })
  const normalHtml = internals.renderTabForTest('EventsTab', React, ReactDOMServer)
  check('ui normal hides startup hint', !normalHtml.includes('history/countries/TBO.txt'))
}

if (failed) process.exit(1)
