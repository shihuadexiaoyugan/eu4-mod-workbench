/**
 * NL2Code: turn a short natural-language request into a structured JSON
 * EventConfig / MissionConfig draft. The draft is deliberately conservative:
 * it always carries needs_confirmation=true and the UI must show it for review.
 *
 * The AI prompt is built here so the host can hand it to the Agent; the local
 * parser below is a fast first pass for the common examples (and a fallback
 * when no Agent is available).
 */
import type { ConditionIntent, EffectIntent, EventFormData, MissionFormData } from './ai.js'
import type { NewTagConfig, ProvinceHistoryConfig, CountryHistoryConfig } from './map-config.js'

export type NLKind = 'event' | 'mission' | 'province_history' | 'country_history' | 'new_tag'

export interface NL2Config {
  kind: NLKind
  needs_confirmation: boolean
  confidence: number
  complex: boolean
  notes: string[]
  warnings: string[]
  event?: Partial<EventFormData>
  mission?: Partial<MissionFormData>
  province?: ProvinceHistoryConfig
  country?: CountryHistoryConfig
  newTag?: NewTagConfig
}

const RELIGIONS: Array<[RegExp, string]> = [
  [/胡斯|hussite/i, 'hussite'], [/天主教|catholic/i, 'catholic'],
  [/新教|protestant/i, 'protestant'], [/东正教|orthodox/i, 'orthodox'],
  [/逊尼|sunni/i, 'sunni'], [/什叶|shiite/i, 'shiite'],
]
const CULTURES: Array<[RegExp, string]> = [
  [/捷克|czech/i, 'czech'], [/德意志|german/i, 'german'],
  [/波兰|polish/i, 'polish'], [/斯洛伐克|slovak/i, 'slovak'],
  [/法兰西|french/i, 'french'], [/英格兰|english/i, 'english'],
]
const GOVERNMENTS: Array<[RegExp, string]> = [
  [/神权|theocra/i, 'hussite_theocracy'], [/共和|republic/i, 'republic'],
  [/君主|monarchy/i, 'monarchy'], [/部落|tribal/i, 'tribal'],
]
const TECHS: Array<[RegExp, string]> = [
  [/东方|eastern/i, 'eastern'], [/西方|western/i, 'western'],
  [/中华|chinese/i, 'chinese'], [/穆斯林|muslim/i, 'muslim'],
  [/印度|indian/i, 'indian'],
]

function firstMatch<K>(table: Array<[RegExp, K]>, text: string): K | null {
  for (const [pattern, value] of table) if (pattern.test(text)) return value
  return null
}

function detectIntent(fallback: NLKind, text: string): NLKind {
  if (fallback === 'province_history' || fallback === 'country_history' || fallback === 'new_tag') return fallback
  if (/(新建|创建|添加).{0,6}(国家|tag)|新国家|全新国家|new\s*tag/i.test(text)) return 'new_tag'
  if (/(省份|省|发展度|基础税收|贸易商品|所有者)/.test(text) && /\d{2,5}/.test(text)) return 'province_history'
  if (/(国家|tag|政府|神权|君主|科技组|主流文化)/i.test(text)) return 'country_history'
  return fallback
}
const TAGS: Record<string, string> = {
  波希米亚: 'BOH', 波西米亚: 'BOH', 法国: 'FRA', 英格兰: 'ENG', 英国: 'ENG',
  卡斯蒂利亚: 'CAS', 西班牙: 'SPA', 奥斯曼: 'TUR', 土耳其: 'TUR',
  俄罗斯: 'RUS', 莫斯科: 'MOS', 奥地利: 'HAB', 普鲁士: 'PRU',
  勃艮第: 'BUR', 米兰: 'MIL', 威尼斯: 'VEN', 教宗国: 'PAP',
  波兰: 'POL', 立陶宛: 'LIT', 瑞典: 'SWE', 丹麦: 'DAN', 挪威: 'NOR',
  葡萄牙: 'POR', 尼德兰: 'NED', 荷兰: 'NED', 神圣罗马: 'HRE',
}

