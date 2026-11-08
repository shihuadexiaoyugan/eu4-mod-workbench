/**
 * NL2Code tests: local draft shape, strict JSON parsing, English prompt.
 */
import { buildNL2JSONPayload, buildRawPreview, localParse, parseNL2JSON } from '../lib/nl2code.js'

let failed = 0
const check = (name, ok, detail = '') => {
  console.log((ok ? 'ok  ' : 'FAIL') + ' ' + name + (detail ? ' — ' + detail : ''))
  if (!ok) failed++
}

const event = localParse('event', '创建一个开局事件，+20%士气')
check('event draft kind', event.kind === 'event')
check('event draft needs confirmation', event.needs_confirmation === true)
check('event year trigger', (event.event.conditions || []).some((c) => c.type === 'is_year' && c.value === '1444'))
const buff = event.event.options[0].effects[0]
check('event morale effect', buff.effect === 'add_country_modifier' && buff.params.stats.land_morale === '0.2')
check('event default duration', buff.params.duration === '1825')

const tax = localParse('event', '给波希米亚加一个5年期限的税收BUFF')
check('tax tag parsed', (tax.event.conditions || []).some((c) => c.type === 'tag' && c.value === 'BOH'))
const taxBuff = tax.event.options[0].effects[0]
check('tax stat parsed', taxBuff.params.stats.global_tax_modifier !== undefined)
check('tax 5 years', taxBuff.params.duration === '1825')

const mission = localParse('mission', '给波希米亚创建一个任务，奖励10威望')
check('mission node isNew', mission.mission.nodes[0].isNew === true)
check('mission prestige reward', mission.mission.nodes[0].rewards[0].effect === 'add_prestige')

const { prompt } = buildNL2JSONPayload('event', '加20威望')
check('prompt english', prompt.includes('EU4 mod development expert'))
check('prompt identifiers', prompt.includes('add_prestige') && prompt.includes('needs_confirmation'))

const good = parseNL2JSON('here:\n```json\n{"kind":"event","needs_confirmation":true,"event":{"id":"x.1"}}\n```')
check('fenced json parsed', good.kind === 'event' && good.needs_confirmation === true)
let invalid = false
try { parseNL2JSON('AI says: sure, I will do it') } catch { invalid = true }
check('invalid json rejected', invalid)

const raw = buildRawPreview(event)
check('raw preview has modifier', raw.includes('add_country_modifier') && raw.includes('is_year = 1444'))

const oneShot = buildNL2JSONPayload('event', '加20威望', { mode: 'code', form: { id: 'x.1' } })
check('one-shot prompt', oneShot.prompt.includes('ONE pass') && oneShot.prompt.includes('max_tokens = 1000'))
check('one-shot no JSON schema', !oneShot.prompt.includes('[JSON shape]'))

const provinceNL = localParse('event', '把 2664 号省改成波希米亚所有，基础税收 5')
check('NL province intent', provinceNL.kind === 'province_history' && provinceNL.province.id === 2664)
check('NL province fields', provinceNL.province.owner === 'BOH' && provinceNL.province.base_tax === 5)
const countryNL = localParse('event', '把波希米亚改成胡斯神权，主流文化捷克')
check('NL country intent', countryNL.kind === 'country_history' && countryNL.country.tag === 'BOH')
check('NL country fields', countryNL.country.government === 'hussite_theocracy')
const newTagNL = localParse('event', '新建国家 HUS，胡斯神权，宗教胡斯')
check('NL new tag intent', newTagNL.kind === 'new_tag' && newTagNL.newTag.tag === 'HUS')

if (failed) process.exit(1)
