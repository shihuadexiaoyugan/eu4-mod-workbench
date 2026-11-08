/**
 * my-eu4-mod-workbench — Host entry.
 *
 * Registers the model-facing fact/validation tools and, when the profile has a
 * webServer, the loopback HTTP surface used by the sidebar panel.
 *
 * This file is the TypeScript source. `node scripts/build.mjs` strips the
 * erasable type syntax into index.js for the Cordis Loader.
 */
import Schema from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { Workbench } from './lib/engine.js';
import { createHandler, WORKBENCH_PREFIX } from './lib/server.js';

export const name = 'my-eu4-mod-workbench';
export const inject = ['tools'];

export const Config = Schema.object({
  eu4Root: Schema.string().description('EU4 游戏根目录。留空时自动探测 Steam/环境变量。'),
  modDir: Schema.string().description('用户 Mod 目录，例如 Documents/Paradox Interactive/Europa Universalis IV/mod。'),
  statePath: Schema.string().description('工作区状态 JSON 的保存路径。默认在 DSH_HOME/eu4-mod-workbench/workspace.json。'),
  clausewitzMcpUrl: Schema.string().description('clausewitz-mcp 的 Streamable HTTP 端点。'),
  clausewitzMcpCommand: Schema.string().default('clausewitz-mcp').description('clausewitz-mcp 的可执行文件名或绝对路径。'),
  clausewitzMcpArgs: Schema.array(Schema.string()).description('预留的 stdio 参数；工作台不会自动启动它。'),
  eu4ModEditingToolPath: Schema.string().description('Eu4-Mod-Editing-Tool 可执行文件路径。'),
  emtPath: Schema.string().description('EMT / ParadoxCode 可执行文件路径。'),
  paradoxCodePath: Schema.string().description('ParadoxCode 可执行文件路径。'),
  maxIndexFiles: Schema.number().default(30000).description('单次工作区索引的最大文件数。'),
});

const output = {
  schema: {
    type: 'object',
    additionalProperties: true,
  },
  render: (_args: unknown, value: unknown) => [
    { type: 'text', text: JSON.stringify(value, null, 2) },
  ],
};

function guarded<T>(fn: () => T | Promise<T>): Promise<T | { error: string }> {
  return Promise.resolve()
    .then(fn)
    .catch((e: any) => ({ error: e && e.message ? e.message : String(e) }));
}

