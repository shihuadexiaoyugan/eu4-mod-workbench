/**
 * National-ideas pipeline: parser (comments, indentation, multi-modifier),
 * file -> UI slot mapping, native<->display value conversion, and the
 * form-memory keys the header refresh clears.
 */
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseNationalIdeas, Workbench } from '../lib/engine.js'

const here = path.dirname(fileURLToPath(import.meta.url))
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

let failed = 0
const check = (name, ok, detail = '') => {
  console.log((ok ? 'ok  ' : 'FAIL') + ' ' + name + (detail ? ' — ' + detail : ''))
  if (!ok) failed++
}

/* ------------------------------- parser ------------------------------- */
const fixture = `
# 胡斯派理念（注释、缩进、空行都要能跳过）
TBO_ideas = {
	start = {
		infantry_cost = -0.10   # 步兵花费
		land_morale   = 0.10
	}

	bonus = {
		core_creation = -0.20
	}

	trigger = {
		has_country_flag = tbo_ideas
		NOT = { has_country_flag = refused_tbo_ideas }
	}
	free = yes

	boh_idea_1 = {
		discipline = 0.05
		land_morale = 0.1
	}
	boh_idea_2 = {
		manpower_recovery_speed = 0.15
		war_exhaustion = -0.03
	}
	boh_idea_3 = {
		may_perform_slave_raid_on_same_religion = yes
		infantry_power = 0.15
	}
	boh_idea_4 = { development_cost = -0.1 }
	boh_idea_5 = {
		cavalry_power = 0.2
	}
	boh_idea_6 = {
		max_manpower = 0.25
	}
	boh_idea_7 = {
		core_creation = -0.1
	}
}
`
const parsed = parseNationalIdeas(fixture, 'TBO')
check('group found despite comments', parsed.group === 'TBO_ideas', parsed.group)
check('start parsed', parsed.start.length === 2 && parsed.start[0].modifier === 'infantry_cost', JSON.stringify(parsed.start))
check('start values stay native', parsed.start[0].value === -0.1 && parsed.start[1].value === 0.1, JSON.stringify(parsed.start.map((m) => m.value)))
check('bonus parsed', parsed.bonus.length === 1 && parsed.bonus[0].modifier === 'core_creation' && parsed.bonus[0].value === -0.2, JSON.stringify(parsed.bonus))
check('trigger block skipped', !parsed.bonus.some((m) => m.modifier === 'has_country_flag'))
check('seven ideas found', parsed.ideas.length === 7, String(parsed.ideas.length))
check('idea ids extracted', parsed.ideas.map((idea) => idea.id).join(',').startsWith('boh_idea_1,boh_idea_2'))
check('multi-modifier idea', parsed.ideas[0].modifiers.length === 2, JSON.stringify(parsed.ideas[0].modifiers))
check('single-line idea block', parsed.ideas[3].modifiers[0].value === -0.1, JSON.stringify(parsed.ideas[3]))
check('non-numeric flag kept aside', parsed.flags.some((flag) => flag.includes('slave_raid')), JSON.stringify(parsed.flags))
check('no warnings on a full file', parsed.warnings.length === 0, JSON.stringify(parsed.warnings))

const empty = parseNationalIdeas('common_event = { }\n')
check('missing group degrades', empty.ideas.length === 0 && empty.warnings.length > 0, JSON.stringify(empty.warnings))
const short = parseNationalIdeas('X_ideas = { start = { a = 0.1 } }', 'X')
check('short file warns', short.warnings.some((w) => w.includes('7 idea blocks')), JSON.stringify(short.warnings))

/* A tag must never fall back to another country's block. */
const wrong = parseNationalIdeas(fixture, 'FRA')
check('wrong tag does not reuse another group', wrong.group === '' && wrong.ideas.length === 0, wrong.group)
check('wrong tag warns', wrong.warnings.some((w) => w.includes('FRA_ideas')), JSON.stringify(wrong.warnings))

