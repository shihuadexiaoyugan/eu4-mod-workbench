/**
 * Pure test for the AI payload builder. No file I/O, no game install needed.
 */
import { buildAIPayload } from '../lib/ai.js'

const checks = []
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail })
  if (!ok) throw new Error('failed: ' + name + (detail ? ' (' + detail + ')' : ''))
}

const event = buildAIPayload('event', 'update', {
  file: 'events/hussite_events.txt',
  id: 'hussite.2',
  kind: 'country_event',
  title: 'hussite.2.t',
  desc: 'hussite.2.d',
  picture: 'painting',
  fireOnlyOnce: true,
  conditions: [{ type: 'tag', op: '=', value: 'BOH' }, { type: 'year', op: '>', value: '1437' }],
  options: [{
    name: 'hussite.2.a',
    effects: [
      { effect: 'add_prestige', value: '10' },
      { effect: 'add_country_modifier', params: { name: 'hussite_fervor', duration: '7300' } },
    ],
  }],
})
check('event meta file', event.meta.file === 'events/hussite_events.txt')
check('event meta target', event.meta.target === 'hussite.2')
check('event prompt file', event.prompt.includes('events/hussite_events.txt'))
check('event prompt target', event.prompt.includes('hussite.2'))
check('event prompt verify', event.prompt.includes('validate_script') && event.prompt.includes('check_loc_keys'))
check('event prompt payload', event.prompt.includes('add_country_modifier'))
check('event payload normalized', event.payload.fire_only_once === true)

const mission = buildAIPayload('mission', 'update', {
  file: 'missions/boh_missions.txt',
  tag: 'BOH',
  nodes: [{
    id: 'boh_1',
    slot: 'icon_1',
    name: 'Dawn',
    description: 'desc',
    required: [],
    conditions: [{ type: 'owns', op: '=', value: '2664' }],
    rewards: [{ effect: 'add_treasury', value: '100' }],
  }],
})
check('mission meta file', mission.meta.file === 'missions/boh_missions.txt')
check('mission meta tag', mission.meta.activeTag === 'BOH')
check('mission prompt localisation', mission.prompt.includes('localisation'))
check('mission prompt duration hint', mission.prompt.includes('1 year = 365') && mission.prompt.includes('params.newModifier'))
check('mission payload node', mission.payload.nodes.length === 1)

let rejected = false
try { buildAIPayload('event', 'update', { id: 'x' }) } catch { rejected = true }
check('missing file rejected', rejected)

rejected = false
try { buildAIPayload('mission', 'update', { file: 'missions/x.txt', nodes: [] }) } catch { rejected = true }
check('empty nodes rejected', rejected)

rejected = false
try { buildAIPayload('nope', 'update', { file: 'x' }) } catch { rejected = true }
check('unknown kind rejected', rejected)

const nested = buildAIPayload('event', 'create', {
  file: 'events/nested.txt', id: 'nested.1',
  conditions: [{ type: 'AND', children: [{ type: 'tag', op: '=', value: 'BOH' }, { type: 'NOT', children: [{ type: 'owns', value: '2664' }] }] }],
  options: [{ name: 'nested.1.a', effects: [{ effect: 'add_country_modifier', params: { name: 'thriving_arms_industry', duration: '1825', stats: { land_morale: '0.05' } } }] }],
})
check('nested logic in prompt', nested.prompt.includes('"type": "AND"') && nested.prompt.includes('"type": "NOT"'))
check('modifier stats in prompt', nested.prompt.includes('"stats"') && nested.prompt.includes('land_morale'))

const newMission = buildAIPayload('mission', 'create', {
  file: 'missions/new.txt',
  nodes: [{ id: 'new_node', isNew: true, conditions: [], rewards: [] }],
})
check('mission isNew flag', newMission.prompt.includes('"isNew": true'))
check('mission create action', newMission.prompt.includes('Create'))