/** Keyword -> modifier stat (block effect add_country_modifier). */
const STATS: Array<[RegExp, string]> = [
  [/士气|morale/i, 'land_morale'],
  [/税收|税务|tax/i, 'global_tax_modifier'],
  [/纪律|discipline/i, 'discipline'],
  [/造核|core.?creation/i, 'core_creation'],
  [/发展成本|dev.?cost/i, 'dev_cost'],
  [/人力|manpower/i, 'global_manpower'],
  [/水手|sailors/i, 'global_sailors'],
  [/外交声誉|reputation/i, 'diplomatic_reputation'],
  [/侵略扩张|aggressive/i, 'aggressive_expansion'],
  [/围城|siege/i, 'siege_ability'],
  [/要塞防御|fort.?defense/i, 'fort_defense'],
  [/贸易效率|trade.?efficiency/i, 'trade_efficiency'],
  [/生产效率|production/i, 'production_efficiency'],
  [/顾问成本|advisor/i, 'advisor_cost'],
  [/建筑成本|build/i, 'build_cost'],
  [/利息|interest/i, 'interest'],
]

/** Keyword -> simple effect. */
const EFFECTS: Array<[RegExp, string]> = [
  [/威望|prestige/i, 'add_prestige'],
  [/稳定|stability/i, 'add_stability'],
  [/合法性|legitimacy/i, 'add_legitimacy'],
  [/金币|金钱|钱|treasury|gold/i, 'add_treasury'],
  [/行政点|adm.?power/i, 'add_adm_power'],
  [/外交点|dip.?power/i, 'add_dip_power'],
  [/军事点|mil.?power/i, 'add_mil_power'],
  [/陆军传统|army.?tradition/i, 'add_army_tradition'],
  [/海军传统|navy.?tradition/i, 'add_navy_tradition'],
  [/共和传统|republican/i, 'add_republican_tradition'],
  [/重商|mercantilism/i, 'add_mercantilism'],
]

function pickTag(text: string): string | null {
  for (const [name, tag] of Object.entries(TAGS)) if (text.includes(name)) return tag
  const upper = text.match(/\b([A-Z]{3})\b/)
  return upper ? upper[1] : null
}

function percentValue(text: string): number | null {
  const match = text.match(/([+-]?\d+(?:\.\d+)?)\s*%/)
  return match ? Number(match[1]) / 100 : null
}

function durationDays(text: string): number | null {
  const match = text.match(/(\d+)\s*年/)
  return match ? Number(match[1]) * 365 : null
}

function parseConditions(text: string, tag: string | null): ConditionIntent[] {
  const out: ConditionIntent[] = []
  if (/开局|1444/.test(text)) out.push({ type: 'is_year', op: '=', value: '1444' })
  const year = text.match(/年份[^\d]{0,6}(\d{4})/)
  if (year) out.push({ type: 'is_year', op: '=', value: year[1] })
  const province = text.match(/(\d{1,5})\s*(?:号)?\s*省/)
  if (province) out.push({ type: 'owns', op: '=', value: province[1] })
  if (tag) out.push({ type: 'tag', op: '=', value: tag })
  return out
}

function parseEffects(text: string): EffectIntent[] {
  const pct = percentValue(text)
  const days = durationDays(text) || 1825
  for (const [pattern, stat] of STATS) {
    if (!pattern.test(text)) continue
    const value = pct === null ? 0.1 : pct
    return [{
      effect: 'add_country_modifier',
      params: { name: `nl_buff_${stat}`, duration: String(days), stats: { [stat]: String(value) } },
    }]
  }
  for (const [pattern, effect] of EFFECTS) {
    if (!pattern.test(text)) continue
    const value = pct === null ? (effect === 'add_prestige' ? '10' : '1') : String(Math.round(pct * 100))
    return [{ effect, value }]
  }
  return [{ effect: 'add_prestige', value: '10' }]
}

/**
 * Fast draft for the shipped example prompts. Dictionary-only: this function
 * never calls an LLM for translation; unknown words stay in English and are
 * reported as warnings so the UI can show them without a network request.
 */
