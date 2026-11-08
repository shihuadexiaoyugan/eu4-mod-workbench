import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// React is a browser-platform module supplied by DSH, not a plugin dependency.
// Resolve it from the active DSH profile when available, else from a local
// node_modules; skip the test instead of hardcoding a machine path.
const here = path.dirname(fileURLToPath(import.meta.url));
const candidates = [];
if (process.env.DSH_PROFILE_DIR) candidates.push(path.join(process.env.DSH_PROFILE_DIR, 'package.json'));
candidates.push(path.join(here, '..', 'package.json'));

let ReactFromProfile;
let ReactDOMServer;
for (const manifest of candidates) {
  if (!existsSync(manifest)) continue;
  try {
    const req = createRequire(manifest);
    ReactFromProfile = req('react');
    ReactDOMServer = req('react-dom/server');
    break;
  } catch {
    /* try the next manifest */
  }
}
if (ReactFromProfile === undefined || ReactDOMServer === undefined) {
  console.log('skipped: react/react-dom not resolvable (run inside DSH or install them as devDependencies)');
  process.exit(0);
}

let factory;
globalThis.window = {
  __ModuleLoader__: {
    load(definition) {
      factory = definition.factory;
    },
  },
};
await import('../client.js');
if (!factory) throw new Error('client module did not register a factory');

const plugin = factory((name) => {
  if (name === 'react') return ReactFromProfile;
  throw new Error('unexpected require: ' + name);
});
const registrations = [];
const waits = [];
const ctx = {
  slots: {
    inject(name, callback) {
      waits.push({ name, callback });
      return () => {};
    },
    register(def, component) {
      registrations.push({ def, component });
      return () => {};
    },
  },
};
plugin.apply(ctx);
if (waits.length !== 2) throw new Error('expected two slot waits: ' + waits.map((w) => w.name).join(','));
for (const wait of waits) wait.callback();
console.log('registrations', registrations.map((r) => r.def.name + ':' + (r.def.key || r.def.id)));
const panel = registrations.find((r) => r.def.name === 'main');
const icon = registrations.find((r) => r.def.name === 'sidebar.panellist');
const html = ReactDOMServer.renderToStaticMarkup(ReactFromProfile.createElement(panel.component));
console.log('panel html bytes', html.length);
console.log('panel root renders', html.includes('eu4w-root'));
console.log('icon bytes', ReactDOMServer.renderToStaticMarkup(ReactFromProfile.createElement(icon.component, { size: 18 })).length);

/* ---------------- province label + search (pure logic) ---------------- */
const internals = plugin.testInternals;
if (!internals) throw new Error('plugin did not expose testInternals');
const { provinceLabelOf, filterProvinces } = internals;

const expectations = [
  ['three-in-one', provinceLabelOf({ id: 2664, name_cn: '皮尔森', name_en: 'Plzeň' }), '[2664] 皮尔森 (Plzeň)'],
  ['chinese only', provinceLabelOf({ id: 2664, name_cn: '皮尔森' }), '[2664] 皮尔森'],
  ['english only fallback', provinceLabelOf({ id: 2664, name_en: 'Plzeň' }), '[2664] Plzeň'],
  ['id only fallback', provinceLabelOf({ id: 2664 }), '[2664]'],
  ['raw numeric fallback', provinceLabelOf(null, 2664), '[2664]'],
];
for (const [name, actual, expected] of expectations) {
  if (actual !== expected) throw new Error(name + ': expected ' + expected + ', got ' + actual);
  console.log('ok  label ' + name, actual);
}

const catalog = [
  { id: 2664, name: 'Plzen', name_cn: '皮尔森', name_en: 'Plzeň' },
  { id: 267, name: 'Plzen', name_cn: '', name_en: 'Plzen' },
  { id: 1, name: 'Stockholm', name_cn: '斯德哥尔摩', name_en: 'Stockholm' },
  { id: 2, name: 'Ostergotland', name_cn: '', name_en: 'Östergötland' },
];
const queries = [
  ['id', '2664', [2664]],
  ['chinese', '皮尔森', [2664]],
  ['chinese prefix', '皮尔', [2664]],
  ['english prefix', 'Plz', [267, 2664]],
  ['folded', 'plzen', [267, 2664]],
  ['folded diacritics', 'ostergotland', [2]],
  ['miss', 'atlantis', []],
];
for (const [name, query, expected] of queries) {
  const actual = filterProvinces(catalog, query, 10).map((item) => item.id);
  if (actual.join(',') !== expected.join(',')) {
    throw new Error('filter ' + name + ': expected ' + expected.join(',') + ', got ' + actual.join(','));
  }
  console.log('ok  filter ' + name, query, '->', actual.join(','));
}

/* ---------------- grid card text: big = Chinese, small = [ID] English ------------- */
const { provinceCardText } = internals;
const cardCases = [
  ['cn+en', { id: 2664, name_cn: '皮尔森', name_en: 'Plzeň', owner: 'BOH' }, '皮尔森', '[2664] Plzeň · BOH', '[2664] 皮尔森 (Plzeň)'],
  ['english fallback', { id: 49, name_en: 'Neumark', owner: 'BRA' }, 'Neumark', '[49] · BRA', '[49] Neumark'],
  ['unused land', { id: 3999, name_en: 'UnusedLand' }, 'UnusedLand', '[3999]', '[3999] UnusedLand'],
  ['id only', { id: 4000 }, '4000', '[4000]', '[4000]'],
];
for (const [name, province, main, sub, tip] of cardCases) {
  const card = provinceCardText(province);
  if (card.main !== main || card.sub !== sub || card.tip !== tip) {
    throw new Error('card ' + name + ': got ' + JSON.stringify(card));
  }
  console.log('ok  card ' + name, JSON.stringify({ main: card.main, sub: card.sub, tip: card.tip }));
}
const emptyCard = provinceCardText(null);
console.log('ok  card null-safe', JSON.stringify({ main: emptyCard.main, tip: emptyCard.tip }));
if (emptyCard.main !== '—' || emptyCard.tip !== '[?]') throw new Error('null card must degrade, got ' + JSON.stringify(emptyCard));

/* ---------------- tabs render without a Host ---------------- */
for (const tab of ['ProvinceTab', 'MapTab', 'BatchTab']) {
  const markup = internals.renderTabForTest(tab, ReactFromProfile, ReactDOMServer);
  console.log('ok  render ' + tab, markup.length, 'bytes');
  if (tab === 'ProvinceTab') {
    if (!markup.includes('eu4w-search')) throw new Error('ProvinceTab has no searchable picker');
    if (!markup.includes('同时写入省份名称本地化')) throw new Error('ProvinceTab has no localisation toggle');
    if (!markup.includes('搜索省份')) throw new Error('ProvinceTab picker placeholder missing');
  }
  if (tab === 'MapTab') {
    if (!markup.includes('eu4w-map')) throw new Error('MapTab grid missing');
    if (!markup.includes('eu4w-search')) throw new Error('MapTab has no province picker');
    if (!markup.includes('按 ID / 中文 / 英文搜索并选中省份')) throw new Error('MapTab jump picker missing');
  }
}

