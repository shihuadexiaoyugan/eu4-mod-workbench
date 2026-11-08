/**
 * EU4 Mod Workbench — shared engine.
 *
 * All filesystem paths are resolved with path.join/path.resolve. No path
 * separator is ever hard-coded. The engine is deliberately dependency-free so
 * the bundle can run from a linked workspace directory without a build step.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ConditionIntent, EffectIntent } from './ai.js';

export interface WorkbenchConfig {
  eu4Root?: string;
  modDir?: string;
  /** EU4 user-data folder (dlc_load.json + mod/*.mod); '' disables discovery. */
  eu4UserDir?: string;
  statePath?: string;
  clausewitzMcpUrl?: string;
  clausewitzMcpCommand?: string;
  clausewitzMcpArgs?: string[];
  eu4ModEditingToolPath?: string;
  emtPath?: string;
  paradoxCodePath?: string;
  maxIndexFiles?: number;
  /** Heap guard (MB); heavy scans abort and clear caches above this. */
  maxHeapMB?: number;
}

export interface CwNode {
  key: string;
  value: string | null;
  children: CwNode[] | null;
  line: number;
}

export interface ValidationIssue {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  line?: number;
  key?: string;
  expectedScope?: string[];
  actualScope?: string;
}

export interface ModRecord {
  id: string;
  name: string;
  path: string;
  supportedVersion?: string;
}

export interface DocEntry {
  name: string;
  kind: string;
  signature: string;
  block: boolean;
  scopes: string[];
  line: number;
  source: string;
  description?: string;
}

export interface WorkspaceState {
  eu4Root: string | null;
  modDir: string | null;
  selectedMod: string | null;
  /** Shared UI selection: the country tag every panel filters by. */
  activeTag: string | null;
  /** Scenario start date used to evaluate province history timelines. */
  currentStartDate: string;
  /** A UI edit waiting for the agent; it holds a prompt, never file writes. */
  pendingEdit: any | null;
  /** Global queue of panel edits, merged into one batch prompt. */
  changeQueue: any[];
  vanillaFiles: string[];
  mods: ModRecord[];
  indexedAt: string | null;
  counts: Record<string, number>;
}

export interface ToolStatus {
  id: string;
  name: string;
  status: 'connected' | 'reachable' | 'installed' | 'not-installed' | 'not-configured' | 'unreachable';
  reason: string;
  path?: string;
  url?: string;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOCS_FILE = path.join(HERE, 'docs-data.json');
const INDEX_DIRS = ['common', 'events', 'missions', 'history', 'localisation', 'decisions', 'customizable_localization', 'map'];
const SKIP_DIRS = new Set(['node_modules', '.git', '.svn', '.hg', '.dsh']);
const TRIGGER_BLOCKS = new Set(['trigger', 'potential', 'allow', 'limit', 'visible', 'custom_trigger_tooltip', 'hidden_trigger', 'ai_will_do', 'ai_chance', 'from_potential']);
const EFFECT_BLOCKS = new Set(['immediate', 'option', 'after', 'on_start', 'on_success', 'on_fail', 'effect', 'hidden_effect', 'else', 'else_if', 'while', 'random', 'random_list', 'tooltip', 'every_owned_province', 'random_owned_province', 'every_country', 'random_country', 'capital_scope']);
const LOC_KEYS = new Set(['title', 'desc', 'tooltip', 'custom_tooltip', 'text', 'name', 'localisation']);
const STRUCTURAL_KEYS = new Set([
  'id', 'name', 'title', 'desc', 'icon', 'picture', 'namespace', 'major', 'hidden', 'option',
  'trigger', 'effect', 'immediate', 'after', 'ai_chance', 'ai_will_do', 'limit', 'potential',
  'allow', 'tooltip', 'custom_tooltip', 'style', 'position', 'duration', 'value', 'modifier',
  'required_missions', 'has_country_shield', 'completed_by', 'visible', 'potential',
]);
const NAMED_SCOPES = new Set(['country', 'province', 'trade_node', 'script', 'any']);

/**
 * New modifier definitions embedded in an event/mission effect list:
 * `add_country_modifier` with stats and `existing !== true`.
 */
function collectEmbeddedModifiers(data: any): Array<{ name: string; nameZh: string; stats: Record<string, any> }> {
  const out: Array<{ name: string; nameZh: string; stats: Record<string, any> }> = [];
  const seen = new Set<string>();
  const add = (name: string, nameZh: string, stats: any) => {
    const safe = String(name || '').trim();
    if (!safe || !/^[A-Za-z0-9_.\-]+$/.test(safe) || seen.has(safe)) return;
    if (!stats || typeof stats !== 'object' || Array.isArray(stats) || !Object.keys(stats).length) return;
    seen.add(safe);
    out.push({ name: safe, nameZh: String(nameZh || '').trim(), stats });
  };
  const scan = (effects: any[]) => {
    for (const effect of effects || []) {
      if (!effect || effect.effect !== 'add_country_modifier') continue;
      const params = effect.params || {};
      if (params.newModifier === false) continue;
      if (params.existing === true && params.newModifier !== true) continue;
      add(params.name, params.nameZh, params.stats);
    }
  };
  for (const option of data?.options || []) scan(option.effects);
  for (const node of data?.nodes || []) scan(node.rewards);
  scan(Array.isArray(data?.effects) ? data.effects : []);
  for (const mod of data?.newModifiers || []) add(mod?.name, mod?.nameZh, mod?.stats);
  return out;
}

/**
 * Province history: owner/controller must agree and live inside a date block,
 * otherwise the vanilla 1444 definition can override the edit.
 */
function parseProvinceHistory(text: string): any {
  let owner = '';
  let controller = '';
  let ownerInBlock = false;
  let controllerInBlock = false;
  let date = '';
  for (const node of parseCw(text)) {
    if (/^\d{1,4}\.\d{1,2}\.\d{1,2}$/.test(node.key) && node.children) {
      const o = findNode(node.children, 'owner')?.value;
      const c = findNode(node.children, 'controller')?.value;
      if (o) { owner = unquote(String(o)).toUpperCase(); ownerInBlock = true; date = node.key; }
      if (c) { controller = unquote(String(c)).toUpperCase(); controllerInBlock = true; }
    } else if (node.key === 'owner' && node.value) {
      owner = unquote(String(node.value)).toUpperCase();
    } else if (node.key === 'controller' && node.value) {
      controller = unquote(String(node.value)).toUpperCase();
    }
  }
  return {
    owner,
    controller,
    ownerInBlock,
    controllerInBlock,
    date,
    inDateBlock: ownerInBlock && controllerInBlock && Boolean(date),
    mismatch: Boolean(owner && controller && owner !== controller),
  };
}

/** Native diplomacy blocks (history/diplomacy uses start_date, not date blocks). */
function parseDiplomacyHistory(text: string): any[] {
  const out: any[] = [];
  for (const node of parseCw(text)) {
    if (!['alliance', 'royal_marriage', 'vassal', 'union', 'guarantee'].includes(node.key) || !node.children) continue;
    const first = unquote(String(findNode(node.children, 'first')?.value ?? '')).trim().toUpperCase();
    const second = unquote(String(findNode(node.children, 'second')?.value ?? '')).trim().toUpperCase();
    const startDate = unquote(String(findNode(node.children, 'start_date')?.value ?? '')).trim();
    const endDate = unquote(String(findNode(node.children, 'end_date')?.value ?? '')).trim();
    out.push({ type: node.key, first, second, startDate, endDate });
  }
  return out;
}

/** War history: a date block with add_attacker/add_defender + war_goal/casus_belli. */
function parseWarHistory(text: string, tagA = '', tagB = ''): any {
  let casusBelli = '';
  let attacker = false;
  let defender = false;
  let date = '';
  for (const node of parseCw(text)) {
    if (node.key === 'war_goal' && node.children) {
      casusBelli = unquote(String(findNode(node.children, 'casus_belli')?.value ?? '')).trim();
    }
    if (/^\d{1,4}\.\d{1,2}\.\d{1,2}$/.test(node.key) && node.children) {
      const atk = unquote(String(findNode(node.children, 'add_attacker')?.value ?? '')).trim().toUpperCase();
      const def = unquote(String(findNode(node.children, 'add_defender')?.value ?? '')).trim().toUpperCase();
      if (atk && (!tagA || atk === tagA)) attacker = true;
      if (def && (!tagB || def === tagB)) defender = true;
      if (atk || def) date = node.key;
    }
  }
  return { casusBelli, attacker, defender, date, found: attacker && defender };
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }}

function normRel(rel: string): string {
  return rel.split(path.sep).join(path.posix.sep).replace(new RegExp('^' + path.posix.sep + '+'), '');
}

function toAbs(root: string, rel: string): string | null {
  const parts = normRel(rel).split(path.posix.sep).filter((p) => p && p !== '.');
  if (parts.some((p) => p === '..')) return null;
  const abs = path.resolve(root, ...parts);
  const inside = path.relative(path.resolve(root), abs);
  if (inside.startsWith('..') || path.isAbsolute(inside)) return null;
  return abs;
}

function existsDir(p: string | null | undefined): p is string {
  if (!p) return false;
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function existsFile(p: string | null | undefined): p is string {
  if (!p) return false;
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function isDirectory(p: string | null | undefined): p is string {
  if (!p) return false;
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function unquote(value: string): string {
  const v = value.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

function stripComment(line: string): string {
  let quote = '';
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '#') {
      return line.slice(0, i);
    }
  }
  return line;
}

/* ------------------------------------------------------------------ */
/* Clausewitz parser                                                   */
/* ------------------------------------------------------------------ */

type Token = { type: 'atom' | 'string' | '{' | '}' | '='; value: string; line: number };

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  while (i < text.length) {
    const c = text[i];
    if (c === '\n') {
      line += 1;
      i += 1;
      continue;
    }
    if (c === '\r' || c === ' ' || c === '\t') {
      i += 1;
      continue;
    }
    if (c === '#') {
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }
    if (c === '{' || c === '}' || c === '=') {
      tokens.push({ type: c, value: c, line });
      i += 1;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      const startLine = line;
      let value = '';
      i += 1;
      while (i < text.length) {
        const d = text[i];
        if (d === '\\' && i + 1 < text.length) {
          value += text[i + 1];
          i += 2;
          continue;
        }
        if (d === quote) {
          i += 1;
          break;
        }
        if (d === '\n') line += 1;
        value += d;
        i += 1;
      }
      tokens.push({ type: 'string', value, line: startLine });
      continue;
    }
    let value = '';
    const startLine = line;
    while (i < text.length) {
      const d = text[i];
      if (d === '\n' || d === '\r' || d === ' ' || d === '\t' || d === '{' || d === '}' || d === '=' || d === '#') break;
      value += d;
      i += 1;
    }
    if (value) tokens.push({ type: 'atom', value, line: startLine });
  }
  return tokens;
}

export function parseCw(text: string): CwNode[] {
  const tokens = tokenize(String(text || ''));
  let i = 0;
  const parseBlock = (stopAtBrace: boolean): CwNode[] => {
    const nodes: CwNode[] = [];
    while (i < tokens.length) {
      if (tokens[i].type === '}') {
        if (stopAtBrace) {
          i += 1;
          return nodes;
        }
        i += 1;
        continue;
      }
      const token = tokens[i];
      if (token.type !== 'atom' && token.type !== 'string') {
        i += 1;
        continue;
      }
      const key = token.value;
      const nodeLine = token.line;
      i += 1;
      if (tokens[i] && tokens[i].type === '=') {
        i += 1;
        const valueToken = tokens[i];
        if (!valueToken) {
          nodes.push({ key, value: null, children: null, line: nodeLine });
          break;
        }
        if (valueToken.type === '{') {
          i += 1;
          const children = parseBlock(true);
          nodes.push({ key, value: null, children, line: nodeLine });
          continue;
        }
        if (valueToken.type === 'atom' || valueToken.type === 'string') {
          i += 1;
          nodes.push({ key, value: valueToken.value, children: null, line: nodeLine });
          continue;
        }
        i += 1;
        nodes.push({ key, value: null, children: null, line: nodeLine });
        continue;
      }
      nodes.push({ key, value: null, children: null, line: nodeLine });
    }
    return nodes;
  };
  return parseBlock(false);
}

function findNode(nodes: CwNode[], key: string): CwNode | undefined {
  return nodes.find((n) => n.key === key);
}

/* ----------------------------- national ideas ----------------------------- */

export interface IdeaModifier {
  modifier: string;
  /** Native EU4 value: `land_morale = 0.10` stays 0.1; the UI shows 10%. */
  value: number;
}

export interface ParsedIdeaGroup {
  group: string;
  start: IdeaModifier[];
  bonus: IdeaModifier[];
  ideas: Array<{ id: string; modifiers: IdeaModifier[] }>;
  /** Non-numeric assignments such as `may_perform_slave_raid... = yes`. */
  flags: string[];
  warnings: string[];
}

function ideaModifiers(nodes: CwNode[] | null): { modifiers: IdeaModifier[]; flags: string[] } {
  const modifiers: IdeaModifier[] = [];
  const flags: string[] = [];
  for (const node of nodes || []) {
    // Nested control blocks (`trigger`, `potential`, …) are not modifiers.
    if (node.children) continue;
    const value = unquote(String(node.value ?? '')).trim();
    if (!value) continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) modifiers.push({ modifier: node.key, value: numeric });
    else flags.push(node.key + ' = ' + value);
  }
  return { modifiers, flags };
}

/**
 * Parse a national-ideas file (`common/ideas/*.txt`) into the exact shape the
 * Ideas panel binds: `traditions` (= `start`), `ambition` (= `bonus`) and the
 * idea blocks with their ids. Comments, indentation and any number of
 * modifiers per block are handled by the Clausewitz parser.
 */
export function parseNationalIdeas(text: string, groupHint = ''): ParsedIdeaGroup {
  const warnings: string[] = [];
  const nodes = parseCw(String(text || ''));
  const groupRe = /^([A-Za-z0-9_]+)_ideas$/i;
  const rawHint = String(groupHint || '').trim();
  const hint = rawHint.toLowerCase();
  const groups = nodes.filter((node) => node.children && groupRe.test(node.key));
  // An explicit tag must match its own block. Falling back to groups[0] would
  // silently show another country's ideas (e.g. BOH data while the tag is RUS).
  const group = hint
    ? groups.find((node) => node.key.toLowerCase() === hint + '_ideas')
    : groups[0];
  if (!group || !group.children) {
    return {
      group: '',
      start: [],
      bonus: [],
      ideas: [],
      flags: [],
      warnings: [rawHint ? rawHint + '_ideas block not found' : 'ideas group not found'],
    };
  }
  let start: IdeaModifier[] = [];
  let bonus: IdeaModifier[] = [];
  const ideas: Array<{ id: string; modifiers: IdeaModifier[] }> = [];
  const flags: string[] = [];
  for (const child of group.children) {
    if (!child.children) continue; // `free = yes` and other group-level scalars
    const key = child.key.toLowerCase();
    if (key === 'start' || key === 'bonus') {
      const parsed = ideaModifiers(child.children);
      if (key === 'start') start = parsed.modifiers;
      else bonus = parsed.modifiers;
      flags.push(...parsed.flags);
      continue;
    }
    if (['trigger', 'potential', 'ai_will_do', 'allow', 'visible'].includes(key)) continue;
    const parsed = ideaModifiers(child.children);
    if (!parsed.modifiers.length && !parsed.flags.length) {
      warnings.push('empty idea block: ' + child.key);
      continue;
    }
    ideas.push({ id: child.key, modifiers: parsed.modifiers });
    flags.push(...parsed.flags);
  }
  if (ideas.length !== 7) warnings.push('expected 7 idea blocks, found ' + ideas.length);
  if (start.length !== 2) warnings.push('expected 2 start modifiers, found ' + start.length);
  if (!bonus.length) warnings.push('bonus block missing');
  return { group: group.key, start, bonus, ideas, flags, warnings };
}


function textOf(nodes: CwNode[] | null): string {

  if (!nodes || nodes.length === 0) return '';
  return nodes.map((n) => (n.children ? `${n.key} = {\n${textOf(n.children)}}\n` : `${n.key} = ${n.value ?? ''}\n`)).join('');
}

/** Hard cap for context sent to the model: 100 lines per target block. */
function clipLines(text: string, max = 100): string {
  const lines = String(text ?? '').split('\n');
  if (lines.length <= max) return String(text ?? '');
  return lines.slice(0, max).join('\n') + `\n... (truncated to ${max} lines to save tokens)`;
}

/** A Clausewitz `yes`/`no` value. */
function isYesNode(node?: CwNode): boolean {
  return !!node && /^\s*"?yes"?\s*$/i.test(String(node.value || ''));
}

