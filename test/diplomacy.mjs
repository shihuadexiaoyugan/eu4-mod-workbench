/**
 * Opening diplomacy: native block generation, war/truce/rival routing, and
 * read-back of first/second/start_date/brace balance.
 */
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Workbench } from '../lib/engine.js'
import { buildBatchPrompt } from '../lib/batch.js'

const here = path.dirname(fileURLToPath(import.meta.url))
let failed = 0
const check = (name, ok, detail = '') => {
  console.log((ok ? '  ok  ' : 'FAIL') + ' ' + name + (detail ? ' — ' + detail : ''))
  if (!ok) failed++
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eu4w-dip-'))
fs.mkdirSync(path.join(tmp, 'eu4', 'common'), { recursive: true })
fs.mkdirSync(path.join(tmp, 'mod', 'history', 'diplomacy'), { recursive: true })
fs.mkdirSync(path.join(tmp, 'mod', 'history', 'wars'), { recursive: true })
fs.mkdirSync(path.join(tmp, 'mod', 'common', 'on_actions'), { recursive: true })
fs.writeFileSync(path.join(tmp, 'mod', 'descriptor.mod'), 'name="x"\n', 'utf8')
const wb = new Workbench({ eu4Root: path.join(tmp, 'eu4'), modDir: path.join(tmp, 'mod'), eu4UserDir: '', statePath: path.join(tmp, 'state.json') })
wb.init()

const prompt = (rel, extra = '') => buildBatchPrompt([{
  id: 'd1', targetType: 'diplomacy', action: 'modify', targetId: 'TBO-BOH-' + rel,
  targetFile: 'history/diplomacy/zz_eu4_workbench_diplomacy.txt',
  data: { tagA: 'TBO', tagB: 'BOH', relationType: rel, extraParams: extra, startDate: '1437.1.1' },
}], { modRoot: path.join(tmp, 'mod'), eu4Root: path.join(tmp, 'eu4'), modVerified: true, startDate: '1437.1.1' }).prompt

const alliance = prompt('alliance')
check('alliance prompt uses start_date (not date block)', alliance.includes('alliance = {\n    first = TBO\n    second = BOH\n    start_date = 1437.1.1'), '')
check('alliance prompt forbids date block', alliance.includes('不使用日期块') && alliance.includes('不要写'), '')
check('alliance prompt targets Mod diplomacy file', alliance.includes('history/diplomacy/zz_eu4_workbench_diplomacy.txt'), '')

const vassal = prompt('vassal')
check('vassal first = overlord', vassal.includes('first 是宗主（overlord）') && vassal.includes('second 是附庸（vassal）'), '')
const war = prompt('war', 'cb_conquest')
check('war routed to history/wars', war.includes('history/wars/zz_eu4_workbench_diplomacy_wars.txt'), '')
check('war includes CB and both sides', war.includes('casus_belli = cb_conquest') && war.includes('add_attacker = TBO') && war.includes('add_defender = BOH'), '')
const truce = prompt('truce', '1442')
check('truce routed to on_startup', truce.includes('on_startup') && truce.includes('add_truce_with') && truce.includes('双向'), '')
const rival = prompt('rival')
check('rival uses historical rival both ways', rival.includes('add_historical_rival') && rival.includes('add_historical_rival = BOH') && rival.includes('add_historical_rival = TBO'), '')

/* ------------------------------ read-back ------------------------------ */
const dipFile = path.join(tmp, 'mod', 'history', 'diplomacy', 'zz_eu4_workbench_diplomacy.txt')
fs.writeFileSync(dipFile, `alliance = {\n\tfirst = TBO\n\tsecond = BOH\n\tstart_date = 1437.1.1\n}\n\nvassal = {\n\tfirst = BOH\n\tsecond = TBO\n\tstart_date = 1437.1.1\n}\n`, 'utf8')
const okAlliance = await wb.readBack({ targetType: 'diplomacy', targetId: 'TBO-BOH-alliance', targetFile: 'history/diplomacy/zz_eu4_workbench_diplomacy.txt', action: 'modify', tagA: 'TBO', tagB: 'BOH', relationType: 'alliance', startDate: '1437.1.1' })
check('alliance read-back found', okAlliance.ok === true && okAlliance.diplomacy.found === true && okAlliance.diplomacy.startDateOk === true, JSON.stringify(okAlliance.diplomacy))
const badDate = await wb.readBack({ targetType: 'diplomacy', targetId: 'TBO-BOH-alliance', targetFile: 'history/diplomacy/zz_eu4_workbench_diplomacy.txt', action: 'modify', tagA: 'TBO', tagB: 'BOH', relationType: 'alliance', startDate: '1444.11.11' })
check('wrong start_date fails', badDate.ok === false && badDate.diplomacy.startDateOk === false, JSON.stringify(badDate.diplomacy))
const reversed = await wb.readBack({ targetType: 'diplomacy', targetId: 'TBO-BOH-vassal', targetFile: 'history/diplomacy/zz_eu4_workbench_diplomacy.txt', action: 'modify', tagA: 'TBO', tagB: 'BOH', relationType: 'vassal', startDate: '1437.1.1' })
check('reversed vassal warns/fails', reversed.ok === false && reversed.diplomacy.directionOk === false && reversed.diplomacy.warning.includes('方向'), JSON.stringify(reversed.diplomacy))

fs.writeFileSync(dipFile, 'alliance = {\n\tfirst = TBO\n\tsecond = BOH\n\tstart_date = 1437.1.1\n', 'utf8')
const unbalanced = await wb.readBack({ targetType: 'diplomacy', targetId: 'TBO-BOH-alliance', targetFile: 'history/diplomacy/zz_eu4_workbench_diplomacy.txt', action: 'modify', tagA: 'TBO', tagB: 'BOH', relationType: 'alliance', startDate: '1437.1.1' })
check('unbalanced braces fail', unbalanced.diplomacy.balanced === false && unbalanced.ok === false, JSON.stringify(unbalanced.diplomacy))

const warFile = path.join(tmp, 'mod', 'history', 'wars', 'zz_eu4_workbench_diplomacy_wars.txt')
fs.writeFileSync(warFile, 'name = "TBO - BOH War"\nwar_goal = {\n\ttype = take_border\n\tcasus_belli = cb_conquest\n}\n\n1437.1.1 = {\n\tadd_attacker = TBO\n\tadd_defender = BOH\n}\n', 'utf8')
const warRb = await wb.readBack({ targetType: 'diplomacy', targetId: 'TBO-BOH-war', targetFile: 'history/wars/zz_eu4_workbench_diplomacy_wars.txt', action: 'modify', tagA: 'TBO', tagB: 'BOH', relationType: 'war', extraParams: 'cb_conquest', startDate: '1437.1.1' })
check('war read-back finds attacker/defender/CB', warRb.ok === true && warRb.diplomacy.cbMatches === true && warRb.diplomacy.attacker && warRb.diplomacy.defender, JSON.stringify(warRb.diplomacy))

const onFile = path.join(tmp, 'mod', 'common', 'on_actions', 'zz_eu4_workbench_on_actions.txt')
fs.writeFileSync(onFile, 'on_startup = {\n\teffect = {\n\t\tif = { limit = { exists = TBO } TBO = { add_truce_with = BOH } }\n\t\tif = { limit = { exists = BOH } BOH = { add_truce_with = TBO } }\n\t}\n}\n', 'utf8')
const truceRb = await wb.readBack({ targetType: 'diplomacy', targetId: 'TBO-BOH-truce', targetFile: 'common/on_actions/zz_eu4_workbench_on_actions.txt', action: 'modify', tagA: 'TBO', tagB: 'BOH', relationType: 'truce', extraParams: '1442', startDate: '1437.1.1' })
check('truce read-back requires both directions', truceRb.ok === true && truceRb.diplomacy.forward && truceRb.diplomacy.backward, JSON.stringify(truceRb.diplomacy))

/* ------------------------------ client UI ------------------------------ */
const candidates = [path.join(process.env.DSH_PROFILE_DIR || '', 'package.json'), path.join(here, '..', 'package.json'), path.join(process.env.USERPROFILE || '', '.dsh', 'profiles', 'desktop', 'package.json')]
let React = null
let ReactDOMServer = null
for (const manifest of candidates) {
  if (!manifest || !existsSync(manifest)) continue
  try { const req = createRequire(manifest); React = req('react'); ReactDOMServer = req('react-dom/server'); break } catch { React = null }
}
if (React) {
  let factory = null
  globalThis.window = { __ModuleLoader__: { load(definition) { factory = definition.factory } } }
  await import('../client.js')
  const plugin = factory((name) => { if (name === 'react') return React; throw new Error(name) })
  const internals = plugin.testInternals
  const html = internals.renderTabForTest('DiplomacyTab', React, ReactDOMServer, { state: { currentStartDate: '1437.1.1' } })
  check('diplomacy tab renders', html.includes('开局外交关系') && html.includes('国家 A'), '')
  check('same tag validation', internals.diplomacyValidation({ tagA: 'TBO', tagB: 'TBO', relationType: 'alliance', extraParams: '', startDate: '1437.1.1' }) === 'dip.err.same', '')
  check('war requires CB', internals.diplomacyValidation({ tagA: 'TBO', tagB: 'BOH', relationType: 'war', extraParams: '', startDate: '1437.1.1' }) === 'dip.err.cb', '')
  check('all relation types available', internals.DIPLOMACY_RELATIONS.length === 8, '')
}

fs.rmSync(tmp, { recursive: true, force: true })
if (failed) process.exit(1)
