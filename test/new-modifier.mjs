/**
 * add_country_modifier rework: id/name split, year→day parsing, inline new
 * modifier creation (mechanic ChangeItem) and the paired batch instructions.
 */
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Workbench } from '../lib/engine.js'
import { buildAIPayload } from '../lib/ai.js'
import { buildRawPreview } from '../lib/nl2code.js'
import { buildBatchPrompt } from '../lib/batch.js'

const here = path.dirname(fileURLToPath(import.meta.url))
let failed = 0
const check = (name, ok, detail = '') => {
  console.log((ok ? '  ok  ' : 'FAIL') + ' ' + name + (detail ? ' — ' + detail : ''))
  if (!ok) failed++
}

/* ------------------------------ durations ------------------------------ */
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
  process.exit(0)
}
let factory = null
globalThis.window = { __ModuleLoader__: { load(definition) { factory = definition.factory } } }
await import('../client.js')
const plugin = factory((name) => {
  if (name === 'react') return React
  throw new Error('unexpected require: ' + name)
})
const internals = plugin.testInternals
const { MODIFIER_OPTIONS, MODIFIER_TREE } = await import('../lib/eu4-dictionary.js')

check('5 years -> 1825 days', internals.durationToNative('5', '0') === 1825, String(internals.durationToNative('5', '0')))
check('"5年" -> 1825 days', internals.durationToNative('5年', '0') === 1825)
check('"90天" -> 90 days', internals.durationToNative('0', '90天') === 90)
check('2 years + 30 days -> 760', internals.durationToNative('2年', '30天') === 760)
check('empty -> 0', internals.durationToNative('', '') === 0)
const split = internals.durationSplit(1825)
check('split 1825 -> 5y 0d', split.years === 5 && split.days === 0, JSON.stringify(split))
const split2 = internals.durationSplit(760)
check('split 760 -> 2y 30d', split2.years === 2 && split2.days === 30, JSON.stringify(split2))

/* --------------------------- queue expansion --------------------------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eu4w-newmod-'))
fs.mkdirSync(path.join(tmp, 'eu4', 'common'), { recursive: true })
const wb = new Workbench({
  eu4Root: path.join(tmp, 'eu4'),
  modDir: path.join(tmp, 'mod'),
  eu4UserDir: '',
  statePath: path.join(tmp, 'state.json'),
})
wb.init()
const eventData = {
  file: 'events/hussite_events.txt',
  id: 'hus_event.1',
  kind: 'country_event',
  title: '布拉格之战',
  desc: '描述',
  triggerMode: 'normal',
  options: [{
    name: 'hus_event.1.a',
    effects: [{
      effect: 'add_country_modifier',
      params: {
        name: 'last_stand_modifier', nameZh: '最后一战', duration: '1825',
        stats: { land_morale: 0.2 }, newModifier: true,
      },
    }],
  }],
}
wb.addChange({ targetType: 'event', action: 'create', targetId: 'hus_event.1', targetFile: 'events/hussite_events.txt', data: eventData })
const queue = wb.listChanges()
check('queue has modifier + event', queue.length === 2, queue.map((item) => item.targetType).join(','))
check('modifier task first', queue[0].targetType === 'mechanic' && queue[0].targetId === 'last_stand_modifier', queue[0].targetType)
check('modifier target file', queue[0].targetFile === 'common/event_modifiers/last_stand_modifier.txt', queue[0].targetFile)
check('modifier stats carried', queue[0].data.stats && queue[0].data.stats.land_morale === 0.2, JSON.stringify(queue[0].data.stats))
check('modifier marked new', queue[0].data.newModifier === true && queue[0].data.nameZh === '最后一战')
check('modifier origin tracked', queue[0].data.origin && queue[0].data.origin.targetType === 'event' && queue[0].data.origin.targetId === 'hus_event.1')

wb.addChange({ targetType: 'event', action: 'create', targetId: 'hus_event.1', targetFile: 'events/hussite_events.txt', data: JSON.parse(JSON.stringify(eventData)) })
check('re-queue does not duplicate', wb.listChanges().length === 2, String(wb.listChanges().length))

// Removing the stats must also drop the auto-created modifier task.
const withoutStats = JSON.parse(JSON.stringify(eventData))
delete withoutStats.options[0].effects[0].params.stats
wb.addChange({ targetType: 'event', action: 'create', targetId: 'hus_event.1', targetFile: 'events/hussite_events.txt', data: withoutStats })
check('stale modifier task removed', wb.listChanges().length === 1 && wb.listChanges()[0].targetType === 'event', JSON.stringify(wb.listChanges().map((item) => item.targetType)))
fs.rmSync(tmp, { recursive: true, force: true })

/* ------------------------------ payloads ------------------------------ */
const built = buildAIPayload('event', 'create', eventData)
check('payload duration is seconds-free integer', built.payload.options[0].effects[0].params.duration === '1825')
check('prompt explains name/newModifier', built.prompt.includes('params.nameZh') && built.prompt.includes('newModifier is true'))
check('prompt forbids UI metadata in txt', /never write them into the event \.txt/.test(built.prompt))

const preview = buildRawPreview({ event: eventData })
check('preview writes duration only', preview.includes('add_country_modifier = {') && preview.includes('name = last_stand_modifier') && preview.includes('duration = 1825'), preview)
check('preview omits UI metadata', !preview.includes('newModifier') && !preview.includes('nameZh') && !preview.includes('最后一战') && !preview.includes('years'))

const batchEvent = {
  id: 'q1', targetType: 'event', action: 'create', targetId: 'hus_event.1',
  targetFile: 'events/hussite_events.txt', data: eventData,
}
const batchMod = {
  id: 'q0', targetType: 'mechanic', action: 'create', targetId: 'last_stand_modifier',
  targetFile: 'common/event_modifiers/last_stand_modifier.txt',
  data: { name: 'last_stand_modifier', nameZh: '最后一战', stats: { land_morale: 0.2 }, newModifier: true },
}
const batch = buildBatchPrompt([batchMod, batchEvent])
check('batch modifier task', batch.prompt.includes('common/event_modifiers/last_stand_modifier.txt') && batch.prompt.includes('land_morale = 0.2'))
check('batch localisation name', batch.prompt.includes('last_stand_modifier:0 "最后一战"'))
check('batch event effect instruction', batch.prompt.includes('add_country_modifier = { name = last_stand_modifier duration = 1825 }'))
check('batch validate_script', batch.prompt.includes('validate_script'))
check('batch strong block title', batch.prompt.includes('[New modifier tasks / 新修正强指令]'))

/* ------------------------------ client UI ------------------------------ */
internals.updateFormMemory('eventForm', {
  ...eventData, isNew: true,
})
internals.updateFormMemory('eventForm.isNew', true)
const html = internals.renderTabForTest('EventsTab', React, ReactDOMServer, {
  dictionary: { modifiers: MODIFIER_OPTIONS, modifierTree: MODIFIER_TREE },
})
check('ui id field', html.includes('value="last_stand_modifier"'))
check('ui chinese name field', html.includes('value="最后一战"'))
check('ui years field', html.includes('value="5"'))
check('ui days field', html.includes('value="0"'))
check('ui total days hint', html.includes('= 1825 天'))
check('ui modifier id placeholder', html.includes('修正英文 ID（必填）'))
check('ui tree selector shows chinese', html.includes('value="陆军士气"'), '')
check('ui stat value percent', html.includes('value="20"'))

if (failed) process.exit(1)
