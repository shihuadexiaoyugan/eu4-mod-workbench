import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Workbench } from '../lib/engine.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = path.join(root, '..', '_eu4_test_modroot');
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(path.join(tmp, 'testmod', 'missions'), { recursive: true });
fs.mkdirSync(path.join(tmp, 'testmod', 'events'), { recursive: true });
fs.mkdirSync(path.join(tmp, 'testmod', 'localisation'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'testmod.mod'), 'name="Test Mod"\npath="testmod"\nsupported_version="v1.37.*"\n');
fs.writeFileSync(path.join(tmp, 'testmod', 'descriptor.mod'), 'name="Test Mod"\npath="testmod"\n');
fs.writeFileSync(path.join(tmp, 'testmod', 'events', 'test_events.txt'),
  'namespace = test_ns\ncountry_event = { id = test_ns.1 title = test_ns.1.t option = { name = test_ns.1.a country_event = { id = test_ns.999 } } }\n');
fs.writeFileSync(path.join(tmp, 'testmod', 'localisation', 'test_l_english.yml'),
  'l_english:\n test_ns.1.t:0 "Test"\n');

const wb = new Workbench({
  eu4Root: process.env.EU4_ROOT ?? 'D:/SteamLibrary/steamapps/common/Europa Universalis IV',
  modDir: tmp,
  statePath: path.join(tmp, 'state.json'),
});
wb.init();
wb.state.selectedMod = 'testmod';
wb.saveState();
console.log('mods', wb.state.mods.map((m) => m.id));
const save = wb.saveMissions({
  nodes: [
    { id: 'a', title: 'A', required: [], trigger: 'tag = FRA', effect: 'add_prestige = 10' },
    { id: 'b', title: 'B', required: ['a'], trigger: 'tag = FRA', effect: 'add_stability = 1' },
  ],
});
console.log('save', save.ok, save.path, save.issues);
console.log(fs.readFileSync(save.path, 'utf8'));
console.log('parse', wb.parseMissions('missions/zz_eu4_workbench_missions.txt').missions);
const ev = wb.eventGraph('test_ns');
console.log('event nodes', ev.nodes.length, 'edges', ev.edges.length, 'missing', ev.missingCount, ev.edges);
console.log('loc', wb.checkLocKeys('country_event = { title = test_ns.1.t desc = missing.key }'));
console.log('shadow', wb.shadowConflicts());
console.log('batch', wb.batchHistory({ tag: 'FRA', provinceIds: [1, 2], operation: 'owner' }).files.map((f) => f.path));
const file = wb.readTextFile('events/test_events.txt');
console.log('read file', file.editable, file.bytes);
const fileSave = wb.saveTextFile('events/test_events.txt', file.content + '\n# edited by smoke test\n');
console.log('save file', fileSave.ok, fileSave.relative);