export function localParse(kindInput: NLKind, text: string): NL2Config {
  const raw = String(text || '').trim()
  const kind = detectIntent(kindInput, raw)
  const tag = pickTag(raw)
  const conditions = parseConditions(raw, tag)
  const effects = parseEffects(raw)
  const complex = ((raw.match(/(并且|或者|而且|同时|如果|那么)/g) || []).length >= 3)
    || /\b(AND|OR)\b/i.test(raw)
  const notes = [`local draft for: ${raw}`]
  const warnings: string[] = []
  if (!tag) warnings.push('no country tag detected; add a tag = XXX trigger manually')
  const config: NL2Config = {
    kind,
    needs_confirmation: true,
    confidence: tag ? 0.82 : 0.45,
    complex,
    notes,
    warnings,
  }

  if (kind === 'province_history') {
    const idMatch = raw.match(/(\d{2,5})\s*(?:号)?\s*省/) || raw.match(/\b(\d{2,5})\b/)
    const id = idMatch ? Number(idMatch[1]) : 0
    if (!id) warnings.push('no province id detected; enter it manually')
    const tax = raw.match(/(?:税收|base_tax)[^\d]{0,8}(\d+)/i)
    const production = raw.match(/(?:生产|base_production)[^\d]{0,8}(\d+)/i)
    const manpower = raw.match(/(?:人力|base_manpower)[^\d]{0,8}(\d+)/i)
    config.province = {
      id,
      name: '',
      owner: tag || '',
      religion: firstMatch(RELIGIONS, raw) || '',
      culture: firstMatch(CULTURES, raw) || '',
      base_tax: tax ? Number(tax[1]) : undefined,
      base_production: production ? Number(production[1]) : undefined,
      base_manpower: manpower ? Number(manpower[1]) : undefined,
      localisation: /名称|改名|name/i.test(raw),
    }
    config.confidence = id ? 0.8 : 0.4
    return config
  }

  if (kind === 'country_history' || kind === 'new_tag') {
    const monarchMatch = raw.match(/(?:君主|monarch)[:：\s]*([A-Za-z\u4e00-\u9fa5 .]{2,24})/i)
    const stats = raw.match(/\b(\d)\s*[\/,，]\s*(\d)\s*[\/,，]\s*(\d)\b/)
    const monarch = {
      name: monarchMatch ? monarchMatch[1].trim() : (/日什卡|zizka/i.test(raw) ? 'Jan Zizka' : 'New Monarch'),
      adm: stats ? Number(stats[1]) : 4,
      dip: stats ? Number(stats[2]) : 5,
      mil: stats ? Number(stats[3]) : 6,
    }
    const nameMatch = raw.match(/(?:名为|名称[:：]?|叫做)\s*([^\s,，。]+)/)
    const upperTag = (raw.match(/\b([A-Z]{3})\b/) || [])[1] || tag || ''
    const base = {
      name: nameMatch ? nameMatch[1] : (upperTag || 'New Country'),
      government: firstMatch(GOVERNMENTS, raw) || 'monarchy',
      religion: firstMatch(RELIGIONS, raw) || 'catholic',
      technology_group: firstMatch(TECHS, raw) || 'western',
      primary_culture: firstMatch(CULTURES, raw) || 'czech',
      localisation: true,
    }
    if (kind === 'new_tag') {
      config.newTag = {
        tag: upperTag || 'NEW',
        ...base,
        add_monarch: /君主|monarch|日什卡|zizka/i.test(raw) ? monarch : undefined,
      }
      config.confidence = 0.6
    } else {
      config.country = {
        tag: upperTag,
        ...base,
        add_monarch: /君主|monarch|日什卡|zizka/i.test(raw) ? monarch : undefined,
      }
      config.confidence = upperTag ? 0.75 : 0.4
    }
    return config
  }

  if (percentValue(raw) === null && !effects.some((e) => e.params?.stats)) {
    warnings.push('no percentage detected; default effect value used')
  }
  config.confidence = tag && (percentValue(raw) !== null || effects.length) ? 0.82 : 0.45
  if (kind === 'mission') {
    config.mission = {
      file: 'missions/zz_nl_missions.txt',
      tag,
      nodes: [{
        id: 'nl_mission_1',
        slot: 'mission_slot',
        name: 'nl_mission_1',
        description: '',
        required: [],
        isNew: true,
        conditions,
        rewards: effects,
      }],
    }
  } else {
    config.event = {
      file: 'events/zz_nl_events.txt',
      kind: 'country_event',
      id: 'nl_event.1',
      namespace: 'nl_event',
      title: '',
      desc: '',
      picture: '',
      triggerMode: 'normal',
      targetTag: tag || '',
      bindDate: '1437.1.1',
      localisationFile: 'localisation/zz_nl_events_l_simp_chinese.yml',
      fireOnlyOnce: false,
      major: false,
      conditions,
      options: [{ name: 'nl_event.1.a', effects }],
    }
  }
  return config
}

