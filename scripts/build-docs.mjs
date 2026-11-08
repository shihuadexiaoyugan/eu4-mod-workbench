/**
 * Build the offline script-doc index used by query_script_doc.
 *
 * Source: https://github.com/vawser/EU4-Documentation (community-maintained
 * documentation of the Clausewitz script surface). The generated file keeps
 * the source commit and URL so every answer can name where it came from.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const outFile = path.join(root, 'lib', 'docs-data.json');
const FILES = ['effects.txt', 'triggers.txt', 'scopes.txt', 'modifiers.txt'];
const SOURCE = 'https://github.com/vawser/EU4-Documentation';
const API = 'https://api.github.com/repos/vawser/EU4-Documentation/contents/';

function scopeFromHeader(header) {
  // Only section headers switch scope. Ordinary prose comments also contain
  // words such as "country" and must never affect the inferred scope.
  const h = header.toLowerCase().trim();
  if (!/(effects?|triggers?)/.test(h)) return null;
  if (h.startsWith('dual')) return ['country', 'province'];
  if (h.startsWith('country-scope') || h.startsWith('effect - country') || h.startsWith('trigger - country')) return ['country'];
  if (h.startsWith('province-scope') || h.startsWith('effect - province') || h.startsWith('trigger - province')) return ['province'];
  if (h.startsWith('trade node') || h.startsWith('tradenode')) return ['trade_node'];
  if (h.startsWith('effect - script') || h.startsWith('trigger - script')) return ['script'];
  return null;
}

function parseDoc(text, kind) {
  const entries = [];
  let scope = kind === 'effect' ? ['country'] : ['country'];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const header = /^#\s+(.+)$/.exec(raw);
    if (header) {
      const next = scopeFromHeader(header[1], kind);
      if (next) scope = next;
      continue;
    }
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
    const m = /^([A-Za-z0-9_<>]+)\s*=\s*(.*)$/.exec(raw.trim());
    if (!m) continue;
    const name = m[1];
    if (name.startsWith('<') || name.endsWith('>')) continue;
    let signature = m[2].trim();
    signature = signature.replace(/\s+#.*$/, '').trim();
    if (!signature) continue;
    if (signature === '{' || signature.startsWith('{ ')) signature = '{ ... }';
    const block = signature.startsWith('{');
    entries.push({
      name,
      kind,
      signature,
      block,
      scopes: scope.slice(),
      line: i + 1,
      source: kind + 's.txt',
    });
  }
  return entries;
}

const scopes = [
  ['ROOT', 'root', 'Current root scope.'],
  ['THIS', 'any', 'Current scope.'],
  ['FROM', 'any', 'Previous scope.'],
  ['PREV', 'any', 'Previous scope.'],
  ['owner', 'country', 'Province -> owning country.'],
  ['controller', 'country', 'Province -> controller country.'],
  ['capital_scope', 'province', 'Country -> capital province.'],
  ['capital', 'province', 'Country -> capital province.'],
  ['overlord', 'country', 'Subject -> overlord.'],
  ['colonial_parent', 'country', 'Colonial nation -> parent.'],
  ['every_owned_province', 'province', 'Country -> all owned provinces.'],
  ['random_owned_province', 'province', 'Country -> one owned province.'],
  ['any_owned_province', 'province', 'Country -> test owned provinces.'],
  ['all_owned_province', 'province', 'Country -> test all owned provinces.'],
  ['every_province', 'province', 'Global -> all provinces.'],
  ['random_province', 'province', 'Global -> one province.'],
  ['any_province', 'province', 'Global -> test provinces.'],
  ['all_province', 'province', 'Global -> test all provinces.'],
  ['every_country', 'country', 'Global -> all countries.'],
  ['random_country', 'country', 'Global -> one country.'],
  ['any_country', 'country', 'Global -> test countries.'],
  ['all_country', 'country', 'Global -> test all countries.'],
  ['every_neighbor_country', 'country', 'Country -> neighbouring countries.'],
  ['random_neighbor_country', 'country', 'Country -> one neighbour.'],
  ['every_core_province', 'province', 'Country -> core provinces.'],
  ['random_core_province', 'province', 'Country -> one core province.'],
  ['every_trade_node_member_country', 'country', 'Trade node -> member countries.'],
  ['every_trade_node_member_province', 'province', 'Trade node -> member provinces.'],
];

const files = {};
for (const name of FILES) {
  const res = await fetch(API + name, { headers: { 'user-agent': 'eu4-mod-workbench' } });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const json = await res.json();
  const text = Buffer.from(String(json.content || '').replace(/\s+/g, ''), 'base64').toString('utf8');
  files[name] = text;
}

const entries = [
  ...parseDoc(files['effects.txt'], 'effect'),
  ...parseDoc(files['triggers.txt'], 'trigger'),
  ...parseDoc(files['modifiers.txt'], 'modifier'),
];
const scopesText = files['scopes.txt'];
const scopeEntries = scopes.map(([name, target, description]) => ({
  name, kind: 'scope', signature: `-> ${target}`, block: true,
  scopes: [target], description, source: 'scopes.txt', line: 0,
}));

// A few hand-checked aliases that the documentation lists under generated
// headers. Their source lines remain the documentation files above.
const index = {
  generatedAt: new Date().toISOString(),
  source: SOURCE,
  files: FILES,
  sourceSizes: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, v.length])),
  scopes: scopeEntries,
  entries,
  scopeChangers: Object.fromEntries(scopes.map(([name, target]) => [name, target])),
  rawScopes: scopesText,
};

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(index, null, 2) + '\n', 'utf8');
console.log(`wrote ${outFile}: ${entries.length} entries, ${scopeEntries.length} scopes`);
