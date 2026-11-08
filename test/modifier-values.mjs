/**
 * Dictionary numeric-type contract: percentages must be converted by the UI,
 * integer effects must be written as flat values.
 */
import { EFFECT_OPTIONS, MODIFIER_OPTIONS, modifierValueType } from '../lib/eu4-dictionary.js'

let failed = 0
const check = (name, ok, detail = '') => {
  console.log((ok ? 'ok  ' : 'FAIL') + ' ' + name + (detail ? ' — ' + detail : ''))
  if (!ok) failed++
}
const modType = (value) => MODIFIER_OPTIONS.find((option) => option.value === value)?.type
const effectType = (value) => EFFECT_OPTIONS.find((option) => option.value === value)?.type

check('land_morale percentage', modType('land_morale') === 'percentage')
check('discipline percentage', modType('discipline') === 'percentage')
check('development_cost percentage', modType('development_cost') === 'percentage')
check('core_creation percentage', modType('core_creation') === 'percentage')
check('global_manpower integer', modType('global_manpower') === 'integer')
check('global_unrest integer', modType('global_unrest') === 'integer')
check('yearly_absolutism decimal', modType('yearly_absolutism') === 'decimal')
check('prestige integer', modType('prestige') === 'integer')
check('add_prestige integer', effectType('add_prestige') === 'integer')
check('add_stability integer', effectType('add_stability') === 'integer')
check('all modifier types present', MODIFIER_OPTIONS.every((option) => ['percentage', 'integer', 'decimal'].includes(option.type)))
check('all effect types present', EFFECT_OPTIONS.every((option) => option.type === 'integer'))
check('helper agrees', modifierValueType('land_morale') === 'percentage' && modifierValueType('prestige') === 'integer' && modifierValueType('yearly_absolutism') === 'decimal')

if (failed) process.exit(1)
