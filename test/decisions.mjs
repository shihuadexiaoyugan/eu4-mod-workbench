/**
 * Country decisions: parser (potential vs allow), queue payload, batch prompt,
 * decision→event graph links and the Decisions tab config mapping.
 */
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Workbench } from '../lib/engine.js'
import { buildAIPayload } from '../lib/ai.js'
import { buildBatchPrompt } from '../lib/batch.js'

const here = path.dirname(fileURLToPath(import.meta.url))
let failed = 0
const check = (name, ok, detail = '') => {
  console.log((ok ? '  ok  ' : 'FAIL') + ' ' + name + (detail ? ' — ' + detail : ''))
  if (!ok) failed++
}

/* ------------------------------ fixture ------------------------------ */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eu4w-dec-'))
fs.mkdirSync(path.join(tmp, 'eu4', 'common'), { recursive: true })
fs.mkdirSync(path.join(tmp, 'mod', 'decisions'), { recursive: true })
fs.mkdirSync(path.join(tmp, 'mod', 'localisation'), { recursive: true })
fs.writeFileSync(path.join(tmp, 'mod', 'decisions', 'TBO_decisions.txt'), `country_decisions = {
  tbo_decision.1 = {
    potential = { tag = TBO is_year = 1437 }
    allow = { stability = 1 treasury = 100 }
    effect = {
      add_stability = 1
      country_event = { id = flavor_boh.1 days = 0 }
      add_country_modifier = { name = last_stand_modifier duration = 1825 }
    }
    ai_will_do = { factor = 2 }
  }
  tbo_decision.2 = {
    potential = { tag = BOH }
    allow = { stability = 0 }
    effect = { add_prestige = 5 }
  }
  tbo_decision.3 = {
    potential = { tag = TBO }
    allow = { treasury = 50 }
    effect = { add_treasury = 100 }
    ai_will_do = { factor = 0 }
  }
}
`, 'utf8')
fs.writeFileSync(path.join(tmp, 'mod', 'localisation', 'd_l_simp_chinese.yml'), `l_simp_chinese:
 tbo_decision.1_title:0 "最后的防线"
 tbo_decision.1_desc:0 "波希米亚需要最后一战。"
 tbo_decision.2_title:0 "波希米亚决议"
`, 'utf8')
const wb = new Workbench({
  eu4Root: path.join(tmp, 'eu4'),
  modDir: path.join(tmp, 'mod'),
  eu4UserDir: '',
  statePath: path.join(tmp, 'state.json'),
})
wb.init()

const tbo = await wb.decisionsForTag('TBO')
check('decision parsed for tag', tbo.items.map((item) => item.id).join(',') === 'tbo_decision.1,tbo_decision.3', tbo.items.map((item) => item.id).join(','))
const dec = tbo.items[0]
check('potential parsed (visible)', dec.potential.some((row) => row.type === 'tag' && row.value === 'TBO') && dec.potential.some((row) => row.type === 'is_year' && row.value === '1437'), JSON.stringify(dec.potential))
check('allow parsed (clickable)', dec.allow.some((row) => row.type === 'stability' && row.value === '1') && dec.allow.some((row) => row.type === 'treasury' && row.value === '100'), JSON.stringify(dec.allow))
check('stability/treasury are known triggers', dec.allow.every((row) => !row.unknown), JSON.stringify(dec.allow))
check('effects parsed', dec.effects.some((row) => row.effect === 'add_stability') && dec.effects.some((row) => row.effect === 'country_event') && dec.effects.some((row) => row.effect === 'add_country_modifier'), JSON.stringify(dec.effects))
check('ai_will_do parsed', dec.ai_will_do === 2, String(dec.ai_will_do))
check('ai 0 preserved', tbo.items.find((item) => item.id === 'tbo_decision.3').ai_will_do === 0)
check('titles resolved', dec.title_cn === '最后的防线' && dec.desc_cn === '波希米亚需要最后一战。', JSON.stringify([dec.title_cn, dec.desc_cn]))
check('tag filter excludes other tags', tbo.items.every((item) => !item.tags.length || item.tags.includes('TBO')))
const boh = await wb.decisionsForTag('BOH')
check('BOH filter works', boh.items.some((item) => item.id === 'tbo_decision.2') && !boh.items.some((item) => item.id === 'tbo_decision.1'))
const all = await wb.decisionsForTag('')
check('unfiltered returns all', all.total === 3, String(all.total))
check('event refs detected', dec.eventRefs.includes('flavor_boh.1'), JSON.stringify(dec.eventRefs))

const graph = await wb.eventGraphAsync()
const decisionNode = graph.nodes.find((node) => node.id === 'decision:tbo_decision.1')
check('decision node in graph', Boolean(decisionNode) && decisionNode.kind === 'decision', decisionNode && decisionNode.kind)
check('decision node tagged', Boolean(decisionNode) && decisionNode.triggerTags.includes('TBO'), JSON.stringify(decisionNode && decisionNode.triggerTags))
const link = graph.edges.find((edge) => edge.from === 'decision:tbo_decision.1' && edge.to === 'flavor_boh.1')
check('dashed decision -> event edge', Boolean(link) && link.dashed === true, JSON.stringify(link))
check('unlinked decision not added', !graph.nodes.some((node) => node.id === 'decision:tbo_decision.2'))

