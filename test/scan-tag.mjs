/**
 * Scanner/tag-filter regressions: recursive mod event scan, tag matches from
 * anywhere in the event script, history/countries binds, path guard, cache
 * refresh, and the deterministic event preview.
 */
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Workbench } from '../lib/engine.js'
import { buildEventPreview } from '../lib/ai.js'
import { buildBatchPrompt } from '../lib/batch.js'

const here = path.dirname(fileURLToPath(import.meta.url))
let failed = 0
const check = (name, ok, detail = '') => {
  console.log((ok ? '  ok  ' : 'FAIL') + ' ' + name + (detail ? ' — ' + detail : ''))
  if (!ok) failed++
}

/* ------------------------------ fixture ------------------------------ */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eu4w-scan-'))
fs.mkdirSync(path.join(tmp, 'eu4', 'common'), { recursive: true })
fs.mkdirSync(path.join(tmp, 'eu4', 'events'), { recursive: true })
fs.mkdirSync(path.join(tmp, 'mod', 'events', 'sub'), { recursive: true })
fs.mkdirSync(path.join(tmp, 'mod', 'history', 'countries'), { recursive: true })
fs.mkdirSync(path.join(tmp, 'mod', 'localisation'), { recursive: true })
fs.writeFileSync(path.join(tmp, 'mod', 'events', 'a.txt'), `
namespace = zzz
country_event = { id = tbo_a.1 title = tbo_a.1.t }
`, 'utf8')
fs.writeFileSync(path.join(tmp, 'mod', 'events', 'sub', 'b.txt'), `
namespace = tbo_b
country_event = { id = tbo_b.1 title = tbo_b.1.t }
`, 'utf8')
fs.writeFileSync(path.join(tmp, 'mod', 'events', 'c.txt'), `
namespace = zzz
country_event = {
  id = tbo_c.1
  title = tbo_c.1.t
  option = { name = tbo_c.1.a trigger = { tag = TBO } }
}
`, 'utf8')
fs.writeFileSync(path.join(tmp, 'mod', 'events', 'd.txt'), `
namespace = zzz
country_event = { id = tbo_d.1 title = tbo_d.1.t }
`, 'utf8')
fs.writeFileSync(path.join(tmp, 'mod', 'history', 'countries', 'TBO - Tabor.txt'), `
1437.1.1 = { country_event = { id = tbo_d.1 days = 0 } }
`, 'utf8')

const wb = new Workbench({
  eu4Root: path.join(tmp, 'eu4'),
  modDir: path.join(tmp, 'mod'),
  eu4UserDir: '',
  statePath: path.join(tmp, 'state.json'),
})
wb.init()

const files = wb.listEventFiles().filter((rec) => rec.label === 'mod').map((rec) => rec.path)
check('recursive mod scan includes subfolder', files.includes('events/sub/b.txt'), files.join(','))
check('mod root resolved', wb.modRoot() === path.join(tmp, 'mod'), wb.modRoot())

const binds = await wb.historyTagBindings()
check('history bind parsed', JSON.stringify(binds.get('tbo_d.1')) === '["TBO"]', JSON.stringify(binds.get('tbo_d.1')))

const bindState = await wb.historyBindState('TBO', '1437.1.1', 'tbo_d.1')
check('history bind state detects date block', bindState.exists === true && bindState.dateBlockCount === 1 && bindState.alreadyBound === true, JSON.stringify(bindState))
const otherDate = await wb.historyBindState('TBO', '1437.1.2', 'tbo_d.1')
check('history bind state other date', otherDate.exists === true && otherDate.dateBlockCount === 0, JSON.stringify(otherDate))
fs.appendFileSync(path.join(tmp, 'mod', 'history', 'countries', 'TBO - Tabor.txt'), '\n1437.1.1 = {\n\tadd_prestige = 5\n}\n', 'utf8')
const duplicate = await wb.historyBindState('TBO', '1437.1.1', 'tbo_d.1')
check('duplicate date blocks detected', duplicate.dateBlockCount === 2, JSON.stringify(duplicate))

const graph = await wb.eventGraphAsync()
check('graph has all four events', graph.nodes.length === 4, String(graph.nodes.length))
const byId = new Map(graph.nodes.map((node) => [node.id, node]))
check('script tag match from option', (byId.get('tbo_c.1')?.triggerTags || []).includes('TBO'), JSON.stringify(byId.get('tbo_c.1')?.triggerTags))
check('history bind merged into node', (byId.get('tbo_d.1')?.triggerTags || []).includes('TBO'), JSON.stringify(byId.get('tbo_d.1')?.triggerTags))
check('unrelated event not tagged', !(byId.get('tbo_a.1')?.triggerTags || []).includes('TBO'), JSON.stringify(byId.get('tbo_a.1')?.triggerTags))

const filtered = await wb.queryEvents({ tag: 'TBO' })
const kept = filtered.nodes.map((node) => node.id).sort()
check('tag filter keeps namespace/script/history matches', kept.join(',') === 'tbo_b.1,tbo_c.1,tbo_d.1', kept.join(','))
const regular = await wb.queryEvents({ tag: 'TBO', category: 'regular' })
check('category filter still works', regular.nodes.length === 3, String(regular.nodes.length))

