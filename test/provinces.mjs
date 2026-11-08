/**
 * Province dictionary: PROV keys, BOM, language priority, replace/, Mod,
 * three-in-one labels and the diacritic-insensitive search used by the UI.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  buildProvinceDictionary,
  decodeLocalisationBuffer,
  foldProvinceText,
  parseLocalisationLanguage,
  provinceLabel,
  provinceMatchScore,
  searchProvinceEntries,
  Workbench,
} from '../lib/engine.js'

let failed = 0
const check = (name, ok, detail = '') => {
  console.log((ok ? 'ok  ' : 'FAIL') + ' ' + name + (detail ? ' — ' + detail : ''))
  if (!ok) failed++
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eu4w-prov-'))
const vanilla = path.join(tmp, 'vanilla', 'localisation')
const mod = path.join(tmp, 'mod', 'localisation')
fs.mkdirSync(path.join(vanilla, 'replace'), { recursive: true })
fs.mkdirSync(mod, { recursive: true })

// English is the canonical name; the other vanilla language files must never
// overwrite it (real vanilla ships prov_names_l_english/french/german/spanish).
fs.writeFileSync(path.join(vanilla, 'prov_names_l_english.yml'), '\uFEFFl_english:\n PROV2664:0 "Plzen"\n PROV1:0 "Stockholm"\n PROV267:0 "Plzen"\n')
fs.writeFileSync(path.join(vanilla, 'prov_names_l_spanish.yml'), 'l_spanish:\n PROV1:0 "Estocolmo"\n PROV2664:0 "Pilsen"\n')
// A Chinese replacement pack (the usual "汉化包" shape: l_simp_chinese, or a
// hacked l_english file carrying Chinese values).
fs.writeFileSync(path.join(vanilla, 'replace', 'zh_hans.yml'), 'l_simp_chinese:\n PROV2664:0 "皮尔森"\n')
// A Chinese-tagged plain file must still beat another CJK locale that sits in
// replace/ (Japanese kanji), because the dictionary tracks *Chinese* names.
fs.writeFileSync(path.join(vanilla, 'prov_names_l_chinese.yml'), 'l_simp_chinese:\n PROV5000:0 "郑州"\n')
fs.writeFileSync(path.join(vanilla, 'replace', 'ja_kanji.yml'), 'l_japanese:\n PROV5000:0 "鄭州"\n PROV2799:0 "鈴鹿"\n')
fs.writeFileSync(path.join(vanilla, 'replace', 'l_english_backup.yml'), 'l_english:\n PROV9:0 "Backup"\n')
// The Mod wins over everything, and one Mod file may mix CJK + Latin.
fs.writeFileSync(path.join(mod, 'zz_mod.yml'), '\uFEFFl_english:\n PROV2664:0 "皮尔森Mod"\n PROV1:0 "斯德哥尔摩"\n PROV4000:0 "Neu-Brandenburg"\n')

const dict = buildProvinceDictionary([vanilla, mod])
const plzen = dict.get(2664)
check('id parsed', plzen?.id === 2664)
check('chinese name', plzen?.name_cn === '皮尔森Mod', plzen?.name_cn)
check('english name retained', plzen?.name_en === 'Plzen', plzen?.name_en)
check('fallback province', dict.get(1)?.name_cn === '斯德哥尔摩' && dict.get(1)?.name_en === 'Stockholm')
check('spanish must not become the english name', dict.get(2664)?.name_en !== 'Pilsen')
check('no chinese name => empty cn', dict.get(4000)?.name_cn === '' && dict.get(4000)?.name_en === 'Neu-Brandenburg')
check('source recorded', String(dict.get(2664)?.name_cn_source || '').length > 0, dict.get(2664)?.name_cn_source)
check('chinese beats japanese replace', dict.get(5000)?.name_cn === '郑州', dict.get(5000)?.name_cn)
check('japanese used when nothing else', dict.get(2799)?.name_cn === '鈴鹿', dict.get(2799)?.name_cn)

// A Chinese pack that only renames in vanilla replace/ still beats vanilla English.
const vanillaOnly = buildProvinceDictionary([vanilla])
check('vanilla replace chinese name', vanillaOnly.get(2664)?.name_cn === '皮尔森', vanillaOnly.get(2664)?.name_cn)
check('vanilla replace source', String(vanillaOnly.get(2664)?.name_cn_source || '').includes('replace'), vanillaOnly.get(2664)?.name_cn_source)
check('vanilla english untouched by replace', vanillaOnly.get(267)?.name_en === 'Plzen')

// Language marker + label format + search behaviour.
check('language english', parseLocalisationLanguage('l_english:\n A:0 "x"') === 'english')
check('language simp chinese', parseLocalisationLanguage('\uFEFFl_simp_chinese:\n PROV1:0 "斯德哥尔摩"') === 'simp_chinese')
check('language default', parseLocalisationLanguage('PROV1:0 "Stockholm"') === 'english')

check('label three-in-one', provinceLabel({ id: 2664, name_cn: '皮尔森', name_en: 'Plzeň' }) === '[2664] 皮尔森 (Plzeň)')
check('label cn only', provinceLabel({ id: 2664, name_cn: '皮尔森' }) === '[2664] 皮尔森')
check('label en only', provinceLabel({ id: 2664, name_en: 'Plzen' }) === '[2664] Plzen')
check('label id only', provinceLabel({ id: 2664 }) === '[2664]')
const entry = { id: 2664, name: 'Plzen', name_cn: '皮尔森', name_en: 'Plzeň' }
check('match by id', provinceMatchScore(entry, ['2664']) === 0)
check('match by id prefix', provinceMatchScore(entry, ['266']) === 1)
check('match by chinese', provinceMatchScore(entry, ['皮尔森']) === 2)
check('match by chinese prefix', provinceMatchScore(entry, ['皮尔']) === 3)
check('match by english prefix', provinceMatchScore(entry, ['plz']) >= 0)
check('match folded diacritics', provinceMatchScore({ id: 2, name_en: 'Östergötland' }, ['ostergotland']) === 2)
check('match folded slavic', provinceMatchScore({ id: 3, name_en: 'Plzeň' }, ['plzen']) === 2)
check('double token and', provinceMatchScore(entry, ['皮尔森', 'plzen']) >= 0)
check('double token mismatch', provinceMatchScore(entry, ['皮尔森', 'wien']) === -1)
check('fold helper', foldProvinceText('  ÖSTERGÖTLAND ') === 'ostergotland')

const all = [...dict.values()].map((item) => ({ ...item }))
check('search 皮尔森', searchProvinceEntries(all, '皮尔森', 5).every((item) => item.id === 2664))
const plzHits = searchProvinceEntries(all, 'Plz', 5).map((item) => item.id)
check('search Plz hits', plzHits.includes(2664) && plzHits.includes(267), plzHits.join(','))
check('search Plz rank', plzHits[0] === 267, plzHits.join(','))
check('search 2664 hits', searchProvinceEntries(all, '2664', 5)[0]?.id === 2664)
check('search 4000 by english', searchProvinceEntries(all, 'neu', 5)[0]?.id === 4000)
check('search miss', searchProvinceEntries(all, 'atlantis', 5).length === 0)

// The engine applies the user's custom PROV keys on top of the scanned files.
const wb = new Workbench({ eu4Root: path.join(tmp, 'vanilla'), modDir: path.join(tmp, 'mod'), eu4UserDir: '', statePath: path.join(tmp, 'state.json') })
wb.init()
const wbDict = wb.provinceDictionary()
check('engine dictionary built', wbDict.get(2664)?.name_cn === '皮尔森Mod', wbDict.get(2664)?.name_cn)
check('engine roots order', wb.localisationRoots().length === 2)
wb.setCustomDictionary('PROV4001', '自定义城')
const custom = wb.provinceDictionary().get(4001)
check('custom user name wins', custom?.name_cn === '自定义城' && custom?.name_cn_source === 'custom-dictionary.json')
check('custom label', wb.provinceLabelOf(4001) === '[4001] 自定义城', wb.provinceLabelOf(4001))
check('unknown label', wb.provinceLabelOf(999999) === '[999999]')

/* ------------------------------------------------------------------
 * Enabled-Mod discovery: a Chinese pack normally lives in the Paradox
 * dlc_load.json list (Steam Workshop), not under the game's localisation/.
 * Encoding handling: UTF-8 BOM, GB18030, and a private/corrupt file.
 * ---------------------------------------------------------------- */