const EVENT_SCHEMA = {
  kind: 'event',
  needs_confirmation: true,
  confidence: 0.8,
  event: {
    file: 'events/example.txt',
    kind: 'country_event',
    id: 'namespace.1',
    namespace: 'namespace',
    title: '布拉格之战',
    desc: '开局事件的中文描述。',
    triggerMode: 'normal',
    targetTag: 'BOH',
    bindDate: '1437.1.1',
    localisationFile: 'localisation/zz_nl_events_l_simp_chinese.yml',
    picture: '',
    fireOnlyOnce: false,
    major: false,
    conditions: [{ type: 'tag', op: '=', value: 'BOH' }],
    options: [{
      name: 'namespace.1.a',
      effects: [{
        effect: 'add_country_modifier',
        params: { name: 'my_buff', duration: '1825', stats: { land_morale: '0.2' } },
      }],
    }],
  },
}

const MISSION_SCHEMA = {  kind: 'mission',
  needs_confirmation: true,
  confidence: 0.8,
  mission: {
    file: 'missions/example.txt',
    tag: 'BOH',
    nodes: [{
      id: 'example_mission',
      slot: 'mission_slot',
      name: 'example_mission',
      description: '',
      required: [],
      isNew: true,
      conditions: [{ type: 'owns', op: '=', value: '2664' }],
      rewards: [{ effect: 'add_prestige', value: '10' }],
    }],
  },
}

const PROVINCE_SCHEMA = {
  kind: 'province_history',
  needs_confirmation: true,
  province: {
    id: 2664, name: 'Plzen', owner: 'BOH', religion: 'hussite',
    culture: 'czech', base_tax: 5, base_production: 3, base_manpower: 4,
    trade_goods: 'grain', localisation: false,
  },
}

const COUNTRY_SCHEMA = {
  kind: 'country_history',
  needs_confirmation: true,
  country: {
    tag: 'BOH', name: 'Bohemia', government: 'hussite_theocracy',
    religion: 'hussite', technology_group: 'eastern',
    primary_culture: 'czech', capital: 2664,
    add_monarch: { name: 'Jan Zizka', adm: 4, dip: 5, mil: 6 },
    localisation: true,
  },
}

const NEW_TAG_SCHEMA = {
  kind: 'new_tag',
  needs_confirmation: true,
  newTag: {
    tag: 'HUS', name: 'Hussite State', government: 'hussite_theocracy',
    religion: 'hussite', technology_group: 'eastern',
    primary_culture: 'czech', capital: 2664,
    add_monarch: { name: 'Jan Zizka', adm: 4, dip: 5, mil: 6 },
    localisation: true, flag_note: 'add gfx/flags/HUS.tga manually',
  },
}

/** English Agent prompt. Output must be a single JSON object, no prose. */
export const MAX_NL_TOKENS = 1000;

export interface NLBuildOptions {
  /** json = visual form draft; code = one-shot final script. */
  mode?: 'json' | 'code';
  /** Current form data, merged into the one-shot request. */
  form?: unknown;
}