/* ------------------------------- queue ------------------------------- */
wb.addChange({
  targetType: 'decision', action: 'create', targetId: 'tbo_decision.1', targetFile: 'decisions/TBO_decisions.txt',
  data: {
    id: 'tbo_decision.1', title_cn: '最后的防线', desc_cn: '描述', file: 'decisions/TBO_decisions.txt',
    potential: [{ type: 'tag', op: '=', value: 'TBO' }],
    allow: [{ type: 'stability', op: '=', value: '1' }],
    effects: [{ effect: 'add_country_modifier', params: { name: 'last_stand_modifier', nameZh: '最后一战', duration: '1825', stats: { land_morale: 0.2 }, newModifier: true } }],
    ai_will_do: 1,
  },
})
const queue = wb.listChanges()
check('decision queue items', queue.length === 2 && queue[0].targetType === 'mechanic' && queue[1].targetType === 'decision', queue.map((item) => item.targetType).join(','))
const batch = buildBatchPrompt(queue)
check('batch decision structure', batch.prompt.includes('country_decisions = { tbo_decision.1'))
check('batch potential/allow rule', batch.prompt.includes('potential 只决定「是否可见」') && batch.prompt.includes('allow 决定「是否可点击」'))
check('batch title/desc keys', batch.prompt.includes('tbo_decision.1_title:0 "最后的防线"') && batch.prompt.includes('tbo_decision.1_desc:0'))
check('batch ai_will_do', batch.prompt.includes('ai_will_do = { factor = 1 }'))
check('batch validate_script', batch.prompt.includes('validate_script'))
check('batch new modifier co-task', batch.prompt.includes('[New modifier tasks / 新修正强指令]'))

/* ------------------------------ AI prompt ------------------------------ */
const payload = buildAIPayload('decision', 'create', {
  file: 'decisions/TBO_decisions.txt',
  id: 'tbo_decision.1',
  title_cn: '最后的防线',
  desc_cn: '描述',
  potential: [{ type: 'tag', op: '=', value: 'TBO' }],
  allow: [{ type: 'stability', op: '=', value: '1' }],
  effects: [{ effect: 'add_stability', value: '1' }],
  ai_will_do: 1,
})
check('decision ai kind', payload.kind === 'decision' && payload.payload.id === 'tbo_decision.1')
check('decision ai structure', payload.prompt.includes('country_decisions = { tbo_decision.1 = { ... } }'))
check('decision ai localisation', payload.prompt.includes('tbo_decision.1_title') && payload.prompt.includes('tbo_decision.1_desc'))
check('decision ai validate', /validate_script/.test(payload.prompt))
check('decision ai separates potential/allow', payload.prompt.includes('potential 只决定决议「是否可见」') && payload.prompt.includes('allow 决定决议「是否可以点击」'))

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
  const config = internals.decisionConfigOf({
    id: 'tbo_decision.1', title_cn: '最后的防线', desc_cn: '描述',
    potential: [{ type: 'tag', op: '=', value: 'TBO' }],
    allow: [{ type: 'stability', op: '=', value: '1' }],
    effects: [{ effect: 'add_stability', value: '1' }],
    ai_will_do: '2',
  })
  check('DecisionConfig keys', JSON.stringify(Object.keys(config)) === JSON.stringify(['id', 'title_cn', 'desc_cn', 'potential', 'allow', 'effects', 'ai_will_do']), JSON.stringify(Object.keys(config)))
  check('DecisionConfig ai number', config.ai_will_do === 2 && typeof config.ai_will_do === 'number')
  check('DecisionConfig default ai', internals.decisionConfigOf({ id: 'x', ai_will_do: '' }).ai_will_do === 1)
  check('DecisionConfig array defaults', Array.isArray(internals.decisionConfigOf({ id: 'x' }).potential))

  internals.updateFormMemory('decisionForm', {
    file: 'decisions/TBO_decisions.txt', id: 'tbo_decision.1', title_cn: '最后的防线', desc_cn: '描述',
    icon: '', potential: [{ type: 'tag', op: '=', value: 'TBO' }],
    allow: [{ type: 'stability', op: '=', value: '1' }],
    effects: [{ effect: 'add_stability', value: '1' }], ai_will_do: '2',
    localisationFile: 'localisation/zz_eu4_workbench_decisions_l_simp_chinese.yml',
  })
  const html = internals.renderTabForTest('DecisionsTab', React, ReactDOMServer)
  check('ui renders potential section', html.includes('显示条件 (potential)'))
  check('ui renders allow section', html.includes('执行条件 (allow)'))
  check('ui shows default tag', html.includes('value="TBO"'))
  check('ui shows ai_will_do', html.includes('value="2"'))
  check('ui shows title', html.includes('value="最后的防线"'))
  check('ui shows loc hint keys', html.includes('tbo_decision.1_title') && html.includes('tbo_decision.1_desc'))
  check('ui shows allow condition value', html.includes('value="1"'))
}
fs.rmSync(tmp, { recursive: true, force: true })

if (failed) process.exit(1)
