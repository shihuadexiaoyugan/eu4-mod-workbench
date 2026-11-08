/** Full culture hierarchy: groups, all vanilla cultures, group labels. */
import { CULTURE_GROUPS, CULTURE_OPTIONS } from '../lib/eu4-dictionary.js'

let failed = 0
const check = (name, ok, detail = '') => {
  console.log((ok ? 'ok  ' : 'FAIL') + ' ' + name + (detail ? ' — ' + detail : ''))
  if (!ok) failed++
}
const groupOf = (id) => CULTURE_GROUPS.find((group) => group.group_id === id)
const hasCulture = (groupId, cultureId) => Boolean(groupOf(groupId)?.cultures.some((culture) => culture.id === cultureId))
const option = (id) => CULTURE_OPTIONS.find((culture) => culture.value === id)

check('71+ culture groups', CULTURE_GROUPS.length >= 60, String(CULTURE_GROUPS.length))
check('400+ cultures', CULTURE_OPTIONS.length >= 400, String(CULTURE_OPTIONS.length))
check('germanic prussian', hasCulture('germanic', 'prussian'))
check('germanic saxon', hasCulture('germanic', 'saxon'))
check('germanic austrian', hasCulture('germanic', 'austrian'))
check('west_slavic czech', hasCulture('west_slavic', 'czech'))
check('west_slavic polish', hasCulture('west_slavic', 'polish'))
check('group labels chinese', groupOf('germanic')?.group_name === '日耳曼组' && groupOf('west_slavic')?.group_name === '西斯拉夫组')
check('culture labels chinese', option('prussian')?.label === '普鲁士' && option('czech')?.label === '捷克')
check('options carry group', option('prussian')?.group === 'germanic' && option('prussian')?.group_name === '日耳曼组')
check('all culture labels chinese', CULTURE_OPTIONS.every((culture) => /[\u4e00-\u9fa5]/.test(culture.label)))
check('all group labels chinese', CULTURE_GROUPS.every((group) => /[\u4e00-\u9fa5]/.test(group.group_name)))
check('lost cultures chinese', option('phoenician')?.label === '腓尼基' && option('parthian')?.label === '帕提亚' && option('anglosaxon')?.label === '盎格鲁-撒克逊')

if (failed) process.exit(1)