export function apply(ctx: any, config: any = {}): void {
  // The Workbench is normally mounted once at Host level. If a preset also
  // names it (for the older agent.cordis.yml workflow), that second mount is a
  // no-op rather than a duplicate tool/web route registration.
  const activeKey = Symbol.for('my-eu4-mod-workbench.active');
  if ((globalThis as any)[activeKey]) return;
  const wb = new Workbench(config || {}).init();
  (globalThis as any)[activeKey] = wb;
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      if ((globalThis as any)[activeKey] === wb) delete (globalThis as any)[activeKey];
    }, 'my-eu4-mod-workbench: active instance');
  }

  const make = (toolName: string, description: string, parameters: any, run: (args: any) => any) => {
    ctx.tools.register(defineTool({
      name: toolName,
      description,
      parameters,
      output,
      execute: async (args: any) => guarded(() => run(args || {})),
    }));
  };

  make(
    'query_script_doc',
    '查询 EU4 trigger/effect/modifier 的准确签名和支持作用域。回答 EU4 语法前必须调用；返回 source 与 generatedAt，未命中时明确说明未命中，不要猜。',
    {
      name: { type: 'string', description: 'trigger/effect/scope/modifier 名称，例如 add_prestige。' },
      kind: { type: 'string', description: '可选：effect | trigger | modifier | scope。', enum: ['effect', 'trigger', 'modifier', 'scope'] },
    },
    (args) => {
      const result = wb.queryDoc(String(args.name || ''), args.kind ? String(args.kind) : undefined);
      if (!result.matches.length) {
        const candidates = wb.searchDocs(String(args.name || ''), args.kind ? String(args.kind) : undefined, 8);
        return { ...result, found: false, candidates, note: '未在脚本文档索引中精确命中；先确认名称或从 candidates 中选。' };
      }
      return { ...result, found: true };
    },
  );

  make(
    'find_definition',
    '在 vanilla 和当前已加载 Mod 中查找一个定义（event、religion、scripted effect 等）的定义位置与引用位置。返回绝对路径、相对路径和行号。',
    {
      name: { type: 'string', description: '要查找的定义名，例如 my_event.1、catholic、my_scripted_effect。' },
    },
    (args) => wb.findDefinition(String(args.name || '')),
  );

  make(
    'eu4_verify_path',
    '写入文件后必须调用：校验目标路径是否位于当前 Mod 目录内、是否误写到原版目录。返回绝对路径、modRoot、eu4Root、underMod、underVanilla、ok；ok=false 时必须回滚并报错。',
    {
      path: { type: 'string', description: '刚写入的文件路径（相对 Mod 根或绝对路径）。' },
    },
    (args) => wb.checkPath(String(args.path || '')),
  );

  make(
    'eu4_scan_report',
    '返回当前扫描到的 Mod/原版事件、任务、决议与理念文件路径与数量；用于排查“面板里 0 事件 / 看不到新文件”。',
    {},
    () => wb.scanReport(),
  );

  make(
    'eu4_readback',
    '写入后回读校验：读取目标文件，确认 id 存在（或删除后不存在），返回绝对路径、文件大小、found。若 found=false 必须回滚并报错。',
    {
      targetType: { type: 'string', description: 'event | mission | decision | mechanic | gui | province_history | country_history | new_tag | national_ideas | government_reform | tag_government' },
      targetId: { type: 'string', description: '目标 id（事件 id、任务 id、省份 id 等）' },
      targetFile: { type: 'string', description: '目标文件（相对 Mod 根，或绝对路径）' },
      action: { type: 'string', description: 'create | modify | delete', enum: ['create', 'modify', 'delete'] },
    },
    (args) => wb.readBack(args),
  );

  make(
    'search_script_docs',
    '模糊搜索 EU4 脚本文档，返回候选 trigger/effect/modifier 名称。只知道“大概想要什么”时先用它。',
    {
      query: { type: 'string', description: '模糊关键词，例如 prestige、core、modifier。' },
      kind: { type: 'string', description: '可选：effect | trigger | modifier | scope。', enum: ['effect', 'trigger', 'modifier', 'scope'] },
      limit: { type: 'number', description: '最多返回数量，默认 20，最大 50。' },
    },
    (args) => {
      const query = String(args.query || '');
      const kind = args.kind ? String(args.kind) : undefined;
      return { query, kind: kind || null, results: wb.searchDocs(query, kind, Number(args.limit) || 20) };
    },
  );

  make(
    'validate_script',
    '校验一段 EU4 脚本：作用域是否匹配、trigger 块是否混入 effect、effect 块是否混入 trigger，并检查 localisation 键。生成或修改脚本后必须调用。',
    {
      script: { type: 'string', description: '要校验的 EU4 脚本文本。' },
      scope: { type: 'string', description: '根作用域，可选 country | province | trade_node；留空时从 country_event/province_event 推断。' },
    },
    (args) => {
      const script = String(args.script || '');
      const result = wb.validateScript(script, { scope: args.scope ? String(args.scope) : undefined });
      const loc = wb.checkLocKeys(script);
      if (loc.missing.length) result.issues.push({
        severity: 'warning',
        code: 'MISSING_LOC',
        message: `localisation 缺失: ${loc.missing.join(', ')}`,
      });
      return { ...result, loc };
    },
  );

  make(
    'check_loc_keys',
    '从脚本中提取 localisation 键，并检查 vanilla 与当前 Mod 的 localisation 文件是否存在缺失。',
    {
      script: { type: 'string', description: '包含 title/desc/tooltip/custom_tooltip 等键的 EU4 脚本。' },
    },
    (args) => wb.checkLocKeys(String(args.script || '')),
  );

  make(
    'eu4_map_query',
    '查询简化省份地图数据：按省份 ID、名称或国家 Tag 返回省份与核心省份 ID。可用 ownerTag 只保留该 Tag 拥有的省份，coresOnly 只保留其核心省份。不会绘制像素地图。',
    {
      provinceId: { type: 'number', description: '省份 ID。' },
      tag: { type: 'string', description: '三字母国家 Tag，例如 FRA。' },
      ownerTag: { type: 'string', description: '只返回 history/provinces 中 owner = 该 Tag 的省份。' },
      coresOnly: { type: 'boolean', description: '只返回该 Tag 拥有核心（add_core）的省份。' },
      q: { type: 'string', description: '省份名称或 ID 片段。' },
    },
    (args) => wb.mapQuery({
      provinceId: Number(args.provinceId) || undefined,
      tag: args.tag ? String(args.tag) : undefined,
      ownerTag: args.ownerTag ? String(args.ownerTag) : undefined,
      coresOnly: args.coresOnly === true,
      q: args.q ? String(args.q) : undefined,
    }),
  );

  make(
    'eu4_batch_history',
    '根据结构化批量编辑意图生成 history/provinces 脚本片段和省份 ID 列表。所有输出都是文本，不直接改游戏文件。',
    {
      tag: { type: 'string', description: '三字母国家 Tag。' },
      provinceIds: { type: 'array', description: '省份 ID 数组。', items: { type: 'number' } },
      operation: { type: 'string', description: 'owner | controller | core | remove_core | base_tax | religion | culture。' },
      value: { type: 'string', description: 'base_tax/religion/culture 的值。' },
    },
    (args) => wb.batchHistory({ tag: String(args.tag || ''), provinceIds: Array.isArray(args.provinceIds) ? args.provinceIds.map(Number) : [], operation: args.operation ? String(args.operation) : 'owner', value: args.value }),
  );

  make(
    'eu4_mission_export',
    '把任务树节点图导出为 missions 脚本。写入前会校验每个节点的 trigger/effect；路径限制在当前 Mod 目录内。',
    {
      path: { type: 'string', description: '相对 Mod 根目录的 missions 文件路径，默认 missions/zz_eu4_workbench_missions.txt。' },
      nodes: { type: 'array', description: '节点数组：{id, required, trigger, effect, icon}。', items: { type: 'object', additionalProperties: true } },
    },
    (args) => wb.saveMissions({ path: String(args.path || ''), nodes: Array.isArray(args.nodes) ? args.nodes : [] }),
  );

  make(
    'eu4_event_graph',
    '解析指定 namespace 或全部事件，返回从左到右的因果链节点和边；引用不存在事件 ID 的边标记 missing=true。可选按 category（all/regular/special）和 Tag 过滤。',
    {
      namespace: { type: 'string', description: '事件 namespace，例如 my_mod。留空则扫描全部事件。' },
      category: { type: 'string', description: 'all | regular | special（special = fire_only_once 或 major 的 DHE）。', enum: ['all', 'regular', 'special'] },
      tag: { type: 'string', description: '只保留 namespace 含该 Tag 或 trigger 含 tag = TAG 的事件。' },
      activeTagOnly: { type: 'boolean', description: 'true 且未给 tag 时，使用面板当前选中的 Tag。' },
    },
    (args) => wb.queryEvents({
      namespace: args.namespace ? String(args.namespace) : undefined,
      category: args.category ? String(args.category) : undefined,
      tag: args.tag ? String(args.tag) : undefined,
      activeTagOnly: args.activeTagOnly === true,
    }),
  );

  make(
    'query_events_by_category',
    '按类别查询事件（all/regular/special）。special 指 fire_only_once 或 major 的特殊事件（DHE）。activeTagOnly=true 时按当前面板选中的 Tag 过滤：namespace 含该 Tag，或 trigger 中含 tag = TAG；也可显式传 tag。',
    {
      namespace: { type: 'string', description: '事件 namespace。留空扫描全部。' },
      category: { type: 'string', description: 'all | regular | special。默认 all。', enum: ['all', 'regular', 'special'] },
      tag: { type: 'string', description: '三字母国家 Tag，例如 BOH。' },
      activeTagOnly: { type: 'boolean', description: '按面板当前选中的 Tag 过滤（tag 为空时生效）。' },
    },
    (args) => wb.queryEvents({
      namespace: args.namespace ? String(args.namespace) : undefined,
      category: args.category ? String(args.category) : 'all',
      tag: args.tag ? String(args.tag) : undefined,
      activeTagOnly: args.activeTagOnly === true,
    }),
  );

  make(
    'eu4_pending_edit',
    '读取 Web 工作台生成的待处理修改（事件/任务表单生成的 Prompt + Payload）。处理完传 clear=true 清除；工作台自身不写任何 .txt。',
    {
      clear: { type: 'boolean', description: 'true 时读取后清除待办。' },
    },
    (args) => wb.takePendingEdit(args.clear === true),
  );

  make(
    'eu4_probe_tools',
    '探测 clausewitz-mcp、Eu4-Mod-Editing-Tool、EMT、ParadoxCode 的真实可用状态。区分已连接、已安装、未安装、未配置、不可达；不会启动外部程序。',
    {},
    async () => ({ tools: await wb.probeMcp() }),
  );

  make(
    'eu4_workspace_status',
    '返回当前 Mod 工程状态：游戏根目录、Mod 目录、已索引 vanilla 文件数量、已加载 Mod 列表和脚本文档来源。',
    {},
    () => wb.summary(),
  );

  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], (scoped: any) => {
      try {
        const dispose = scoped.webServer.register({
          kind: 'prefix',
          path: WORKBENCH_PREFIX,
          handler: createHandler(wb),
        });
        if (typeof scoped.effect === 'function') {
          scoped.effect(() => () => {
            try { dispose(); } catch { /* already disposed */ }
          }, 'my-eu4-mod-workbench: HTTP surface');
        }
      } catch (e) {
        // Tools remain available without a web server; the UI will report 404.
        scoped.logger?.warn?.('eu4-mod-workbench: webServer route not mounted', e);
      }
    });
  }

  // Drop the multi-megabyte scan caches when the Host reloads this plugin;
  // otherwise every HMR/reload leaves an orphaned engine behind.
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => wb.dispose(), 'my-eu4-mod-workbench: scan caches');
  } else if (typeof ctx.onDispose === 'function') {
    ctx.onDispose(() => wb.dispose());
  }
}