const userDir = path.join(tmp, 'userdata')
const modFolder = path.join(userDir, 'mod')
const relPack = path.join(modFolder, 'packs', 'zh')
fs.mkdirSync(path.join(relPack, 'localisation', 'replace'), { recursive: true })
fs.writeFileSync(path.join(modFolder, 'zh_pack.mod'), 'name="中文汉化"\npath="packs/zh"\n')
// UTF-16LE + BOM file with a Chinese province name, inside replace/.
const utf16 = Buffer.concat([
  Buffer.from([0xff, 0xfe]),
  Buffer.from('\uFEFFl_simp_chinese:\n PROV2664:0 "皮尔森十六"\n', 'utf16le'),
])
fs.writeFileSync(path.join(relPack, 'localisation', 'replace', 'zh16.yml'), utf16)
// GB18030 bytes for 斯德哥尔摩 (斯cb b9 德b5 c2 哥b8 e7 尔b6 fb 摩c4 a6).
const gbkLine = Buffer.concat([
  Buffer.from('l_english:\n PROV1:0 "', 'ascii'),
  Buffer.from([0xcb, 0xb9, 0xb5, 0xc2, 0xb8, 0xe7, 0xb6, 0xfb, 0xc4, 0xa6]),
  Buffer.from('"\n', 'ascii'),
])
fs.writeFileSync(path.join(relPack, 'localisation', 'gbk_extra.yml'), gbkLine)

