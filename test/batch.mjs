/**
 * Global batch prompt tests: pure JSON envelope, clear sections, token cap.
 */
import { buildBatchPrompt } from '../lib/batch.js'

let failed = 0
const check = (name, ok, detail = '') => {
  console.log((ok ? 'ok  ' : 'FAIL') + ' ' + name + (detail ? ' — ' + detail : ''))
  if (!ok) failed++
}

const items = [
  { id: 'q1', targetType: 'event', action: 'modify', targetId: 'hussite.2', targetFile: 'events/hussite.txt', data: { id: 'hussite.2', options: [] } },
  { id: 'q2', targetType: 'mission', action: 'create', targetId: 'missions/boh.txt', targetFile: 'missions/boh.txt', data: { file: 'missions/boh.txt', nodes: [] } },
  { id: 'q3', targetType: 'mechanic', action: 'modify', targetId: 'my_mod', targetFile: 'common/event_modifiers/my_mod.txt', data: { name: 'my_mod', stats: { land_morale: '0.1' } } },
  { id: 'q4', targetType: 'gui', action: 'create', targetId: 'my_button', data: { name: 'my_button', imagePath: 'gfx/interface/x.dds' } },
  { id: 'q5', targetType: 'province_history', action: 'modify', targetId: '2664', targetFile: 'history/provinces/2664 - Plzen.txt', data: { id: 2664, name: 'Plzen', owner: 'BOH', religion: 'hussite', base_tax: 5, localisation: true } },
  { id: 'q6', targetType: 'country_history', action: 'modify', targetId: 'BOH', targetFile: 'history/countries/BOH - Bohemia.txt', data: { tag: 'BOH', government: 'hussite_theocracy', add_monarch: { name: 'Jan Zizka', adm: 4, dip: 5, mil: 6 }, localisation: true } },
  { id: 'q7', targetType: 'new_tag', action: 'create', targetId: 'HUS', targetFile: 'history/countries/HUS - Hussite State.txt', data: { tag: 'HUS', name: 'Hussite State', government: 'hussite_theocracy', religion: 'hussite', technology_group: 'eastern', primary_culture: 'czech', localisation: true } },
  { id: 'q8', targetType: 'event', action: 'delete', targetId: 'ashes.blockade.1', targetFile: 'events/hussite_blockade.txt', data: { id: 'ashes.blockade.1' } },
  { id: 'q9', targetType: 'national_ideas', action: 'modify', targetId: 'BOH', targetFile: 'common/ideas/BOH_ideas.txt', data: { tag: 'BOH', traditions: [{ modifier: 'land_morale', value: 0.1 }, { modifier: 'discipline', value: 0.05 }], ambition: { modifier: 'core_creation', value: -0.1 }, ideas: Array.from({ length: 7 }, (_, i) => ({ id: 'boh_idea_' + (i + 1), name: '理念' + (i + 1), desc: '描述' + (i + 1), modifier: 'land_morale', value: 0.1 })) } },
  { id: 'q10', targetType: 'government_reform', action: 'create', targetId: 'boh_reform_1', targetFile: 'common/governments/00_reforms.txt', data: { id: 'boh_reform_1', name: '胡斯纪律', tier: 2, potential_government: 'monarchy', modifiers: [{ modifier: 'discipline', value: 0.05 }] } },
  { id: 'q11', targetType: 'tag_government', action: 'modify', targetId: 'BOH', targetFile: 'history/countries/BOH - Bohemia.txt', data: { tag: 'BOH', government_type: 'monarchy', reforms: ['boh_reform_1'] } },
]
const built = buildBatchPrompt(items)
check('payload is pure JSON', built.payload.changes.length === 11 && built.payload.changes[4].targetType === 'province_history')
check('sections present', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].every((n) => built.prompt.includes('[Change ' + n + ']')))
check('target types present', ['event', 'mission', 'mechanic', 'gui', 'province_history', 'country_history', 'new_tag', 'national_ideas', 'government_reform', 'tag_government'].every((type) => built.prompt.includes('target_type: ' + type)))
check('delete event task', built.prompt.includes('删除事件') && built.prompt.includes('删除节点（不是删除文件）') && built.prompt.includes('精准定位'))
check('national ideas task', built.prompt.includes('配置国家理念') && built.prompt.includes('完整覆盖'))
check('ideas localisation', built.prompt.includes('7 条 ideas') && built.prompt.includes('本地化联动'))
check('government reform append', built.prompt.includes('必须**追加**') && built.prompt.includes('不得覆盖'))
check('government reform localisation', built.prompt.includes('_name') && built.prompt.includes('_desc'))
check('tag government binding', built.prompt.includes('add_government_reform') && built.prompt.includes('government = '))
check('exact province path', built.prompt.includes('history/provinces/2664 - Plzen.txt'))
check('exact country path', built.prompt.includes('history/countries/BOH - Bohemia.txt'))
check('timeline warning', built.prompt.includes('1444.11.11') && built.prompt.includes('年份分段'))
check('monarch/localisation warning', built.prompt.includes('death_date') && built.prompt.includes('localisation/'))
check('json translation instruction', built.prompt.includes('不要直接写 JSON') && built.prompt.includes('原生脚本'))
check('new tag four files', built.prompt.includes('四个文件') && built.prompt.includes('gfx/flags/'))
check('batch JSON at end', built.prompt.lastIndexOf('[Batch JSON') > built.prompt.indexOf('[Task list]'))
check('single JSON block', (built.prompt.match(/```json/g) || []).length === 1)
check('token cap', built.prompt.includes('max_tokens = 2000') && built.meta.maxTokens === 2000)
check('mechanic stats', built.prompt.includes('land_morale'))
let empty = false
try { buildBatchPrompt([]) } catch { empty = true }
check('empty queue rejected', empty)

// Province display hints: the prompt can carry `[2664] 皮尔森 (Plzeň)` while the
// JSON payload and the generated script keep the numeric ID.
const provinceItems = [{
  id: 'p1', targetType: 'province_history', action: 'modify', targetId: '2664',
  targetFile: 'history/provinces/2664 - Plzen.txt',
  data: { id: 2664, name: 'Plzen', owner: 'BOH' },
}]
const withHints = buildBatchPrompt(provinceItems, { provinceLabel: (id) => (id === 2664 ? '[2664] 皮尔森 (Plzeň)' : '[' + id + ']') })
check('province hint present', withHints.prompt.includes('province_hint: [2664] 皮尔森 (Plzeň)'))
check('province hint numeric rule', withHints.prompt.includes('纯数字 ID'))
check('hint stays out of JSON', !JSON.stringify(withHints.payload).includes('皮尔森'))
check('payload id stays numeric', withHints.payload.changes[0].data.id === 2664 && typeof withHints.payload.changes[0].data.id === 'number')
check('no hint line without labeler', !built.prompt.includes('province_hint: '))
check('labeler failure is harmless', (() => {
  try {
    const bad = buildBatchPrompt(provinceItems, { provinceLabel: () => { throw new Error('nope') } })
    return !bad.prompt.includes('province_hint: ')
  } catch { return false }
})())

if (failed) process.exit(1)
