/**
 * Province-history timeline tests: dates at/before the scenario start date win;
 * future dated blocks are ignored; a future-only file stays unowned.
 */
import { normalizeStartDate, provinceHistoryAt, Workbench } from '../lib/engine.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let failed = 0
const check = (name, ok, detail = '') => {
  console.log((ok ? 'ok  ' : 'FAIL') + ' ' + name + (detail ? ' — ' + detail : ''))
  if (!ok) failed++
}

const text = [
  'owner = FRA',
  '1437.1.1 = { owner = TBO add_core = TBO }',
  '1444.1.1 = { owner = POL add_core = POL }',
].join('\n')

const at1437 = provinceHistoryAt(text, '1437.1.1')
check('1437 owner TBO', at1437.owner === 'TBO', at1437.owner)
check('1437 core TBO', at1437.cores.includes('TBO'))
check('1437 ignores POL', !at1437.cores.includes('POL'))
const at1443 = provinceHistoryAt(text, '1443.1.1')
check('1443 still TBO', at1443.owner === 'TBO')
const at1444 = provinceHistoryAt(text, '1444.1.1')
check('1444 owner POL', at1444.owner === 'POL')
const before = provinceHistoryAt(text, '1436.1.1')
check('1436 falls back to base owner', before.owner === 'FRA')

const futureOnly = provinceHistoryAt('1444.1.1 = { owner = POL }', '1437.1.1')
check('future-only unowned', futureOnly.owner === '' && futureOnly.unresolved === true)
check('future-only warning', typeof futureOnly.historyWarning === 'string' && futureOnly.hasFuture === true)
check('invalid date rejected', normalizeStartDate('not-a-date') === null)

// Mod history must win over a vanilla file for the same province id.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eu4w-dates-'))
const eu4 = path.join(tmp, 'eu4')
const mod = path.join(tmp, 'mod')
fs.mkdirSync(path.join(eu4, 'map'), { recursive: true })
fs.mkdirSync(path.join(eu4, 'history', 'provinces'), { recursive: true })
fs.mkdirSync(path.join(mod, 'history', 'provinces'), { recursive: true })
fs.writeFileSync(path.join(eu4, 'map', 'definition.csv'), '2664;0;0;0;Plzen;x\n', 'latin1')
fs.writeFileSync(path.join(eu4, 'history', 'provinces', '2664 - Plzen.txt'), '1444.1.1 = { owner = POL }\n')
fs.writeFileSync(path.join(mod, 'history', 'provinces', '2664 - Plzen.txt'), '1437.1.1 = { owner = TBO add_core = TBO }\n')
const wb = new Workbench({ eu4Root: eu4, modDir: mod, eu4UserDir: '', statePath: path.join(tmp, 'state.json') })
wb.init()
wb.setStartDate('1437.1.1')
const modResult = wb.mapQuery({ provinceId: 2664 })
check('mod priority at 1437', modResult.provinces[0]?.owner === 'TBO', modResult.provinces[0]?.owner)
wb.setStartDate('1444.1.1')
const later = wb.mapQuery({ provinceId: 2664 })
check('mod timeline still wins at 1444', later.provinces[0]?.owner === 'TBO', later.provinces[0]?.owner)
fs.rmSync(tmp, { recursive: true, force: true })

if (failed) process.exit(1)
