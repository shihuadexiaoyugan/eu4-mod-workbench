/**
 * Modifier catalogue + tree selector: full key coverage from the shipped
 * documentation, Chinese labels, category tree, fuzzy search and the
 * English-key binding (display Chinese, store the key).
 */
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  MODIFIER_OPTIONS,
  MODIFIER_TREE,
  MODIFIER_CATEGORIES,
  modifierLabelOf,
  modifierCategoryLabelOf,
  modifierValueType,
} from '../lib/eu4-dictionary.js'

const here = path.dirname(fileURLToPath(import.meta.url))
let failed = 0
const check = (name, ok, detail = '') => {
  console.log((ok ? 'ok  ' : 'FAIL') + ' ' + name + (detail ? ' — ' + detail : ''))
  if (!ok) failed++
}

/* ------------------------------ catalogue ------------------------------ */
const byKey = new Map(MODIFIER_OPTIONS.map((option) => [option.value, option]))
const docs = JSON.parse(fs.readFileSync(path.join(here, '..', 'lib', 'docs-data.json'), 'utf8'))
const documented = new Set((docs.entries || [])
  .filter((entry) => entry.kind === 'modifier' && String(entry.signature ?? '').trim() !== '' && Number.isFinite(Number(String(entry.signature).trim())))
  .map((entry) => entry.name))

check('catalogue is large', MODIFIER_OPTIONS.length >= 300, String(MODIFIER_OPTIONS.length))
check('catalogue has no duplicates', MODIFIER_OPTIONS.length === byKey.size)
check('catalogue covers every documented key', [...documented].every((key) => byKey.has(key)), String([...documented].filter((key) => !byKey.has(key)).length) + ' missing')
check('every entry carries a Chinese label', MODIFIER_OPTIONS.every((option) => /[\u4e00-\u9fff]/.test(option.label || '')), '')
check('every entry carries a category group', MODIFIER_OPTIONS.every((option) => /^(military|economy|diplomacy|internal|misc)\./.test(option.group || '')))

check('five categories', MODIFIER_CATEGORIES.length === 5 && MODIFIER_CATEGORIES.map((cat) => cat.label).join(',') === '军事,经济,外交,内部,其他')
const treeTotal = MODIFIER_TREE.reduce((sum, category) => sum + category.groups.reduce((n, group) => n + group.items.length, 0), 0)
check('tree holds every modifier', treeTotal === MODIFIER_OPTIONS.length, treeTotal + '/' + MODIFIER_OPTIONS.length)
check('tree has military group', MODIFIER_TREE.find((cat) => cat.id === 'military')?.groups.some((group) => group.items.some((item) => item.value === 'discipline')))
check('tree has internal unrest', MODIFIER_TREE.find((cat) => cat.id === 'internal')?.groups.find((group) => group.id === 'unrest')?.items.some((item) => item.value === 'global_unrest'))

check('label land_morale', byKey.get('land_morale')?.label === '陆军士气')
check('label global_unrest', byKey.get('global_unrest')?.label === '全局叛乱度')
check('label development_cost', byKey.get('development_cost')?.label === '发展成本')
check('label global_tax_modifier', byKey.get('global_tax_modifier')?.label === '全国税收')
check('label build_cost', byKey.get('build_cost')?.label === '建筑花费')
check('label diplomatic_reputation', byKey.get('diplomatic_reputation')?.label === '外交声望')
check('label same_culture_advisor_cost', byKey.get('same_culture_advisor_cost')?.label === '同文化顾问花费')
check('label stability_cost_modifier', byKey.get('stability_cost_modifier')?.label === '稳定度花费')
check('label global_manpower_modifier', byKey.get('global_manpower_modifier')?.label === '人力上限')

check('reverse lookup', modifierLabelOf('global_unrest') === '全局叛乱度', modifierLabelOf('global_unrest'))
check('reverse lookup unknown', modifierLabelOf('not_a_modifier') === '')
check('category lookup', modifierCategoryLabelOf('global_unrest') === '内部', modifierCategoryLabelOf('global_unrest'))
check('type percentage', modifierValueType('core_creation') === 'percentage')
check('type integer', modifierValueType('global_unrest') === 'integer')
check('type decimal', modifierValueType('yearly_absolutism') === 'decimal')

