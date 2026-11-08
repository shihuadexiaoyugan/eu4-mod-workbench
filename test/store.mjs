/**
 * Form memory test: edits survive a tab "remount" without the removed draft
 * layer — no localStorage, no dirty flags, no draft UI — and every tab still
 * renders headlessly.
 */
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { UI_MESSAGES } from '../lib/ui-locales.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const candidates = []
if (process.env.DSH_PROFILE_DIR) candidates.push(path.join(process.env.DSH_PROFILE_DIR, 'package.json'))
candidates.push(path.join(here, '..', 'package.json'))

let req = null
let React = null
let ReactDOMServer = null
for (const manifest of candidates) {
  if (!existsSync(manifest)) continue
  try {
    req = createRequire(manifest)
    React = req('react')
    ReactDOMServer = req('react-dom/server')
    break
  } catch { req = null }
}
if (!req || !React || !ReactDOMServer) {
  console.log('skipped: react not resolvable')
  process.exit(0)
}

// Any access to localStorage is a failure: the draft layer is gone.
let storageTouched = 0
const fail = (what) => () => { storageTouched += 1; throw new Error('localStorage must not be ' + what) }
let factory = null
globalThis.window = {
  __ModuleLoader__: { load(definition) { factory = definition.factory } },
  localStorage: { getItem: fail('read'), setItem: fail('written'), removeItem: fail('removed') },
  confirm: () => { throw new Error('tab switching must not prompt') },
}

await import('../client.js')
if (!factory) throw new Error('client module did not register a factory')
const plugin = factory((name) => {
  if (name === 'react') return React
  throw new Error('unexpected require: ' + name)
})
const internals = plugin.testInternals
if (!internals) throw new Error('plugin did not expose testInternals')

let failed = 0
const check = (name, ok, detail = '') => {
  console.log((ok ? 'ok  ' : 'FAIL') + ' ' + name + (detail ? ' — ' + detail : ''))
  if (!ok) failed++
}

/* ---------------- form memory semantics ---------------- */
const initialEvent = { id: 'event.1', options: [] }
check('initial value stored once', internals.rememberForm('eventForm', initialEvent) === initialEvent)
internals.updateFormMemory('eventForm', { id: 'event.2' })
check('tab switch keeps the edit', internals.rememberForm('eventForm', { id: 'initial' }).id === 'event.2')
check('keys are independent', internals.rememberForm('provinceForm', { id: 2664 }).id === 2664)
internals.updateFormMemory('provinceForm', { id: 267 })
check('second key keeps its edit', internals.rememberForm('provinceForm', { id: 2664 }).id === 267)
internals.updateFormMemory('provinceForm', { id: 2664 })
check('reset restores the initial value', internals.rememberForm('provinceForm', { id: 1 }).id === 2664)

/* ---------------- every tab renders without a Host ---------------- */
for (const tab of ['ProvinceTab', 'MapTab', 'BatchTab', 'EventsTab', 'MissionsTab']) {
  const html = internals.renderTabForTest(tab, React, ReactDOMServer)
  check('render ' + tab, typeof html === 'string' && html.length > 100, html.length + ' bytes')
}
check('no localStorage access during render', storageTouched === 0, String(storageTouched))

/* ---------------- source and locale cleanup ---------------- */
const source = fs.readFileSync(path.join(here, '..', 'client.js'), 'utf8')
check('global draft store removed', !source.includes('__EU4W_STORE__') && !source.includes('draftStates') && !source.includes('draftMeta'))
check('draft badge removed', !source.includes('eu4w-draft-badge'))
check('leave confirmation removed', !source.includes('draft.leaveConfirm') && !source.includes('beforeunload'))
check('save-draft button removed', !source.includes("t('draft.save')"))
check('no draft leftovers', !source.includes('hasDirtyDrafts') && !source.includes('saveAllDrafts') && !source.includes('setDraft('))
check('form memory hook present', source.includes('function useFormState') && source.includes('rememberForm'))
const draftKeys = Object.keys(UI_MESSAGES).filter((key) => key.startsWith('draft.'))
check('locale draft keys removed', draftKeys.length === 0, draftKeys.join(','))

if (failed) process.exit(1)
