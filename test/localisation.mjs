/**
 * Dynamic localisation parser + priority: user > Mod > vanilla.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseLocalisationFolder, parseLocalisationText, Workbench } from '../lib/engine.js'

let failed = 0
const check = (name, ok, detail = '') => {
  console.log((ok ? 'ok  ' : 'FAIL') + ' ' + name + (detail ? ' — ' + detail : ''))
  if (!ok) failed++
}

const text = '\uFEFFl_english:\n czech:0 "Czech" # comment\n hussite:0 "Hussite"\n'
const parsed = parseLocalisationText(text)
check('BOM tolerated', parsed.czech === 'Czech')
check('value parsed', parsed.hussite === 'Hussite')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eu4w-loc-'))
const baseDir = path.join(tmp, 'localisation')
fs.mkdirSync(path.join(baseDir, 'replace'), { recursive: true })
fs.writeFileSync(path.join(baseDir, 'base.yml'), '\uFEFFa:0 "Alpha"\nb:0 "Beta"\n')
fs.writeFileSync(path.join(baseDir, 'replace', 'over.yml'), 'b:0 "Beta2"\nc:0 "Gamma"\n')
const folder = await parseLocalisationFolder(baseDir)
check('folder scan', folder.a === 'Alpha' && folder.b === 'Beta2' && folder.c === 'Gamma')

const eu4 = path.join(tmp, 'eu4')
const mod = path.join(tmp, 'mod')
fs.mkdirSync(path.join(eu4, 'localisation'), { recursive: true })
fs.mkdirSync(path.join(mod, 'localisation'), { recursive: true })
fs.writeFileSync(path.join(eu4, 'localisation', 'base.yml'), 'czech:0 "原版捷克"\n')
fs.writeFileSync(path.join(mod, 'localisation', 'mod.yml'), 'czech:0 "Mod捷克"\n')
const wb = new Workbench({ eu4Root: eu4, modDir: mod, eu4UserDir: '', statePath: path.join(tmp, 'state.json') })
wb.init()
const modLoc = await wb.localisation()
check('mod overrides vanilla', modLoc.get('czech') === 'Mod捷克', modLoc.get('czech'))
wb.setCustomDictionary('czech', '用户捷克')
const userLoc = await wb.localisation()
check('user overrides mod', userLoc.get('czech') === '用户捷克', userLoc.get('czech'))
fs.rmSync(tmp, { recursive: true, force: true })

if (failed) process.exit(1)