const updateEvent = buildAIPayload('event', 'update', { file: 'events/x.txt', id: 'x.1', conditions: [], options: [] })
const createEvent = buildAIPayload('event', 'create', { file: 'events/x.txt', id: 'x.1', conditions: [], options: [] })
check('event update wording', updateEvent.prompt.includes('Update (replace the target block)'))
check('event create wording', createEvent.prompt.includes('[Action] Create'))

const longOriginal = Array.from({ length: 150 }, (_, i) => `line ${i}`).join('\n')
const pruned = buildAIPayload('event', 'update', { file: 'events/x.txt', id: 'x.1', original: longOriginal, conditions: [], options: [] })
check('update pruned to 100 lines', pruned.prompt.includes('truncated to 100 lines') && !pruned.prompt.includes('line 149'))
check('max tokens meta', pruned.meta.maxTokens === 1000)
const referenced = buildAIPayload('event', 'create', { file: 'events/x.txt', id: 'x.1', examples: ['country_event = { id = ref.1 }'], conditions: [], options: [] })
check('create uses format reference', referenced.prompt.includes('Format references') && referenced.prompt.includes('ref.1'))
check('create omits original block', !referenced.prompt.includes('Original event block'))

const guiButton = buildAIPayload('gui', 'create', {
  guiType: 'topbar-button',
  name: 'hussite_zeal_button',
  imagePath: 'gfx/interface/topbar/hussite.dds',
  tooltipText: '查看胡斯狂热',
  buttonText: '狂热',
  anchor: 'left_of_coins',
  visibility: 'tag = BOH',
  clickAction: 'hussite.2',
  width: 32,
  height: 32,
  strategy: 'insert',
})
check('gui button file', guiButton.meta.file === 'interface/topbar.gui')
check('gui button target', guiButton.meta.target === 'hussite_zeal_button')
check('gui no image generation', guiButton.prompt.includes('Do not generate') && guiButton.prompt.includes('gfx/interface'))
check('gui spriteType', guiButton.prompt.includes('spriteType') && guiButton.prompt.includes('texturefile'))
check('gui brace check', guiButton.prompt.includes('brace'))
check('gui resolution impact', guiButton.prompt.includes('1920x1080'))
check('gui insert strategy', guiButton.prompt.includes('insert') && guiButton.prompt.includes('topbar.gui'))
check('gui anchor code', guiButton.prompt.includes('left_of_coins'))
check('gui visibility trigger', guiButton.prompt.includes('trigger = { tag = BOH }'))
check('gui localisation text', guiButton.prompt.includes('hussite_zeal_button:0 "狂热"') && guiButton.prompt.includes('hussite_zeal_button_tooltip:0 "查看胡斯狂热"'))
check('gui three files', guiButton.prompt.includes('.gui') && guiButton.prompt.includes('.gfx') && guiButton.prompt.includes('.yml'))
check('gui pure payload (no Chinese label)', !guiButton.prompt.includes('国库(金币)左侧'))

const guiPanel = buildAIPayload('gui', 'create', {
  guiType: 'custom-panel',
  name: 'hussite_religion',
  imagePath: 'gfx/interface/panels/hussite_religion.dds',
  width: 600,
  height: 400,
  closeButtonPosition: '右上角',
  tooltipText: '查看胡斯派宗教',
  buttonText: '宗教',
  anchor: 'top_center',
  visibility: 'always',
})
check('gui panel file', guiPanel.meta.file === 'interface/hussite_religion.gui')
check('gui panel size', guiPanel.prompt.includes('600x400'))
check('gui always no trigger', guiPanel.prompt.includes('always') && guiPanel.prompt.includes('omit') && !guiPanel.prompt.includes('trigger = { always }'))

rejected = false
try { buildAIPayload('gui', 'create', { name: 'missing_image' }) } catch { rejected = true }
check('gui missing image rejected', rejected)

console.log(checks.map((c) => `ok  ${c.name}`).join('\n'))
