/**
 * HTTP surface for the EU4 Mod Workbench panel.
 *
 * The panel is the only caller. Every route is same-origin and loopback-only;
 * no CORS header is emitted. The panel never writes game/mod files: edit
 * buttons only build AI prompts and optionally store a pending request in the
 * workbench state file. The model-facing tools own actual file changes.
 */
import { spawn } from 'node:child_process';
import { Workbench, provinceLabel } from './engine.js';
import { buildAIPayload, buildEventPreview } from './ai.js';
import { buildNL2JSONPayload, localParse, buildRawPreview } from './nl2code.js';
import { buildBatchPrompt } from './batch.js';
import { GUI_ANCHORS, GUI_VISIBILITIES, TRIGGER_OPTIONS, EFFECT_OPTIONS, MODIFIER_OPTIONS, MODIFIER_TREE, MODIFIER_CATEGORIES, CATEGORY_OPTIONS, PROVINCE_FIELD_OPTIONS, COUNTRY_FIELD_OPTIONS, TECH_GROUP_OPTIONS, GOVERNMENT_OPTIONS, RELIGION_OPTIONS, CULTURE_OPTIONS, CULTURE_GROUPS } from './eu4-dictionary.js';
import { UI_DEFAULT_LOCALE, uiMessages } from './ui-locales.js';

const PREFIX = '/eu4-workbench';

/** UTF-8 BOM + key check used by preview/read-back. */
const _locOk = (state: any): boolean => Boolean(state && state.exists && state.bom && state.size > 3 && state.keyOk);
const MAX_BODY = 2 * 1024 * 1024;

/**
 * Prompt display hints for the batch builder: one dictionary snapshot, so a
 * province shows up as `[2664] 皮尔森 (Plzeň)` in the task list while the JSON
 * payload and the generated script keep the numeric ID.
 */
function provincePromptOptions(wb: Workbench) {
  const dict = wb.provinceDictionary();
  return { provinceLabel: (id: number) => provinceLabel(dict.get(Number(id)) || { id: Number(id) }) };
}

/** Batch options: province hints + the absolute Mod/vanilla roots (path guard). */
function batchOptions(wb: Workbench) {
  return {
    ...provincePromptOptions(wb),
    modRoot: wb.modRoot() || '',
    eu4Root: wb.state.eu4Root || '',
    modVerified: wb.verifyModDirectory().ok,
    startDate: wb.state.currentStartDate || '1437.1.1',
    activeLanguage: wb.activeLanguage(),
  };
}

/** Pre-execution path log: every queued target is printed with the Mod root. */
function logBatchTargets(wb: Workbench, label: string): void {
  const targets = wb.listChanges().map((item) => `${item.targetType}:${item.targetFile || item.targetId}`);
  console.log('[eu4w ' + label + '] modRoot=' + (wb.modRoot() || '(none)') + ' targets=' + targets.join(' | '));
}

