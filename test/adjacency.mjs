/**
 * Province adjacency: event condition parsing/generation and the neighbour
 * picker contract (land neighbours + straits from adjacencies.csv).
 */
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Workbench } from '../lib/engine.js'
import { buildRawPreview } from '../lib/nl2code.js'

const here = path.dirname(fileURLToPath(import.meta.url))
let failed = 0
const check = (name, ok, detail = '') => {
  console.log((ok ? '  ok  ' : 'FAIL') + ' ' + name + (detail ? ' — ' + detail : ''))
  if (!ok) failed++
}

/* ---------------------- event condition parse/render ---------------------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eu4w-adj-'))
fs.mkdirSync(path.join(tmp, 'eu4', 'common'), { recursive: true })
fs.mkdirSync(path.join(tmp, 'mod', 'events'), { recursive: true })
fs.writeFileSync(path.join(tmp, 'mod', 'descriptor.mod'), 'name="x"\n', 'utf8')
fs.writeFileSync(path.join(tmp, 'mod', 'events', 'a.txt'), `namespace = adj
country_event = {
  id = adj.1
  title = adj.1.t
  trigger = {
    any_neighbor_province = { province_id = 265 }
  }
}
`, 'utf8')
const wb = new Workbench({ eu4Root: path.join(tmp, 'eu4'), modDir: path.join(tmp, 'mod'), eu4UserDir: '', statePath: path.join(tmp, 'state.json') })
wb.init()
const form = await wb.eventForm('events/a.txt', 'adj.1')
const cond = (form.conditions || []).find((row) => row.type === 'any_neighbor_province')
check('engine parses any_neighbor_province', Boolean(cond) && cond.value === '265', JSON.stringify(form.conditions))

const preview = buildRawPreview({
  event: {
    id: 'adj.1', kind: 'country_event', title: '', desc: '',
    conditions: [{ type: 'any_neighbor_province', op: '=', value: '265' }], options: [],
  },
})
check('preview renders neighbor block', preview.includes('any_neighbor_province = { province_id = 265 }'), preview)
check('preview keeps event shell', preview.startsWith('country_event = {') && preview.trimEnd().endsWith('}'))
fs.rmSync(tmp, { recursive: true, force: true })

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
if (React) {
  let factory = null
  globalThis.window = { __ModuleLoader__: { load(definition) { factory = definition.factory } } }
  await import('../client.js')
  const plugin = factory((name) => {
    if (name === 'react') return React
    throw new Error('unexpected require: ' + name)
  })
  const internals = plugin.testInternals
  internals.updateFormMemory('eventForm', {
    file: 'events/a.txt', id: 'adj.1', kind: 'country_event', namespace: 'adj',
    title: 'T', desc: 'D', triggerMode: 'normal',
    conditions: [{ type: 'any_neighbor_province', op: '=', value: '265' }],
    options: [{ name: 'adj.1.a', effects: [] }], isNew: true,
  })
  internals.updateFormMemory('eventForm.isNew', true)
  const html = internals.renderTabForTest('EventsTab', React, ReactDOMServer)
  check('neighbor picker asks for map focus', html.includes('先在地图选择一个省份'), html.includes('neighbor.pickOnMap') ? 'raw key' : '')
  const panelHtml = ReactDOMServer.renderToStaticMarkup(React.createElement(internals.Panel))
  check('panel mounts with focus provider', panelHtml.includes('eu4w-root') && panelHtml.includes('eu4w-head'), '')
  const mapHtml = internals.renderTabForTest('MapTab', React, ReactDOMServer)
  check('map tab renders detail card', mapHtml.includes('省份详情') || mapHtml.includes('map.details'), '')
}

if (failed) process.exit(1)