/* ------------------------------- client ------------------------------- */
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
  const flatten = (tree) => tree.flatMap((category) => category.groups.flatMap((group) => group.items))

  const rebels = flatten(internals.filterModifierTree(MODIFIER_TREE, '叛乱'))
  check('search 叛乱 finds global_unrest', rebels.some((item) => item.value === 'global_unrest'), rebels.map((item) => item.value).join(','))
  check('search 叛乱 results are Chinese', rebels.every((item) => /[\u4e00-\u9fff]/.test(item.label)))
  check('search 叛乱 narrows the tree', rebels.length <= 8 && rebels.every((item) => item.label.includes('叛乱') || item.value.includes('unrest')))

  const morale = flatten(internals.filterModifierTree(MODIFIER_TREE, 'morale')).map((item) => item.value)
  check('search english key', morale.includes('land_morale') && morale.includes('naval_morale'), morale.join(','))
  const pinyin = flatten(internals.filterModifierTree(MODIFIER_TREE, 'shiqi')).map((item) => item.value)
  check('search pinyin alias', pinyin.includes('land_morale'), pinyin.join(','))
  const exact = flatten(internals.filterModifierTree(MODIFIER_TREE, 'global_unrest'))
  check('search exact key returns one', exact.length === 1 && exact[0].label === '全局叛乱度')
  check('search miss is empty', internals.filterModifierTree(MODIFIER_TREE, 'zzzzz').length === 0)
  check('modifierLabelFrom reverse lookup', internals.modifierLabelFrom(MODIFIER_OPTIONS, 'global_unrest') === '全局叛乱度')
  check('modifierLabelFrom unknown keeps key', internals.modifierLabelFrom(MODIFIER_OPTIONS, 'custom_key') === 'custom_key')

  // Mount the Ideas panel with a raw English key and make sure the row shows
  // the Chinese label (Task 3): value stays the key, display is localized.
  internals.updateFormMemory('ideaForm.traditions', [
    { modifiers: [{ modifier: 'global_unrest', value: '-3' }] },
    { modifiers: [{ modifier: 'same_culture_advisor_cost', value: '-0.25' }] },
  ])
  internals.updateFormMemory('ideaForm.ambition', { modifiers: [{ modifier: 'core_creation', value: '-0.2' }] })
  internals.updateFormMemory('ideaForm.ideas', Array.from({ length: 7 }, (_, i) => ({
    id: 'idea_' + (i + 1), name: '', desc: '', modifiers: [{ modifier: 'land_morale', value: '0.1' }],
  })))
  const dictionary = { modifiers: MODIFIER_OPTIONS, modifierTree: MODIFIER_TREE }
  const html = internals.renderTabForTest('IdeasTab', React, ReactDOMServer, { dictionary })
  check('key rendered as Chinese', html.includes('value="全局叛乱度"'), '')
  check('raw key kept as binding', html.includes('title="global_unrest"'), '')
  check('raw key not shown as value', !html.includes('value="global_unrest"'))
  check('decimal/integer rows render', html.includes('value="-3"'))
  check('percentage rows render', /value="-25"/.test(html) && /value="-20"/.test(html) && /value="10"/.test(html))

  // Unknown/custom keys must not crash: they fall back to the raw key.
  internals.updateFormMemory('ideaForm.traditions', [{ modifiers: [{ modifier: 'my_custom_modifier', value: '1' }] }])
  const fallbackHtml = internals.renderTabForTest('IdeasTab', React, ReactDOMServer, { dictionary })
  check('unknown key degrades to raw key', fallbackHtml.includes('value="my_custom_modifier"'))

  // Binding contract: the selector always passes the English key onward.
  const source = fs.readFileSync(path.join(here, '..', 'client.js'), 'utf8')
  check('selector binds item.value', source.includes('onChange(item.value)'))
  check('selector rows show [category] label (key)', source.includes('`[${category.label}] ${item.label} (${item.value})`'))
}

if (failed) process.exit(1)