/* --------------------------- refresh + report --------------------------- */
let report = await wb.scanReport()
check('scan report mod files', report.events.mod === 4, JSON.stringify({ mod: report.events.mod, total: report.events.total }))
check('scan report lists absolute paths', report.events.modFiles.every((file) => path.isAbsolute(file)), report.events.modFiles[0])

fs.writeFileSync(path.join(tmp, 'mod', 'events', 'e.txt'), `
namespace = zzz
country_event = { id = tbo_e.1 title = tbo_e.1.t }
`, 'utf8')
const refreshed = wb.refreshCaches()
check('refresh returns mod root', refreshed.modRoot === path.join(tmp, 'mod'), refreshed.modRoot)
report = await wb.scanReport()
check('refresh picks up new file', report.events.mod === 5, String(report.events.mod))
const graph2 = await wb.eventGraphAsync()
check('new event appears after refresh', graph2.nodes.some((node) => node.id === 'tbo_e.1'))

/* ------------------------------ path guard ------------------------------ */
const modPath = wb.checkPath('events/zz_eu4_workbench_events.txt')
check('mod path accepted', modPath.ok === true && modPath.underMod === true, JSON.stringify(modPath))
const vanillaPath = wb.checkPath(path.join(tmp, 'eu4', 'events', 'x.txt'))
check('vanilla path rejected', vanillaPath.ok === false && vanillaPath.underVanilla === true, JSON.stringify(vanillaPath))
check('outside path rejected', wb.checkPath('C:/Windows/System32/x.txt').ok === false)

const batch = buildBatchPrompt([{
  id: 'q1', targetType: 'event', action: 'create', targetId: 'tbo_a.1', targetFile: 'events/a.txt',
  data: { id: 'tbo_a.1', options: [] },
}], { modRoot: tmp + '/mod', eu4Root: tmp + '/eu4' })
check('path contract in batch prompt', batch.prompt.includes('[Path contract / 路径契约]')
  && batch.prompt.includes(tmp + '/mod') && batch.prompt.includes(tmp + '/eu4'))

/* ---------------------------- event preview ---------------------------- */
const preview = buildEventPreview({
  file: 'events/zz_eu4_workbench_events.txt',
  id: 'hus_event.1',
  title: '布拉格之战',
  desc: '1437 年冬，胡斯派在布拉格集结。',
  triggerMode: 'startup',
  targetTag: 'TBO',
  bindDate: '1437.1.1',
  conditions: [],
  options: [{ name: 'hus_event.1.a', effects: [{ effect: 'add_stability', value: '1' }] }],
})
check('preview is a country_event block', preview.code.includes('country_event = {') && preview.code.includes('id = hus_event.1'))
check('preview uses derived keys', preview.code.includes('title = "hus_event.1.t"') && preview.code.includes('desc = "hus_event.1.d"'))
check('preview startup flag', preview.code.includes('is_triggered_only = yes') && !preview.code.includes('mean_time_to_happen'))
check('preview localisation lines', preview.localisation.join('\n').includes('hus_event.1.t:0 "布拉格之战"') && preview.localisation.join('\n').includes('hus_event.1.d:0'))
check('preview history bind', preview.history && preview.history.line === '1437.1.1 = { country_event = { id = hus_event.1 days = 0 } }', JSON.stringify(preview.history))
check('preview no warnings for startup', preview.warnings.length === 0, JSON.stringify(preview.warnings))

const normalPreview = buildEventPreview({ file: 'events/x.txt', id: 'x.1', title: 'T', desc: 'D', triggerMode: 'normal', conditions: [], options: [] })
check('preview warns untriggerable normal event', normalPreview.warnings.some((w) => w.includes('永远不会触发')), JSON.stringify(normalPreview.warnings))
const missingTag = buildEventPreview({ file: 'events/x.txt', id: 'x.1', title: 'T', desc: 'D', triggerMode: 'startup', targetTag: '', options: [] })
check('preview warns missing startup tag', missingTag.warnings.some((w) => w.includes('目标国家 Tag')), JSON.stringify(missingTag.warnings))

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
  internals.updateFormMemory('eventForm', {
    file: 'events/x.txt', id: 'x.1', kind: 'country_event', title: 'T', desc: 'D',
    triggerMode: 'normal', conditions: [], options: [{ name: 'a', effects: [] }], isNew: true,
  })
  internals.updateFormMemory('eventForm.isNew', true)
  const eventHtml = internals.renderTabForTest('EventsTab', React, ReactDOMServer)
  check('preview button rendered', eventHtml.includes('预览最终代码'))
  const batchHtml = internals.renderTabForTest('BatchTab', React, ReactDOMServer)
  check('path check button rendered', batchHtml.includes('校验写入路径'))
}

fs.rmSync(tmp, { recursive: true, force: true })
if (failed) process.exit(1)