/** Turn a parsed `trigger`/`limit` block into form rows. Local dictionary only. */
/** Normalize an EU4 date such as 1437.1.1; null when invalid. */
export function normalizeStartDate(value: unknown): string | null {
  const match = /^(\d{1,4})\.(\d{1,2})\.(\d{1,2})$/.exec(String(value ?? '').trim());
  if (!match) return null;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${Number(match[1])}.${month}.${day}`;
}

function dateScore(value: string): number {
  const normalized = normalizeStartDate(value);
  if (!normalized) return -1;
  const [year, month, day] = normalized.split('.').map(Number);
  return year * 10000 + month * 100 + day;
}

function applyHistoryNodes(nodes: CwNode[], state: any, cores: Set<string>): void {
  for (const node of nodes) {
    if (node.children && node.children.length) continue;
    const value = unquote(String(node.value ?? '')).trim();
    if (node.key === 'add_core') { if (value) cores.add(value.toUpperCase()); continue; }
    if (node.key === 'remove_core') { if (value) cores.delete(value.toUpperCase()); continue; }
    if (node.key === 'owner' || node.key === 'controller' || node.key === 'culture' || node.key === 'religion' || node.key === 'capital' || node.key === 'trade_goods') {
      state[node.key] = value;
      continue;
    }
    if (node.key === 'base_tax' || node.key === 'base_production' || node.key === 'base_manpower') {
      state[node.key] = Number(value) || 0;
    }
  }
}

/**
 * Evaluate a province history file at an arbitrary start date.
 * Base fields apply first; dated blocks are applied in ascending order, but
 * only when their timestamp is <= startDate. Future blocks are ignored.
 */
export function provinceHistoryAt(text: string, startDate: string): any {
  const start = normalizeStartDate(startDate) || '1437.1.1';
  const startScore = dateScore(start);
  const state: any = {
    owner: '', controller: '', culture: '', religion: '', capital: '', trade_goods: '',
    base_tax: 0, base_production: 0, base_manpower: 0,
  };
  const cores = new Set<string>();
  const dated: Array<{ score: number; children: CwNode[] }> = [];
  for (const node of parseCw(String(text || ''))) {
    if (/^\d{1,4}\.\d{1,2}\.\d{1,2}$/.test(node.key) && node.children) {
      dated.push({ score: dateScore(node.key), children: node.children });
    } else if (!node.children || node.children.length === 0) {
      applyHistoryNodes([node], state, cores);
    }
  }
  const future = dated.some((block) => block.score > startScore);
  dated
    .filter((block) => block.score >= 0 && block.score <= startScore)
    .sort((a, b) => a.score - b.score)
    .forEach((block) => applyHistoryNodes(block.children, state, cores));
  const unresolved = !state.owner;
  return {
    ...state,
    cores: [...cores].sort(),
    unresolved,
    hasFuture: future,
    startDate: start,
    historyWarning: unresolved
      ? 'no province history at ' + start + (future ? '; later dated blocks were ignored' : '')
      : undefined,
  };
}


/** Parse one EU4 .yml file: KEY:0 "value" (comments and BOM tolerated). */
export function parseLocalisationText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const clean = String(text || '').replace(/^\uFEFF/, '');
  const re = /^\s*([A-Za-z0-9_.\-]+)\s*:\s*\d+\s*"((?:\\.|[^"])*)"/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(clean))) {
    out[match[1]] = match[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return out;
}

function countCjk(text: string): number {
  const match = String(text || '').match(/[\u3400-\u9fff]/g);
  return match ? match.length : 0;
}

function countControlChars(text: string): number {
  const match = String(text || '').match(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g);
  return match ? match.length : 0;
}

/**
 * CP1252 <-> UCS2 table used by the EU4 double-byte patch (matanki-saito/EU4dll).
 * The patch stores bytes 0x80-0x9F as their CP1252 characters, so a byte-level
 * recovery has to invert this table, not plain Latin-1.
 */
const CP1252_TO_UCS2: Array<[number, number]> = [
  [0x80, 0x20ac], [0x82, 0x201a], [0x83, 0x0192], [0x84, 0x201e], [0x85, 0x2026],
  [0x86, 0x2020], [0x87, 0x2021], [0x88, 0x02c6], [0x89, 0x2030], [0x8a, 0x0160],
  [0x8b, 0x2039], [0x8c, 0x0152], [0x8e, 0x017d], [0x91, 0x2018], [0x92, 0x2019],
  [0x93, 0x201c], [0x94, 0x201d], [0x95, 0x2022], [0x96, 0x2013], [0x97, 0x2014],
  [0x98, 0x02dc], [0x99, 0x2122], [0x9a, 0x0161], [0x9b, 0x203a], [0x9c, 0x0153],
  [0x9e, 0x017e], [0x9f, 0x0178],
];
const CP1252_FROM_UCS2 = new Map<number, number>(CP1252_TO_UCS2.map(([byte, cp]) => [cp, byte]));
const CP1252_FROM_BYTE = new Map<number, number>(CP1252_TO_UCS2);

/**
 * Decode the escaped text format written by the EU4 double-byte patch
 * (matanki-saito/EU4dll, `convertEscapedTextToWideText`):
 *
 *   [0x10][low][high]   -> code = high<<8 | low
 *   [0x11][low][high]   -> code - 0x0E     (low was +14)
 *   [0x12][low][high]   -> code + 0x900    (high was -9)
 *   [0x13][low][high]   -> code + 0x8F2    (both)
 *   other bytes         -> CP1252 -> UCS2
 *
 * The file layer stores those bytes as UTF-8 text of CP1252 characters, so the
 * input here is the UTF-8 decoded file content.
 */
export function decodeEscapedLocalisation(source: string): { text: string; replacements: number } {
  const bytes: number[] = [];
  for (const ch of String(source || '')) {
    const cp = ch.codePointAt(0) ?? 0;
    const mapped = CP1252_FROM_UCS2.get(cp);
    bytes.push(mapped !== undefined ? mapped : cp <= 0xff ? cp : cp & 0xff);
  }
  const out: string[] = [];
  let replacements = 0;
  for (let i = 0; i < bytes.length;) {
    const cp = bytes[i++];
    let sp: number;
    if (cp >= 0x10 && cp <= 0x13) {
      const low = bytes[i++];
      const high = bytes[i++];
      if (low === undefined || high === undefined) break;
      sp = (high << 8) + low;
      if (cp === 0x11) sp -= 0x0e;
      else if (cp === 0x12) sp += 0x900;
      else if (cp === 0x13) sp += 0x8f2;
    } else {
      sp = CP1252_FROM_BYTE.get(cp) ?? cp;
    }
    if (sp > 0xffff || (sp < 0x98f && sp > 0x100)) {
      sp = 0x2026;
      replacements += 1;
    }
    out.push(String.fromCodePoint(sp));
  }
  return { text: out.join(''), replacements };
}

/**
 * Decode a localisation file. Mod packs are not always clean UTF-8:
 * vanilla/`replace/` files carry a UTF-8 BOM, some packs are saved as UTF-16,
 * and older Chinese packs are GB18030. The bytes decide, not the extension.
 * `invalid` marks a file no decoder can read (a private/obfuscated encoding or
 * a corrupted download), so the caller can report it instead of inventing names.
 */
export function decodeLocalisationBuffer(buffer: Buffer | Uint8Array): { text: string; encoding: string; invalid: boolean } {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (!buf.length) return { text: '', encoding: 'utf-8', invalid: false };
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(buf.subarray(2)), encoding: 'utf-16le', invalid: false };
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(buf.subarray(2)), encoding: 'utf-16be', invalid: false };
  }
  const stripBom = (value: string): string => value.replace(/^\uFEFF/, '');
  const utf8 = stripBom(new TextDecoder('utf-8').decode(buf));
  // Clean UTF-8 is the normal case; invalid sequences and control characters
  // both mean "try the legacy single/double byte encodings as well".
  const utf8Broken = utf8.includes('\uFFFD') || countControlChars(utf8) > 0;
  if (!utf8Broken) {
    return { text: utf8, encoding: 'utf-8', invalid: false };
  }
  const candidates: Array<{ text: string; encoding: string }> = [{ text: utf8, encoding: 'utf-8' }];
  try {
    candidates.push({ text: stripBom(new TextDecoder('gb18030').decode(buf)), encoding: 'gb18030' });
  } catch {
    /* no gb18030 support in this runtime */
  }
  // A Chinese pack made for the EU4 double-byte patch uses escape bytes, which
  // show up as control characters after a plain UTF-8 read.
  const escaped = decodeEscapedLocalisation(utf8);
  candidates.push({ text: escaped.text, encoding: 'eu4dll-escaped' });
  const scoreOf = (value: string, replacements = 0): number =>
    countCjk(value) - countControlChars(value) * 4 - (value.match(/\uFFFD/g) || []).length * 4 - replacements * 4;
  let best = candidates[0];
  let bestScore = scoreOf(best.text);
  for (const candidate of candidates.slice(1)) {
    const score = candidate.encoding === 'eu4dll-escaped'
      ? scoreOf(candidate.text, escaped.replacements)
      : scoreOf(candidate.text);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  const invalid = countControlChars(best.text) > 0 || best.text.includes('\uFFFD');
  return { text: best.text, encoding: best.encoding, invalid };
}

/** Read one localisation file tolerantly; unreadable files are skipped. */
export function readLocalisationFile(file: string): { text: string; encoding: string; invalid: boolean; bytes: number } {
  const buf = fs.readFileSync(file);
  const decoded = decodeLocalisationBuffer(buf);
  return { ...decoded, bytes: buf.length };
}

/**
 * The language block a .yml announces (`l_english:`, `l_simp_chinese:`…).
 * Vanilla ships one file per language, so the filename is not enough; the
 * in-file marker decides whether a value is the English name or a translation.
 */
export function parseLocalisationLanguage(text: string): string {
  const clean = String(text || '').replace(/^\uFEFF/, '');
  const match = /^\s*l_([a-z_]+)\s*:/im.exec(clean);
  return match ? match[1].toLowerCase() : 'english';
}

/** Chinese-tagged packs beat any other CJK locale (e.g. a Japanese pack). */
function chineseSourceRank(language: string): number {
  if (/chinese|schinese/.test(language)) return 30;
  if (language === 'english') return 20;
  return 10;
}

/** Recursively parse localisation/ (including replace/) with path.join. */
export async function parseLocalisationFolder(folderPath: string, onEntry?: (key: string, value: string) => void): Promise<Record<string, string>> {
  // Streaming mode (onEntry) never materialises the whole folder in one object;
  // the old Object.assign(out, ...) doubled peak memory on 58MB of .yml files.
  const out: Record<string, string> | null = onEntry ? null : {};
  async function walk(dir: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (/\.yml$/i.test(entry.name)) {
        try {
          const decoded = readLocalisationFile(full);
          if (!decoded.invalid) {
            const parsed = parseLocalisationText(decoded.text);
            if (onEntry) for (const [key, value] of Object.entries(parsed)) onEntry(key, value);
            else Object.assign(out as Record<string, string>, parsed);
          }
        } catch {
          /* unreadable/localised file */
        }
      }
    }
  }
  await walk(folderPath);
  return out || {};
}

function hasCjk(value: string): boolean {
  return /[\u3400-\u9fff]/.test(String(value || ''));
}

/** Latin letters that NFKD does not decompose but players never type. */
const LETTER_FOLD: Record<string, string> = {
  'ø': 'o', 'æ': 'ae', 'œ': 'oe', 'ß': 'ss', 'ł': 'l',
  'đ': 'd', 'ð': 'd', 'þ': 'th', 'ı': 'i', 'ŋ': 'n',
};

/**
 * Diacritic-insensitive search form: "Plzen" finds "Plzeň",
 * "Ostergotland" finds "Östergötland". Used by the HTTP API and mirrored in
 * the client so the picker filters without a round trip.
 */
export function foldProvinceText(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[øæœßłđðþıŋ]/g, (ch) => LETTER_FOLD[ch] || ch)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface ProvinceNameEntry {
  id: number;
  name_cn: string;
  name_en: string;
  /** .yml file (relative to its localisation folder) that won for the Chinese name. */
  name_cn_source?: string;
  /** .yml file that won for the English/native name. */
  name_en_source?: string;
}

/**
 * `[2664] 皮尔森 (Plzeň)`; a province without a Chinese localisation falls
 * back to `[2664] Plzeň`, and one without any name to `[2664]`.
 */
export function provinceLabel(entry: { id: number; name_cn?: string; name_en?: string; name?: string } | null | undefined): string {
  const id = Number(entry?.id);
  const cn = String(entry?.name_cn || '').trim();
  const en = String(entry?.name_en || entry?.name || '').trim();
  const head = '[' + (Number.isFinite(id) ? id : '') + ']';
  if (cn && en && cn !== en) return head + ' ' + cn + ' (' + en + ')';
  if (cn) return head + ' ' + cn;
  if (en) return head + ' ' + en;
  return head;
}

interface ProvinceSearchable {
  id: number;
  name?: string;
  name_cn?: string;
  name_en?: string;
}

/**
 * Token match over id + Chinese name + English name. Every whitespace-separated
 * token must hit at least one field, so "皮尔森 boh" style refinements work.
 * Lower score = better: 0 exact id, 1 id prefix, 2 exact name, 3 name prefix,
 * 4 name substring. Returns -1 when any token misses.
 */
export function provinceMatchScore(entry: ProvinceSearchable, tokens: string[]): number {
  if (!tokens.length) return 5;
  const idText = String(entry?.id ?? '');
  const cn = foldProvinceText(entry?.name_cn);
  const en = foldProvinceText(entry?.name_en || entry?.name);
  let score = 5;
  for (const token of tokens) {
    let hit = -1;
    if (/^\d+$/.test(token)) {
      if (idText === token) hit = 0;
      else if (idText.startsWith(token)) hit = 1;
    }
    if (hit < 0) {
      if (cn === token || en === token) hit = 2;
      else if (cn.startsWith(token) || en.startsWith(token)) hit = 3;
      else if (cn.includes(token) || en.includes(token)) hit = 4;
    }
    if (hit < 0) return -1;
    if (hit < score) score = hit;
  }
  return score;
}

/** Filter + rank a province list for the picker; pure, so it is unit-tested. */
export function searchProvinceEntries<T extends ProvinceSearchable>(entries: T[], query: string, limit = 200): T[] {
  const list = Array.isArray(entries) ? entries : [];
  const tokens = foldProvinceText(query).split(' ').filter(Boolean);
  const cap = Math.max(1, Math.min(12000, Number(limit) || 200));
  if (!tokens.length) return list.slice(0, cap);
  const scored: Array<{ entry: T; score: number }> = [];
  for (const entry of list) {
    const score = provinceMatchScore(entry, tokens);
    if (score >= 0) scored.push({ entry, score });
  }
  scored.sort((left, right) => left.score - right.score || Number(left.entry.id) - Number(right.entry.id));
  return scored.slice(0, cap).map((item) => item.entry);
}

/**
 * Build {id, name_cn, name_en} from PROV<id> localisation keys.
 *
 * Priority (low -> high): vanilla, then every later folder (the Mods in their
 * `dlc_load.json` order), and inside each folder plain files before `replace/`.
 * The Chinese and English names are tracked independently: a pack that only
 * renames `PROV2664` in Chinese keeps the vanilla English name intact. User
 * custom entries are applied afterwards by the engine, on top of everything.
 *
 * `stats` is optional and is filled while scanning, so the UI can explain why
 * a dictionary ended up with zero Chinese names (unreadable pack encoding).
 */
export interface ProvinceDictionaryStats {
  files: number;
  unreadable: number;
  provinces: number;
  chinese: number;
  roots: string[];
}

export function buildProvinceDictionary(folderPaths: string[], stats?: ProvinceDictionaryStats): Map<number, ProvinceNameEntry> {
  const result = new Map<number, ProvinceNameEntry>();
  const collect = (dir: string, out: string[]): void => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) collect(full, out);
      else if (/\.yml$/i.test(entry.name)) out.push(full);
    }
  };
  const relOf = (folderPath: string, file: string): string =>
    normRel(path.relative(folderPath, file));
  /** Rank of the Chinese name currently stored, so a Japanese pack cannot beat it. */
  const cnRanks = new Map<number, number>();
  let fileCount = 0;
  let unreadable = 0;
  for (let folderIndex = 0; folderIndex < folderPaths.length; folderIndex += 1) {
    const folderPath = folderPaths[folderIndex];
    if (!folderPath) continue;
    const files: string[] = [];
    collect(folderPath, files);
    files.sort((left, right) => {
      const leftReplace = left.split(path.sep).includes('replace') ? 1 : 0;
      const rightReplace = right.split(path.sep).includes('replace') ? 1 : 0;
      return leftReplace - rightReplace || left.localeCompare(right);
    });
    for (const file of files) {
      let decoded: { text: string; encoding: string; invalid: boolean; bytes: number };
      try {
        decoded = readLocalisationFile(file);
      } catch {
        continue;
      }
      fileCount += 1;
      if (decoded.invalid) {
        unreadable += 1;
        continue;
      }
      const text = decoded.text;
      const source = relOf(folderPath, file);
      const language = parseLocalisationLanguage(text);
      const replace = file.split(path.sep).includes('replace') ? 1 : 0;
      // A Chinese translation may be tagged `l_simp_chinese` or be a hacked
      // `l_english` file, so the value itself decides the Chinese name. The
      // rank keeps the order meaningful: Mod > vanilla, then a Chinese-tagged
      // pack > an English-tagged one > any other CJK locale (e.g. Japanese),
      // and finally localisation/replace/ wins inside the same language.
      const cnRank = folderIndex * 10000 + chineseSourceRank(language) * 100 + replace;
      for (const [key, rawValue] of Object.entries(parseLocalisationText(text))) {
        const match = /^PROV(\d+)$/i.exec(key);
        if (!match) continue;
        const id = Number(match[1]);
        if (!Number.isFinite(id) || id <= 0) continue;
        const value = rawValue.replace(/\$[^$]*\$/g, '').trim();
        if (!value) continue;
        const record = result.get(id) || { id, name_cn: '', name_en: '' };
        if (hasCjk(value)) {
          const previous = cnRanks.get(id);
          if (previous === undefined || cnRank >= previous) {
            record.name_cn = value;
            record.name_cn_source = source;
            cnRanks.set(id, cnRank);
          }
        } else if (language === 'english') {
          // Only English-tagged values are the canonical name; a Spanish or
          // German file must never overwrite `name_en`.
          record.name_en = value;
          record.name_en_source = source;
        }
        result.set(id, record);
      }
    }
  }
  if (stats) {
    stats.files = fileCount;
    stats.unreadable = unreadable;
    stats.provinces = result.size;
    stats.chinese = [...result.values()].filter((entry) => Boolean(entry.name_cn)).length;
    stats.roots = folderPaths.slice();
  }
  return result;
}


function conditionsFromNodes(nodes: CwNode[] | null, depth = 0): ConditionIntent[] {
  const out: ConditionIntent[] = [];
  const logic = new Set(['AND', 'OR', 'NOT', 'and', 'or', 'not']);
  for (const node of nodes || []) {
    if (logic.has(node.key) && node.children && depth < 6) {
      out.push({
        type: node.key.toUpperCase(),
        op: '=',
        value: '',
        children: conditionsFromNodes(node.children, depth + 1),
      });
      continue;
    }
    if (node.key === 'any_neighbor_province' && node.children) {
      const provinceId = unquote(String(findNode(node.children, 'province_id')?.value ?? '')).trim();
      out.push({ type: 'any_neighbor_province', op: '=', value: provinceId });
      continue;
    }
    if (node.children && node.children.length) {
      // Complex or too deeply nested: keep the exact source for source mode.
      const raw = textOf([node]).trim();
      out.push({ type: 'custom', value: raw, raw, complex: true });
      continue;
    }
    const value = unquote(String(node.value ?? '')).trim();
    const known: Record<string, string> = {
      owns: 'owns', year: 'year', is_year: 'is_year', tag: 'tag',
      has_country_flag: 'has_country_flag', religion: 'religion', religion_group: 'religion_group',
      government: 'government', has_regency: 'has_regency', legitimacy: 'legitimacy',
      prestige: 'prestige', stability: 'stability', treasury: 'treasury', inflation: 'inflation',
      corruption: 'corruption', num_of_cities: 'num_of_cities', num_of_provinces: 'num_of_provinces',
      manpower: 'manpower', army_size: 'army_size', navy_size: 'navy_size',
      adm_tech: 'adm_tech', dip_tech: 'dip_tech', mil_tech: 'mil_tech',
      is_emperor: 'is_emperor', is_subject: 'is_subject', overlord: 'overlord',
      at_war: 'at_war', truce_with: 'truce_with', alliance_with: 'alliance_with',
      has_casus_belli: 'has_casus_belli', has_idea: 'has_idea', has_idea_group: 'has_idea_group',
      culture: 'culture', primary_culture: 'primary_culture', technology_group: 'technology_group',
      exists: 'exists',
    };
    if (known[node.key]) {
      out.push({ type: known[node.key], op: '=', value });
    } else {
      // Unknown word: keep it as-is and let the UI show the English fallback.
      out.push({ type: node.key, op: '=', value, unknown: true, raw: `${node.key} = ${value}`.trim() });
    }
  }
  return out;
}

/** Turn a parsed effect list into form rows (blocks keep named params). */
function effectsFromNodes(nodes: CwNode[] | null): EffectIntent[] {
  const out: EffectIntent[] = [];
  for (const node of nodes || []) {
    if (node.key === 'effect' || node.key === 'hidden_effect') {
      out.push(...effectsFromNodes(node.children));
      continue;
    }
    if (node.children && node.children.length) {
      const hasNested = node.children.some((child) => child.children && child.children.length);
      const complex = ['if', 'else', 'else_if', 'random_list', 'random', 'tooltip', 'custom_tooltip', 'while', 'every_country', 'every_owned_province', 'random_country', 'random_owned_province'].includes(node.key);
      if (hasNested || complex) {
        // Preserve control flow exactly; the form shows it as a custom effect row.
        const raw = textOf([node]).trim();
        out.push({ effect: 'custom', value: raw, raw, complex: true });
        continue;
      }
      const params: Record<string, string> = {};
      for (const child of node.children) {
        if (child.value !== null && child.value !== undefined) params[child.key] = unquote(String(child.value));
      }
      out.push({ effect: node.key, params });
      continue;
    }
    out.push({ effect: node.key, value: node.value !== null && node.value !== undefined ? unquote(String(node.value)) : '' });
  }
  return out;
}

/**
 * Collect every `tag = <TAG>` value inside a node subtree. Used on an event's
 * `trigger` block: `tag` may sit at any nesting depth (`OR`, `any_country`,
 * `hidden_trigger`, …), so a flat substring search would miss it. The AST is
 * already available, so this is a tree walk rather than a regex over raw text.
 */
function collectTagValues(nodes: CwNode[] | null, out: string[] = []): string[] {
  if (!nodes) return out;
  for (const node of nodes) {
    if (node.key === 'tag' && node.value) {
      const tag = unquote(node.value).trim().toUpperCase();
      if (/^[A-Z0-9]{3}$/.test(tag) && !out.includes(tag)) out.push(tag);
    }
    if (node.children) collectTagValues(node.children, out);
  }
  return out;
}

function namespaceMatchesTag(node: any, tag: string): boolean {
  return String(node.namespace || '').toLowerCase().includes(tag.toLowerCase());
}

function triggerMatchesTag(node: any, tag: string): boolean {
  return Array.isArray(node.triggerTags) && node.triggerTags.includes(tag);
}

function eventMatchesTag(node: any, tag: string): boolean {
  return namespaceMatchesTag(node, tag) || triggerMatchesTag(node, tag);
}

/** Recompute left-to-right depth on a filtered node set. */
function recomputeDepths(nodes: any[], edges: any[]): any[] {
  if (!nodes.length) return [];
  const ids = new Set(nodes.map((n) => n.id));
  const incoming = new Map<string, number>();
  for (const edge of edges) if (ids.has(edge.to)) incoming.set(edge.to, (incoming.get(edge.to) || 0) + 1);
  const queue = nodes.filter((n) => !incoming.has(n.id)).map((n) => n.id);
  const depth = new Map<string, number>();
  for (const id of queue) depth.set(id, 0);
  for (let i = 0; i < queue.length; i += 1) {
    const id = queue[i];
    for (const edge of edges.filter((x) => x.from === id && ids.has(x.to))) {
      const d = (depth.get(id) || 0) + 1;
      if (d > (depth.get(edge.to) || 0)) depth.set(edge.to, d);
      if (!queue.includes(edge.to)) queue.push(edge.to);
    }
  }
  return nodes.map((n) => ({ ...n, depth: depth.get(n.id) || 0 }));
}

/**
 * Pure filter over a built event graph: category (all/regular/special) and an
 * optional tag. Edges survive only when both endpoints survive, and depth is
 * recomputed for the kept subset.
 */
function filterEventGraph(graph: any, options: { category: 'all' | 'regular' | 'special'; tag: string | null }): any {
  const { category, tag } = options;
  const nodes = (graph.nodes || []).filter((node: any) => {
    if (category === 'special' && !node.special) return false;
    if (category === 'regular' && node.special) return false;
    if (!tag) return true;
    return eventMatchesTag(node, tag);
  });
  const ids = new Set(nodes.map((n: any) => n.id));
  const edges = (graph.edges || []).filter((edge: any) => ids.has(edge.from) && ids.has(edge.to));
  const decorated = recomputeDepths(nodes, edges).map((node: any) => ({
    ...node,
    tagMatch: tag ? { namespace: namespaceMatchesTag(node, tag), trigger: triggerMatchesTag(node, tag) } : null,
  }));
  return {
    ...graph,
    total: (graph.nodes || []).length,
    nodes: decorated,
    edges,
    missingCount: edges.filter((edge: any) => edge.missing).length,
    category,
    activeTag: tag,
    tagFiltered: !!tag,
    filtered: tag !== null || category !== 'all',
  };
}

/* ------------------------------------------------------------------ */
/* Workspace                                                           */
/* ------------------------------------------------------------------ */

export class Workbench {
  config: WorkbenchConfig;
  docs: { entries: DocEntry[]; scopes: DocEntry[]; scopeChangers: Record<string, string>; source: string; generatedAt: string };
  effects = new Map<string, DocEntry>();
  triggers = new Map<string, DocEntry>();
  modifiers = new Map<string, DocEntry>();
  state: WorkspaceState;
  private locCache: { key: string; keys: Set<string> } | null = null;
  private mapCache: any[] | null = null;
  private provinceHistoryCache: Map<string, any> | null = null;
  private provinceHistoryCacheDate: string | null = null;
  private provinceHistoryWarnings: string[] = [];
  private localisationCache: Map<string, string> | null = null;
  private localisationAllCache: Map<string, string> | null = null;
  /** Parsed ideas per absolute path, keyed by file mtime. */
  private ideasCache = new Map<string, { mtimeMs: number; parsed: ParsedIdeaGroup }>();
  /** Full event id -> title index for the effect selector (30s TTL). */
  private eventCatalogCache: { key: string; at: number; data: any } | null = null;
  /** Parsed country decisions (mod + vanilla), 30s TTL. */
  private decisionsCache: { key: string; at: number; data: any[] } | null = null;
  /** event id -> tags that bind it from `history/countries/<TAG>.txt`. */
  private historyBindCache: { key: string; at: number; data: Map<string, string[]> } | null = null;
  /** Land + strait adjacency maps (10 min TTL). */
  private adjacencyCache: { key: string; at: number; land: Map<number, number[]>; special: Map<number, any[]>; warnings: string[] } | null = null;
  private adjacencyBuilding: Promise<any> | null = null;
  private localisationBuilding: Promise<Map<string, string>> | null = null;
  /** mtime of the ideas file that produced the current translation cache. */
  private ideasLocMtime = 0;
  private provinceDictionaryCache: Map<number, ProvinceNameEntry> | null = null;
  private provinceDictionaryStats: ProvinceDictionaryStats | null = null;

  constructor(config: WorkbenchConfig = {}) {
    this.config = config || {};
    const data = readJson<any>(DOCS_FILE, { entries: [], scopes: [], scopeChangers: {}, source: '', generatedAt: '' });
    this.docs = data;
    for (const entry of data.entries || []) {
      if (entry.kind === 'effect' && !this.effects.has(entry.name)) this.effects.set(entry.name, entry);
      if (entry.kind === 'trigger' && !this.triggers.has(entry.name)) this.triggers.set(entry.name, entry);
      if (entry.kind === 'modifier' && !this.modifiers.has(entry.name)) this.modifiers.set(entry.name, entry);
    }
    this.state = this.loadState();
  }

  stateFile(): string {
    if (this.config.statePath) return path.resolve(this.config.statePath);
    const home = process.env.DSH_HOME ? path.resolve(process.env.DSH_HOME) : path.join(os.homedir(), '.dsh');
    return path.join(home, 'eu4-mod-workbench', 'workspace.json');
  }

  loadState(): WorkspaceState {
    const raw = readJson<any>(this.stateFile(), null);
    if (raw && typeof raw === 'object') {
      return {
        eu4Root: typeof raw.eu4Root === 'string' ? raw.eu4Root : null,
        modDir: typeof raw.modDir === 'string' ? raw.modDir : null,
        selectedMod: typeof raw.selectedMod === 'string' ? raw.selectedMod : null,
        activeTag: typeof raw.activeTag === 'string' && /^[A-Z0-9]{3}$/.test(raw.activeTag.toUpperCase()) ? raw.activeTag.toUpperCase() : null,
        currentStartDate: normalizeStartDate(raw.currentStartDate) || '1437.1.1',
        pendingEdit: raw.pendingEdit && typeof raw.pendingEdit === 'object' ? raw.pendingEdit : null,
        changeQueue: Array.isArray(raw.changeQueue) ? raw.changeQueue.filter((x: any) => x && typeof x.id === 'string') : [],
        vanillaFiles: Array.isArray(raw.vanillaFiles) ? raw.vanillaFiles.filter((x: unknown) => typeof x === 'string') : [],
        mods: Array.isArray(raw.mods) ? raw.mods.filter((x: any) => x && typeof x.id === 'string') : [],
        indexedAt: typeof raw.indexedAt === 'string' ? raw.indexedAt : null,
        counts: raw.counts && typeof raw.counts === 'object' ? raw.counts : {},
      };
    }
    return { eu4Root: null, modDir: null, selectedMod: null, activeTag: null, currentStartDate: '1437.1.1', pendingEdit: null, changeQueue: [], vanillaFiles: [], mods: [], indexedAt: null, counts: {} };
  }

  /** Current V8 heap in MB (for diagnostics and the circuit breaker). */
  memoryMB(): number {
    return Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
  }

  /**
   * Circuit breaker: never let one scan take the whole Host process down.
   * Above the configured limit, release the big caches and abort the request.
   */
  assertHeap(label: string): void {
    const limit = Math.max(16, Number(this.config.maxHeapMB) || 1024);
    const used = this.memoryMB();
    if (used > limit) {
      this.releaseCaches();
      throw new Error('MEMORY_GUARD: ' + label + ' 中止：heap ' + used + 'MB 超过 ' + limit + 'MB 上限');
    }
  }

  /** Drop every large cache (safe to call on refresh, memory pressure, dispose). */
  releaseCaches(): void {
    this.locCache = null;
    this.mapCache = null;
    this.provinceHistoryCache = null;
    this.provinceHistoryCacheDate = null;
    this.localisationCache = null;
    this.localisationAllCache = null;
    this.provinceDictionaryCache = null;
    this.provinceDictionaryStats = null;
    this.eventCatalogCache = null;
    this.decisionsCache = null;
    this.historyBindCache = null;
    this.adjacencyCache = null;
    this.adjacencyBuilding = null;
    this.localisationBuilding = null;
    try { this.ideasCache.clear(); } catch { /* optional */ }
  }

  /** Release caches when the plugin is disposed/reloaded (prevents HMR leaks). */
  dispose(): void {
    this.releaseCaches();
    try { this.state.vanillaFiles = []; } catch { /* state is optional */ }
  }

  /**
   * Set the shared country-tag selection used by every panel and by the
   * `query_events_by_category` tool. Only the workbench state file is written;
   * game and mod files are never touched.
   */
  setActiveTag(tag: string | null | undefined): { ok: boolean; activeTag: string | null; error?: string } {
    const raw = String(tag ?? '').trim().toUpperCase();
    if (raw !== '' && !/^[A-Z0-9]{3}$/.test(raw)) {
      return { ok: false, activeTag: this.state.activeTag, error: 'tag must be a three-character country tag' };
    }
    this.state.activeTag = raw === '' ? null : raw;
    this.saveState();
    return { ok: true, activeTag: this.state.activeTag };
  }

  /** Change the scenario start date; province-history caches are rebuilt. */
  setStartDate(date: string): { ok: boolean; currentStartDate?: string; error?: string } {
    const normalized = normalizeStartDate(date);
    if (!normalized) return { ok: false, error: 'date must look like 1437.1.1' };
    this.state.currentStartDate = normalized;
    this.provinceHistoryCache = null;
    this.provinceHistoryCacheDate = null;
    this.mapCache = null;
    this.saveState();
    return { ok: true, currentStartDate: normalized };
  }

  customDictionaryPath(): string {
    return path.join(path.dirname(this.stateFile()), 'custom-dictionary.json');
  }

  readCustomDictionary(): Record<string, string> {
    const raw = readJson<any>(this.customDictionaryPath(), {});
    const out: Record<string, string> = {};
    if (raw && typeof raw === 'object') {
      for (const [key, value] of Object.entries(raw)) {
        if (typeof value === 'string') out[key] = value;
      }
    }
    return out;
  }

  setCustomDictionary(key: string, value: string): Record<string, string> {
    const safeKey = String(key || '').trim();
    const safeValue = String(value || '').trim();
    if (!/^[A-Za-z0-9_.\-]+$/.test(safeKey)) throw new Error('invalid localisation key');
    if (!safeValue) throw new Error('value is required');
    const map = this.readCustomDictionary();
    map[safeKey] = safeValue;
    const file = this.customDictionaryPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(map, null, 2), 'utf8');
    this.provinceDictionaryCache = null;
    this.provinceDictionaryStats = null;
    return map;
  }

  /**
   * EU4 user-data folder that holds `dlc_load.json` and `mod/*.mod`. An explicit
   * (possibly empty) config value wins, so tests stay deterministic; otherwise
   * the standard Documents / OneDrive locations are probed.
   */
  eu4UserDir(): string | null {
    if (this.config.eu4UserDir !== undefined) {
      const configured = String(this.config.eu4UserDir || '').trim();
      return configured && isDirectory(configured) ? path.resolve(configured) : null;
    }
    const home = os.homedir();
    const candidates = [
      path.join(home, 'Documents', 'Paradox Interactive', 'Europa Universalis IV'),
    ];
    if (process.env.OneDrive) {
      candidates.push(path.join(process.env.OneDrive, 'Documents', 'Paradox Interactive', 'Europa Universalis IV'));
    }
    for (const candidate of candidates) {
      if (isDirectory(candidate)) return path.resolve(candidate);
    }
    return null;
  }

  /** `.../steamapps/workshop/content/236850`, derived from the game install. */
  workshopRoot(): string | null {
    if (!this.state.eu4Root) return null;
    // <steamapps>/common/Europa Universalis IV -> <steamapps>/workshop/content/236850
    const steamapps = path.resolve(this.state.eu4Root, '..', '..');
    const root = path.join(steamapps, 'workshop', 'content', '236850');
    return isDirectory(root) ? root : null;
  }

  /**
   * Mod roots the game actually loads, in `dlc_load.json` order (later wins).
   * A Chinese localisation pack is normally a Workshop Mod, so it can only be
   * found here — not under the game's own `localisation/` folder.
   */
  enabledModRoots(): string[] {
    const userDir = this.eu4UserDir();
    if (!userDir) return [];
    let raw: any = null;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(userDir, 'dlc_load.json'), 'utf8').replace(/^\uFEFF/, ''));
    } catch {
      return [];
    }
    const list = Array.isArray(raw?.enabled_mods) ? raw.enabled_mods : [];
    const modFolder = path.join(userDir, 'mod');
    const roots: string[] = [];
    const add = (root: string | null): void => {
      if (!root) return;
      const abs = path.resolve(root);
      if (isDirectory(abs) && !roots.includes(abs)) roots.push(abs);
    };
    for (const entry of list) {
      const name = String(entry || '').trim();
      if (!name) continue;
      let text = '';
      try {
        text = fs.readFileSync(path.join(userDir, ...name.split(/[\\/]+/).filter(Boolean)), 'utf8').replace(/^\uFEFF/, '');
      } catch {
        continue;
      }
      const field = (key: string): string => {
        const match = new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, 'mi').exec(text);
        return match ? match[1] : '';
      };
      const modPath = field('path');
      if (modPath) {
        add(path.isAbsolute(modPath) ? modPath : path.join(modFolder, ...normRel(modPath).split(path.posix.sep)));
        continue;
      }
      const remote = field('remote_file_id') || (path.basename(name).match(/(\d{4,})/) || [])[1];
      const workshop = remote ? this.workshopRoot() : null;
      if (remote && workshop) add(path.join(workshop, remote));
    }
    return roots;
  }

  /**
   * The localisation roots the game actually loads: vanilla, every Mod enabled
   * in `dlc_load.json` (in load order, so a Chinese pack is finally reachable),
   * then the configured Mod. Paths are resolved and de-duplicated.
   */
  localisationRoots(): string[] {
    const roots: string[] = [];
    const add = (root?: string | null): void => {
      if (!root) return;
      const abs = path.resolve(root);
      if (!roots.includes(abs)) roots.push(abs);
    };
    add(this.state.eu4Root);
    for (const root of this.enabledModRoots()) add(root);
    add(this.modRoot());
    return roots;
  }

  /** Mod-first map file lookup (map overrides are allowed per file). */
  private mapFile(rel: string): string | null {
    const mod = this.modRoot();
    if (mod && existsFile(path.join(mod, rel))) return path.join(mod, rel);
    if (this.state.eu4Root && existsFile(path.join(this.state.eu4Root, rel))) return path.join(this.state.eu4Root, rel);
    return null;
  }

  /** `key = { 1 2 3 }` number set from map/default.map. */
  private mapNumberSet(text: string, key: string): Set<number> {
    const match = new RegExp(key + '\\s*=\\s*\\{([\\s\\S]*?)\\}').exec(text);
    const out = new Set<number>();
    if (!match) return out;
    for (const n of match[1].match(/\d+/g) || []) out.add(Number(n));
    return out;
  }

  /**
   * Adjacency source:
   * - `map/provinces.bmp` + `definition.csv`: land borders from pixel colours;
   * - `map/adjacencies.csv`: straits/lakes (cross-sea), including mod additions.
   * Sea/lake provinces are excluded from the land list; crossings keep their type.
   */
  async adjacencyMap(): Promise<{ land: Map<number, number[]>; special: Map<number, any[]>; warnings: string[] }> {
    if (this.adjacencyBuilding) return this.adjacencyBuilding;
    this.adjacencyBuilding = this.buildAdjacencyMap().finally(() => { this.adjacencyBuilding = null; });
    return this.adjacencyBuilding;
  }

  private async buildAdjacencyMap(): Promise<{ land: Map<number, number[]>; special: Map<number, any[]>; warnings: string[] }> {
    this.assertHeap('adjacencyMap');
    const mod = this.modRoot();
    const key = (mod || '') + '|' + (this.state.eu4Root || '');
    const now = Date.now();
    if (this.adjacencyCache && this.adjacencyCache.key === key && now - this.adjacencyCache.at < 10 * 60_000) return this.adjacencyCache;
    const land = new Map<number, number[]>();
    const special = new Map<number, any[]>();
    const warnings: string[] = [];
    const add = (a: number, b: number, type: string, through?: number): void => {
      if (!a || !b || a === b) return;
      if (type === 'land') {
        const la = land.get(a) || [];
        if (!la.includes(b)) la.push(b);
        land.set(a, la);
        const lb = land.get(b) || [];
        if (!lb.includes(a)) lb.push(a);
        land.set(b, lb);
        return;
      }
      const ea = special.get(a) || [];
      if (!ea.some((edge) => edge.id === b && edge.type === type)) ea.push({ id: b, type, through });
      special.set(a, ea);
      const eb = special.get(b) || [];
      if (!eb.some((edge) => edge.id === a && edge.type === type)) eb.push({ id: a, type, through });
      special.set(b, eb);
    };

    let colorToId = new Map<number, number>();
    const defFile = this.mapFile('map/definition.csv');
    if (defFile) {
      const text = await fs.promises.readFile(defFile, 'latin1');
      for (const line of text.split(/\r?\n/).slice(1)) {
        const parts = line.split(';');
        if (parts.length < 4) continue;
        const id = Number(parts[0]);
        const r = Number(parts[1]);
        const g = Number(parts[2]);
        const b = Number(parts[3]);
        if (!id || ![r, g, b].every(Number.isFinite)) continue;
        colorToId.set((r << 16) | (g << 8) | b, id);
      }
    } else warnings.push('未找到 map/definition.csv');

    let water = new Set<number>();
    const defaultFile = this.mapFile('map/default.map');
    if (defaultFile) {
      const text = await fs.promises.readFile(defaultFile, 'latin1');
      water = new Set([...this.mapNumberSet(text, 'sea_starts'), ...this.mapNumberSet(text, 'lakes')]);
    }

    const bmpFile = this.mapFile('map/provinces.bmp');
    if (bmpFile && colorToId.size) {
      const buf = await fs.promises.readFile(bmpFile);
      const offset = buf.readUInt32LE(10);
      const width = buf.readInt32LE(18);
      const rawHeight = buf.readInt32LE(22);
      const bpp = buf.readUInt16LE(28);
      if (width > 0 && rawHeight !== 0 && (bpp === 24 || bpp === 32)) {
        const height = Math.abs(rawHeight);
        const topDown = rawHeight < 0;
        const rowSize = Math.floor((bpp * width + 31) / 32) * 4;
        const bytesPerPixel = bpp / 8;
        // Only two rows are kept: a full 46MB Uint32Array doubles the BMP
        // buffer and was a major peak-memory contributor.
        const prev = new Uint32Array(width);
        const cur = new Uint32Array(width);
        for (let y = 0; y < height; y += 1) {
          const srcY = topDown ? y : height - 1 - y;
          const row = offset + srcY * rowSize;
          for (let x = 0; x < width; x += 1) {
            const p = row + x * bytesPerPixel;
            const b = buf[p];
            const g = buf[p + 1];
            const r = buf[p + 2];
            cur[x] = colorToId.get((r << 16) | (g << 8) | b) || 0;
          }
          if ((y & 255) === 0) this.assertHeap('adjacencyMap(bmp)');
          for (let x = 0; x < width; x += 1) {
            const a = cur[x];
            if (!a || water.has(a)) continue;
            if (x + 1 < width) {
              const b = cur[x + 1];
              if (b && b !== a && !water.has(b)) add(a, b, 'land');
            }
            const b = prev[x];
            if (b && b !== a && !water.has(b)) add(a, b, 'land');
          }
          prev.set(cur);
        }
      } else warnings.push('map/provinces.bmp 不是 24/32 位 BMP');
    } else warnings.push('未找到可解析的 map/provinces.bmp');

    // Straits/lakes: vanilla + mod files are both read (mod rows merge in).
    const csvFiles: string[] = [];
    if (mod) csvFiles.push(path.join(mod, 'map', 'adjacencies.csv'));
    if (this.state.eu4Root) csvFiles.push(path.join(this.state.eu4Root, 'map', 'adjacencies.csv'));
    let csvFound = false;
    for (const file of csvFiles) {
      if (!existsFile(file)) continue;
      csvFound = true;
      const text = await fs.promises.readFile(file, 'latin1');
      for (const line of text.split(/\r?\n/).slice(1)) {
        const cols = line.split(';');
        if (cols.length < 3) continue;
        const a = Number(cols[0]);
        const b = Number(cols[1]);
        const typeText = String(cols[2] || '').trim().toLowerCase();
        if (!a || !b) continue;
        const through = Number(cols[3]) || undefined;
        const type = typeText === 'sea' ? 'strait' : typeText === 'lake' ? 'lake' : 'special';
        add(a, b, type, through);
      }
    }
    if (!csvFound) warnings.push('未找到 map/adjacencies.csv（跨海连接为空）');

    this.adjacencyCache = { key, at: now, land, special, warnings };
    return this.adjacencyCache;
  }

  /** API: neighbours of one province (land borders + straits/lakes). */
  async adjacentProvinces(id: number): Promise<any> {
    const pid = Number(id);
    if (!Number.isFinite(pid) || pid <= 0) return { error: 'province id is required' };
    const map = await this.adjacencyMap();
    const dict = this.provinceDictionary();
    const entries = new Map<number, any>();
    for (const other of map.land.get(pid) || []) entries.set(other, { id: other, type: 'land' });
    for (const edge of map.special.get(pid) || []) entries.set(edge.id, { id: edge.id, type: edge.type, through: edge.through });
    const items = [...entries.values()].sort((a, b) => a.id - b.id).map((item) => {
      const entry = dict.get(item.id);
      return {
        ...item,
        label: provinceLabel(entry || { id: item.id }),
        name_cn: entry?.name_cn || '',
        name_en: entry?.name_en || entry?.name || '',
        water: item.type !== 'land',
      };
    });
    return {
      id: pid,
      items,
      total: items.length,
      land: items.filter((item) => item.type === 'land').length,
      strait: items.filter((item) => item.type === 'strait' || item.type === 'lake').length,
      warning: map.warnings.join('；'),
      note: items.length ? '' : '该省没有陆地接壤或海峡连接（可能是孤立海岛/海域）',
    };
  }

  /** Cached province names from vanilla + Mod localisation, plus custom PROV keys. */
  provinceDictionary(): Map<number, ProvinceNameEntry> {
    this.assertHeap('provinceDictionary');
    if (!this.provinceDictionaryCache) {
      const folders = this.localisationRoots().map((root) => path.join(root, 'localisation'));
      const stats: ProvinceDictionaryStats = { files: 0, unreadable: 0, provinces: 0, chinese: 0, roots: folders.slice() };
      this.provinceDictionaryCache = buildProvinceDictionary(folders, stats);
      this.provinceDictionaryStats = stats;
    }
    const result = new Map(this.provinceDictionaryCache);
    for (const [key, value] of Object.entries(this.readCustomDictionary())) {
      const match = /^PROV(\d+)$/i.exec(key);
      if (!match) continue;
      const id = Number(match[1]);
      if (!Number.isFinite(id)) continue;
      const record = result.get(id) || { id, name_cn: '', name_en: '' };
      if (hasCjk(value)) {
        record.name_cn = value;
        record.name_cn_source = 'custom-dictionary.json';
      } else {
        record.name_en = value;
        record.name_en_source = 'custom-dictionary.json';
      }
      result.set(id, record);
    }
    return result;
  }

  /**
   * Dictionary health for the UI: how many provinces got a Chinese name, which
   * folders were scanned, and how many .yml files could not be decoded. When
   * `chinese` is 0 the panel can explain why instead of silently showing English.
   */
  provinceDictionaryMeta(): ProvinceDictionaryStats & { rootsExisting: string[]; unreadableFiles: number } {
    const dict = this.provinceDictionary();
    const stats = this.provinceDictionaryStats || { files: 0, unreadable: 0, provinces: 0, chinese: 0, roots: [] };
    const chinese = [...dict.values()].filter((entry) => Boolean(entry.name_cn)).length;
    return {
      ...stats,
      provinces: dict.size,
      chinese,
      unreadableFiles: stats.unreadable,
      rootsExisting: (stats.roots || []).filter((folder) => isDirectory(folder)),
    };
  }

  /** `[2664] 皮尔森 (Plzeň)` for one numeric province id. */
  provinceLabelOf(id: number): string {
    const key = Number(id);
    if (!Number.isFinite(key)) return '[' + String(id ?? '') + ']';
    return provinceLabel(this.provinceDictionary().get(key) || { id: key });
  }

  /**
   * Searchable province catalog for the UI. Every item carries the numeric `id`
   * plus the three-in-one `label`; query matching is diacritic-insensitive and
   * accepts an id, a Chinese name or an English name (`2664`, `皮尔森`, `Plz`).
   */
  provinceDictionaryList(query = '', limit = 200): Array<ProvinceNameEntry & { name: string; label: string }> {
    const dict = this.provinceDictionary();
    const all = this.mapData().map((province) => {
      const names = dict.get(province.id);
      const entry = {
        id: province.id,
        name: province.name,
        name_cn: names?.name_cn || '',
        name_en: names?.name_en || province.name || '',
        name_cn_source: names?.name_cn_source || '',
        name_en_source: names?.name_en_source || '',
      };
      return { ...entry, label: provinceLabel(entry) };
    });
    return searchProvinceEntries(all, String(query || ''), limit);
  }

  /**
   * Cached Chinese localisation from vanilla and Mod .yml files, then the
   * user's custom dictionary. Only CJK values are merged over static Chinese
   * labels; English-only .yml values would otherwise undo the Chinese UI.
   * Priority: custom > Mod > vanilla > static (static handled by server).
   */
  async localisation(): Promise<Map<string, string>> {
    if (!this.localisationCache) {
      if (!this.localisationBuilding) {
        this.localisationBuilding = this.buildLocalisation().finally(() => { this.localisationBuilding = null; });
      }
      await this.localisationBuilding;
    }
    // Overlay only the (small) user dictionary; never copy the 124k-entry map.
    const custom = this.readCustomDictionary();
    for (const [key, value] of Object.entries(custom)) {
      if (typeof value === 'string') this.localisationCache.set(key, value);
    }
    return this.localisationCache;
  }

  private async buildLocalisation(): Promise<Map<string, string>> {
    this.assertHeap('localisation');
    if (!this.localisationCache) {
      const map = new Map<string, string>();
      for (const root of this.localisationRoots()) {
        const dir = path.join(root, 'localisation');
        await parseLocalisationFolder(dir, (key, value) => {
          if (hasCjk(value)) map.set(key, value);
        });
      }
      this.localisationCache = map;
      // Do not keep a second all-language map: on the full vanilla pack it was
      // hundreds of MB and was the main driver of the 3.4GB heap crash.
      this.localisationAllCache = null;
      // Custom keys are merged once; translation() still checks them first.
      for (const [key, value] of Object.entries(this.readCustomDictionary())) {
        if (typeof value === 'string') map.set(key, value);
      }
    }
    // Overlay only the (small) user dictionary; never copy the 124k-entry map.
    const custom = this.readCustomDictionary();
    for (const [key, value] of Object.entries(custom)) {
      if (typeof value === 'string') this.localisationCache.set(key, value);
    }
    return this.localisationCache;
  }

  /**
   * Resolve one localisation key for display: user dictionary, then a Chinese
   * value from any scanned .yml, then the English/other value. Used to fill
   * idea names/descriptions when the file itself only stores modifiers.
   */
  async translation(key: string): Promise<string> {
    const name = String(key || '').trim();
    if (!name) return '';
    const custom = this.readCustomDictionary();
    if (typeof custom[name] === 'string' && custom[name]) return custom[name];
    await this.localisation();
    return this.localisationCache?.get(name) || this.localisationAllCache?.get(name) || '';
  }

  /** Store a UI-built edit request for the agent to pick up later. */
  setPendingEdit(edit: any): any {
    this.state.pendingEdit = { ...(edit || {}), createdAt: new Date().toISOString() };
    this.saveState();
    return this.state.pendingEdit;
  }

  /** Read (and optionally clear) the pending UI edit. Never writes game files. */
  takePendingEdit(clear = false): any {
    const pending = this.state.pendingEdit || null;
    if (clear && pending) {
      this.state.pendingEdit = null;
      this.saveState();
    }
    return pending;
  }

  /** Global change queue: pure JSON items, persisted in the workspace state. */
  listChanges(): any[] {
    return Array.isArray(this.state.changeQueue) ? [...this.state.changeQueue] : [];
  }

  addChange(input: any): any {
    const targetType = String(input?.targetType || '');
    // Two vocabularies exist on purpose: the AI payload uses
    // `create | update | delete`, the change queue uses
    // `create | modify | delete`. Normalise at this single boundary so no
    // caller can enqueue an unrepresentable action.
    const rawAction = String(input?.action || '').trim().toLowerCase();
    const action = rawAction === 'update' || rawAction === 'edit' ? 'modify' : rawAction;
    if (!['event', 'mission', 'mechanic', 'gui', 'province_history', 'country_history', 'new_tag', 'national_ideas', 'government_reform', 'tag_government', 'decision', 'diplomacy'].includes(targetType)) {
      throw new Error('invalid targetType: ' + targetType);
    }
    if (!['create', 'modify', 'delete'].includes(action)) {
      throw new Error('invalid action: ' + rawAction);
    }
    const targetId = String(input?.targetId || '').trim();
    if (!targetId) throw new Error('targetId is required');
    if (!input?.data || typeof input.data !== 'object' || Array.isArray(input.data)) {
      throw new Error('data must be a JSON object');
    }
    let data: any;
    try {
      data = JSON.parse(JSON.stringify(input.data));
    } catch {
      throw new Error('data must be JSON-serializable');
    }
    const item = {
      id: 'q_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
      targetType,
      action,
      targetId,
      targetFile: input.targetFile ? String(input.targetFile) : (data.file ? String(data.file) : ''),
      data,
      createdAt: new Date().toISOString(),
    };
    // Same target (e.g. the same province) replaces the old queue item.
    const queue = (this.state.changeQueue || []).filter(
      (old: any) => !(old.targetType === targetType && old.targetId === targetId),
    );
    // Embedded new modifiers (`add_country_modifier` + stats) become their own
    // mechanic tasks, placed before the event/mission that references them.
    const embedded = collectEmbeddedModifiers(data);
    const origin = { targetType, targetId };
    let kept = queue.filter((old: any) => !(old.targetType === 'mechanic'
      && old.data && old.data.origin
      && old.data.origin.targetType === targetType && old.data.origin.targetId === targetId));
    if (embedded.length) {
      kept = kept.filter((old: any) => !embedded.some((mod) => old.targetType === 'mechanic' && old.targetId === mod.name));
    }
    const modifierItems = embedded.map((mod) => ({
      id: 'q_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
      targetType: 'mechanic',
      action: 'create',
      targetId: mod.name,
      targetFile: 'common/event_modifiers/' + mod.name + '.txt',
      data: {
        name: mod.name,
        file: 'common/event_modifiers/' + mod.name + '.txt',
        nameZh: mod.nameZh,
        stats: mod.stats,
        newModifier: true,
        origin,
      },
      createdAt: new Date().toISOString(),
    }));
    this.state.changeQueue = [...kept, ...modifierItems, item];
    this.saveState();
    return item;
  }

  removeChange(id: string): boolean {
    const before = this.listChanges();
    this.state.changeQueue = before.filter((item: any) => item.id !== id);
    if (this.state.changeQueue.length !== before.length) this.saveState();
    return this.state.changeQueue.length !== before.length;
  }

  clearChanges(): number {
    const count = this.listChanges().length;
    this.state.changeQueue = [];
    this.saveState();
    return count;
  }

  saveState(): void {
    const file = this.stateFile();
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(this.state, null, 2) + '\n', 'utf8');
    } catch {
      /* persistence is best-effort; the workspace remains usable */
    }
  }

  resolveEu4Root(): string | null {
    const candidates: string[] = [];
    const push = (p: string | null | undefined) => {
      if (!p) return;
      const abs = path.resolve(p);
      if (!candidates.includes(abs)) candidates.push(abs);
    };
    push(this.config.eu4Root);
    push(process.env.EU4_ROOT);
    push(this.state.eu4Root);
    const steamRoots = [
      process.env['ProgramFiles(x86)'] ? path.join(process.env['ProgramFiles(x86)'], 'Steam') : '',
      process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'Steam') : '',
      path.join(os.homedir(), '.steam', 'steam'),
      path.join(os.homedir(), '.local', 'share', 'Steam'),
      path.join(os.homedir(), 'Library', 'Application Support', 'Steam'),
    ].filter(Boolean);
    for (const steam of steamRoots) {
      push(path.join(steam, 'steamapps', 'common', 'Europa Universalis IV'));
      const vdf = path.join(steam, 'steamapps', 'libraryfolders.vdf');
      if (existsFile(vdf)) {
        try {
          const text = fs.readFileSync(vdf, 'utf8');
          const re = /"path"\s*"([^"]+)"/g;
          let m: RegExpExecArray | null;
          while ((m = re.exec(text))) {
            push(path.join(path.normalize(m[1]), 'steamapps', 'common', 'Europa Universalis IV'));
          }
        } catch {
          /* ignore */
        }
      }
    }
    for (const c of candidates) if (existsDir(c) && (existsFile(path.join(c, 'eu4.exe')) || existsFile(path.join(c, 'eu4')) || existsDir(path.join(c, 'common')))) return c;
    return null;
  }

  resolveModDir(): string | null {
    const candidates: string[] = [];
    const push = (p: string | null | undefined) => {
      if (!p) return;
      const abs = path.resolve(p);
      if (!candidates.includes(abs)) candidates.push(abs);
    };
    push(this.config.modDir);
    push(process.env.EU4_MOD_DIR);
    push(this.state.modDir);
    push(path.join(os.homedir(), 'Documents', 'Paradox Interactive', 'Europa Universalis IV', 'mod'));
    push(path.join(os.homedir(), '.local', 'share', 'Paradox Interactive', 'Europa Universalis IV', 'mod'));
    for (const c of candidates) if (existsDir(c)) return c;
    return null;
  }

  init(): this {
    const eu4Root = this.resolveEu4Root();
    const modDir = this.resolveModDir();
    let changed = false;
    if (eu4Root && eu4Root !== this.state.eu4Root) {
      this.state.eu4Root = eu4Root;
      changed = true;
    }
    if (modDir && modDir !== this.state.modDir) {
      this.state.modDir = modDir;
      changed = true;
    }
    if (!this.state.vanillaFiles.length && eu4Root) {
      this.reindex();
      changed = false;
    } else if (changed) {
      this.saveState();
    }
    return this;
  }

  setRoots(eu4Root?: string, modDir?: string): void {
    if (eu4Root) this.state.eu4Root = path.resolve(eu4Root);
    if (modDir) this.state.modDir = path.resolve(modDir);
    this.localisationCache = null;
    this.localisationAllCache = null;
    this.provinceDictionaryCache = null;
    this.provinceDictionaryStats = null;
    this.reindex();
  }

  private walk(root: string, rel: string, out: string[], max: number): void {
    if (out.length >= max) return;
    const baseRel = rel ? normRel(rel) : '';
    const abs = baseRel ? path.join(root, ...baseRel.split(path.posix.sep)) : root;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= max) return;
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      const childRel = baseRel ? path.posix.join(baseRel, entry.name) : entry.name;
      const childAbs = path.join(abs, entry.name);
      if (entry.isDirectory()) {
        this.walk(root, childRel, out, max);
      } else if (entry.isFile() && /\.(txt|yml|csv|mod)$/i.test(entry.name)) {
        out.push(childRel);
      }
    }
  }

  /** Async directory walk used by the renderer-facing mission lookup. */
  private async walkAsync(root: string, rel: string, out: string[], max: number): Promise<void> {
    if (out.length >= max) return;
    const baseRel = rel ? normRel(rel) : '';
    const abs = baseRel ? path.join(root, ...baseRel.split(path.posix.sep)) : root;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= max) return;
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      const childRel = baseRel ? path.posix.join(baseRel, entry.name) : entry.name;
      if (entry.isDirectory()) {
        await this.walkAsync(root, childRel, out, max);
      } else if (entry.isFile() && /\.(txt|yml|csv|mod)$/i.test(entry.name)) {
        out.push(childRel);
      }
    }
  }

  reindex(): WorkspaceState {
    this.localisationCache = null;
    this.localisationAllCache = null;
    this.provinceDictionaryCache = null;
    this.provinceDictionaryStats = null;
    const root = this.state.eu4Root;
    const max = Math.max(1000, Math.min(100000, Number(this.config.maxIndexFiles) || 30000));
    const files: string[] = [];
    if (root) for (const dir of INDEX_DIRS) this.walk(root, dir, files, max);
    this.state.vanillaFiles = files;
    this.state.mods = this.listMods();
    this.state.indexedAt = new Date().toISOString();
    this.state.counts = {};
    for (const f of files) {
      const top = f.split(path.posix.sep)[0];
      this.state.counts[top] = (this.state.counts[top] || 0) + 1;
    }
    this.locCache = null;
    this.mapCache = null;
    this.provinceHistoryCache = null;
    this.saveState();
    return this.state;
  }

  listMods(): ModRecord[] {
    const dir = this.state.modDir;
    if (!dir) return [];
    const out: ModRecord[] = [];
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    for (const entry of entries) {
      if (!entry.isFile() || !/\.mod$/i.test(entry.name)) continue;
      const file = path.join(dir, entry.name);
      let text = '';
      try {
        text = fs.readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      const field = (name: string): string | undefined => {
        const m = new RegExp(`^\\s*${name}\\s*=\\s*"([^"]*)"`, 'mi').exec(text);
        return m ? m[1] : undefined;
      };
      const id = entry.name.replace(/\.mod$/i, '');
      out.push({
        id,
        name: field('name') || id,
        path: field('path') || '',
        supportedVersion: field('supported_version'),
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  modRoot(modId?: string | null): string | null {
    const id = modId || this.state.selectedMod;
    if (!id) return this.state.modDir;
    const mod = this.state.mods.find((m) => m.id === id || m.name === id);
    if (!mod || !mod.path) return this.state.modDir;
    const rel = path.normalize(mod.path);
    if (path.isAbsolute(rel)) return rel;
    return path.join(this.state.modDir || '', ...normRel(rel).split(path.posix.sep));
  }

  /* ---------------------------- docs ---------------------------- */

  queryDoc(name: string, kind?: string): { matches: DocEntry[]; source: string; generatedAt: string } {
    const q = String(name || '').trim().toLowerCase();
    const maps = kind === 'effect' ? [this.effects] : kind === 'trigger' ? [this.triggers] : kind === 'modifier' ? [this.modifiers] : [this.effects, this.triggers, this.modifiers];
    const matches: DocEntry[] = [];
    if (!kind || kind === 'scope') {
      for (const entry of this.docs.scopes || []) if (entry.name.toLowerCase() === q) matches.push(entry);
    }
    for (const map of maps) {
      for (const entry of map.values()) if (entry.name.toLowerCase() === q) matches.push(entry);
    }
    return { matches, source: this.docs.source, generatedAt: this.docs.generatedAt };
  }

  searchDocs(query: string, kind?: string, limit = 20): DocEntry[] {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    const maps = kind === 'effect' ? [this.effects] : kind === 'trigger' ? [this.triggers] : kind === 'modifier' ? [this.modifiers] : [this.effects, this.triggers, this.modifiers];
    const pool: DocEntry[] = [];
    for (const map of maps) for (const entry of map.values()) pool.push(entry);
    if (!kind || kind === 'scope') for (const entry of this.docs.scopes || []) pool.push(entry);
    const scored: Array<{ e: DocEntry; score: number }> = [];
    for (const entry of pool) {
      const n = entry.name.toLowerCase();
      let score = 0;
      if (n === q) score = 100;
      else if (n.startsWith(q)) score = 80;
      else if (n.includes(q)) score = 60;
      else if (q.length > 2 && this.subsequence(q, n)) score = 30;
      if (score) scored.push({ e: entry, score });
    }
    scored.sort((a, b) => b.score - a.score || a.e.name.localeCompare(b.e.name));
    return scored.slice(0, Math.max(1, Math.min(50, limit))).map((x) => x.e);
  }

  private subsequence(needle: string, haystack: string): boolean {
    let j = 0;
    for (let i = 0; i < haystack.length && j < needle.length; i += 1) if (haystack[i] === needle[j]) j += 1;
    return j === needle.length;
  }

  allFiles(): string[] {
    const files = this.state.vanillaFiles.slice();
    const modRoot = this.modRoot();
    if (modRoot && existsDir(modRoot)) {
      const extra: string[] = [];
      this.walk(modRoot, '', extra, 30000);
      for (const f of extra) if (!files.includes(f)) files.push(f);
    }
    return files;
  }

  findDefinition(name: string, limit = 20): any {
    const needle = String(name || '').trim();
    if (!needle) return { name, definitions: [], references: [], note: 'empty name' };
    const esc = this.escapeRe(needle);
    const reDefs = [
      new RegExp(`^\\s*${esc}\\s*=`, 'm'),
      new RegExp(`^\\s*id\\s*=\\s*${esc}\\b`, 'm'),
      new RegExp(`^\\s*name\\s*=\\s*"?${esc}"?\\s*$`, 'm'),
    ];
    const isDef = (line: string) => reDefs.some((re) => re.test(line));
    const reRef = new RegExp(`\\b${esc}\\b`);
    const definitions: any[] = [];
    const references: any[] = [];
    const roots: Array<{ label: string; root: string }> = [];
    if (this.state.eu4Root) roots.push({ label: 'vanilla', root: this.state.eu4Root });
    const modRoot = this.modRoot();
    if (modRoot && existsDir(modRoot)) roots.push({ label: 'mod:' + (this.state.selectedMod || 'workspace'), root: modRoot });
    for (const source of roots) {
      const files: string[] = [];
      this.walk(source.root, '', files, 30000);
      for (const rel of files) {
        if (!/\.(txt|yml)$/i.test(rel)) continue;
        const abs = toAbs(source.root, rel);
        if (!abs) continue;
        let text = '';
        try {
          text = fs.readFileSync(abs, 'utf8');
        } catch {
          continue;
        }
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length && definitions.length < limit; i += 1) {
          if (isDef(lines[i])) definitions.push({ source: source.label, path: abs, relative: rel, line: i + 1, text: lines[i].trim() });
        }
        if (references.length < limit) {
          for (let i = 0; i < lines.length && references.length < limit; i += 1) {
            if (!reRef.test(lines[i])) continue;
            if (isDef(lines[i])) continue;
            references.push({ source: source.label, path: abs, relative: rel, line: i + 1, text: lines[i].trim() });
          }
        }
        if (definitions.length >= limit && references.length >= limit) break;
      }
    }
    return { name: needle, definitions, references, note: definitions.length ? null : 'not found in indexed vanilla/mod files' };
  }

  private escapeRe(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /* ------------------------- validation ------------------------- */

  classify(name: string): { effect?: DocEntry; trigger?: DocEntry; modifier?: DocEntry } {
    return { effect: this.effects.get(name), trigger: this.triggers.get(name), modifier: this.modifiers.get(name) };
  }

  private scopeOf(entry: DocEntry | undefined): string[] {
    if (!entry || !Array.isArray(entry.scopes)) return [];
    return entry.scopes.filter((s) => NAMED_SCOPES.has(s));
  }

  validateScript(script: string, options: { scope?: string; modId?: string } = {}): { issues: ValidationIssue[]; nodes: number; summary: string } {
    const text = String(script || '');
    const nodes = parseCw(text);
    const issues: ValidationIssue[] = [];
    let rootScope = options.scope || 'country';
    for (const n of nodes) {
      if (n.key === 'province_event') rootScope = 'province';
      else if (n.key === 'country_event') rootScope = 'country';
      else if (n.key === 'trade_node_event') rootScope = 'trade_node';
    }
    const scopeChangers = this.docs.scopeChangers || {};
    const walk = (list: CwNode[], scope: string, context: string | null): void => {
      for (const node of list) {
        const key = node.key;
        if (STRUCTURAL_KEYS.has(key)) {
          if (node.children) walk(node.children, scope, context);
          continue;
        }
        const cls = this.classify(key);
        const isContainer = !!node.children;
        const nextScope = scopeChangers[key] || scope;
        let nextContext = context;
        if (TRIGGER_BLOCKS.has(key) && isContainer) nextContext = 'trigger';
        if (EFFECT_BLOCKS.has(key) && isContainer) nextContext = 'effect';
        if (key === 'if' || key === 'else_if' || key === 'else' || key === 'random' || key === 'while') nextContext = context;
        if (!isContainer) {
          if (context === 'trigger' && cls.effect) {
            issues.push({
              severity: 'error',
              code: 'EFFECT_IN_TRIGGER',
              message: `effect "${key}" 出现在 trigger 块中；trigger 只接受条件。`,
              line: node.line,
              key,
            });
          }
          if (context === 'effect' && cls.trigger && !cls.effect) {
            issues.push({
              severity: 'error',
              code: 'TRIGGER_IN_EFFECT',
              message: `trigger "${key}" 出现在 effect 块中；effect 块只接受效果。`,
              line: node.line,
              key,
            });
          }
          if (context !== 'trigger' && cls.effect) {
            const expected = this.scopeOf(cls.effect);
            if (expected.length && scope !== 'any' && !expected.includes(scope) && !expected.includes('script')) {
              issues.push({
                severity: 'error',
                code: 'SCOPE_MISMATCH',
                message: `effect "${key}" 需要 ${expected.join('/')} 作用域，当前是 ${scope}。`,
                line: node.line,
                key,
                expectedScope: expected,
                actualScope: scope,
              });
            }
          }
        }
        if (node.children) walk(node.children, nextScope, nextContext);
      }
    };
    walk(nodes, rootScope, null);
    return {
      issues,
      nodes: this.countNodes(nodes),
      summary: issues.length ? `${issues.length} 个问题` : '未发现作用域或 trigger/effect 混用问题',
    };
  }

  countNodes(nodes: CwNode[]): number {
    let n = 0;
    for (const node of nodes) {
      n += 1;
      if (node.children) n += this.countNodes(node.children);
    }
    return n;
  }

  /* --------------------------- loc --------------------------- */

  private locKeyCache(): Set<string> {
    const roots = [this.state.eu4Root, this.modRoot()].filter(Boolean) as string[];
    const cacheKey = roots.join('|') + '|' + (this.state.indexedAt || '');
    if (this.locCache && this.locCache.key === cacheKey) return this.locCache.keys;
    const keys = new Set<string>();
    for (const root of roots) {
      const locDir = path.join(root, 'localisation');
      const files: string[] = [];
      this.walk(root, 'localisation', files, 30000);
      for (const rel of files) {
        if (!/\.yml$/i.test(rel)) continue;
        const abs = toAbs(root, rel);
        if (!abs) continue;
        let text = '';
        try {
          text = fs.readFileSync(abs, 'utf8');
        } catch {
          continue;
        }
        for (const line of text.split(/\r?\n/)) {
          const m = /^\s*([A-Za-z0-9_.\-]+):\d*\s*"/.exec(line);
          if (m) keys.add(m[1]);
        }
      }
      void locDir;
    }
    this.locCache = { key: cacheKey, keys };
    return keys;
  }

  extractLocKeys(script: string): string[] {
    const nodes = parseCw(script);
    const out = new Set<string>();
    const walk = (list: CwNode[]): void => {
      for (const node of list) {
        if (LOC_KEYS.has(node.key) && node.value) {
          const v = unquote(node.value).trim();
          if (/^[A-Za-z0-9_.\-]+$/.test(v) && !/^\d+$/.test(v)) out.add(v);
        }
        if (node.key === 'custom_tooltip' && node.value) {
          const v = unquote(node.value).trim();
          if (/^[A-Za-z0-9_.\-]+$/.test(v)) out.add(v);
        }
        if (node.children) walk(node.children);
      }
    };
    walk(nodes);
    return [...out].sort();
  }

  checkLocKeys(script: string): { keys: string[]; missing: string[]; known: number } {
    const keys = this.extractLocKeys(script);
    const known = this.locKeyCache();
    return { keys, missing: keys.filter((k) => !known.has(k)), known: known.size };
  }

  /* --------------------------- map --------------------------- */

  mapData(): any[] {
    this.assertHeap('mapData');
    if (this.mapCache) return this.mapCache;
    const root = this.state.eu4Root;
    if (!root) return [];
    const file = path.join(root, 'map', 'definition.csv');
    let text = '';
    try {
      // EU4's map definition CSV is Windows-1252, not UTF-8.
      text = fs.readFileSync(file, 'latin1');
    } catch {
      return [];
    }
    const hist = this.provinceHistory();
    const out: any[] = [];
    for (const line of text.split(/\r?\n/)) {
      if (!line || /^id;/i.test(line)) continue;
      const cols = line.split(';');
      if (cols.length < 5) continue;
      const id = Number(cols[0]);
      if (!Number.isFinite(id) || id <= 0) continue;
      const name = cols[4] || String(id);
      const record = hist.get(String(id)) || {};
      out.push({ id, name, type: cols[5] || '', ...record });
      if (out.length >= 12000) break;
    }
    this.mapCache = out;
    return out;
  }

  private provinceHistory(): Map<string, any> {
    const startDate = this.state.currentStartDate || '1437.1.1';
    if (this.provinceHistoryCache && this.provinceHistoryCacheDate === startDate) return this.provinceHistoryCache;
    const map = new Map<string, any>();
    const warnings: string[] = [];
    const chosen = new Map<string, { abs: string; rel: string; source: string }>();
    const roots: Array<{ root: string | null; source: string }> = [
      { root: this.modRoot(), source: 'mod' },
      { root: this.state.eu4Root, source: 'vanilla' },
    ];
    for (const entry of roots) {
      if (!entry.root) continue;
      const files: string[] = [];
      this.walk(entry.root, path.join('history', 'provinces'), files, 12000);
      files.sort();
      for (const rel of files) {
        if (!/\.txt$/i.test(rel)) continue;
        const normalized = rel.split(path.sep).join('/');
        const base = path.posix.basename(normalized);
        const match = /^(\d+)(?:\s*-[^/]*)?\.txt$/i.exec(base);
        if (!match) continue;
        const id = match[1];
        // Mod history wins absolutely: once a mod file exists for this province,
        // vanilla is never merged or consulted for that id.
        if (chosen.has(id)) continue;
        const abs = toAbs(entry.root, rel);
        if (abs) chosen.set(id, { abs, rel: normalized, source: entry.source });
      }
    }
    for (const [id, file] of chosen) {
      let text = '';
      try {
        text = fs.readFileSync(file.abs, 'utf8');
      } catch {
        continue;
      }
      const record = provinceHistoryAt(text, startDate);
      record.file = file.rel;
      record.source = file.source;
      if (record.unresolved) {
        warnings.push(`${id} (${file.rel}): ${record.historyWarning}`);
      }
      map.set(id, record);
    }
    this.provinceHistoryCache = map;
    this.provinceHistoryCacheDate = startDate;
    this.provinceHistoryWarnings = warnings;
    return map;
  }

  coreProvinceIds(tag: string): number[] {
    const t = String(tag || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{3}$/.test(t)) return [];
    const out = new Set<number>();
    const root = this.state.eu4Root;
    if (!root) return [];
    const files: string[] = [];
    this.walk(root, path.join('history', 'countries'), files, 3000);
    for (const rel of files) {
      if (!path.basename(rel).toUpperCase().startsWith(t + ' ')) continue;
      const abs = toAbs(root, rel);
      if (!abs) continue;
      let text = '';
      try {
        text = fs.readFileSync(abs, 'utf8');
      } catch {
        continue;
      }
      const re = /^\s*add_core\s*=\s*(\d+)\b/gm;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) out.add(Number(m[1]));
    }
    for (const [id, rec] of this.provinceHistory()) {
      if (Array.isArray(rec.cores) && rec.cores.includes(t)) out.add(Number(id));
    }
    return [...out].sort((a, b) => a - b);
  }

  mapQuery(input: { provinceId?: number; tag?: string; ownerTag?: string; coresOnly?: boolean; q?: string; limit?: number }): any {
    this.assertHeap('mapQuery');
    const all = this.mapData();
    const dict = this.provinceDictionary();
    let items = all;
    let coreIds: number[] = [];
    const tag = String(input.tag || '').trim().toUpperCase();
    if (tag) coreIds = this.coreProvinceIds(tag);
    if (Number.isFinite(Number(input.provinceId))) {
      items = all.filter((p) => p.id === Number(input.provinceId));
    } else if (input.q) {
      const tokens = foldProvinceText(input.q).split(' ').filter(Boolean);
      items = all.filter((p) => {
        const names = dict.get(p.id);
        return provinceMatchScore({ id: p.id, name: p.name, name_cn: names?.name_cn, name_en: names?.name_en }, tokens) >= 0;
      });
    }
    const ownerTag = String(input.ownerTag || '').trim().toUpperCase();
    if (/^[A-Z0-9]{3}$/.test(ownerTag)) {
      items = items.filter((p) => String(p.owner || '').toUpperCase() === ownerTag);
    }
    if (input.coresOnly) {
      const wanted = new Set(coreIds.length ? coreIds : this.coreProvinceIds(ownerTag));
      items = items.filter((p) => wanted.has(p.id));
    }
    const limit = Math.max(1, Math.min(12000, Number(input.limit) || 12000));
    return {
      total: items.length,
      coreIds,
      provinces: items.slice(0, limit).map((p) => {
        const names = dict.get(p.id);
        const entry = {
          id: p.id,
          name_cn: names?.name_cn || '',
          name_en: names?.name_en || p.name || '',
        };
        return {
          ...p,
          ...entry,
          label: provinceLabel({ ...entry, name: p.name }),
          isCore: coreIds.includes(p.id),
        };
      }),
      startDate: this.state.currentStartDate,
      warnings: this.provinceHistoryWarnings.slice(0, 50),
      warningCount: this.provinceHistoryWarnings.length,
    };
  }

  batchHistory(input: { tag: string; provinceIds: number[]; operation?: string; value?: string | number }): any {
    const tag = String(input.tag || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{3}$/.test(tag)) return { error: 'tag must be a three-character country tag' };
    const ids = (input.provinceIds || []).map(Number).filter((n) => Number.isFinite(n) && n > 0);
    if (!ids.length) return { error: 'provinceIds is empty' };
    const op = String(input.operation || 'owner').toLowerCase();
    const all = this.mapData();
    const dict = this.provinceDictionary();
    const files = ids.map((id) => {
      const p = all.find((x) => x.id === id) || { id, name: String(id) };
      const lines = ['# generated by EU4 Mod Workbench'];
      if (op === 'owner' || op === 'give') lines.push(`owner = ${tag}`);
      else if (op === 'controller') lines.push(`controller = ${tag}`);
      else if (op === 'core' || op === 'add_core') lines.push(`add_core = ${tag}`);
      else if (op === 'remove_core') lines.push(`remove_core = ${tag}`);
      else if (op === 'base_tax') lines.push(`base_tax = ${Number(input.value) || 1}`);
      else if (op === 'religion') lines.push(`religion = ${String(input.value || 'catholic')}`);
      else if (op === 'culture') lines.push(`culture = ${String(input.value || 'english')}`);
      else lines.push(`owner = ${tag}`);
      return {
        provinceId: id,
        // Display only: the generated script body above only ever holds numbers.
        label: provinceLabel({ id, name: p.name, name_cn: dict.get(id)?.name_cn, name_en: dict.get(id)?.name_en }),
        path: path.posix.join('history', 'provinces', `${id} - ${p.name}.txt`),
        content: lines.join('\n') + '\n',
      };
    });
    return {
      tag,
      operation: op,
      provinceIds: ids,
      labels: files.map((file) => file.label),
      files,
      note: 'Write these files into the mod root; the game loads history/provinces/<id> - <name>.txt.',
    };
  }

  /* ------------------------ missions/events ------------------------ */

  safeResolveFile(input: string, preferMod = true): string | null {
    const raw = String(input || '').trim();
    if (!raw) return null;
    if (path.isAbsolute(raw)) return existsFile(raw) ? raw : null;
    const roots = preferMod ? [this.modRoot(), this.state.eu4Root] : [this.state.eu4Root, this.modRoot()];
    for (const root of roots) {
      if (!root) continue;
      const abs = toAbs(root, raw);
      if (abs && existsFile(abs)) return abs;
    }
    return null;
  }

  readTextFile(input: string): any {
    const abs = this.safeResolveFile(input, true);
    if (!abs) return { error: 'file not found: ' + input };
    let content = '';
    try {
      content = fs.readFileSync(abs, 'utf8');
    } catch (e: any) {
      return { error: String(e && e.message ? e.message : e) };
    }
    const modRoot = this.modRoot();
    const insideMod = modRoot ? this.isInside(modRoot, abs) : false;
    return {
      path: abs,
      relative: modRoot && insideMod ? normRel(path.relative(modRoot, abs)) : abs,
      editable: !!insideMod,
      content,
      bytes: Buffer.byteLength(content, 'utf8'),
    };
  }

  saveTextFile(input: string, content: string): any {
    const modRoot = this.modRoot();
    if (!modRoot) return { error: 'mod directory is not configured' };
    const raw = String(input || '').trim();
    if (!raw) return { error: 'empty path' };
    const abs = path.isAbsolute(raw) ? path.resolve(raw) : toAbs(modRoot, raw);
    if (!abs || !this.isInside(modRoot, abs)) return { error: 'path escapes the mod directory' };
    const validation = this.validateScript(String(content || ''), {});
    if (validation.issues.some((i) => i.severity === 'error')) return { error: 'validation failed', issues: validation.issues };
    try {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, String(content || ''), 'utf8');
    } catch (e: any) {
      return { error: String(e && e.message ? e.message : e) };
    }
    return { ok: true, path: abs, relative: normRel(path.relative(modRoot, abs)), issues: validation.issues };
  }

  private isInside(root: string, abs: string): boolean {
    const rel = path.relative(path.resolve(root), path.resolve(abs));
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
  }

  listMissionFiles(): any[] {
    const root = this.modRoot();
    if (!root) return [];
    const files: string[] = [];
    this.walk(root, 'missions', files, 5000);
    return files.map((rel) => {
      const abs = path.join(root, ...rel.split(path.posix.sep));
      let stat: fs.Stats | null = null;
      try { stat = fs.statSync(abs); } catch { /* ignore */ }
      return { path: rel, absolute: abs, size: stat ? stat.size : 0 };
    });
  }

  /**
   * Resolve a country tag to its mission file, e.g. `missions/BOH_missions.txt`.
   * The mod root wins over vanilla; the walk uses `fs.promises.readdir` so a
   * large mission tree does not block the Host event loop. Nothing is written.
   */
  async findMissionsForTag(tag: string): Promise<any> {
    const t = String(tag || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{3}$/.test(t)) return { tag: t, path: null, candidates: [], error: 'tag must be a three-character country tag' };
    const low = t.toLowerCase();
    const roots: Array<{ label: string; base: string }> = [];
    const mod = this.modRoot();
    if (mod) roots.push({ label: 'mod', base: mod });
    if (this.state.eu4Root) roots.push({ label: 'vanilla', base: this.state.eu4Root });
    for (const root of roots) {
      const files: string[] = [];
      await this.walkAsync(root.base, 'missions', files, 5000);
      const textFiles = files.filter((rel) => /\.txt$/i.test(rel));
      const named = textFiles.filter((rel) => {
        const base = path.basename(rel).toLowerCase();
        return base === `${low}_missions.txt`
          || base.startsWith(`${low}_`)
          || base.includes(`_${low}_`)
          || new RegExp(`${low}[ _-]?missions`).test(base);
      });
      if (named.length) {
        return { tag: t, path: path.posix.normalize(named[0]), source: root.label, matchedBy: 'filename', candidates: named.slice(0, 20) };
      }
      // Vanilla names mission files by country adjective (`Bohemian_Missions.txt`),
      // so fall back to the mission file that actually scopes a mission to this tag.
      const needle = new RegExp(`\\btag\\s*=\\s*${t}\\b`);
      const hits = await Promise.all(textFiles.map(async (rel) => {
        try {
          const abs = path.join(root.base, ...rel.split(path.posix.sep));
          return needle.test(await fs.promises.readFile(abs, 'utf8')) ? rel : null;
        } catch {
          return null;
        }
      }));
      const contentMatches = hits.filter((rel) => rel !== null) as string[];
      if (contentMatches.length) {
        return { tag: t, path: path.posix.normalize(contentMatches[0]), source: root.label, matchedBy: 'content', candidates: contentMatches.slice(0, 20) };
      }
    }
    return { tag: t, path: null, candidates: [] };
  }

  parseMissions(file: string): any {
    const abs = this.safeResolveFile(file, true);
    if (!abs) return { error: 'mission file not found: ' + file };
    let text = '';
    try {
      text = fs.readFileSync(abs, 'utf8');
    } catch (e: any) {
      return { error: String(e && e.message ? e.message : e) };
    }
    const nodes = parseCw(text);
    const missions: any[] = [];
    const visit = (list: CwNode[]): void => {
      for (const node of list) {
        if (!node.children) continue;
        const childKeys = new Set(node.children.map((c) => c.key));
        const looksLikeMission = childKeys.has('required_missions') || (childKeys.has('trigger') && childKeys.has('effect')) || childKeys.has('icon');
        if (looksLikeMission && !['missions', 'country_missions', 'generic_missions'].includes(node.key)) {
          const requiredNode = findNode(node.children, 'required_missions');
          const required = requiredNode && requiredNode.children ? requiredNode.children.map((c) => c.key) : [];
          const trigger = findNode(node.children, 'trigger');
          const effect = findNode(node.children, 'effect');
          missions.push({
            id: node.key,
            title: node.key,
            required,
            trigger: trigger && trigger.children ? textOf(trigger.children).trim() : '',
            effect: effect && effect.children ? textOf(effect.children).trim() : '',
            conditions: trigger && trigger.children ? conditionsFromNodes(trigger.children) : [],
            rewards: effect && effect.children ? effectsFromNodes(effect.children) : [],
            icon: findNode(node.children, 'icon')?.value || '',
            line: node.line,
          });
          continue;
        }
        visit(node.children);
      }
    };
    visit(nodes);
    return { path: abs, relative: normRel(path.relative(this.modRoot() || this.state.eu4Root || path.dirname(abs), abs)), missions };
  }

  /**
   * Parse one event into the structured form the panel edits. Read-only: the
   * result is JSON, and the panel only turns it into an AI prompt.
   */
  async eventForm(file: string, id: string): Promise<any> {
    const target = String(id || '').trim();
    if (!target) return { error: 'event id is required' };
    const abs = this.safeResolveFile(String(file || ''), true);
    if (!abs) return { error: 'file not found: ' + file };
    let text = '';
    try {
      text = await fs.promises.readFile(abs, 'utf8');
    } catch (e: any) {
      return { error: String(e && e.message ? e.message : e) };
    }
    const nodes = parseCw(text);
    const found = nodes.find((node) => ['country_event', 'province_event', 'news_event'].includes(node.key)
      && node.children
      && unquote(String(findNode(node.children, 'id')?.value ?? '')) === target);
    if (!found || !found.children) return { error: `event ${target} not found in ${this.relativeForFile(abs)}` };
    const children = found.children;
    const trigger = findNode(children, 'trigger');
    const namespaceMatch = /^\s*namespace\s*=\s*([A-Za-z0-9_]+)/m.exec(text);
    const options = children.filter((child) => child.key === 'option').map((option) => {
      const optionChildren = option.children || [];
      return {
        name: findNode(optionChildren, 'name')?.value || '',
        effects: effectsFromNodes(optionChildren.filter((child) => !['name', 'trigger', 'ai_chance'].includes(child.key))),
      };
    });
    // title/desc in the .txt are localisation keys; the UI edits the Chinese text.
    const titleRaw = unquote(String(findNode(children, 'title')?.value ?? '')).trim();
    const descRaw = unquote(String(findNode(children, 'desc')?.value ?? '')).trim();
    const titleKey = titleRaw || (target + '.t');
    const descKey = descRaw || (target + '.d');
    const isTriggeredOnly = isYesNode(findNode(children, 'is_triggered_only'));
    return {
      file: this.relativeForFile(abs),
      absolute: abs,
      id: target,
      kind: found.key,
      namespace: namespaceMatch ? namespaceMatch[1] : target.split('.')[0],
      titleKey,
      descKey,
      title: (await this.translation(titleKey)) || titleKey,
      desc: (await this.translation(descKey)) || descKey,
      picture: findNode(children, 'picture')?.value || '',
      fireOnlyOnce: isYesNode(findNode(children, 'fire_only_once')),
      major: isYesNode(findNode(children, 'major')),
      isTriggeredOnly,
      triggerMode: isTriggeredOnly ? 'startup' : 'normal',
      targetTag: '',
      bindDate: this.state.currentStartDate || '1437.1.1',
      localisationFile: 'localisation/zz_eu4_workbench_l_simp_chinese.yml',
      conditions: trigger && trigger.children ? conditionsFromNodes(trigger.children) : [],
      options,
      original: clipLines(textOf([found]), 100),
    };
  }

  /**
   * Every legal event id in the current mod + vanilla, with a Chinese title
   * resolved from localisation. Used by the event selector so effects bind an
   * id string instead of a raw number. Mod definitions win over vanilla.
   */
  async eventCatalog(force = false): Promise<any> {
    this.assertHeap('eventCatalog');
    const mod = this.modRoot();
    const rootKey = (mod || '') + '|' + (this.state.eu4Root || '');
    const now = Date.now();
    if (!force && this.eventCatalogCache && this.eventCatalogCache.key === rootKey && now - this.eventCatalogCache.at < 30_000) {
      return this.eventCatalogCache.data;
    }
    const events = new Map<string, any>();
    const scan = async (root: string, source: 'mod' | 'vanilla') => {
      const files: string[] = [];
      await this.walkAsync(root, path.join('events'), files, 8000);
      let scanned = 0;
      for (const rel of files) {
        if (!/\.txt$/i.test(rel)) continue;
        if ((++scanned % 200) === 0) this.assertHeap('eventCatalog(scan)');
        const abs = path.join(root, ...rel.split(path.posix.sep));
        let text = '';
        try { text = await fs.promises.readFile(abs, 'utf8'); } catch { continue; }
        const nodes = parseCw(text);
        const namespaceMatch = /^\s*namespace\s*=\s*([A-Za-z0-9_]+)/m.exec(text);
        for (const node of nodes) {
          if (!['country_event', 'province_event', 'news_event'].includes(node.key) || !node.children) continue;
          const id = unquote(String(findNode(node.children, 'id')?.value ?? '')).trim();
          if (!id || !/^[A-Za-z0-9_.\-]+$/.test(id) || events.has(id)) continue;
          const titleKey = unquote(String(findNode(node.children, 'title')?.value ?? '')).trim();
          events.set(id, {
            id,
            titleKey,
            kind: node.key,
            namespace: namespaceMatch ? namespaceMatch[1] : id.split('.')[0],
            source,
            file: rel.split(path.sep).join('/'),
          });
        }
      }
    };
    if (mod) await scan(mod, 'mod');
    if (this.state.eu4Root) await scan(this.state.eu4Root, 'vanilla');
    // One localisation pass, then synchronous map lookups (translation() reads
    // the custom dictionary from disk on every call).
    const cjk = await this.localisation();
    const all = this.localisationAllCache;
    const items = [...events.values()].map((item) => ({
      ...item,
      title: (item.titleKey && (cjk.get(item.titleKey) || all?.get(item.titleKey))) || '',
    }));
    items.sort((a, b) => a.id.localeCompare(b.id));
    const data = {
      items,
      total: items.length,
      mod: items.filter((item) => item.source === 'mod').length,
      vanilla: items.filter((item) => item.source === 'vanilla').length,
      cachedAt: new Date(now).toISOString(),
    };
    this.eventCatalogCache = { key: rootKey, at: now, data };
    return data;
  }

  /** Two small real event blocks, used only as format references for create. */
  async eventExamples(count = 2): Promise<string[]> {
    const out: string[] = [];
    const roots: string[] = [];
    if (this.state.eu4Root) roots.push(this.state.eu4Root);
    const mod = this.modRoot();
    if (mod) roots.push(mod);
    for (const root of roots) {
      const files: string[] = [];
      await this.walkAsync(root, 'events', files, 8000);
      for (const rel of files) {
        if (!/\.txt$/i.test(rel)) continue;
        let text = '';
        try {
          text = await fs.promises.readFile(path.join(root, ...rel.split(path.posix.sep)), 'utf8');
        } catch {
          continue;
        }
        for (const node of parseCw(text)) {
          if (!node.children || !node.children.length) continue;
          if (!node.children.some((child) => child.key === 'id')) continue;
          out.push(clipLines(textOf([node]), 40));
          if (out.length >= count) return out;
        }
      }
    }
    return out;
  }

  /** A path relative to the mod root when inside it, else to the game root. */
  private relativeForFile(abs: string): string {
    const mod = this.modRoot();
    if (mod && this.isInside(mod, abs)) return normRel(path.relative(mod, abs));
    if (this.state.eu4Root) return normRel(path.relative(this.state.eu4Root, abs));
    return abs;
  }

  /** Exact province history file path; never let the AI search by id/name. */
  async provinceHistoryFile(id: number, name?: string): Promise<any> {
    const numeric = Number(id);
    if (!Number.isFinite(numeric) || numeric <= 0) return { error: 'invalid province id' };
    const roots: string[] = [];
    const mod = this.modRoot();
    if (mod) roots.push(mod);
    if (this.state.eu4Root) roots.push(this.state.eu4Root);
    for (const root of roots) {
      const files: string[] = [];
      await this.walkAsync(root, path.join('history', 'provinces'), files, 12000);
      for (const rel of files) {
        const base = path.posix.basename(rel.split(path.sep).join('/'));
        if (!new RegExp('^' + numeric + '(?:\\s*-.*)?\\.txt$', 'i').test(base)) continue;
        return { id: numeric, file: rel.split(path.sep).join('/'), exists: true };
      }
    }
    return { id: numeric, file: 'history/provinces/' + numeric + ' - ' + (name || numeric) + '.txt', exists: false };
  }

  /** Exact country history file path (TAG - CountryName.txt), with display name. */
  async countryHistoryFile(tag: string): Promise<any> {
    const upper = String(tag || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{3}$/.test(upper)) return { error: 'tag must be a three-character country tag' };
    const roots: string[] = [];
    const mod = this.modRoot();
    if (mod) roots.push(mod);
    if (this.state.eu4Root) roots.push(this.state.eu4Root);
    for (const root of roots) {
      const files: string[] = [];
      await this.walkAsync(root, path.join('history', 'countries'), files, 5000);
      for (const rel of files) {
        const base = path.posix.basename(rel.split(path.sep).join('/'));
        const match = new RegExp('^' + upper + '(?:\\s*-\\s*(.*))?\\.txt$', 'i').exec(base);
        if (!match) continue;
        return {
          tag: upper,
          file: rel.split(path.sep).join('/'),
          name: match[1] ? match[1].replace(/\.txt$/i, '').trim() : upper,
          exists: true,
        };
      }
    }
    return { tag: upper, file: 'history/countries/' + upper + ' - ' + upper + '.txt', name: upper, exists: false };
  }

  /** Find the exact national-ideas file for a tag (default <TAG>_ideas.txt). */
  async nationalIdeasFile(tag: string): Promise<any> {
    const upper = String(tag || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{3}$/.test(upper)) return { error: 'tag must be a three-character country tag' };
    const roots: string[] = [];
    const mod = this.modRoot();
    if (mod) roots.push(mod);
    if (this.state.eu4Root) roots.push(this.state.eu4Root);
    for (const root of roots) {
      const files: string[] = [];
      await this.walkAsync(root, path.join('common', 'ideas'), files, 5000);
      for (const rel of files) {
        if (!/\.txt$/i.test(rel)) continue;
        const base = path.posix.basename(rel.split(path.sep).join('/'));
        const abs = path.join(root, ...rel.split(path.posix.sep));
        let text = '';
        try { text = await fs.promises.readFile(abs, 'utf8'); } catch { continue; }
        if (!(new RegExp('\\b' + upper + '_ideas\\b', 'i').test(text) || base.toUpperCase().startsWith(upper + '_'))) continue;
        let mtimeMs = 0;
        let bytes = 0;
        try {
          const stat = await fs.promises.stat(abs);
          mtimeMs = stat.mtimeMs;
          bytes = stat.size;
        } catch { /* keep 0 so the client can still poll */ }
        // Re-parse only when the file (or the requested tag) changed. The cache
        // key includes the tag: one file holds many `<TAG>_ideas` groups.
        const cacheKey = abs + '|' + upper;
        const cached = this.ideasCache.get(cacheKey);
        const parsed = cached && cached.mtimeMs === mtimeMs ? cached.parsed : parseNationalIdeas(text, upper);
        if (!cached || cached.mtimeMs !== mtimeMs) this.ideasCache.set(cacheKey, { mtimeMs, parsed });
        // A file may mention the tag in a comment; only accept the file when the
        // requested group is really parsed out of it.
        if (!parsed.group || parsed.group.toUpperCase() !== upper + '_IDEAS') continue;
        // The Agent usually writes the ideas block and its localisation together;
        // a changed ideas file invalidates the cached translations so the
        // refreshed panel sees the new names instead of the old ones.
        if (this.ideasLocMtime !== mtimeMs) {
          this.ideasLocMtime = mtimeMs;
          this.localisationCache = null;
          this.localisationAllCache = null;
        }
        // Names/descriptions live in localisation, not in this file.
        const localised = await Promise.all(parsed.ideas.map(async (idea) => ({
          id: idea.id,
          name: await this.translation(idea.id),
          desc: await this.translation(idea.id + '_desc'),
          modifiers: idea.modifiers,
        })));
        return {
          tag: upper,
          file: rel.split(path.sep).join('/'),
          exists: true,
          mtimeMs,
          bytes,
          group: parsed.group,
          traditions: parsed.start,
          ambitionModifiers: parsed.bonus,
          ambition: parsed.bonus[0] || null,
          ideas: localised,
          flags: parsed.flags,
          warnings: parsed.warnings,
        };
      }
    }
    return {
      tag: upper,
      file: 'common/ideas/' + upper + '_ideas.txt',
      exists: false,
      mtimeMs: 0,
      bytes: 0,
      group: '',
      traditions: [],
      ambition: null,
      ambitionModifiers: [],
      ideas: [],
      flags: [],
      warnings: [upper + '_ideas block not found in common/ideas'],
    };
  }

  /**
   * Read one event/static modifier definition so the UI can edit its internal
   * stats (e.g. land_morale = 0.1). Read-only and async.
   */  async modifierForm(name: string): Promise<any> {    const target = String(name || '').trim();
    if (!target || !/^[A-Za-z0-9_]+$/.test(target)) return { error: 'modifier name is required' };
    const roots: Array<{ label: string; base: string }> = [];
    const mod = this.modRoot();
    if (mod) roots.push({ label: 'mod', base: mod });
    if (this.state.eu4Root) roots.push({ label: 'vanilla', base: this.state.eu4Root });
    for (const root of roots) {
      for (const dir of ['common/event_modifiers', 'common/static_modifiers']) {
        const files: string[] = [];
        await this.walkAsync(root.base, dir, files, 5000);
        for (const rel of files) {
          if (!/\.txt$/i.test(rel)) continue;
          const abs = path.join(root.base, ...rel.split(path.posix.sep));
          let text = '';
          try {
            text = await fs.promises.readFile(abs, 'utf8');
          } catch {
            continue;
          }
          if (!text.includes(target)) continue;
          const nodes = parseCw(text);
          const node = nodes.find((entry) => entry.key === target && entry.children);
          if (!node || !node.children) continue;
          const stats = node.children
            .filter((child) => !child.children && child.value !== null)
            .map((child) => ({ key: child.key, value: unquote(String(child.value)) }));
          return { name: target, file: this.relativeForFile(abs), stats, raw: textOf([node]) };
        }
      }
    }
    return { name: target, stats: [], error: 'modifier definition not found' };
  }

  saveMissions(input: { path?: string; nodes: any[] }): any {
    const modRoot = this.modRoot();
    if (!modRoot) return { error: 'mod directory is not configured' };
    const rel = normRel(String(input.path || path.posix.join('missions', 'zz_eu4_workbench_missions.txt')));
    const abs = toAbs(modRoot, rel);
    if (!abs) return { error: 'path escapes the mod directory' };
    const nodes = Array.isArray(input.nodes) ? input.nodes : [];
    const issues: ValidationIssue[] = [];
    const seen = new Set<string>();
    for (const node of nodes) {
      const id = String(node.id || '').trim();
      if (!/^[A-Za-z0-9_]+$/.test(id)) {
        issues.push({ severity: 'error', code: 'BAD_MISSION_ID', message: `非法任务 ID: ${id || '(empty)'}` });
        continue;
      }
      if (seen.has(id)) issues.push({ severity: 'error', code: 'DUPLICATE_MISSION_ID', message: `重复任务 ID: ${id}` });
      seen.add(id);
      for (const key of ['trigger', 'effect']) {
        if (node[key]) {
          const result = this.validateScript(String(node[key]), { scope: 'country' });
          for (const issue of result.issues) issues.push({ ...issue, key: `${id}.${key}` });
        }
      }
      for (const req of node.required || []) if (!nodes.some((n: any) => String(n.id) === String(req))) issues.push({ severity: 'warning', code: 'MISSING_REQUIRED', message: `任务 ${id} 的前置${req} 不在本次导出中。` });
    }
    if (issues.some((i) => i.severity === 'error')) return { error: 'validation failed', issues };
    const body = nodes.map((n: any) => {
      const lines: string[] = [];
      const id = String(n.id);
      lines.push(`\t${id} = {`);
      if (n.icon) lines.push(`\t\ticon = ${n.icon}`);
      if ((n.required || []).length) lines.push(`\t\trequired_missions = { ${n.required.map(String).join(' ')} }`);
      if (n.trigger) lines.push(`\t\ttrigger = {\n${indent(String(n.trigger), 3)}\n\t\t}`);
      if (n.effect) lines.push(`\t\teffect = {\n${indent(String(n.effect), 3)}\n\t\t}`);
      lines.push('\t}');
      return lines.join('\n');
    }).join('\n');
    const content = `# generated by EU4 Mod Workbench\nmissions = {\n${body}\n}\n`;
    try {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, 'utf8');
    } catch (e: any) {
      return { error: String(e && e.message ? e.message : e) };
    }
    return { ok: true, path: abs, relative: rel, issues, content };
  }

  listEventFiles(): any[] {
    const root = this.state.eu4Root;
    const mod = this.modRoot();
    const out: any[] = [];
    for (const [label, base] of [['vanilla', root], ['mod', mod]] as Array<[string, string | null]>) {
      if (!base) continue;
      const files: string[] = [];
      this.walk(base, 'events', files, 6000);
      for (const rel of files) out.push({ label, path: rel, absolute: path.join(base, ...rel.split(path.posix.sep)) });
    }
    return out;
  }

  eventGraph(namespace?: string): any {
    const records: any[] = [];
    for (const rec of this.listEventFiles()) {
      if (!/\.txt$/i.test(rec.path)) continue;
      try {
        records.push({ ...rec, text: fs.readFileSync(rec.absolute, 'utf8') });
      } catch {
        /* unreadable event file */
      }
    }
    return this.buildEventGraph(records, namespace);
  }
  /**
   * Async variant of `eventGraph`: event files are read concurrently with
   * `fs.promises`, so a large `events/` tree never blocks the Host event loop.
   * The renderer only receives JSON and never reads files itself.
   */
  async eventGraphAsync(namespace?: string): Promise<any> {
    this.assertHeap('eventGraph');
    const files = this.listEventFiles().filter((rec) => /\.txt$/i.test(rec.path));
    const loaded = await Promise.all(files.map(async (rec) => {
      try {
        return { ...rec, text: await fs.promises.readFile(rec.absolute, 'utf8') };
      } catch {
        return null;
      }
    }));
    const graph = this.buildEventGraph(loaded.filter((rec) => rec !== null) as any[], namespace);
    await this.enrichEventGraphTags(graph);
    return this.appendDecisionGraph(graph);
  }

  /** Decision files across the current mod and vanilla (`decisions/*.txt`). */
  listDecisionFiles(): Array<{ label: string; path: string; absolute: string }> {
    const root = this.state.eu4Root;
    const mod = this.modRoot();
    const out: any[] = [];
    for (const [label, base] of [['vanilla', root], ['mod', mod]] as Array<[string, string | null]>) {
      if (!base) continue;
      const files: string[] = [];
      this.walk(base, 'decisions', files, 4000);
      for (const rel of files) out.push({ label, path: rel, absolute: path.join(base, ...rel.split(path.posix.sep)) });
    }
    return out;
  }

  /** Parse every `country_decisions = { <id> = { … } }` block in one file. */
  private parseDecisions(text: string, rec: { label: string; path: string; absolute: string }): any[] {
    const out: any[] = [];
    for (const node of parseCw(text)) {
      if (!/_decisions$/i.test(node.key) || !node.children) continue;
      for (const child of node.children) {
        if (!child.children || !child.key) continue;
        if (['potential', 'allow', 'effect', 'ai_will_do', 'trigger', 'modifier', 'major', 'icon'].includes(child.key)) continue;
        const id = child.key;
        if (!/^[A-Za-z0-9_.\-]+$/.test(id)) continue;
        const potentialNode = findNode(child.children, 'potential');
        const allowNode = findNode(child.children, 'allow');
        const effectNode = findNode(child.children, 'effect');
        const aiNode = findNode(child.children, 'ai_will_do');
        const factorNode = aiNode ? findNode(aiNode.children || [], 'factor') : null;
        const factorRaw = factorNode?.value ?? aiNode?.value ?? '';
        const factor = Number(unquote(String(factorRaw || '')));
        const eventRefs: string[] = [];
        const collectRefs = (children: CwNode[] | null): void => {
          for (const c of children || []) {
            if (['country_event', 'province_event', 'news_event', 'trigger_event'].includes(c.key)) {
              const target = c.children ? findNode(c.children, 'id')?.value : c.value;
              if (target) eventRefs.push(unquote(String(target)));
            }
            if (c.children) collectRefs(c.children);
          }
        };
        collectRefs(effectNode?.children || null);
        out.push({
          id,
          file: rec.path.split(path.sep).join('/'),
          source: rec.label,
          path: rec.absolute,
          line: child.line,
          potential: potentialNode?.children ? conditionsFromNodes(potentialNode.children) : [],
          allow: allowNode?.children ? conditionsFromNodes(allowNode.children) : [],
          effects: effectNode?.children ? effectsFromNodes(effectNode.children) : [],
          ai_will_do: Number.isFinite(factor) ? factor : 1,
          icon: unquote(String(findNode(child.children, 'icon')?.value || '')),
          tags: collectTagValues(potentialNode?.children || null),
          eventRefs: [...new Set(eventRefs)],
        });
      }
    }
    return out;
  }

  /**
   * Country decisions for the Decisions tab. `tag` filters by the `tag =` value
   * inside `potential`; decisions without a tag condition apply to everyone.
   */
  async decisionsForTag(tag = '', force = false): Promise<any> {
    const mod = this.modRoot();
    const key = (mod || '') + '|' + (this.state.eu4Root || '');
    const now = Date.now();
    let list: any[];
    if (!force && this.decisionsCache && this.decisionsCache.key === key && now - this.decisionsCache.at < 30_000) {
      list = this.decisionsCache.data;
    } else {
      const byId = new Map<string, any>();
      for (const rec of this.listDecisionFiles()) {
        if (!/\.txt$/i.test(rec.path)) continue;
        let text = '';
        try { text = await fs.promises.readFile(rec.absolute, 'utf8'); } catch { continue; }
        for (const item of this.parseDecisions(text, rec)) byId.set(item.id, item); // mod wins
      }
      const cjk = await this.localisation();
      const all = this.localisationAllCache;
      list = [...byId.values()].map((item) => {
        const titleKey = item.id + '_title';
        const descKey = item.id + '_desc';
        return {
          ...item,
          title_cn: cjk.get(titleKey) || all?.get(titleKey) || '',
          desc_cn: cjk.get(descKey) || all?.get(descKey) || '',
        };
      });
      list.sort((a, b) => a.id.localeCompare(b.id));
      this.decisionsCache = { key, at: now, data: list };
    }
    const wanted = String(tag || '').trim().toUpperCase();
    const valid = /^[A-Z0-9]{3}$/.test(wanted);
    const items = valid ? list.filter((item) => !item.tags.length || item.tags.includes(wanted)) : list;
    return { items, total: items.length, all: list.length, tag: valid ? wanted : null };
  }

  /** Add decision nodes + dashed decision→event edges to the event graph. */
  private async appendDecisionGraph(graph: any): Promise<any> {
    const decisions = await this.decisionsForTag('');
    const nodes = [...(graph.nodes || [])];
    const edges = [...(graph.edges || [])];
    const eventIds = new Set(nodes.map((node: any) => node.id));
    for (const item of decisions.items) {
      if (!item.eventRefs || !item.eventRefs.length) continue; // only linked decisions
      const nodeId = 'decision:' + item.id;
      if (nodes.some((node: any) => node.id === nodeId)) continue;
      nodes.push({
        id: nodeId,
        kind: 'decision',
        title: item.title_cn || item.id,
        desc: item.desc_cn || '',
        edges: item.eventRefs.map((to: string) => ({ from: nodeId, to, option: 'decision', line: item.line, dashed: true, missing: !eventIds.has(to) })),
        source: item.source,
        path: item.path,
        line: item.line,
        namespace: 'decision',
        triggerTags: item.tags || [],
        fireOnlyOnce: false,
        major: false,
        isTriggeredOnly: false,
        special: false,
        isDecision: true,
        depth: 0,
      });
      for (const to of item.eventRefs) {
        edges.push({ from: nodeId, to, option: 'decision', line: item.line, dashed: true, missing: !eventIds.has(to) });
      }
    }
    return { ...graph, nodes, edges, total: nodes.length, missingCount: edges.filter((edge: any) => edge.missing).length };
  }

  /**
   * Events referenced from `history/countries/<TAG>.txt` are bound to that tag
   * even when neither namespace nor trigger mentions it (startup events).
   */
  async historyTagBindings(): Promise<Map<string, string[]>> {
    const mod = this.modRoot();
    const key = (mod || '') + '|' + (this.state.eu4Root || '');
    const now = Date.now();
    if (this.historyBindCache && this.historyBindCache.key === key && now - this.historyBindCache.at < 60_000) {
      return this.historyBindCache.data;
    }
    const map = new Map<string, string[]>();
    const scan = async (root: string) => {
      const files: string[] = [];
      await this.walkAsync(root, path.join('history', 'countries'), files, 4000);
      for (const rel of files) {
        if (!/\.txt$/i.test(rel)) continue;
        const base = path.posix.basename(rel.split(path.sep).join('/'));
        const tagMatch = /^([A-Za-z0-9]{3})(?:\s*-\s*.*)?\.txt$/i.exec(base);
        const tag = tagMatch ? tagMatch[1].toUpperCase() : '';
        if (!tag) continue;
        let text = '';
        try { text = await fs.promises.readFile(path.join(root, ...rel.split(path.posix.sep)), 'utf8'); } catch { continue; }
        const re = /country_event\s*=\s*\{\s*id\s*=\s*([A-Za-z0-9_.\-]+)/g;
        let match: RegExpExecArray | null;
        while ((match = re.exec(text))) {
          const id = match[1];
          const tags = map.get(id) || [];
          if (!tags.includes(tag)) tags.push(tag);
          map.set(id, tags);
        }
      }
    };
    if (mod) await scan(mod);
    if (this.state.eu4Root) await scan(this.state.eu4Root);
    this.historyBindCache = { key, at: now, data: map };
    return map;
  }

  /** Merge history binds into each event node's tag list (graph tag filter). */
  private async enrichEventGraphTags(graph: any): Promise<any> {
    const binds = await this.historyTagBindings();
    for (const node of graph.nodes || []) {
      const tags = new Set<string>(Array.isArray(node.triggerTags) ? node.triggerTags : []);
      for (const tag of binds.get(node.id) || []) tags.add(tag);
      for (const tag of node.scriptTags || []) tags.add(tag);
      node.triggerTags = [...tags];
    }
    return graph;
  }

  /**
   * Drop every scan cache and (optionally) reindex the vanilla tree. The Web
   * panel calls this after the Agent writes files, so new `.txt` files show up
   * immediately in the event graph / decisions / ideas panels.
   */
  refreshCaches(reindexVanilla = false): any {
    this.assertHeap('refreshCaches');
    this.localisationCache = null;
    this.localisationAllCache = null;
    this.provinceDictionaryCache = null;
    this.provinceDictionaryStats = null;
    this.eventCatalogCache = null;
    this.decisionsCache = null;
    this.historyBindCache = null;
    this.ideasCache.clear();
    this.ideasLocMtime = 0;
    if (reindexVanilla) {
      this.state.vanillaFiles = [];
      this.reindex();
    }
    return {
      eu4Root: this.state.eu4Root || '',
      modRoot: this.modRoot() || '',
      modFiles: this.listEventFiles().filter((rec) => rec.label === 'mod').length,
      reindexedVanilla: reindexVanilla,
    };
  }

  /** Inspect the target country history file for an existing date block. */
  async historyBindState(tag: string, date: string, eventId: string): Promise<any> {
    const t = String(tag || '').trim().toUpperCase();
    const when = String(date || '').trim() || '1437.1.1';
    const id = String(eventId || '').trim();
    if (!/^[A-Z0-9]{3}$/.test(t)) return { tag: t, exists: false, file: '', dateBlockCount: 0, alreadyBound: false };
    const roots = [this.modRoot(), this.state.eu4Root].filter(Boolean) as string[];
    const dateRe = new RegExp(when.replace(/\./g, '\\.') + '\\s*=\\s*\\{', 'g');
    const boundRe = new RegExp('country_event\\s*=\\s*\\{\\s*id\\s*=\\s*' + id.replace(/\./g, '\\.'));
    for (const root of roots) {
      const files: string[] = [];
      await this.walkAsync(root, path.join('history', 'countries'), files, 4000);
      for (const rel of files) {
        const base = path.posix.basename(rel.split(path.sep).join('/'));
        const match = /^([A-Za-z0-9]{3})(?:\s*-\s*.*)?\.txt$/i.exec(base);
        if (!match || match[1].toUpperCase() !== t) continue;
        const abs = path.join(root, ...rel.split(path.posix.sep));
        let text = '';
        try { text = await fs.promises.readFile(abs, 'utf8'); } catch { continue; }
        return {
          tag: t,
          exists: true,
          file: abs,
          dateBlockCount: (text.match(dateRe) || []).length,
          alreadyBound: Boolean(id) && boundRe.test(text),
        };
      }
    }
    return { tag: t, exists: false, file: '', dateBlockCount: 0, alreadyBound: false };
  }

  /** A legal Mod directory must contain descriptor.mod. */
  verifyModDirectory(): any {
    const modRoot = this.modRoot() || '';
    const descriptor = modRoot ? path.join(modRoot, 'descriptor.mod') : '';
    const exists = Boolean(descriptor) && existsFile(descriptor);
    return {
      ok: exists,
      modRoot,
      descriptor,
      exists,
      eu4Root: this.state.eu4Root || '',
      message: exists
        ? 'Mod 目录有效：' + descriptor
        : '写入失败：目标路径不是合法的 Mod 目录（缺少 descriptor.mod），请检查设置！',
    };
  }

  /**
   * on_startup fallback: the dedicated on_actions file must contain the event
   * for the target tag, guarded by `exists = <TAG>`.
   */
  async onActionBindState(tag: string, eventId: string): Promise<any> {
    const rel = 'common/on_actions/zz_eu4_workbench_on_actions.txt';
    const absolute = this.absoluteModPath(rel);
    const t = String(tag || '').trim().toUpperCase();
    const id = String(eventId || '').trim();
    let text = '';
    try { text = await fs.promises.readFile(absolute, 'utf8'); } catch {
      return { file: rel, absolute, exists: false, hasOnStartup: false, bound: false, tag: t };
    }
    const hasOnStartup = /(^|\n)\s*on_startup\s*=\s*\{/.test(text);
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const hasEvent = Boolean(id) && new RegExp('country_event\\s*=\\s*\\{\\s*id\\s*=\\s*' + escaped).test(text);
    const hasTag = Boolean(t) && (new RegExp('exists\\s*=\\s*' + t).test(text)
      || new RegExp('\\b' + t + '\\s*=\\s*\\{\\s*country_event').test(text));
    return { file: rel, absolute, exists: true, hasOnStartup, hasEvent, hasTag, bound: hasOnStartup && hasEvent && hasTag, tag: t };
  }

  /** Read the top-level `namespace = X` from a file (EU4 uses no `add_`). */
  namespaceOfFile(rel: string): any {    const absolute = this.absoluteModPath(rel);
    try {
      const text = fs.readFileSync(absolute, 'utf8');
      const match = /^\s*(?:add_)?namespace\s*=\s*([A-Za-z0-9_]+)/m.exec(text);
      return {
        absolute,
        exists: true,
        namespace: match ? match[1] : '',
        syntaxOk: !/^\s*add_namespace\s*=/m.test(text),
      };
    } catch {
      return { absolute, exists: false, namespace: '', syntaxOk: true };
    }
  }

  /** Active game language from `settings.txt` (e.g. l_english). */
  activeLanguage(): string {
    const dir = this.eu4UserDir();
    if (!dir) return 'l_english';
    try {
      const text = fs.readFileSync(path.join(dir, 'settings.txt'), 'latin1');
      const match = /language\s*=\s*"([^"]+)"/.exec(text);
      return match ? match[1] : 'l_english';
    } catch {
      return 'l_english';
    }
  }

  /** UTF-8 BOM + exact key check for a localisation file. */
  localisationFileState(rel: string, keys: string[]): any {
    const absolute = this.absoluteModPath(rel);
    let bytes = Buffer.alloc(0);
    try { bytes = fs.readFileSync(absolute); } catch {
      return { file: rel, absolute, exists: false, size: 0, bom: false, keys, keyOk: false };
    }
    const text = bytes.toString('utf8').replace(/^\uFEFF/, '');
    const keyOk = keys.length > 0 && keys.every((key) => new RegExp('(^|\\n)\\s*"?' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"?\\s*:\\s*0\\s+"').test(text));
    const bom = bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF;
    return { file: rel, absolute, exists: true, size: bytes.length, bom, keys, keyOk, ok: bom && bytes.length > 3 && keyOk };
  }

  /** Absolute target path under the Mod root (display + read-back). */
  absoluteModPath(rel: string): string {
    const modRoot = this.modRoot() || '';
    const input = String(rel || '').trim();
    if (!input) return '';
    return path.isAbsolute(input) ? path.normalize(input) : path.resolve(modRoot || process.cwd(), input);
  }

  /**
   * Read-back verification after the Agent claims a write: the file must exist
   * under the Mod root and contain (or, for delete, no longer contain) the id.
   */
  async readBack(input: any): Promise<any> {
    const targetType = String(input?.targetType || '');
    const targetId = String(input?.targetId || '').trim();
    const action = String(input?.action || 'modify');
    const rel = String(input?.targetFile || '');
    const removedNodeIds = (Array.isArray(input?.removedNodeIds) ? input.removedNodeIds : [])
      .map((id: any) => String(id || '').trim()).filter(Boolean);
    const modCheck = this.verifyModDirectory();
    if (!modCheck.ok) return { ok: false, mode: 'blocked', found: false, exists: false, ...modCheck, error: modCheck.message };
    const absolute = this.absoluteModPath(rel);
    if (!this.checkPath(absolute).underMod) {
      return { ok: false, mode: 'blocked', found: false, exists: false, absolute, modRoot: modCheck.modRoot, error: '目标路径不在 Mod 目录内：' + absolute };
    }
    const looksLikePath = (value: string): boolean => /[\\/]/.test(value) || /\.txt$/i.test(value);
    const deleteFile = input?.deleteFile === true || (action === 'delete' && looksLikePath(targetId));
    // Whole-file deletion: success means the file no longer exists.
    if (deleteFile) {
      let exists = false;
      let size = 0;
      try {
        const stat = await fs.promises.stat(absolute);
        exists = stat.isFile();
        size = stat.size;
      } catch { /* missing = success */ }
      return {
        ok: !exists,
        found: exists,
        exists,
        absolute,
        size,
        mode: 'file',
        operation: 'delete-file',
        targetType,
        targetId,
        action,
        message: exists ? '✖ 删除失败，文件仍存在（' + size + ' bytes）' : '✅ 文件已成功删除',
      };
    }
    let text = '';
    let size = 0;
    try {
      text = await fs.promises.readFile(absolute, 'utf8');
      size = (await fs.promises.stat(absolute)).size;
    } catch {
      return {
        ok: false, mode: 'node', operation: 'missing', found: false, exists: false,
        absolute, size: 0, modRoot: modCheck.modRoot,
        error: '文件不存在：' + absolute, message: '✖ 文件不存在：' + absolute,
      };
    }
    const escaped = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Namespace: EU4 uses `namespace = X` (never `add_namespace`). Missing or
    // mismatched namespace means the game ignores the event.
    const expectedNamespace = targetType === 'event' && targetId && !looksLikePath(targetId)
      ? targetId.split('.')[0]
      : '';
    const namespaceMatch = /^\s*(?:add_)?namespace\s*=\s*([A-Za-z0-9_]+)/m.exec(text);
    const namespace = namespaceMatch ? namespaceMatch[1] : '';
    const namespaceSyntax = /^\s*add_namespace\s*=/m.test(text);
    const namespaceOk = !expectedNamespace || (namespace === expectedNamespace && !namespaceSyntax);
    // Startup trigger wiring: the country history file must contain the bind.
    const historyTag = String(input?.historyTag || '').trim().toUpperCase();
    const bindDate = String(input?.bindDate || '').trim() || '1437.1.1';
    let trigger: any = null;
    if (targetType === 'event' && /^[A-Z0-9]{3}$/.test(historyTag)) {      const state = await this.historyBindState(historyTag, bindDate, targetId);
      const onAction = await this.onActionBindState(historyTag, targetId);
      const expected = action !== 'delete' && String(input?.triggerMode || '') === 'startup';
      const historyOk = Boolean(state.exists && state.alreadyBound);
      trigger = {
        ...state,
        history: { ...state, ok: historyOk },
        onAction,
        expected,
        bindDate,
        ok: expected ? Boolean(historyOk && onAction.exists && onAction.bound) : true,
      };
    }
    // Province history: owner/controller consistency + date-block placement.
    let province: any = null;
    if (targetType === 'province_history') {
      const parsed = parseProvinceHistory(text);
      const expectedOwner = String(input?.owner || '').trim().toUpperCase();
      province = {
        ...parsed,
        expectedOwner,
        ownerMatches: !expectedOwner || parsed.owner === expectedOwner,
      };
    }
    // Opening diplomacy: native blocks, war files, or on_startup effects.
    let diplomacy: any = null;    if (targetType === 'diplomacy') {
      const rel = String(input?.relationType || '').trim().toLowerCase();
      const a = String(input?.tagA || '').trim().toUpperCase();
      const b = String(input?.tagB || '').trim().toUpperCase();
      const expectedDate = String(input?.startDate || '').trim();
      const balanced = (text.match(/\{/g) || []).length === (text.match(/\}/g) || []).length;
      if (rel === 'war') {
        const war = parseWarHistory(text, a, b);
        diplomacy = { ...war, type: 'war', tagA: a, tagB: b, balanced,
          expectedCb: String(input?.extraParams || '').trim(),
          cbMatches: !input.extraParams || war.casusBelli === String(input.extraParams).trim() };
      } else if (rel === 'truce' || rel === 'rival') {
        const effect = rel === 'truce' ? 'add_truce_with' : 'add_historical_rival';
        const forward = new RegExp(effect + '\\s*=\\s*' + b).test(text);
        const backward = new RegExp(effect + '\\s*=\\s*' + a).test(text);
        diplomacy = { type: rel, tagA: a, tagB: b, balanced, forward, backward, found: forward && backward };
      } else {
        const blocks = parseDiplomacyHistory(text);
        const match = blocks.find((block) => block.type === rel
          && ((block.first === a && block.second === b) || (block.first === b && block.second === a)));
        const directional = ['vassal', 'union', 'guarantee'].includes(rel);
        diplomacy = {
          type: rel, tagA: a, tagB: b, balanced,
          found: Boolean(match),
          first: match?.first || '',
          second: match?.second || '',
          startDate: match?.startDate || '',
          startDateOk: !match || !expectedDate || match.startDate === expectedDate,
          ordered: Boolean(match && match.first === a && match.second === b),
          directionOk: !directional || Boolean(match && match.first === a && match.second === b),
        };
      }
      if (!diplomacy.balanced) diplomacy.warning = '⚠ 括号不闭合';
      else if (!diplomacy.found) diplomacy.warning = '⚠ 未找到对应的外交关系块';
      else if (rel === 'war' && !diplomacy.cbMatches) diplomacy.warning = '⚠ casus_belli 与配置不一致';
      else if (diplomacy.startDateOk === false) diplomacy.warning = '⚠ start_date 与配置不一致';
      else if (diplomacy.directionOk === false) diplomacy.warning = '⚠ first/second 方向与配置相反（附庸 first 必须是宗主）';
    }
    // Event localisation: Chinese file must be UTF-8 BOM and contain .t/.d.
    let localisation: any = null;
    if (targetType === 'event' && input?.localisationFile) {
      const simpFile = String(input.localisationFile);
      const keys = [targetId + '.t', targetId + '.d'];
      const simp = this.localisationFileState(simpFile, keys);
      let active: any = null;
      if (this.activeLanguage() !== 'l_simp_chinese') {
        active = this.localisationFileState('localisation/zz_eu4_workbench_' + this.activeLanguage() + '.yml', keys);
      }
      const ok = Boolean(simp.exists && simp.bom && simp.size > 3 && simp.keyOk
        && (!active || (active.exists && active.bom && active.size > 3 && active.keyOk)));
      localisation = {
        file: simpFile, ...simp, activeFile: active ? active.file : '', active,
        ok,
        warning: !simp.exists ? '⚠ 缺少本地化 .yml'
          : !simp.bom ? '⚠ 本地化 .yml 缺少 UTF-8 BOM'
          : simp.size <= 3 ? '⚠ 本地化 .yml 小于 4 字节（无 BOM/内容）'
          : !simp.keyOk ? '⚠ 本地化 .yml 缺少 ' + keys.join(' / ')
          : active && !active.ok ? '⚠ 游戏语言 ' + this.activeLanguage() + ' 的 .yml 缺少中文键（会显示英文）'
          : '',
      };
    }
    /** Does the file still contain `id = { ... }` (events use the AST)? */
    const containsId = (id: string): boolean => {
      if (!id || looksLikePath(id)) return false;
      if (targetType === 'event') {
        return parseCw(text).some((node) => ['country_event', 'province_event', 'news_event'].includes(node.key)
          && node.children && unquote(String(findNode(node.children, 'id')?.value ?? '')) === id);
      }
      return new RegExp('(^|\\n)\\s*"?' + escaped(id) + '"?\\s*=\\s*\\{').test(text);
    };
    // Node deletion: success means the id is gone (file itself stays).
    if (action === 'delete') {
      const still = containsId(targetId);
      return {
        ok: !still,
        found: still,
        exists: true,
        absolute,
        size,
        mode: 'node',
        operation: 'delete-node',
        targetType,
        targetId,
        action,
        namespace,
        namespaceOk,
        trigger,
        message: still
          ? '✖ 删除失败：节点 ' + targetId + ' 仍存在（文件 ' + size + ' bytes）'
          : '✅ 节点 ' + targetId + ' 已成功移除（文件 ' + size + ' bytes）',
      };
    }
    // List editor (missions etc.) that removed nodes in this edit.
    if (removedNodeIds.length) {
      const still = removedNodeIds.filter((id: string) => containsId(id));
      return {
        ok: still.length === 0,
        found: still.length > 0,
        exists: true,
        absolute,
        size,
        mode: 'nodes',
        operation: 'delete-nodes',
        targetType,
        targetId,
        action,
        removedNodeIds,
        message: still.length
          ? '✖ 删除失败：' + still.join(', ') + ' 仍存在（文件 ' + size + ' bytes）'
          : '✅ 节点 ' + removedNodeIds.join(', ') + ' 已成功移除（文件 ' + size + ' bytes）',
      };
    }
    // create / modify: the target should exist. A path-like targetId means the
    // queue item is file-level (e.g. a mission tree keyed by its file).
    const pathTarget = looksLikePath(targetId);
    const found = targetType === 'province_history'
      ? Boolean(province?.owner)
      : targetType === 'diplomacy'
        ? Boolean(diplomacy?.found)
        : (pathTarget ? true : containsId(targetId));
    const ok = found && namespaceOk && (!trigger || trigger.ok)
      && (!province || province.ownerMatches)
      && (!diplomacy || (diplomacy.balanced && diplomacy.startDateOk !== false && diplomacy.directionOk !== false))
      && (!localisation || localisation.ok);
    const extras: string[] = [];
    if (expectedNamespace) extras.push('namespace ' + (namespaceOk ? '✅' : '✖'));
    if (trigger) extras.push('开局引线 ' + (trigger.ok ? '✅' : '✖'));
    if (province) {
      if (province.mismatch) extras.push('⚠ owner/controller 不一致');
      if (!province.inDateBlock) extras.push('⚠ 不在日期块内');
      if (!province.ownerMatches) extras.push('✖ owner 不是 ' + province.expectedOwner);
    }
    if (diplomacy) {
      extras.push('外交关系 ' + (diplomacy.found ? '✅' : '✖'));
      if (diplomacy.warning) extras.push(diplomacy.warning);
      if (diplomacy.balanced === false) extras.push('✖ 括号不闭合');
    }
    if (localisation) {
      extras.push('本地化 ' + (localisation.ok ? '✅' : '✖'));
      if (localisation.warning) extras.push(localisation.warning);
    }
    return {
      ok,
      found,
      exists: true,
      absolute,
      size,
      mode: 'node',
      operation: action === 'create' ? 'create' : 'modify',
      targetType,
      targetId,
      action,
      namespace,
      namespaceExpected: expectedNamespace,
      namespaceOk,
      namespaceSyntax,
      trigger,
      province,
      diplomacy,
      localisation,
      message: (found
        ? (pathTarget ? '✅ 文件存在（' + size + ' bytes）' : '✅ ' + targetId + ' 已找到（文件 ' + size + ' bytes）')
        : '✖ 未找到 ' + targetId + '（文件 ' + size + ' bytes）')
        + (extras.length ? '；' + extras.join('；') : ''),
    };
  }

  /** Path guard: an Agent write must land under the Mod root, never vanilla. */
  checkPath(target: string): any {
    const input = String(target || '').trim();
    const modRoot = this.modRoot() || '';
    const eu4Root = this.state.eu4Root || '';
    const absolute = path.isAbsolute(input)
      ? path.normalize(input)
      : path.resolve(modRoot || process.cwd(), input);
    const under = (base: string): boolean => Boolean(base) && (absolute === path.normalize(base) || absolute.startsWith(path.normalize(base) + path.sep));
    return {
      input,
      absolute,
      modRoot,
      eu4Root,
      underMod: under(modRoot),
      underVanilla: under(eu4Root),
      ok: under(modRoot),
    };
  }

  /** Scanner diagnostics for the UI / self-check console output. */
  async scanReport(): Promise<any> {
    const events = this.listEventFiles();
    const modEvents = events.filter((rec) => rec.label === 'mod');
    const missionFiles = this.listMissionFiles();
    const decisions = await this.decisionsForTag('');
    const ideas: string[] = [];
    const mod = this.modRoot();
    if (mod) await this.walkAsync(mod, path.join('common', 'ideas'), ideas, 3000);
    return {
      eu4Root: this.state.eu4Root || '',
      modRoot: mod || '',
      modCheck: this.verifyModDirectory(),
      events: {
        total: events.length,
        mod: modEvents.length,
        vanilla: events.length - modEvents.length,
        modFiles: modEvents.map((rec) => rec.absolute),
      },
      missions: { mod: missionFiles.length, files: missionFiles.map((rec) => rec.absolute) },
      decisions: { total: decisions.all, mod: decisions.items.filter((item: any) => item.source === 'mod').length },
      ideas: { modFiles: ideas.length, files: ideas.map((rel) => path.join(mod || '', ...rel.split(path.posix.sep))) },
    };
  }

  private buildEventGraph(records: any[], namespace?: string): any {
    const ns = String(namespace || '').trim();
    const allEvents = new Map<string, any>();
    const knownIds = new Set<string>();
    const fileRecords: any[] = [];
    for (const rec of records) {
      const text = String(rec.text || '');
      if (!/country_event|province_event|news_event/.test(text)) continue;
      const nodes = parseCw(text);
      const topEvents = nodes.filter((node) => ['country_event', 'province_event', 'news_event'].includes(node.key) && node.children && findNode(node.children, 'id')?.value);
      for (const node of topEvents) {
        const id = findNode(node.children || [], 'id')?.value;
        if (id) knownIds.add(unquote(id));
      }
      const nsMatch = /^\s*namespace\s*=\s*([A-Za-z0-9_]+)/m.exec(text);
      const fileNamespace = nsMatch ? nsMatch[1] : '';
      if (ns) {
        if (!nsMatch || nsMatch[1] !== ns) {
          const hasNsEvent = topEvents.some((node) => String(findNode(node.children || [], 'id')?.value || '').startsWith(ns + '.'));
          if (!hasNsEvent) continue;
        }
      }
      const events: any[] = [];
      for (const node of topEvents) {
        if (!node.children) continue;
        const idNode = findNode(node.children, 'id');
        if (!idNode || !idNode.value) continue;
        const id = unquote(idNode.value);
        const edges: any[] = [];
        const collectEdges = (children: CwNode[], optionName: string): void => {
          for (const child of children) {
            let nextOption = optionName;
            if (child.key === 'option') {
              nextOption = findNode(child.children || [], 'name')?.value || optionName;
            }
            if (child.key === 'trigger_event') {
              let target = '';
              if (child.value) target = unquote(child.value);
              else if (child.children) target = findNode(child.children, 'id')?.value || '';
              if (target) edges.push({ from: id, to: unquote(target), option: nextOption, line: child.line });
            } else if (['country_event', 'province_event', 'news_event'].includes(child.key) && child.children) {
              const target = findNode(child.children, 'id')?.value || '';
              if (target) edges.push({ from: id, to: unquote(target), option: nextOption, line: child.line });
            }
            if (child.children) collectEdges(child.children, nextOption);
          }
        };
        collectEdges(node.children, 'root');
        const trigger = findNode(node.children, 'trigger');
        const fireOnlyOnce = isYesNode(findNode(node.children, 'fire_only_once'));
        const major = isYesNode(findNode(node.children, 'major'));
        // Any `tag = X` anywhere in the block (trigger, potential, option trigger,
        // immediate …) counts as a tag association, not just the top trigger.
        const scriptTags = collectTagValues(node.children);
        events.push({
          id,
          kind: node.key,
          title: findNode(node.children, 'title')?.value || id,
          desc: findNode(node.children, 'desc')?.value || '',
          edges,
          source: rec.label,
          path: rec.absolute,
          line: node.line,
          namespace: fileNamespace || id.split('.')[0] || '',
          triggerTags: [...new Set([...collectTagValues(trigger?.children || null), ...scriptTags])],
          scriptTags,
          fireOnlyOnce,
          major,
          isTriggeredOnly: isYesNode(findNode(node.children, 'is_triggered_only')),
          special: fireOnlyOnce || major,
        });
      }
      if (events.length) {
        for (const e of events) allEvents.set(e.id, e);
        fileRecords.push({ path: rec.absolute, relative: rec.path, label: rec.label, events });
      }
    }
    const ids = knownIds;
    for (const e of allEvents.values()) for (const edge of e.edges) edge.missing = !ids.has(edge.to);
    const nodes = [...allEvents.values()];
    const edges = nodes.flatMap((n) => n.edges.map((e: any) => ({ ...e, missing: !ids.has(e.to) })));
    const depth = new Map<string, number>();
    const incoming = new Map<string, number>();
    for (const e of edges) incoming.set(e.to, (incoming.get(e.to) || 0) + 1);
    const queue = nodes.filter((n) => !incoming.has(n.id)).map((n) => n.id);
    for (const id of queue) depth.set(id, 0);
    for (let i = 0; i < queue.length; i += 1) {
      const id = queue[i];
      for (const e of edges.filter((x: any) => x.from === id)) {
        const d = (depth.get(id) || 0) + 1;
        if (d > (depth.get(e.to) || 0)) depth.set(e.to, d);
        if (!queue.includes(e.to)) queue.push(e.to);
      }
    }
    const graph = {
      namespace: ns || null,
      nodes: nodes.map((n) => ({ ...n, depth: depth.get(n.id) || 0 })),
      edges,
      files: fileRecords.length,
      missingCount: edges.filter((e: any) => e.missing).length,
    };
    return { ...graph, total: nodes.length };
  }

  /**
   * Filter events by category and by the shared country tag.
   *
   * A tag match follows the documented rule:
   *  - the event file's `namespace` contains the tag (case-insensitive), or
   *  - the event's `trigger` block contains `tag = <TAG>` at any nesting depth.
   *
   * `activeTagOnly` falls back to the tag persisted by the UI when `tag` is
   * omitted, so the model can query the tag the user is looking at now. Event
   * files are read asynchronously and nothing is written.
   */
  async queryEvents(input: { namespace?: string; category?: string; tag?: string; activeTagOnly?: boolean } = {}): Promise<any> {
    const requested = String(input.tag || (input.activeTagOnly ? this.state.activeTag || '' : '')).trim().toUpperCase();
    const tag = /^[A-Z0-9]{3}$/.test(requested) ? requested : null;
    const category = input.category === 'regular' || input.category === 'special' ? input.category : 'all';
    const graph = await this.eventGraphAsync(input.namespace ? String(input.namespace) : undefined);
    return filterEventGraph(graph, { category, tag });
  }

  /* --------------------------- tools --------------------------- */

  probeTools(): ToolStatus[] {
    const out: ToolStatus[] = [];
    const mcpUrl = this.config.clausewitzMcpUrl || process.env.CLAUSEWITZ_MCP_URL;
    const mcpCommand = this.config.clausewitzMcpCommand || 'clausewitz-mcp';
    const commandPath = this.findExecutable(mcpCommand);
    if (mcpUrl) {
      out.push({ id: 'clausewitz-mcp', name: 'clausewitz-mcp (HTTP)', status: 'unreachable', reason: '正在探测…', url: mcpUrl });
    } else if (commandPath) {
      out.push({ id: 'clausewitz-mcp', name: 'clausewitz-mcp', status: 'installed', reason: '可执行文件存在，但未配置 MCP URL 或适配器连接。', path: commandPath });
    } else {
      out.push({ id: 'clausewitz-mcp', name: 'clausewitz-mcp', status: 'not-installed', reason: '未在 PATH 中找到 clausewitz-mcp，且未配置 HTTP 端点。' });
    }
    const gui = [
      ['eu4-mod-editing-tool', 'Eu4-Mod-Editing-Tool', this.config.eu4ModEditingToolPath],
      ['emt', 'EMT', this.config.emtPath],
      ['paradoxcode', 'ParadoxCode', this.config.paradoxCodePath],
    ] as Array<[string, string, string | undefined]>;
    for (const [id, name, configured] of gui) {
      if (!configured) out.push({ id, name, status: 'not-configured', reason: '路径未配置（可在插件 Config 中填写）。' });
      else if (existsFile(configured) || existsDir(configured)) out.push({ id, name, status: 'installed', reason: '已找到程序路径；点击“打开”才会启动。', path: configured });
      else out.push({ id, name, status: 'not-installed', reason: '配置的路径不存在。', path: configured });
    }
    return out;
  }

  async probeMcp(): Promise<ToolStatus[]> {
    const out = this.probeTools();
    const mcp = out.find((t) => t.id === 'clausewitz-mcp');
    if (!mcp || !mcp.url) return out;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1800);
    try {
      const res = await fetch(mcp.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'eu4-mod-workbench', version: '0.1.0' } } }),
        signal: controller.signal,
      });
      if (res.ok) {
        mcp.status = 'connected';
        mcp.reason = `MCP initialize 返回 HTTP ${res.status}。`;
      } else {
        mcp.status = 'unreachable';
        mcp.reason = `端点可达但返回 HTTP ${res.status}；请检查 MCP 路径与鉴权。`;
      }
    } catch (e: any) {
      mcp.status = 'unreachable';
      mcp.reason = `连接失败：${e && e.name === 'AbortError' ? '超时' : (e && e.message ? e.message : String(e))}`;
    } finally {
      clearTimeout(timer);
    }
    return out;
  }

  findExecutable(command: string): string | null {
    if (!command) return null;
    if (path.isAbsolute(command)) return existsFile(command) ? command : null;
    const exts = process.platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';') : [''];
    for (const dir of (process.env.PATH || '').split(path.delimiter)) {
      if (!dir) continue;
      for (const ext of exts) {
        const candidate = path.join(dir, command + (command.toLowerCase().endsWith(ext.toLowerCase()) ? '' : ext));
        if (existsFile(candidate)) return candidate;
      }
    }
    return null;
  }

  summary(): any {
    return {
      eu4Root: this.state.eu4Root,
      modDir: this.state.modDir,
      selectedMod: this.state.selectedMod,
      activeTag: this.state.activeTag,
      currentStartDate: this.state.currentStartDate,
      pendingEdit: this.state.pendingEdit ? {
        kind: this.state.pendingEdit.kind,
        action: this.state.pendingEdit.action,
        createdAt: this.state.pendingEdit.createdAt,
      } : null,
      indexedAt: this.state.indexedAt,
      vanillaFileCount: this.state.vanillaFiles.length,
      counts: this.state.counts,
      mods: this.state.mods,
      shadow: this.shadowConflicts(),
      docs: { source: this.docs.source, generatedAt: this.docs.generatedAt, entries: this.docs.entries.length, scopes: this.docs.scopes.length },
      tools: this.probeTools(),
    };
  }

  shadowConflicts(limit = 80): { count: number; items: Array<{ path: string; vanilla: boolean }> } {
    const modRoot = this.modRoot();
    if (!modRoot || !existsDir(modRoot)) return { count: 0, items: [] };
    const vanilla = new Set(this.state.vanillaFiles.map((f) => f.toLowerCase()));
    const files: string[] = [];
    this.walk(modRoot, '', files, 30000);
    const items = files
      .filter((rel) => vanilla.has(rel.toLowerCase()))
      .slice(0, Math.max(1, Math.min(500, limit)))
      .map((rel) => ({ path: rel, vanilla: true }));
    return { count: files.filter((rel) => vanilla.has(rel.toLowerCase())).length, items };
  }
}

function indent(text: string, levels: number): string {
  const pad = '\t'.repeat(levels);
  return String(text).split(/\r?\n/).map((line) => (line.trim() ? pad + line : line)).join('\n');
}