/* ---------------------- backend: tag switch + cache ---------------------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eu4w-ideas-'))
fs.mkdirSync(path.join(tmp, 'eu4', 'common'), { recursive: true })
fs.mkdirSync(path.join(tmp, 'eu4', 'localisation'), { recursive: true })
fs.mkdirSync(path.join(tmp, 'mod', 'common', 'ideas'), { recursive: true })
fs.writeFileSync(path.join(tmp, 'mod', 'common', 'ideas', '00_country_ideas.txt'), `
BOH_ideas = {
  start = { land_morale = 0.1 discipline = 0.05 }
  bonus = { core_creation = -0.1 }
  compacta_of_prague = { tolerance_heretic = 3 }
  boh_1 = { discipline = 0.05 }
  boh_2 = { discipline = 0.05 }
  boh_3 = { discipline = 0.05 }
  boh_4 = { discipline = 0.05 }
  boh_5 = { discipline = 0.05 }
}
RUS_ideas = {
  start = { infantry_power = 0.1 }
  bonus = { manpower_recovery_speed = 0.5 }
  rus_1 = { discipline = 0.05 }
  rus_2 = { discipline = 0.05 }
  rus_3 = { discipline = 0.05 }
  rus_4 = { discipline = 0.05 }
  rus_5 = { discipline = 0.05 }
  rus_6 = { discipline = 0.05 }
  rus_7 = { discipline = 0.05 }
}
`, 'utf8')
const wb = new Workbench({
  eu4Root: path.join(tmp, 'eu4'),
  modDir: path.join(tmp, 'mod'),
  eu4UserDir: '',
  statePath: path.join(tmp, 'state.json'),
})
wb.init()
const bohIdeas = await wb.nationalIdeasFile('BOH')
const rusIdeas = await wb.nationalIdeasFile('RUS')
const bohAgain = await wb.nationalIdeasFile('BOH')
const unknownIdeas = await wb.nationalIdeasFile('FRA')
check('BOH group parsed', bohIdeas.group === 'BOH_ideas' && bohIdeas.ideas.some((idea) => idea.id === 'compacta_of_prague'), bohIdeas.group)
check('RUS group parsed', rusIdeas.group === 'RUS_ideas' && rusIdeas.ideas.some((idea) => idea.id === 'rus_1'), rusIdeas.group)
check('tag switch never reuses cache', !rusIdeas.ideas.some((idea) => idea.id === 'compacta_of_prague'), rusIdeas.ideas.map((idea) => idea.id).join(','))
check('switch back returns BOH', bohAgain.group === 'BOH_ideas' && bohAgain.ideas.some((idea) => idea.id === 'compacta_of_prague'))
check('unknown tag reports not found', unknownIdeas.exists === false && unknownIdeas.warnings.length > 0, JSON.stringify(unknownIdeas.warnings))
check('unknown tag has no borrowed ideas', unknownIdeas.ideas.length === 0, String(unknownIdeas.ideas.length))
fs.rmSync(tmp, { recursive: true, force: true })

/* ------------------------- file -> slots (client) ------------------------- */
const plugin = await (async () => {
  if (!React) return null
  let factory = null
  globalThis.window = { __ModuleLoader__: { load(definition) { factory = definition.factory } } }
  await import('../client.js')
  return factory((name) => {
    if (name === 'react') return React
    throw new Error('unexpected require: ' + name)
  })
})()
if (!plugin) {
  console.log('skipped client checks: react not resolvable')
} else {
  const internals = plugin.testInternals
  const slots = internals.ideasToSlots({
    traditions: [{ modifier: 'infantry_cost', value: -0.1 }, { modifier: 'land_morale', value: 0.1 }],
    ambitionModifiers: [{ modifier: 'core_creation', value: -0.2 }],
    ideas: [{ id: 'boh_idea_1', name: '圣杯布道者', desc: '描述', modifiers: [{ modifier: 'discipline', value: 0.05 }, { modifier: 'land_morale', value: 0.1 }] }],
  })
  check('slots keep both traditions', slots.traditions.length === 2 && slots.traditions[1].modifiers[0].modifier === 'land_morale')
  check('slots keep ambition', slots.ambition.modifiers[0].modifier === 'core_creation' && slots.ambition.modifiers[0].value === '-0.2')
  check('slots keep idea name', slots.ideas[0].name === '圣杯布道者', slots.ideas[0].name)
  check('slots keep multi modifiers', slots.ideas[0].modifiers.length === 2)
  check('slots pad to seven ideas', slots.ideas.length === 7 && slots.ideas[6].id === 'idea_7', slots.ideas.map((i) => i.id).join(','))

  // Rendering shows percent values: native 0.10 -> displayed 10.
  internals.updateFormMemory('ideaForm.traditions', slots.traditions)
  internals.updateFormMemory('ideaForm.ambition', slots.ambition)
  internals.updateFormMemory('ideaForm.ideas', slots.ideas)
  const html = internals.renderTabForTest('IdeasTab', React, ReactDOMServer)
  check('teaches display 10 for 0.10', /value="10"/.test(html))
  check('display -10 for -0.10', /value="-10"/.test(html))
  check('display -20 for -0.20', /value="-20"/.test(html))
  check('idea name rendered', html.includes('圣杯布道者'))
  check('seven idea blocks rendered', (html.match(/eu4w-card/g) || []).length >= 7)

  // Header refresh keeps the tag but clears the data slots (so RUS stays RUS).
  check('refresh keeps the tag', !internals.TAB_FORM_KEYS.ideas.includes('ideaForm.tag'), JSON.stringify(internals.TAB_FORM_KEYS.ideas))
  check('refresh clears the data slots', ['ideaForm.traditions', 'ideaForm.ambition', 'ideaForm.ideas', 'ideaForm.meta']
    .every((key) => internals.TAB_FORM_KEYS.ideas.includes(key)), JSON.stringify(internals.TAB_FORM_KEYS.ideas))
  internals.updateFormMemory('ideaForm.ideas', slots.ideas)
  internals.updateFormMemory('provinceForm', { id: 1 })
  internals.clearFormMemory(internals.TAB_FORM_KEYS.ideas)
  check('refresh clears idea memory', !internals.formMemory.has('ideaForm.ideas') && !internals.formMemory.has('ideaForm.meta'))
  check('refresh keeps other tabs', internals.formMemory.get('provinceForm')?.id === 1)
}

if (failed) process.exit(1)
