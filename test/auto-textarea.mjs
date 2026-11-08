/**
 * Auto-resize textarea: height clamping, EU4 yml toolbar helpers and the
 * long-text fields (event/decision/idea/mission descriptions) rendering as
 * multi-line textareas instead of single-line inputs.
 */
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
let failed = 0
const check = (name, ok, detail = '') => {
  console.log((ok ? '  ok  ' : 'FAIL') + ' ' + name + (detail ? ' — ' + detail : ''))
  if (!ok) failed++
}

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
  console.log('skipped: react not resolvable')
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

/* ------------------------------ height clamp ------------------------------ */
check('short text stays above min', JSON.stringify(internals.clampTextareaHeight(30)) === JSON.stringify({ height: 60, overflow: false }))
check('normal text follows content', JSON.stringify(internals.clampTextareaHeight(120)) === JSON.stringify({ height: 120, overflow: false }))
check('long text clamps at max', JSON.stringify(internals.clampTextareaHeight(900)) === JSON.stringify({ height: 400, overflow: true }))
check('empty text uses min', internals.clampTextareaHeight(0).height === 60)
check('custom bounds', JSON.stringify(internals.clampTextareaHeight(500, 80, 200)) === JSON.stringify({ height: 200, overflow: true }))

/* ------------------------------ yml toolbar ------------------------------ */
const newline = internals.insertYmlTool('abc', 1, 1, 'newline')
check('newline inserts \\n', newline.value === 'a\\nbc', JSON.stringify(newline.value))
check('newline caret after insert', newline.caret === 3)
const highlight = internals.insertYmlTool('abc', 0, 2, 'highlight')
check('highlight wraps selection', highlight.value === '§Yab§!c', JSON.stringify(highlight.value))
const emptyHighlight = internals.insertYmlTool('abc', 1, 1, 'highlight')
check('highlight empty selection', emptyHighlight.value === 'a§Y§!bc')
check('tool clamps indices', internals.insertYmlTool('ab', 99, 200, 'highlight').value === 'ab§Y§!')

/* ------------------------------ SSR rendering ------------------------------ */
const longText = '波希米亚的冬天漫长而寒冷。'.repeat(40) // ~500 chars
internals.updateFormMemory('eventForm', {
  file: 'events/test.txt', id: 'hus_event.1', kind: 'country_event', namespace: 'hus_event',
  title: '布拉格之战', desc: longText, picture: '', triggerMode: 'normal',
  conditions: [], options: [{ name: 'a', effects: [] }], isNew: true,
})
internals.updateFormMemory('eventForm.isNew', true)
const eventHtml = internals.renderTabForTest('EventsTab', React, ReactDOMServer)
check('event desc is a textarea', eventHtml.includes('<textarea') && eventHtml.includes('eu4w-autotext-area'))
check('event desc renders long text', eventHtml.includes('波希米亚的冬天漫长而寒冷'))
check('event desc no single-line value', !eventHtml.includes('value="波希米亚的冬天'))
check('event desc toolbar', eventHtml.includes('换行') && eventHtml.includes('高亮'))
check('auto textarea keeps min/max style', eventHtml.includes('min-height:90px') && eventHtml.includes('max-height:400px'))

internals.updateFormMemory('decisionForm', {
  file: 'decisions/TBO_decisions.txt', id: 'tbo_decision.1', title_cn: '最后的防线', desc_cn: longText,
  icon: '', potential: [{ type: 'tag', op: '=', value: 'TBO' }], allow: [], effects: [], ai_will_do: '1',
})
const decisionHtml = internals.renderTabForTest('DecisionsTab', React, ReactDOMServer)
check('decision desc is a textarea', decisionHtml.includes('eu4w-autotext-area') && decisionHtml.includes('波希米亚的冬天'))
check('decision title stays input', decisionHtml.includes('value="最后的防线"'))

internals.updateFormMemory('ideaForm.ideas', Array.from({ length: 7 }, (_, i) => ({
  id: 'idea_' + (i + 1), name: '', desc: i === 0 ? longText : '', modifiers: [],
})))
const ideaHtml = internals.renderTabForTest('IdeasTab', React, ReactDOMServer)
check('idea desc is a textarea', ideaHtml.includes('eu4w-autotext-area') && ideaHtml.includes('波希米亚的冬天'))

const area = ReactDOMServer.renderToStaticMarkup(
  React.createElement(internals.AutoTextArea, { value: 'line1\nline2', onChange: () => {}, toolbar: true }),
)
check('textarea keeps newlines', area.includes('line1\nline2'))
check('resize none class present', area.includes('eu4w-autotext-area'))
const source = fs.readFileSync(path.join(here, '..', 'client.js'), 'utf8')
check('css resize none + overflow hidden', source.includes('.eu4w-autotext-area{resize:none;overflow:hidden'))

if (failed) process.exit(1)
