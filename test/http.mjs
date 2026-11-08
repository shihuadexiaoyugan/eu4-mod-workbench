import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { Workbench } from '../lib/engine.js';
import { createHandler } from '../lib/server.js';

const wb = new Workbench({
  eu4Root: process.env.EU4_ROOT ?? 'D:/SteamLibrary/steamapps/common/Europa Universalis IV',
  modDir: path.join(path.resolve('.'), '..', '_eu4_test_modroot'),
  statePath: path.join(path.resolve('.'), '_tmp', 'http-state.json'),
});
wb.init();
const testModRoot = wb.modRoot() || wb.state.modDir;
fs.mkdirSync(testModRoot, { recursive: true });
if (!fs.existsSync(path.join(testModRoot, 'descriptor.mod'))) {
  fs.writeFileSync(path.join(testModRoot, 'descriptor.mod'), 'name="eu4 workbench test mod"\n', 'utf8');
}
const server = http.createServer(createHandler(wb));
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const base = `http://127.0.0.1:${port}/eu4-workbench`;
const get = async (p) => (await fetch(base + p)).json();
const post = async (p, body) => (await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-eu4-workbench': '1' }, body: JSON.stringify(body) })).json();
console.log('state', (await get('/api/state')).ok);
const ui = await get('/api/ui/locales');
console.log('ui-locales', ui.ok, ui.data.locale, Object.keys(ui.data.messages).length);
const custom = await post('/api/dictionary/custom', { key: 'czech', value: '测试捷克' });
const ui2 = await get('/api/ui/locales');
console.log('custom-dictionary', custom.ok, ui2.data.messages['culture.czech'], JSON.stringify(custom).slice(0, 240));
const v = await post('/api/validate', { script: 'province_event = { id = t.1 immediate = { add_prestige = 10 } }' });
console.log('validate', v.data.issues.map((i) => i.code));
const m = await get('/api/map?tag=FRA&limit=3');
console.log('map', m.data.coreIds.length, m.data.provinces.length);
const oneProvince = await get('/api/map?provinceId=2664');
const provinceDict = await get('/api/provinces/dictionary?q=2664&limit=3');
console.log('province', oneProvince.data.provinces[0]?.id, provinceDict.data.items[0]?.id, provinceDict.data.items[0]?.name_en);
const e = await get('/api/events?namespace=aow_events');
console.log('events', e.data.nodes.length, e.data.edges.length, e.data.missingCount);
const form = await get('/api/event/form?path=events/flavorBOH.txt&id=flavor_boh.1');
console.log('event-form', form.ok, form.data && form.data.options.length);
const p = await post('/api/ai/build', {
  kind: 'mission',
  action: 'update',
  data: {
    file: 'missions/zz_eu4_workbench_missions.txt',
    nodes: [{ id: 'a', required: [], conditions: [{ type: 'tag', op: '=', value: 'FRA' }], rewards: [{ effect: 'add_prestige', value: '10' }] }],
  },
});
console.log('ai-build', p.ok, p.data.meta.file, p.data.prompt.length);
const nl = await post('/api/nl2json', { kind: 'event', text: '创建一个开局事件，+20%士气' });
console.log('nl2json', nl.ok, nl.data.config.event.id, nl.data.config.event.options[0].effects[0].effect, nl.data.warnings.length);
const examples = await get('/api/event/examples?count=2');
console.log('event-examples', examples.ok, examples.data.examples.length);
const raw = await post('/api/ai/raw', { file: 'events/zz_test.txt', code: 'country_event = { id = zz_test.1 }' });
console.log('ai-raw', raw.ok, Boolean(raw.data.pending));
const q1 = await post('/api/queue', { targetType: 'event', action: 'modify', targetId: 'flavor_boh.1', targetFile: 'events/flavorBOH.txt', data: { id: 'flavor_boh.1' } });
const q2 = await post('/api/queue', { targetType: 'mechanic', action: 'modify', targetId: 'thriving_arms_industry', data: { name: 'thriving_arms_industry', stats: { land_morale: '0.05' } } });
await post('/api/queue', { targetType: 'province_history', action: 'modify', targetId: '2664', targetFile: 'history/provinces/2664 - Veraguas.txt', data: { id: 2664, base_tax: 5 } });
await post('/api/queue', { targetType: 'province_history', action: 'modify', targetId: '2664', targetFile: 'history/provinces/2664 - Veraguas.txt', data: { id: 2664, base_tax: 7 } });
const queue = await get('/api/queue');
const batch = await post('/api/queue/build', {});
console.log('queue', q1.ok, q2.ok, queue.data.count, batch.data.meta.count);
const ph = await get('/api/history/province?id=2664&name=Plzen');
const ch = await get('/api/history/country?tag=BOH');
console.log('history', ph.ok, ph.data.file, ch.ok, ch.data.file);

/* ---- province dictionary HTTP contract: numeric id + three-in-one label ---- */
const failures = [];
const expect = (name, ok, detail = '') => {
  console.log((ok ? 'ok  ' : 'FAIL') + ' ' + name + (detail ? ' — ' + detail : ''));
  if (!ok) failures.push(name);
};
const byId = await get('/api/provinces/dictionary?q=2664&limit=5');
const first = byId.data.items[0];
expect('dictionary numeric id', first?.id === 2664 && typeof first.id === 'number', String(first?.id));
expect('dictionary label format', first?.label === `[${first?.id}] ${first?.name_cn ? first.name_cn + (first.name_en ? ' (' + first.name_en + ')' : '') : first?.name_en}`, first?.label);
expect('dictionary carries sources', typeof first?.name_cn_source === 'string' && typeof first?.name_en_source === 'string', `${first?.name_cn_source} / ${first?.name_en_source}`);
const byName = await get('/api/provinces/dictionary?q=' + encodeURIComponent('Plz') + '&limit=5');
expect('english fuzzy search', byName.data.items.some((item) => item.id === 267), byName.data.items.map((x) => x.label).join(' | '));
const byChinese = await get('/api/provinces/dictionary?q=' + encodeURIComponent('斯德哥尔摩') + '&limit=5');
expect('chinese search does not throw', Array.isArray(byChinese.data.items), String(byChinese.data.items?.length));
const mapRow = (await get('/api/map?provinceId=2664')).data.provinces[0];
const expectedLabel = mapRow?.name_cn
  ? `[${mapRow.id}] ${mapRow.name_cn} (${mapRow.name_en})`
  : `[${mapRow.id}] ${mapRow.name_en}`;
expect('map row label', mapRow?.label === expectedLabel, mapRow?.label);
expect('queue prompt province hint', batch.data.prompt.includes('province_hint: [2664]'), '');
expect('queue prompt keeps numeric id', batch.data.payload.changes.some((item) => item.targetType === 'province_history' && item.data.id === 2664));
expect('queue prompt rule', batch.data.prompt.includes('纯数字 ID'));

/* The AI vocabulary must be accepted at the queue boundary (bug regression). */
const alias = await post('/api/queue', {
  targetType: 'mission',
  action: 'update',
  targetId: 'missions/zz_eu4_workbench_missions.txt',
  targetFile: 'missions/zz_eu4_workbench_missions.txt',
  data: { file: 'missions/zz_eu4_workbench_missions.txt', nodes: [] },
});
expect('queue accepts action: update', alias.ok === true && alias.data.item?.action === 'modify', JSON.stringify(alias).slice(0, 120));
const badAction = await post('/api/queue', { targetType: 'mission', action: 'rename', targetId: 'x', data: {} });
expect('queue rejects unknown action', badAction.ok === false && /invalid action/.test(badAction.error || ''), badAction.error || '');

/* New modifier embedded in an event effect becomes a mechanic ChangeItem. */
const newMod = await post('/api/queue', {
  targetType: 'event', action: 'create', targetId: 'hus_event.1', targetFile: 'events/zz_eu4_workbench_events.txt',
  data: {
    file: 'events/zz_eu4_workbench_events.txt', id: 'hus_event.1', title: '布拉格之战', desc: '描述', triggerMode: 'normal',
    options: [{ name: 'hus_event.1.a', effects: [{ effect: 'add_country_modifier', params: { name: 'last_stand_modifier', nameZh: '最后一战', duration: '1825', stats: { land_morale: 0.2 }, newModifier: true } }] }],
  },
});
const q3 = await get('/api/queue');
const modItem = (q3.data.items || []).find((item) => item.targetType === 'mechanic' && item.targetId === 'last_stand_modifier');
expect('new modifier queue item', Boolean(modItem) && modItem.targetFile === 'common/event_modifiers/last_stand_modifier.txt' && modItem.data.stats.land_morale === 0.2, JSON.stringify(modItem && modItem.targetFile));
const items3 = q3.data.items || [];
expect('modifier task precedes event', items3.findIndex((item) => item.targetType === 'mechanic' && item.targetId === 'last_stand_modifier')
  < items3.findIndex((item) => item.targetType === 'event' && item.targetId === 'hus_event.1'));
const batch2 = await post('/api/queue/build', {});
expect('new modifier prompt task', batch2.data.prompt.includes('[New modifier tasks / 新修正强指令]')
  && batch2.data.prompt.includes('last_stand_modifier:0 "最后一战"')
  && batch2.data.prompt.includes('duration = 1825'), '');

/* Country decisions: parsed potential/allow + queue + strong prompt. */
const decisions = await get('/api/decisions?tag=BOH');
const decItems = decisions.data.items || [];
expect('decisions for tag', decisions.ok === true && decItems.length > 0, String(decItems.length));
const decSample = decItems[0];
expect('decision shape', Boolean(decSample) && typeof decSample.id === 'string' && Array.isArray(decSample.potential)
  && Array.isArray(decSample.allow) && Array.isArray(decSample.effects) && String(decSample.file || '').startsWith('decisions/'), JSON.stringify(decSample && decSample.file));
const decAll = await get('/api/decisions');
expect('decisions catalogue', (decAll.data.total || 0) > 50, String(decAll.data.total));
await post('/api/queue', {
  targetType: 'decision', action: 'create', targetId: 'dec_test.1', targetFile: 'decisions/zz_test_decisions.txt',
  data: {
    id: 'dec_test.1', title_cn: '测试决议', desc_cn: '描述', file: 'decisions/zz_test_decisions.txt',
    potential: [{ type: 'tag', op: '=', value: 'TBO' }], allow: [{ type: 'stability', op: '=', value: '1' }],
    effects: [{ effect: 'add_stability', value: '1' }], ai_will_do: 1,
  },
});
const q4 = await get('/api/queue');
const decItem = (q4.data.items || []).find((item) => item.targetType === 'decision' && item.targetId === 'dec_test.1');
expect('decision queued', Boolean(decItem) && decItem.targetFile === 'decisions/zz_test_decisions.txt', JSON.stringify(decItem && decItem.targetFile));
const batch3 = await post('/api/queue/build', {});
expect('decision prompt', batch3.data.prompt.includes('country_decisions = { dec_test.1')
  && batch3.data.prompt.includes('dec_test.1_title:0 "测试决议"')
  && batch3.data.prompt.includes('potential 只决定「是否可见」'), '');

/* Scanner report + path guard + deterministic event preview. */
const scanEventFile = path.join(wb.modRoot(), 'events', 'zz_scan_test.txt');
fs.mkdirSync(path.dirname(scanEventFile), { recursive: true });
fs.writeFileSync(scanEventFile, 'namespace = scan_test\ncountry_event = { id = scan_test.1 trigger = { tag = TBO } }\n', 'utf8');
await post('/api/refresh', {});
const scan = await get('/api/scan/report');
expect('scan report mod events', scan.ok === true && scan.data.events.mod >= 1 && scan.data.events.modFiles.some((file) => file.endsWith('zz_scan_test.txt')), JSON.stringify({ mod: scan.data.events.mod }));
expect('scan report other modules', Number.isFinite(scan.data.missions.mod) && Number.isFinite(scan.data.decisions.mod) && Number.isFinite(scan.data.ideas.modFiles), JSON.stringify({ missions: scan.data.missions.mod, decisions: scan.data.decisions.mod }));
const scanGraph = await get('/api/events?namespace=scan_test');
expect('new mod event scanned', (scanGraph.data.nodes || []).some((node) => node.id === 'scan_test.1'));
fs.unlinkSync(scanEventFile);
const modPath = await get('/api/paths/check?path=' + encodeURIComponent('events/zz_eu4_workbench_events.txt'));
expect('path guard accepts mod', modPath.data.ok === true && modPath.data.underMod === true, JSON.stringify(modPath.data.absolute));
const vanPath = await get('/api/paths/check?path=' + encodeURIComponent(path.join(scan.data.eu4Root, 'events', 'x.txt')));
expect('path guard rejects vanilla', vanPath.data.ok === false && vanPath.data.underVanilla === true);
const preview = await post('/api/ai/preview', {
  kind: 'event',
  data: { file: 'events/zz_test.txt', id: 'hus_event.1', title: '布拉格之战', desc: '描述', triggerMode: 'startup', targetTag: 'TBO', bindDate: '1437.1.1', options: [] },
});
expect('event preview code', preview.ok === true && preview.data.code.includes('country_event = {')
  && preview.data.code.includes('is_triggered_only = yes') && preview.data.history.line.includes('1437.1.1'));
const refreshApi = await post('/api/refresh', {});
expect('refresh api', refreshApi.ok === true && refreshApi.data.modRoot === scan.data.modRoot, JSON.stringify(refreshApi.data));

/* Mod directory + read-back verification. */
const modVerify = await get('/api/mod/verify');
expect('mod directory valid', modVerify.data.ok === true && modVerify.data.descriptor.endsWith('descriptor.mod'), JSON.stringify(modVerify.data));
const readbackFile = path.join(wb.modRoot(), 'events', 'zz_readback_test.txt');
fs.writeFileSync(readbackFile, 'namespace = readback_test\ncountry_event = { id = readback_test.1 title = readback_test.1.t }\n', 'utf8');
const readback = await post('/api/verify/readback', {
  targetType: 'event', targetId: 'readback_test.1', targetFile: 'events/zz_readback_test.txt', action: 'modify',
});
expect('readback finds event', readback.data.ok === true && readback.data.found === true && readback.data.size > 0, JSON.stringify({ size: readback.data.size, absolute: readback.data.absolute }));
const readbackMissing = await post('/api/verify/readback', {
  targetType: 'event', targetId: 'readback_test.404', targetFile: 'events/zz_readback_test.txt',
});
expect('readback missing event', readbackMissing.data.found === false, String(readbackMissing.data.found));
const triggerFile = path.join(wb.modRoot(), 'events', 'zz_trigger_test.txt');
fs.writeFileSync(triggerFile, 'namespace = trigger_test\ncountry_event = { id = trigger_test.1 title = trigger_test.1.t }\n', 'utf8');
fs.mkdirSync(path.join(wb.modRoot(), 'history', 'countries'), { recursive: true });
fs.writeFileSync(path.join(wb.modRoot(), 'history', 'countries', 'TBO - Tabor.txt'), '1437.1.1 = { country_event = { id = trigger_test.1 days = 0 } }\n', 'utf8');
fs.mkdirSync(path.join(wb.modRoot(), 'common', 'on_actions'), { recursive: true });
fs.writeFileSync(path.join(wb.modRoot(), 'common', 'on_actions', 'zz_eu4_workbench_on_actions.txt'), 'on_startup = {\n\teffect = {\n\t\tif = {\n\t\t\tlimit = { exists = TBO }\n\t\t\tTBO = { country_event = { id = trigger_test.1 days = 1 } }\n\t\t}\n\t}\n}\n', 'utf8');
const rbTrigger = await post('/api/verify/readback', {
  targetType: 'event', targetId: 'trigger_test.1', targetFile: 'events/zz_trigger_test.txt',
  action: 'modify', triggerMode: 'startup', historyTag: 'TBO', bindDate: '1437.1.1',
});
expect('readback namespace + startup trigger', rbTrigger.data.ok === true && rbTrigger.data.namespaceOk === true && rbTrigger.data.trigger && rbTrigger.data.trigger.ok === true, JSON.stringify({ ns: rbTrigger.data.namespaceOk, trigger: rbTrigger.data.trigger && rbTrigger.data.trigger.ok }));
const previewTrigger = await post('/api/ai/preview', {
  kind: 'event', data: { file: 'events/zz_trigger_test.txt', id: 'trigger_test.1', title: 'T', desc: 'D', triggerMode: 'startup', targetTag: 'TBO', bindDate: '1437.1.1', options: [] },
});
expect('preview namespace ok', previewTrigger.data.namespaceOk === true, JSON.stringify(previewTrigger.data.namespace));
expect('preview trigger ok', previewTrigger.data.history && previewTrigger.data.history.ok === true && previewTrigger.data.onAction && previewTrigger.data.onAction.bound === true, JSON.stringify(previewTrigger.data.onAction));
fs.unlinkSync(triggerFile);
const previewPath = await post('/api/ai/preview', {
  kind: 'event', data: { file: 'events/zz_readback_test.txt', id: 'readback_test.1', title: 'T', desc: 'D', triggerMode: 'normal', options: [] },
});
expect('preview absolute path', String(previewPath.data.absolutePath || '').includes('events'), String(previewPath.data.absolutePath));
fs.unlinkSync(readbackFile);

/* Opening diplomacy read-back. */
const dipDir = path.join(wb.modRoot(), 'history', 'diplomacy');
fs.mkdirSync(dipDir, { recursive: true });
const dipFile = path.join(dipDir, 'zz_eu4_workbench_diplomacy.txt');
fs.writeFileSync(dipFile, 'alliance = {\n\tfirst = TBO\n\tsecond = BOH\n\tstart_date = 1437.1.1\n}\n', 'utf8');
const dipRb = await post('/api/verify/readback', {
  targetType: 'diplomacy', targetId: 'TBO-BOH-alliance', targetFile: 'history/diplomacy/zz_eu4_workbench_diplomacy.txt',
  action: 'modify', tagA: 'TBO', tagB: 'BOH', relationType: 'alliance', startDate: '1437.1.1',
});
expect('diplomacy read-back', dipRb.data.ok === true && dipRb.data.diplomacy.found === true && dipRb.data.diplomacy.balanced === true, JSON.stringify(dipRb.data.diplomacy));
fs.unlinkSync(dipFile);

/* Province adjacency (land borders + straits). */
const adj = await get('/api/provinces/adjacent?id=265');
expect('adjacent land provinces', adj.ok === true && adj.data.total > 0 && adj.data.items.some((item) => item.type === 'land'), JSON.stringify({ total: adj.data.total }));
const adjIsland = await get('/api/provinces/adjacent?id=333');
expect('adjacent strait provinces', adjIsland.data.items.some((item) => item.type === 'strait' || item.type === 'lake'), JSON.stringify(adjIsland.data.items.slice(0, 3)));

/* Province history: owner/controller consistency + date block. */
const provDir = path.join(wb.modRoot(), 'history', 'provinces');
fs.mkdirSync(provDir, { recursive: true });
const provFile = path.join(provDir, '265 - Test.txt');
fs.writeFileSync(provFile, '1437.1.1 = {\n\towner = MVA\n\tcontroller = BOH\n}\n', 'utf8');
const provMismatch = await post('/api/verify/readback', { targetType: 'province_history', targetId: '265', targetFile: 'history/provinces/265 - Test.txt', action: 'modify', owner: 'MVA' });
expect('province readback mismatch warning', provMismatch.data.ok === true && provMismatch.data.province.mismatch === true && provMismatch.data.province.inDateBlock === true, JSON.stringify(provMismatch.data.province));
fs.writeFileSync(provFile, '1437.1.1 = {\n\towner = MVA\n\tcontroller = MVA\n}\n', 'utf8');
const provOk = await post('/api/verify/readback', { targetType: 'province_history', targetId: '265', targetFile: 'history/provinces/265 - Test.txt', action: 'modify', owner: 'MVA' });
expect('province readback matching controller', provOk.data.ok === true && provOk.data.province.mismatch === false && provOk.data.province.ownerMatches === true);
fs.unlinkSync(provFile);

/* Delete semantics: node removal vs whole-file removal. */
const deleteFile = path.join(wb.modRoot(), 'events', 'zz_delete_test.txt');
fs.writeFileSync(deleteFile, 'namespace = del\ncountry_event = { id = del.1 title = del.1.t }\ncountry_event = { id = del.2 title = del.2.t }\n', 'utf8');
const nodeStill = await post('/api/verify/readback', { targetType: 'event', targetId: 'del.1', targetFile: 'events/zz_delete_test.txt', action: 'delete' });
expect('delete node still present', nodeStill.data.ok === false && nodeStill.data.operation === 'delete-node', JSON.stringify(nodeStill.data.operation));
fs.writeFileSync(deleteFile, 'namespace = del\ncountry_event = { id = del.2 title = del.2.t }\n', 'utf8');
const nodeGone = await post('/api/verify/readback', { targetType: 'event', targetId: 'del.1', targetFile: 'events/zz_delete_test.txt', action: 'delete' });
expect('delete node removed', nodeGone.data.ok === true && nodeGone.data.operation === 'delete-node');
const fileStill = await post('/api/verify/readback', { targetType: 'event', targetId: 'events/zz_delete_test.txt', targetFile: 'events/zz_delete_test.txt', action: 'delete', deleteFile: true });
expect('delete file still present', fileStill.data.ok === false && fileStill.data.operation === 'delete-file');
fs.unlinkSync(deleteFile);
const fileGone = await post('/api/verify/readback', { targetType: 'event', targetId: 'events/zz_delete_test.txt', targetFile: 'events/zz_delete_test.txt', action: 'delete', deleteFile: true });
expect('delete file removed', fileGone.data.ok === true && fileGone.data.message.includes('文件已成功删除'), String(fileGone.data.message));

/* Ideas endpoint must return the parsed file, not just its path. */
const ideas = await get('/api/ideas/file?tag=BOH');
const ideaData = ideas.data || {};
expect('ideas file located', ideas.ok === true && ideaData.exists === true, ideaData.file);
expect('ideas mtime exposed', Number(ideaData.mtimeMs) > 0, String(ideaData.mtimeMs));
expect('ideas traditions parsed as modifiers', Array.isArray(ideaData.traditions) && ideaData.traditions.length === 2, JSON.stringify(ideaData.traditions));
expect('ideas ambition parsed', Boolean(ideaData.ambition && ideaData.ambition.modifier), JSON.stringify(ideaData.ambition));
expect('ideas seven blocks parsed', (ideaData.ideas || []).length === 7, String((ideaData.ideas || []).length));
expect('ideas carry modifiers array', Array.isArray(ideaData.ideas?.[0]?.modifiers) && ideaData.ideas[0].modifiers.length > 0, JSON.stringify(ideaData.ideas?.[0]?.modifiers));
expect('ideas values stay native', (ideaData.traditions || []).every((m) => typeof m.value === 'number' && Math.abs(m.value) <= 10), JSON.stringify(ideaData.traditions));

/* Modifier catalogue: full Chinese dictionary plus the category tree. */
const optionsData = await get('/api/eu4/options');
expect('modifier catalogue is large', (optionsData.data.modifiers || []).length >= 300, String((optionsData.data.modifiers || []).length));
expect('modifier tree has five categories', (optionsData.data.modifierTree || []).length === 5, String((optionsData.data.modifierTree || []).length));
const treeItems = (optionsData.data.modifierTree || []).flatMap((category) => category.groups.flatMap((group) => group.items));
expect('modifier tree covers the catalogue', treeItems.length === (optionsData.data.modifiers || []).length, treeItems.length + '/' + (optionsData.data.modifiers || []).length);
const localesNow = await get('/api/ui/locales');
expect('modifier labels localized', localesNow.data.messages['modifier.global_unrest'] === '全局叛乱度', String(localesNow.data.messages['modifier.global_unrest']));
expect('modifier type exposed', (optionsData.data.modifiers || []).find((m) => m.value === 'global_unrest')?.type === 'integer');

/* Switching the tag must parse that tag's group (not the first block, not a cache hit). */
const bohIdeas = await get('/api/ideas/file?tag=BOH');
const rusIdeas = await get('/api/ideas/file?tag=RUS');
const bohAgain = await get('/api/ideas/file?tag=BOH');
const missingIdeas = await get('/api/ideas/file?tag=ZZZ');
expect('BOH group parsed', bohIdeas.data.group === 'BOH_ideas', String(bohIdeas.data.group));
expect('RUS group parsed', rusIdeas.data.group === 'RUS_ideas', String(rusIdeas.data.group));
expect('tag switch does not borrow ideas', !(rusIdeas.data.ideas || []).some((idea) => idea.id === 'compacta_of_prague'), (rusIdeas.data.ideas || []).map((idea) => idea.id).join(','));
expect('switch back still BOH', bohAgain.data.group === 'BOH_ideas' && (bohAgain.data.ideas || []).some((idea) => idea.id === 'compacta_of_prague'));
expect('unknown tag is empty', missingIdeas.data.exists === false && (missingIdeas.data.ideas || []).length === 0, JSON.stringify(missingIdeas.data.warnings));

/* Event form + startup prompt contract. */
expect('event form exposes keys', form.ok === true && form.data.titleKey === 'flavor_boh.1.t' && form.data.descKey === 'flavor_boh.1.d', JSON.stringify({ titleKey: form.data.titleKey, descKey: form.data.descKey }));
expect('event form trigger mode', form.data.triggerMode === 'normal' || form.data.triggerMode === 'startup', String(form.data.triggerMode));
const eventBuild = await post('/api/ai/build', {
  kind: 'event', action: 'create',
  data: { file: 'events/zz_test.txt', id: 'hus_event.1', title: '布拉格之战', desc: '中文描述', triggerMode: 'startup', targetTag: 'TBO', bindDate: '1437.1.1' },
});
expect('event startup prompt', eventBuild.ok === true
  && eventBuild.data.prompt.includes("Generate an event with is_triggered_only = yes")
  && eventBuild.data.prompt.includes('history/countries/TBO.txt')
  && eventBuild.data.prompt.includes('1437.1.1 = { country_event = { id = hus_event.1 days = 0 } }'), '');
expect('event prompt keys', eventBuild.data.prompt.includes('title = "hus_event.1.t"') && eventBuild.data.prompt.includes('l_simp_chinese'));

/* Event catalogue + quick-add dictionary. */
const eventCatalog = await get('/api/events/catalog');
expect('event catalogue size', eventCatalog.ok === true && eventCatalog.data.total > 1000, String(eventCatalog.data.total));
const bohEvent = (eventCatalog.data.items || []).find((item) => item.id === 'flavor_boh.1');
expect('event catalogue chinese title', Boolean(bohEvent && bohEvent.title && /[\u4e00-\u9fff]/.test(bohEvent.title)), JSON.stringify(bohEvent && bohEvent.title));
expect('event catalogue shape', Boolean(bohEvent && bohEvent.kind === 'country_event' && bohEvent.source === 'vanilla' && bohEvent.titleKey === 'flavor_boh.1.t'));
const refreshed = await get('/api/events/catalog?refresh=1');
expect('event catalogue refresh', refreshed.ok === true && refreshed.data.total === eventCatalog.data.total, String(refreshed.data.total));
const custom2 = await post('/api/dictionary/custom', { key: 'my_custom_effect', value: '测试效果' });
const uiCustom = await get('/api/ui/locales');
expect('quick-add dictionary visible', custom2.ok === true && uiCustom.data.messages['my_custom_effect'] === '测试效果', String(uiCustom.data.messages['my_custom_effect']));
if (failures.length) {
  console.log('http checks failed:', failures.join(', '));
  process.exit(1);
}

await post('/api/queue/clear', {});
const mod = await get('/api/modifier?name=thriving_arms_industry');
console.log('modifier', mod.ok, mod.data.stats.length);
const refused = await post('/api/missions/save', { nodes: [] });
console.log('ui-write-refused', refused.ok === false);
const t = await get('/api/tools');
console.log('tools', t.data.map((x) => x.id + ':' + x.status));
server.close();