export function buildNL2JSONPayload(kind: NLKind, text: string, options: NLBuildOptions = {}): { prompt: string; schema: unknown } {
  const mode = options.mode === 'code' ? 'code' : 'json';
  if (mode === 'code') {
    const formText = options.form ? JSON.stringify(options.form, null, 2) : '{}';
    const target = kind === 'mission' ? 'mission tree node(s)'
      : kind === 'province_history' ? 'province history file'
      : kind === 'country_history' ? 'country history file'
      : kind === 'new_tag' ? 'new country tag (four files)'
      : 'event';
    const prompt = [
      'You are an EU4 mod development expert. Produce the final EU4 script in ONE pass.',
      '',
      '[Target] ' + target,
      '[Player request] ' + String(text || '').trim(),
      '',
      '[Current form data (authoritative; do not restate it)]',
      '```json',
      formText,
      '```',
      '',
      '[Rules]',
      '1. Use exact EU4 English identifiers (add_prestige, land_morale, …).',
      '2. Return ONLY one ```eu4 fenced code block that can be written to the target file. No JSON, no explanation.',
      '3. Do not touch unrelated blocks. For an update, return just the changed block.',
      '4. If the request is ambiguous, return one short question instead of code.',
      '5. Use exact localisation keys derived from the namespace; keep unknown words in English.',
      '6. Hard output limit: max_tokens = ' + MAX_NL_TOKENS + '. Be concise.',
      '7. This is a draft for user confirmation; do not write files.',
    ].join('\n')
    return { prompt, schema: null }
  }
  const schema = kind === 'mission' ? MISSION_SCHEMA
    : kind === 'province_history' ? PROVINCE_SCHEMA
    : kind === 'country_history' ? COUNTRY_SCHEMA
    : kind === 'new_tag' ? NEW_TAG_SCHEMA
    : EVENT_SCHEMA
  const targetInterface = kind === 'mission' ? 'MissionConfig'
    : kind === 'province_history' ? 'ProvinceHistoryConfig'
    : kind === 'country_history' ? 'CountryHistoryConfig'
    : kind === 'new_tag' ? 'NewTagConfig'
    : 'EventConfig'
  const prompt = [
    'You are an EU4 mod development expert. Convert the player natural-language request into structured JSON only.',
    '',
    '[Target interface] ' + targetInterface,
    '[Player request] ' + String(text || '').trim(),
    '',
    '[Rules]',
    '1. Use exact EU4 English identifiers for triggers/effects (e.g. add_prestige, not the Chinese words).',
    '2. Output ONLY one ```json fenced block; no explanation, no prose.',
    '3. The JSON must match the shape below. Keep all keys, fill unknown strings with empty values.',
    '4. If the request is ambiguous or incomplete, set "needs_confirmation": true and list what is missing.',
    '5. If the request needs more than 4 levels of AND/OR/NOT nesting, set "complex": true and include a "raw_script" string with the complete EU4 block.',
    '6. Never invent localisation keys silently: derive `<namespace>.<id>.title/.desc` and state it in notes.',
    '7. Do not write files; this is a draft for the UI to confirm.',
    '8. Hard output limit: max_tokens = ' + MAX_NL_TOKENS + '. Be concise.',
    '',
    '[JSON shape]',
    '```json',
    JSON.stringify(schema, null, 2),
    '```',
  ].join('\n')
  return { prompt, schema }
}

/**
 * Robustly parse an AI reply: accept fenced JSON, leading prose, or a bare
 * object. Throws a user-facing error on anything else.
 */
export function parseNL2JSON(raw: string): NL2Config {
  let text = String(raw || '').trim()
  if (!text) throw new Error('AI returned an empty response')
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) text = fence[1].trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) throw new Error('AI did not return a JSON object')
  let parsed: any
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch (error) {
    throw new Error('AI returned invalid JSON: ' + String((error as Error).message || error))
  }
  const kinds: NLKind[] = ['event', 'mission', 'province_history', 'country_history', 'new_tag']
  const kind: NLKind = kinds.includes(parsed.kind) ? parsed.kind
    : parsed.province ? 'province_history'
    : parsed.country ? 'country_history'
    : parsed.newTag ? 'new_tag'
    : parsed.mission ? 'mission'
    : 'event'
  const key = kind === 'new_tag' ? 'newTag' : kind === 'province_history' ? 'province'
    : kind === 'country_history' ? 'country' : kind
  const body = parsed[key]
  if (!body || typeof body !== 'object') throw new Error('JSON does not contain ' + key)
  return {
    kind,
    needs_confirmation: parsed.needs_confirmation !== false,
    confidence: Number(parsed.confidence) || 0.5,
    complex: parsed.complex === true || typeof parsed.raw_script === 'string',
    notes: Array.isArray(parsed.notes) ? parsed.notes.map(String) : [],
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map(String) : [],
    [key]: body,
  } as NL2Config
}

function conditionScript(node: ConditionIntent, indent: string): string {
  const type = String((node as any).condition || node.type || '')
  if (type === 'AND' || type === 'OR' || type === 'NOT') {
    const children = (node.children || []).map((child) => conditionScript(child, indent + '\t')).join('\n')
    return `${indent}${type} = {\n${children}\n${indent}}`
  }
  if (type === 'any_neighbor_province') {
    return `${indent}any_neighbor_province = { province_id = ${node.value || ''} }`
  }
  if (type === 'custom') return indent + String((node as any).raw || node.value || '').trim()
  return `${indent}${type} ${node.op || '='} ${node.value ?? ''}`.trimEnd()
}

