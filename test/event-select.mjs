/**
 * Event selector: backend catalogue (mod + vanilla, Chinese titles), the
 * searchable picker binds an event id string, and `country_event` effects emit
 * `{ id, days }` instead of a raw number.
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

/* --------------------------- backend catalogue --------------------------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eu4w-eventsel-'))
fs.mkdirSync(path.join(tmp, 'eu4', 'common'), { recursive: true })
fs.mkdirSync(path.join(tmp, 'eu4', 'events'), { recursive: true })
fs.mkdirSync(path.join(tmp, 'eu4', 'localisation'), { recursive: true })
fs.mkdirSync(path.join(tmp, 'mod', 'events'), { recursive: true })
fs.mkdirSync(path.join(tmp, 'mod', 'localisation'), { recursive: true })
fs.writeFileSync(path.join(tmp, 'eu4', 'events', 'vanilla_events.txt'), `
country_event = {
  id = y.1
  title = y.1.t
  desc = y.1.d
}
country_event = {
  id = x.1
  title = vanilla_overridden.t
}
`, 'utf8')
fs.writeFileSync(path.join(tmp, 'eu4', 'localisation', 'v_l_simp_chinese.yml'), `
l_simp_chinese:
 y.1.t:0 "原版事件"
`, 'utf8')
fs.writeFileSync(path.join(tmp, 'mod', 'events', 'test_events.txt'), `
namespace = test_events
country_event = {
  id = x.1
  title = x.1.t
  desc = x.1.d
}
province_event = {
  id = x.2
  title = x.2.t
}
country_event = {
  id = x.3
  title = x.3.t
}
`, 'utf8')
fs.writeFileSync(path.join(tmp, 'mod', 'localisation', 'test_l_simp_chinese.yml'), `
l_simp_chinese:
 x.1.t:0 "测试事件一"
 x.1.d:0 "描述一"
 x.2.t:0 "省份事件二"
`, 'utf8')

const wb = new Workbench({
  eu4Root: path.join(tmp, 'eu4'),
  modDir: path.join(tmp, 'mod'),
  eu4UserDir: '',
  statePath: path.join(tmp, 'state.json'),
})
wb.init()
const catalog = await wb.eventCatalog(true)
check('catalogue merges mod + vanilla', catalog.total === 4, JSON.stringify(catalog.items.map((i) => i.id)))
const x1 = catalog.items.find((item) => item.id === 'x.1')
check('mod definition wins', x1.source === 'mod' && x1.title === '测试事件一', JSON.stringify(x1))
check('vanilla title resolved', catalog.items.find((item) => item.id === 'y.1')?.title === '原版事件')
check('kind carried', catalog.items.find((item) => item.id === 'x.2')?.kind === 'province_event')
check('namespace carried', catalog.items.find((item) => item.id === 'x.1')?.namespace === 'test_events')
check('unlocalised title is empty', catalog.items.find((item) => item.id === 'x.3')?.title === '')
check('assets counted', catalog.mod === 3 && catalog.vanilla === 1, JSON.stringify({ mod: catalog.mod, vanilla: catalog.vanilla }))
const cached = await wb.eventCatalog()
check('catalogue cached', cached.items.length === catalog.items.length)

/* Quick-add dictionary entry is visible through translation(). */
wb.setCustomDictionary('x.3.t', '补录事件三')
const filled = await wb.eventCatalog(true)
check('custom dictionary fills title', filled.items.find((item) => item.id === 'x.3')?.title === '补录事件三')
fs.rmSync(tmp, { recursive: true, force: true })

/* ------------------------------- payloads ------------------------------- */
const data = {
  file: 'events/test_events.txt',
  id: 'hus_event.1',
  kind: 'country_event',
  title: '布拉格之战',
  desc: '描述',
  triggerMode: 'normal',
  options: [{
    name: 'hus_event.1.a',
    effects: [{ effect: 'country_event', params: { id: 'flavor_boh.1', days: '0' } }],
  }],
}
const built = buildAIPayload('event', 'create', data)
check('payload keeps event id', JSON.stringify(built.payload.options).includes('flavor_boh.1'), '')
check('payload keeps days', JSON.stringify(built.payload.options).includes('"days":"0"'))
check('prompt explains id + days', built.prompt.includes('params.id (event id string') && built.prompt.includes('params.days'))
check('prompt forbids bare number', /Never write a bare number as the event id/.test(built.prompt))

const preview = buildRawPreview({ event: data })
check('raw preview id/days block', /country_event = \{\s*\n\s*id = flavor_boh\.1\s*\n\s*days = 0/.test(preview), preview)

const batch = buildBatchPrompt([{
  id: 'q1', targetType: 'event', action: 'create', targetId: 'hus_event.1',
  targetFile: 'events/test_events.txt', data,
}])
check('batch rule for event effects', batch.prompt.includes('country_event = { id = 事件ID days = 延迟天数 }'))
check('batch json keeps params', JSON.stringify(batch.payload).includes('flavor_boh.1'))

/* ------------------------------ client-side ------------------------------ */
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
  const items = [
    { id: 'flavor_boh.1', title: '巴塞尔条约', namespace: 'flavor_boh', source: 'vanilla', kind: 'country_event' },
    { id: 'hus_event.1', title: '布拉格之战', namespace: 'hus_event', source: 'mod', kind: 'country_event' },
  ]
  check('search by id', internals.filterEventCatalog(items, 'flavor_boh.1').length === 1)
  check('search by chinese title', internals.filterEventCatalog(items, '布拉格').length === 1)
  check('search by namespace', internals.filterEventCatalog(items, 'flavor').length === 1)
  check('search miss is empty', internals.filterEventCatalog(items, 'zzzz').length === 0)
  check('label shows id + title', internals.eventCatalogLabel(items[0]) === 'flavor_boh.1 — 巴塞尔条约')

  const picker = ReactDOMServer.renderToStaticMarkup(
    React.createElement(internals.EventSelect, { value: 'hus_event.1', items, onChange: () => {} }),
  )
  check('picker displays id + title', picker.includes('value="hus_event.1 — 布拉格之战"'), picker)
  check('picker has search input', picker.includes('eu4w-search'))

  // An existing event effect row renders the picker + days, never a bare number.
  internals.updateFormMemory('eventForm', {
    file: 'events/test_events.txt', id: 'hus_event.1', kind: 'country_event', namespace: 'hus_event',
    title: '布拉格之战', desc: '描述', triggerMode: 'normal', conditions: [],
    options: [{ name: 'hus_event.1.a', effects: [{ effect: 'country_event', params: { id: 'flavor_boh.1', days: '0' } }] }],
    isNew: true,
  })
  internals.updateFormMemory('eventForm.isNew', true)
  const html = internals.renderTabForTest('EventsTab', React, ReactDOMServer, {
    dictionary: { modifiers: [], modifierTree: [] },
  })
  check('effect row shows event picker', html.includes('value="flavor_boh.1"'), '')
  check('effect row shows days 0', /value="0"/.test(html))
  check('effect row labels days', html.includes('延迟天数 (days)'))
  check('effect row has no raw numeric id input', !html.includes('value="43"'))

  const bad = buildRawPreview({ event: { ...data, options: [{ name: 'a', effects: [{ effect: 'country_event', value: '43' }] }] } })
  check('legacy bare number still previews as value', bad.includes('country_event = 43'))
}

if (failed) process.exit(1)