/* --- EU4 double-byte patch (matanki-saito/EU4dll) escaped text --- */
const CP1252_BYTES = new Map([[0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88], [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c], [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97], [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b], [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f]])
const PROBLEM_BYTES = new Set([0xa4, 0xa3, 0xa7, 0x24, 0x5b, 0x00, 0x5c, 0x20, 0x0d, 0x0a, 0x22, 0x7b, 0x7d, 0x40, 0x80, 0x7e, 0x2f, 0x5f, 0xbd, 0x3b, 0x5d, 0x3d, 0x23, 0x3f, 0x3a, 0x3c, 0x3e, 0x2a, 0x7c])
/** Port of convertWideTextToEscapedText() for the test fixture. */
function encodeEscaped(text) {
  const bytes = []
  for (const ch of text) {
    let cp = ch.codePointAt(0)
    if (cp < 0x80 || CP1252_BYTES.has(cp)) { bytes.push(CP1252_BYTES.get(cp) ?? cp); continue }
    if (cp > 0x100 && cp < 0xa00) cp += 0xe000
    const hi = (cp >> 8) & 0xff
    const lo = cp & 0xff
    if (hi === 0) { bytes.push(cp & 0xff); continue }
    let escape = 0x10
    if (PROBLEM_BYTES.has(hi)) escape += 2
    if (PROBLEM_BYTES.has(lo)) escape += 1
    let outLo = lo
    let outHi = hi
    if (escape === 0x11) outLo += 14
    else if (escape === 0x12) outHi -= 9
    else if (escape === 0x13) { outLo += 14; outHi -= 9 }
    bytes.push(escape, outLo & 0xff, outHi & 0xff)
  }
  return bytes
}
/** The file layer stores escaped bytes as CP1252 characters (UTF-8 on disk). */
function escapedFileLayer(text) {
  return encodeEscaped(text).map((byte) => String.fromCharCode(byte)).join('')
}
const escapedText = 'l_simp_chinese:\n PROV5001:0 "' + escapedFileLayer('斯德哥尔摩') + '"\n PROV5002:0 "' + escapedFileLayer('维亚马') + '"\n'
fs.writeFileSync(path.join(relPack, 'localisation', 'escaped_l_simp_chinese.yml'), escapedText, 'utf8')
// A genuinely undecodable file (control bytes, no escape structure) must be
// reported, never guessed. (A valid escape fragment would decode — see below.)
const broken = Buffer.concat([
  Buffer.from('l_english:\n PROV9:0 "', 'ascii'),
  Buffer.from([0x0e, 0x0f, 0x01, 0x02, 0x03, 0x07, 0x0b, 0x0c, 0x0f, 0x0e]),
  Buffer.from('"\n', 'ascii'),
])
fs.writeFileSync(path.join(relPack, 'localisation', 'broken.yml'), broken)
// A Workshop mod referenced only by remote_file_id.
const steamapps = path.join(tmp, 'steamapps')
const fakeGame = path.join(steamapps, 'common', 'Europa Universalis IV')
const workshopPack = path.join(steamapps, 'workshop', 'content', '236850', '7777')
fs.mkdirSync(path.join(workshopPack, 'localisation'), { recursive: true })
fs.mkdirSync(path.join(fakeGame, 'localisation'), { recursive: true })
fs.mkdirSync(path.join(fakeGame, 'common'), { recursive: true })
fs.writeFileSync(path.join(workshopPack, 'localisation', 'zz_ws.yml'), 'l_simp_chinese:\n PROV5000:0 "郑州工坊"\n')
fs.writeFileSync(path.join(modFolder, 'ws_pack.mod'), 'name="workshop zh"\nremote_file_id="7777"\n')
fs.writeFileSync(path.join(userDir, 'dlc_load.json'), JSON.stringify({ enabled_mods: ['mod/zh_pack.mod', 'mod/ws_pack.mod'], disabled_dlcs: [] }))