function effectScript(effect: EffectIntent, indent: string): string {
  if (effect.effect === 'custom') return indent + String(effect.raw || effect.value || '').trim()
  if (effect.params) {
    // UI metadata (newModifier/nameZh/years/…) must never reach the .txt.
    const allowed = ['country_event', 'province_event', 'news_event'].includes(effect.effect)
      ? ['id', 'days']
      : effect.effect === 'add_country_modifier'
        ? ['name', 'duration']
        : Object.keys(effect.params).filter((key) => !['stats', 'newModifier', 'existing', 'nameZh', 'years', 'daysText'].includes(key))
    const inner = allowed
      .filter((key) => effect.params![key] !== undefined && effect.params![key] !== '')
      .map((key) => `\t${indent}${key} = ${effect.params![key]}`)
      .join('\n')
    return `${indent}${effect.effect} = {\n${inner}\n${indent}}`
  }
  return `${indent}${effect.effect} = ${effect.value ?? ''}`.trimEnd()
}

/** Deterministic source preview for the advanced-mode confirmation screen. */
export function buildRawPreview(config: NL2Config): string {
  if (config.province) {
    const p = config.province
    return [
      '# ' + (p.id || '') + ' - ' + (p.name || 'province'),
      p.owner ? 'owner = ' + p.owner : '',
      p.controller ? 'controller = ' + p.controller : '',
      p.religion ? 'religion = ' + p.religion : '',
      p.culture ? 'culture = ' + p.culture : '',
      p.base_tax !== undefined ? 'base_tax = ' + p.base_tax : '',
      p.trade_goods ? 'trade_goods = ' + p.trade_goods : '',
    ].filter(Boolean).join('\n')
  }
  if (config.country) {
    const c = config.country
    return [
      '# ' + (c.tag || '') + ' - ' + (c.name || ''),
      c.government ? 'government = ' + c.government : '',
      c.religion ? 'religion = ' + c.religion : '',
      c.technology_group ? 'technology_group = ' + c.technology_group : '',
      c.primary_culture ? 'primary_culture = ' + c.primary_culture : '',
      c.capital ? 'capital = ' + c.capital : '',
      c.add_monarch ? 'monarch = { name = "' + c.add_monarch.name + '" adm = ' + c.add_monarch.adm + ' dip = ' + c.add_monarch.dip + ' mil = ' + c.add_monarch.mil + ' }' : '',
    ].filter(Boolean).join('\n')
  }
  if (config.newTag) {
    const n = config.newTag
    return [
      '# new tag ' + n.tag,
      n.government ? 'government = ' + n.government : '',
      n.religion ? 'religion = ' + n.religion : '',
      n.technology_group ? 'technology_group = ' + n.technology_group : '',
      n.primary_culture ? 'primary_culture = ' + n.primary_culture : '',
    ].filter(Boolean).join('\n')
  }
  if (config.mission) {
    const nodes = (config.mission.nodes || []).map((node) => {
      const trigger = (node.conditions || []).map((c) => conditionScript(c, '\t\t')).join('\n')
      const effect = (node.rewards || []).map((e) => effectScript(e, '\t\t')).join('\n')
      return `${node.id} = {\n\ticon = ${node.slot || 'mission_slot'}\n\ttrigger = {\n${trigger}\n\t}\n\teffect = {\n${effect}\n\t}\n}`
    }).join('\n\n')
    return `# ${config.mission.file || 'missions/nl_missions.txt'}\n${nodes}`
  }
  const event = config.event || {}
  const id = event.id || 'nl_event.1'
  // title/desc are always the derived localisation keys, never raw text.
  const titleKey = `${id}.t`
  const descKey = `${id}.d`
  const startup = event.triggerMode === 'startup'
  const bindDate = /^\d{1,4}\.\d{1,2}\.\d{1,2}$/.test(String(event.bindDate || '').trim()) ? String(event.bindDate).trim() : '1437.1.1'
  const targetTag = String(event.targetTag || '').trim().toUpperCase() || '<TARGET_TAG>'
  const trigger = (event.conditions || []).map((c) => conditionScript(c, '\t\t')).join('\n')
  const options = (event.options || []).map((option) => {
    const effects = (option.effects || []).map((e) => effectScript(e, '\t\t')).join('\n')
    return `\toption = {\n\t\tname = ${option.name || 'option.a'}\n${effects}\n\t}`
  }).join('\n')
  const lines = [
    `${event.kind || 'country_event'} = {`,
    `\tid = ${id}`,
    `\ttitle = "${titleKey}"`,
    `\tdesc = "${descKey}"`,
  ]
  if (startup) lines.push('\tis_triggered_only = yes')
  if (trigger) lines.push(`\ttrigger = {\n${trigger}\n\t}`)
  if (options) lines.push(options)
  lines.push('}')
  return lines.join('\n')
}
