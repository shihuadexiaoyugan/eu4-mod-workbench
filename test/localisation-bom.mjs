/**
 * Event localisation: forced filename, UTF-8 BOM (>3 bytes), exact keys,
 * and the active-language fallback (game is often l_english).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Workbench } from '../lib/engine.js'
import { buildAIPayload } from '../lib/ai.js'
import { buildBatchPrompt } from '../lib/batch.js'

let failed = 0
const check = (name, ok, detail = '') => {
  console.log((ok ? '  ok  ' : 'FAIL') + ' ' + name + (detail ? ' — ' + detail : ''))
  if (!ok) failed++
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eu4w-loc-'))
fs.mkdirSync(path.join(tmp, 'eu4', 'common'), { recursive: true })
fs.mkdirSync(path.join(tmp, 'mod', 'events'), { recursive: true })
fs.mkdirSync(path.join(tmp, 'mod', 'localisation'), { recursive: true })
fs.writeFileSync(path.join(tmp, 'mod', 'descriptor.mod'), 'name="x"\n', 'utf8')
fs.writeFileSync(path.join(tmp, 'mod', 'events', 'x.txt'), 'namespace = x\ncountry_event = { id = x.1 title = "x.1.t" desc = "x.1.d" }\n', 'utf8')
const wb = new Workbench({ eu4Root: path.join(tmp, 'eu4'), modDir: path.join(tmp, 'mod'), eu4UserDir: '', statePath: path.join(tmp, 'state.json') })
wb.init()

const simp = path.join(tmp, 'mod', 'localisation', 'zz_eu4_workbench_l_simp_chinese.yml')
const active = path.join(tmp, 'mod', 'localisation', 'zz_eu4_workbench_l_english.yml')
const body = 'l_simp_chinese:\n x.1.t:0 "中文标题"\n x.1.d:0 "中文描述"\n'
fs.writeFileSync(simp, '\uFEFF' + body, 'utf8')
fs.writeFileSync(active, '\uFEFF' + body.replace('l_simp_chinese:', 'l_english:'), 'utf8')

const read = () => wb.readBack({
  targetType: 'event', targetId: 'x.1', targetFile: 'events/x.txt', action: 'modify',
  localisationFile: 'localisation/zz_eu4_workbench_l_simp_chinese.yml',
})
const ok = await read()
check('BOM + keys accepted', ok.ok === true && ok.localisation.bom === true && ok.localisation.size > 3 && ok.localisation.keyOk === true, JSON.stringify(ok.localisation))
check('active language file checked', ok.localisation.active && ok.localisation.active.ok === true, JSON.stringify(ok.localisation.active))

const bytes = fs.readFileSync(simp)
fs.writeFileSync(simp, bytes.subarray(3), 'utf8')
const noBom = await read()
check('missing BOM fails', noBom.ok === false && noBom.localisation.bom === false && noBom.localisation.warning.includes('BOM'), JSON.stringify(noBom.localisation))
fs.writeFileSync(simp, '\uFEFF' + body.replace(' x.1.d:0 "中文描述"\n', ''), 'utf8')
const missingKey = await read()
check('missing desc key fails', missingKey.ok === false && missingKey.localisation.keyOk === false, JSON.stringify(missingKey.localisation))

const ai = buildAIPayload('event', 'create', {
  file: 'events/x.txt', id: 'x.1', kind: 'country_event', title: '中文标题', desc: '中文描述',
  activeLanguage: 'l_english', conditions: [], options: [],
})
check('payload forces new yml path', ai.prompt.includes('localisation/zz_eu4_workbench_l_simp_chinese.yml'), '')
check('payload requires BOM', ai.prompt.includes('EF BB BF') && ai.prompt.includes('larger than 3 bytes'), '')
check('payload writes active language file', ai.prompt.includes('localisation/zz_eu4_workbench_l_english.yml') && ai.prompt.toLowerCase().includes('otherwise the game shows english'), '')
check('payload exact key format', ai.prompt.includes('x.1.t:0 "') && ai.prompt.includes('one ASCII space after the colon'), '')

const batch = buildBatchPrompt([{
  id: 'e1', targetType: 'event', action: 'modify', targetId: 'x.1', targetFile: 'events/x.txt',
  data: { id: 'x.1', file: 'events/x.txt', triggerMode: 'normal', title: '中文标题', desc: '中文描述', options: [], localisationFile: 'localisation/zz_eu4_workbench_l_simp_chinese.yml' },
}], { modRoot: path.join(tmp, 'mod'), eu4Root: path.join(tmp, 'eu4'), modVerified: true, activeLanguage: 'l_english' }).prompt
check('batch forces BOM + dual file', batch.includes('EF BB BF') && batch.includes('zz_eu4_workbench_l_english.yml') && batch.includes('否则游戏会显示英文'), '')

fs.rmSync(tmp, { recursive: true, force: true })
if (failed) process.exit(1)