const wbMods = new Workbench({ eu4Root: fakeGame, modDir: relPack, eu4UserDir: userDir, statePath: path.join(tmp, 'state-mods.json') })
wbMods.init()
const roots = wbMods.localisationRoots()
check('enabled mod roots discovered', roots.includes(path.resolve(relPack)) && roots.includes(path.resolve(workshopPack)), roots.join(' | '))
check('user dir resolution', wbMods.eu4UserDir() === path.resolve(userDir))
const modsDict = wbMods.provinceDictionary()
check('utf-16 pack name', modsDict.get(2664)?.name_cn === '皮尔森十六', modsDict.get(2664)?.name_cn)
check('gb18030 pack name', modsDict.get(1)?.name_cn === '斯德哥尔摩', modsDict.get(1)?.name_cn)
check('escaped patch name', modsDict.get(5001)?.name_cn === '斯德哥尔摩', modsDict.get(5001)?.name_cn)
check('escaped patch name 2', modsDict.get(5002)?.name_cn === '维亚马', modsDict.get(5002)?.name_cn)
const escapedDecoded = decodeLocalisationBuffer(Buffer.from('l_simp_chinese:\n PROV1:0 "' + escapedFileLayer('皮尔森') + '"\n', 'utf8'))
check('escaped encoding detected', escapedDecoded.encoding === 'eu4dll-escaped', escapedDecoded.encoding)
check('escaped decode exact', escapedDecoded.text.includes('皮尔森'), JSON.stringify(escapedDecoded.text))
check('workshop pack name', modsDict.get(5000)?.name_cn === '郑州工坊', modsDict.get(5000)?.name_cn)
check('broken file invents nothing', !modsDict.get(9)?.name_cn, String(modsDict.get(9)?.name_cn))
const meta = wbMods.provinceDictionaryMeta()
check('meta counts chinese', meta.chinese >= 3, String(meta.chinese))
check('meta reports unreadable', meta.unreadableFiles >= 1, String(meta.unreadableFiles))
check('meta roots scanned', meta.rootsExisting.length >= 2, String(meta.rootsExisting.length))
check('dictionary cache invalidation', (() => {
  wbMods.setCustomDictionary('PROV6000', '缓存失效城')
  return wbMods.provinceDictionary().get(6000)?.name_cn === '缓存失效城'
})())

fs.rmSync(tmp, { recursive: true, force: true })

if (failed) process.exit(1)