function isLoopback(req: any): boolean {
  const addr = String(req.socket?.remoteAddress || '');
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function json(res: any, code: number, value: unknown): void {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.length),
    'cache-control': 'no-store',
    'cross-origin-resource-policy': 'same-origin',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

function fail(res: any, code: number, message: string): void {
  json(res, code, { ok: false, error: message });
}

function readBody(req: any): Promise<any> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('body is not valid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sameOrigin(req: any): boolean {
  const site = String(req.headers?.['sec-fetch-site'] || '');
  return site === '' || site === 'same-origin' || site === 'none';
}

export function createHandler(wb: Workbench) {
  return async function handle(req: any, res: any): Promise<void> {
    if (!isLoopback(req)) return fail(res, 403, 'loopback only');
    if (!sameOrigin(req)) return fail(res, 403, 'cross-site request refused');
    const url = new URL(String(req.url || '/'), 'http://127.0.0.1');
    if (!url.pathname.startsWith(PREFIX)) return fail(res, 404, 'not found');
    const sub = url.pathname.slice(PREFIX.length) || '/';
    if (process.env.EU4W_MEM_LOG) console.error('MEM ' + sub + ' ' + wb.memoryMB() + 'MB');
    try {
      if (req.method === 'GET') {
        if (sub === '/api/state') return json(res, 200, { ok: true, data: wb.summary() });
        if (sub === '/api/memory') return json(res, 200, { ok: true, data: { heapMB: wb.memoryMB() } });
        if (sub === '/api/query') {
          const name = url.searchParams.get('name') || '';
          const kind = url.searchParams.get('kind') || undefined;
          return json(res, 200, { ok: true, data: wb.queryDoc(name, kind) });
        }
        if (sub === '/api/search') {
          const q = url.searchParams.get('q') || '';
          const kind = url.searchParams.get('kind') || undefined;
          return json(res, 200, { ok: true, data: wb.searchDocs(q, kind, Number(url.searchParams.get('limit')) || 20) });
        }
        if (sub === '/api/definition') {
          const name = url.searchParams.get('name') || '';
          return json(res, 200, { ok: true, data: wb.findDefinition(name) });
        }
        if (sub === '/api/map') {
          const data = wb.mapQuery({
            provinceId: Number(url.searchParams.get('id') || url.searchParams.get('provinceId')) || undefined,
            tag: url.searchParams.get('tag') || undefined,
            ownerTag: url.searchParams.get('ownerTag') || undefined,
            coresOnly: url.searchParams.get('coresOnly') === '1',
            q: url.searchParams.get('q') || undefined,
            limit: Number(url.searchParams.get('limit')) || 12000,
          });
          return json(res, 200, { ok: true, data });
        }
        if (sub === '/api/missions/find') {
          const data = await wb.findMissionsForTag(url.searchParams.get('tag') || '');
          return json(res, 200, { ok: true, data });
        }
        if (sub === '/api/missions') {
          const file = url.searchParams.get('path') || '';
          const data = file ? wb.parseMissions(file) : { files: wb.listMissionFiles(), missions: [] };
          return json(res, 200, { ok: true, data });
        }
        if (sub === '/api/events/catalog') {
          const data = await wb.eventCatalog(url.searchParams.get('refresh') === '1');
          return json(res, 200, { ok: true, data });
        }
        if (sub === '/api/decisions') {
          const data = await wb.decisionsForTag(url.searchParams.get('tag') || '', url.searchParams.get('refresh') === '1');
          return json(res, 200, { ok: true, data });
        }
        if (sub === '/api/scan/report') {
          const data = await wb.scanReport();
          return json(res, 200, { ok: true, data });
        }
        if (sub === '/api/paths/check') {
          const data = wb.checkPath(url.searchParams.get('path') || '');
          return json(res, 200, { ok: true, data });
        }
        if (sub === '/api/mod/verify') {
          return json(res, 200, { ok: true, data: wb.verifyModDirectory() });
        }
        if (sub === '/api/events') {
          const ns = url.searchParams.get('namespace') || '';
          const category = url.searchParams.get('category') || '';
          const tag = url.searchParams.get('tag') || '';
          const activeTagOnly = url.searchParams.get('activeTagOnly') === '1';
          const data = (category || tag || activeTagOnly)
            ? await wb.queryEvents({ namespace: ns, category: category || undefined, tag: tag || undefined, activeTagOnly })
            : await wb.eventGraphAsync(ns);
          return json(res, 200, { ok: true, data });
        }
        if (sub === '/api/ui/locales') {          const messages = uiMessages();
          for (const option of TRIGGER_OPTIONS) messages['trigger.' + option.value] = option.label;
          for (const option of EFFECT_OPTIONS) messages['effect.' + option.value] = option.label;
          for (const option of MODIFIER_OPTIONS) messages['modifier.' + option.value] = option.label;
          for (const option of CATEGORY_OPTIONS) messages['category.' + option.value] = option.label;
          for (const option of PROVINCE_FIELD_OPTIONS) messages['province.' + option.value] = option.label;
          for (const option of COUNTRY_FIELD_OPTIONS) messages['country.' + option.value] = option.label;
          for (const option of TECH_GROUP_OPTIONS) messages['techgroup.' + option.value] = option.label;
          for (const option of GOVERNMENT_OPTIONS) messages['government.' + option.value] = option.label;
          for (const option of RELIGION_OPTIONS) messages['religion.' + option.value] = option.label;
          for (const option of CULTURE_OPTIONS) messages['culture.' + option.value] = option.label;
          for (const group of CULTURE_GROUPS) messages['culture_group.' + group.group_id] = group.group_name;
          const cultureValues = new Set(CULTURE_OPTIONS.map((option) => option.value));
          const religionValues = new Set(RELIGION_OPTIONS.map((option) => option.value));
          const governmentValues = new Set(GOVERNMENT_OPTIONS.map((option) => option.value));
          const techValues = new Set(TECH_GROUP_OPTIONS.map((option) => option.value));
          const dynamic = await wb.localisation();
          for (const [key, value] of dynamic) {
            if (cultureValues.has(key)) messages['culture.' + key] = value;
            else if (religionValues.has(key)) messages['religion.' + key] = value;
            else if (governmentValues.has(key)) messages['government.' + key] = value;
            else if (techValues.has(key)) messages['techgroup.' + key] = value;
          }
          // User-added dictionary entries (the UI quick-add) must be visible to
          // t(key) so unknown triggers/effects can display their Chinese label.
          for (const [key, value] of Object.entries(wb.readCustomDictionary())) messages[key] = value;
          return json(res, 200, { ok: true, data: { locale: UI_DEFAULT_LOCALE, messages } });
        }
        if (sub === '/api/queue') {
          const items = wb.listChanges();
          return json(res, 200, { ok: true, data: { items, count: items.length } });
        }
        if (sub === '/api/eu4/options') {          return json(res, 200, {
            ok: true,
            data: {
              triggers: TRIGGER_OPTIONS,
              effects: EFFECT_OPTIONS,
              modifiers: MODIFIER_OPTIONS,
            modifierTree: MODIFIER_TREE,
            modifierCategories: MODIFIER_CATEGORIES,
              categories: CATEGORY_OPTIONS,
              techGroups: TECH_GROUP_OPTIONS,
              governments: GOVERNMENT_OPTIONS,
              religions: RELIGION_OPTIONS,
              cultures: CULTURE_OPTIONS,
              cultureGroups: CULTURE_GROUPS,
            },
          });
        }
        if (sub === '/api/gui/options') {
          return json(res, 200, { ok: true, data: { anchors: GUI_ANCHORS, visibilities: GUI_VISIBILITIES } });
        }
        if (sub === '/api/history/province') {
          const data = await wb.provinceHistoryFile(Number(url.searchParams.get('id')), url.searchParams.get('name') || undefined);
          return json(res, data.error ? 400 : 200, data.error ? { ok: false, error: data.error } : { ok: true, data });
        }
        if (sub === '/api/history/country') {
          const data = await wb.countryHistoryFile(url.searchParams.get('tag') || '');
          return json(res, data.error ? 400 : 200, data.error ? { ok: false, error: data.error } : { ok: true, data });
        }
        if (sub === '/api/ideas/file') {
          const data = await wb.nationalIdeasFile(url.searchParams.get('tag') || '');
          return json(res, data.error ? 400 : 200, data.error ? { ok: false, error: data.error } : { ok: true, data });
        }
        if (sub === '/api/modifier') {
          const data = await wb.modifierForm(url.searchParams.get('name') || '');
          return json(res, data.error ? 404 : 200, data.error ? { ok: false, error: data.error } : { ok: true, data });
        }
        if (sub === '/api/provinces/adjacent') {
          const data = await wb.adjacentProvinces(Number(url.searchParams.get('id')));
          return json(res, 200, { ok: true, data });
        }
        if (sub === '/api/provinces/dictionary') {          const query = url.searchParams.get('q') || '';
          const limit = Number(url.searchParams.get('limit')) || 200;
          const data = wb.provinceDictionaryList(query, limit);
          const meta = wb.provinceDictionaryMeta();
          return json(res, 200, {
            ok: true,
            data: {
              items: data,
              total: data.length,
              query,
              labelFormat: '[id] 中文名 (English)',
              // Why is a name still English? These counters answer it.
              chineseCount: meta.chinese,
              provinceCount: meta.provinces,
              localisationFiles: meta.files,
              unreadableFiles: meta.unreadableFiles,
              roots: meta.rootsExisting,
            },
          });
        }
        if (sub === '/api/event/examples') {
          const data = await wb.eventExamples(Number(url.searchParams.get('count')) || 2);
          return json(res, 200, { ok: true, data: { examples: data, maxLines: 40 } });
        }
        if (sub === '/api/event/form') {
          const data = await wb.eventForm(url.searchParams.get('path') || '', url.searchParams.get('id') || '');
          return json(res, data.error ? 404 : 200, data.error ? { ok: false, error: data.error } : { ok: true, data });
        }
        if (sub === '/api/file') {
          const file = url.searchParams.get('path') || '';
          return json(res, 200, { ok: true, data: wb.readTextFile(file) });
        }
        if (sub === '/api/tools') {
          const tools = await wb.probeMcp();
          return json(res, 200, { ok: true, data: tools });
        }
        return fail(res, 404, 'unknown route');
      }
      if (req.method !== 'POST') return fail(res, 405, 'method not allowed');
      const body = await readBody(req);
      if (sub === '/api/workspace') {
        wb.setRoots(String(body.eu4Root || '').trim() || undefined, String(body.modDir || '').trim() || undefined);
        if (body.selectedMod !== undefined) {
          wb.state.selectedMod = body.selectedMod ? String(body.selectedMod) : null;
          wb.saveState();
        }
        return json(res, 200, { ok: true, data: wb.summary() });
      }
      if (sub === '/api/tag') {
        const result = wb.setActiveTag(body.tag);
        return json(res, result.ok ? 200 : 400, { ok: result.ok, data: { activeTag: result.activeTag }, ...(result.error ? { error: result.error } : {}) });
      }
      if (sub === '/api/dictionary/custom') {
        try {
          const data = await Promise.resolve(wb.setCustomDictionary(String(body.key || ''), String(body.value || '')));
          return json(res, 200, { ok: true, data: { key: body.key, value: body.value, entries: Object.keys(data).length } });
        } catch (e: any) {
          return json(res, 400, { ok: false, error: e && e.message ? e.message : String(e) });
        }
      }
      if (sub === '/api/startdate') {
        const result = wb.setStartDate(String(body.date || ''));
        return result.ok ? json(res, 200, { ok: true, data: result }) : json(res, 400, { ok: false, error: result.error });
      }
      if (sub === '/api/reindex') {
        wb.reindex();
        return json(res, 200, { ok: true, data: wb.summary() });
      }
      if (sub === '/api/validate') {
        const data = wb.validateScript(String(body.script || ''), { scope: body.scope ? String(body.scope) : undefined });
        const loc = wb.checkLocKeys(String(body.script || ''));
        if (loc.missing.length) {
          data.issues.push({ severity: 'warning', code: 'MISSING_LOC', message: `缺失 localisation: ${loc.missing.join(', ')}` });
        }
        return json(res, 200, { ok: true, data: { ...data, loc } });
      }
      if (sub === '/api/loc') {
        return json(res, 200, { ok: true, data: wb.checkLocKeys(String(body.script || '')) });
      }
      if (sub === '/api/map/intent') {
        const text = String(body.text || '');
        let operation = String(body.operation || '');
        let tag = String(body.tag || '').toUpperCase();
        const ids = (Array.isArray(body.provinceIds) ? body.provinceIds : []).map(Number).filter((n: number) => Number.isFinite(n));
        const tagInText = /\b([A-Z]{3})\b/.exec(text);
        if (tagInText && !tag) tag = tagInText[1];
        if (!operation) {
          if (/(核心|core)/i.test(text)) operation = 'core';
          else if (/(控制|controller)/i.test(text)) operation = 'controller';
          else if (/(税|tax)/i.test(text)) operation = 'base_tax';
          else operation = 'owner';
        }
        const matches = [...text.matchAll(/\b(\d{1,5})\b/g)].map((m) => Number(m[1]));
        if (!ids.length) ids.push(...matches);
        const data = wb.batchHistory({ tag, provinceIds: [...new Set(ids)], operation, value: body.value });
        return json(res, 200, { ok: true, data });
      }
      if (sub === '/api/missions/save') {
        return fail(res, 410, 'UI 不再直接写文件；请使用“生成 AI 指令”。');
      }
      if (sub === '/api/file/save') {
        return fail(res, 410, 'UI 不再直接写文件；请使用“生成 AI 指令”。');
      }
      if (sub === '/api/nl2json') {
        const kinds = ['event', 'mission', 'province_history', 'country_history', 'new_tag'];
        const kind = kinds.includes(String(body.kind)) ? String(body.kind) : 'event';
        const mode = body.mode === 'code' ? 'code' : 'json';
        const text = String(body.text || '').trim();
        if (!text) return fail(res, 400, 'text is required');
        try {
          const config = localParse(kind as any, text);
          const raw = buildRawPreview(config);
          const prompt = buildNL2JSONPayload(kind as any, text, { mode, form: body.form });
          const validation = (kind === 'event' || kind === 'mission')
            ? wb.validateScript(raw, { scope: kind === 'event' ? 'country' : undefined })
            : { issues: [] };
          const triggerSet = new Set(TRIGGER_OPTIONS.map((option) => option.value));
          const effectSet = new Set(EFFECT_OPTIONS.map((option) => option.value));
          const statSet = new Set(MODIFIER_OPTIONS.map((option) => option.value));
          const warnings = [...config.warnings];
          const walkConditions = (nodes: any[] = []) => {
            for (const node of nodes) {
              if (!['AND', 'OR', 'NOT', 'custom'].includes(node.type) && !triggerSet.has(node.type)) {
                warnings.push('unknown trigger: ' + node.type);
              }
              walkConditions(node.children || []);
            }
          };
          const walkEffects = (effects: any[] = []) => {
            for (const effect of effects) {
              if (effect.effect !== 'custom' && !effectSet.has(effect.effect)) {
                warnings.push('unknown effect: ' + effect.effect);
              }
              for (const key of Object.keys(effect.params?.stats || {})) {
                if (!statSet.has(key)) warnings.push('unknown modifier stat: ' + key);
              }
            }
          };
          walkConditions(config.event?.conditions || config.mission?.nodes?.[0]?.conditions || []);
          walkEffects(config.event?.options?.flatMap((option) => option.effects || []) || []);
          for (const node of config.mission?.nodes || []) {
            walkConditions(node.conditions || []);
            walkEffects(node.rewards || []);
          }
          return json(res, 200, {
            ok: true,
            data: {
              config,
              mode,
              max_tokens: 1000,
              prompt: prompt.prompt,
              schema: prompt.schema,
              raw,
              warnings: [...new Set(warnings)],
              validation: validation.issues,
              validatedBy: 'local dictionary + validate_script',
            },
          });
        } catch (e: any) {
          return json(res, 400, { ok: false, error: e && e.message ? e.message : String(e) });
        }
      }
      if (sub === '/api/queue') {
        if (req.method === 'GET') {
          return json(res, 200, { ok: true, data: { items: wb.listChanges(), count: wb.listChanges().length } });
        }
        try {
          const item = wb.addChange(body || {});
          return json(res, 200, { ok: true, data: { item, count: wb.listChanges().length } });
        } catch (e: any) {
          return json(res, 400, { ok: false, error: e && e.message ? e.message : String(e) });
        }
      }
      if (sub === '/api/queue/remove') {
        const removed = wb.removeChange(String(body.id || ''));
        return json(res, 200, { ok: true, data: { removed, count: wb.listChanges().length } });
      }
      if (sub === '/api/queue/clear') {
        const cleared = wb.clearChanges();
        return json(res, 200, { ok: true, data: { cleared, count: 0 } });
      }
      if (sub === '/api/queue/build') {
        const modCheck = wb.verifyModDirectory();
        if (!modCheck.ok) return json(res, 409, { ok: false, error: modCheck.message, data: modCheck });
        try {
          logBatchTargets(wb, 'queue/build');
          const result = buildBatchPrompt(wb.listChanges(), batchOptions(wb));
          return json(res, 200, { ok: true, data: result });
        } catch (e: any) {
          return json(res, 400, { ok: false, error: e && e.message ? e.message : String(e) });
        }
      }
      if (sub === '/api/queue/submit') {
        const modCheck = wb.verifyModDirectory();
        if (!modCheck.ok) return json(res, 409, { ok: false, error: modCheck.message, data: modCheck });
        try {
          logBatchTargets(wb, 'queue/submit');
          const result = buildBatchPrompt(wb.listChanges(), batchOptions(wb));
          const pending = wb.setPendingEdit({
            kind: 'batch',
            action: 'update',
            prompt: result.prompt,
            payload: result.payload,
            meta: result.meta,
          });
          return json(res, 200, { ok: true, data: { pending, prompt: result.prompt, meta: result.meta } });
        } catch (e: any) {
          return json(res, 400, { ok: false, error: e && e.message ? e.message : String(e) });
        }
      }
      if (sub === '/api/ai/raw') {
        const file = String(body.file || '').trim();
        const code = String(body.code || '').trim();
        if (!file || !code) return fail(res, 400, 'file and code are required');
        const prompt = [
          'Write the following confirmed EU4 script to ' + file + '.',
          'Keep every other block, comment and indentation unchanged; run validate_script before and after writing.',
          'Hard output limit: max_tokens = 1000. Do not restate the code in your answer; report file, lines and validation.',
          '```',
          code,
          '```',
        ].join('\n');
        const pending = wb.setPendingEdit({
          kind: 'raw' as any,
          action: 'update',
          prompt,
          payload: { file, code },
          meta: { file, target: 'raw', maxTokens: 1000 },
        });
        return json(res, 200, { ok: true, data: { pending, max_tokens: 1000 } });
      }
      if (sub === '/api/ai/build') {
        try {
          const result = buildAIPayload(String(body.kind || ''), String(body.action || 'update'), { ...(body.data || {}), activeLanguage: wb.activeLanguage() });
          return json(res, 200, { ok: true, data: result });
        } catch (e: any) {
          return json(res, 400, { ok: false, error: e && e.message ? e.message : String(e) });
        }
      }
      if (sub === '/api/ai/preview') {
        try {
          if (String(body.kind || 'event') !== 'event') {
            return json(res, 400, { ok: false, error: 'preview is available for event only' });
          }
          const data = buildEventPreview(body.data || {});
          const form = body.data || {};
          const activeLanguage = wb.activeLanguage();
          data.activeLanguage = activeLanguage;
          const locKeys = [String(form.id || '') + '.t', String(form.id || '') + '.d'];
          const simpState = wb.localisationFileState(String(data.localisationFile || 'localisation/zz_eu4_workbench_l_simp_chinese.yml'), locKeys);
          const activeFile = activeLanguage === 'l_simp_chinese' ? '' : 'localisation/zz_eu4_workbench_' + activeLanguage + '.yml';
          const activeState = activeFile ? wb.localisationFileState(activeFile, locKeys) : null;
          data.localisationCheck = { simp: simpState, active: activeState, ok: _locOk(simpState) && (!activeState || _locOk(activeState)) };
          if (!simpState.exists) data.warnings.push('缺少本地化文件 ' + simpState.file + '：必须新建 UTF-8 BOM 的 .yml。');
          else if (!simpState.bom || simpState.size <= 3) data.warnings.push('本地化文件缺少 UTF-8 BOM 或小于 4 字节：游戏会忽略中文。');
          else if (!simpState.keyOk) data.warnings.push('本地化文件缺少 ' + locKeys.join(' / ') + ' 键。');
          if (activeState && !_locOk(activeState)) data.warnings.push('游戏语言 ' + activeLanguage + ' 的中文键缺失（' + activeFile + '）：游戏会显示英文。');
          data.absolutePath = wb.absoluteModPath(data.file);
          const modCheck = wb.verifyModDirectory();
          data.modRoot = modCheck.modRoot;
          data.modVerified = modCheck.ok;
          if (!modCheck.ok) data.warnings.push(modCheck.message);
          const expectedNamespace = String(form.id || '').split('.')[0] || '';
          const nsInfo = wb.namespaceOfFile(data.file);
          data.namespace = nsInfo;
          data.namespaceExpected = expectedNamespace;
          data.namespaceOk = Boolean(nsInfo.exists && nsInfo.namespace === expectedNamespace && nsInfo.syntaxOk);
          if (!nsInfo.exists) {
            data.warnings.push('事件文件尚不存在：AI 创建文件时必须在顶部写 `namespace = ' + expectedNamespace + '`（EU4 语法，不是 add_namespace）');
          } else if (!data.namespaceOk) {
            data.warnings.push('事件文件顶部缺少 `namespace = ' + expectedNamespace + '` 或命名空间不匹配：游戏会忽略该事件');
          }
          if (data.history) {
            const targetTag = String(form.targetTag || '').trim().toUpperCase();
            const bindDate = String(form.bindDate || '').trim() || '1437.1.1';
            const state = await wb.historyBindState(targetTag, bindDate, String(form.id || ''));
            data.history.exists = state.exists;
            data.history.dateBlockCount = state.dateBlockCount;
            data.history.alreadyBound = state.alreadyBound;
            data.history.expected = String(form.triggerMode || '') === 'startup';
            data.history.ok = !data.history.expected || Boolean(state.exists && state.alreadyBound);
            const onAction = await wb.onActionBindState(targetTag, String(form.id || ''));
            data.onAction = onAction;
            data.triggerOk = Boolean(!data.history.expected || (data.history.ok && onAction.exists && onAction.bound));
            if (!state.exists) data.warnings.push('未找到该 Tag 的国家历史文件：需要创建 history/countries/' + targetTag + '.txt');
            if (state.exists && state.dateBlockCount > 0) {
              data.warnings.push('目标历史文件已有 ' + bindDate + ' 区块（' + state.dateBlockCount + ' 处）：必须把 country_event 合并进已有区块，追加重复日期块可能被游戏忽略');
            }
            if (data.history.expected && !state.alreadyBound) {
              data.warnings.push('历史文件缺少开局触发行：`' + bindDate + ' = { country_event = { id = ' + String(form.id || '') + ' days = 0 } }`；is_triggered_only 事件不会触发');
            }
            if (state.alreadyBound) data.warnings.push('该事件已在 ' + state.file + ' 绑定，无需重复添加');
            if (data.history.expected && !onAction.bound) {
              data.warnings.push('on_startup 兜底缺失：common/on_actions/zz_eu4_workbench_on_actions.txt 需要写入 `if = { limit = { exists = ' + targetTag + ' } ' + targetTag + ' = { country_event = { id = ' + String(form.id || '') + ' days = 1 } } }`');
            }
          }
          return json(res, 200, { ok: true, data });
        } catch (e: any) {
          return json(res, 400, { ok: false, error: e && e.message ? e.message : String(e) });
        }
      }
      if (sub === '/api/refresh') {
        try {
          const data = wb.refreshCaches(Boolean(body && body.reindex));
          return json(res, 200, { ok: true, data });
        } catch (e: any) {
          return json(res, 400, { ok: false, error: e && e.message ? e.message : String(e) });
        }
      }
      if (sub === '/api/verify/readback') {
        try {
          const data = await wb.readBack(body || {});
          return json(res, 200, { ok: true, data });
        } catch (e: any) {
          return json(res, 400, { ok: false, error: e && e.message ? e.message : String(e) });
        }
      }
      if (sub === '/api/ai/submit') {
        try {
          const result = buildAIPayload(String(body.kind || ''), String(body.action || 'update'), body.data || {});
          const pending = wb.setPendingEdit({
            kind: result.kind,
            action: result.action,
            prompt: result.prompt,
            payload: result.payload,
            meta: result.meta,
          });
          return json(res, 200, { ok: true, data: { prompt: result.prompt, payload: result.payload, pending } });
        } catch (e: any) {
          return json(res, 400, { ok: false, error: e && e.message ? e.message : String(e) });
        }
      }
      if (sub === '/api/tools/open') {
        const id = String(body.id || '');
        const tools = await wb.probeMcp();
        const tool = tools.find((t) => t.id === id);
        if (!tool) return fail(res, 404, 'unknown tool');
        if (id === 'clausewitz-mcp') return fail(res, 409, 'MCP 由适配器管理，工作台不会自行启动外部 MCP 进程。');
        if (tool.status !== 'installed' && tool.status !== 'connected') return fail(res, 409, tool.reason);
        if (!tool.path) return fail(res, 409, '该工具没有可执行路径');
        try {
          const child = spawn(tool.path, [], { detached: true, stdio: 'ignore', shell: false, windowsHide: false });
          child.on('error', () => { /* reported through the probe on the next refresh */ });
          child.unref();
        } catch (e: any) {
          return fail(res, 500, e && e.message ? e.message : String(e));
        }
        return json(res, 200, { ok: true, data: { launched: true, path: tool.path } });
      }
      return fail(res, 404, 'unknown route');
    } catch (e: any) {
      return fail(res, 500, e && e.message ? e.message : String(e));
    }
  };
}

export const WORKBENCH_PREFIX = PREFIX;
