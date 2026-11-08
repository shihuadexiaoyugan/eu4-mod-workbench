window.__ModuleLoader__.load({
  id: 'my-eu4-mod-workbench',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useRef, useMemo, useCallback } = React;
    /** Explicit output budget for every Agent handoff (UI-side contract). */
    const AI_MAX_TOKENS = 1000;

    /** Numeric conversion between player-facing units and EU4 native values. */
    function valueTypeOf(options, code, fallback = 'percentage') {
      const option = (options || []).find((item) => item.value === code);
      if (option?.type === 'integer') return 'integer';
      if (option?.type === 'decimal') return 'decimal';
      if (option?.type === 'percentage') return 'percentage';
      return fallback;
    }
    function toDisplayValue(value, type) {
      if (value === '' || value === null || value === undefined) return '';
      const n = Number(value);
      if (!Number.isFinite(n)) return '';
      return type === 'percentage' ? String(Number((n * 100).toFixed(4))) : String(n);
    }
    function toNativeValue(value, type) {
      const n = Number(value);
      if (!Number.isFinite(n)) return 0;
      return type === 'percentage' ? Number((n / 100).toFixed(6)) : n;
    }

    /**
     * Duration helpers for add_country_modifier. One EU4 year is 365 days.
     * Accepts bare numbers ("5") or smart text ("5年" / "90天") per input box.
     */
    function durationPartDays(text, unit = 'day') {
      const raw = String(text == null ? '' : text).trim();
      if (!raw) return 0;
      const num = Number(raw.replace(/[^0-9.\-]/g, ''));
      if (!Number.isFinite(num)) return 0;
      if (/年|y/i.test(raw)) return Math.round(num * 365);
      if (/天|d/i.test(raw)) return Math.round(num);
      return unit === 'year' ? Math.round(num * 365) : Math.round(num);
    }
    function durationToNative(yearsText, daysText) {
      return Math.max(0, durationPartDays(yearsText, 'year') + durationPartDays(daysText, 'day'));
    }
    function durationSplit(durationDays) {
      const total = Math.max(0, Math.round(Number(durationDays) || 0));
      return { years: Math.floor(total / 365), days: total % 365 };
    }

    /** Province history must keep owner and controller identical. */
    function syncProvinceController(cfg) {
      const out = { ...(cfg || {}) };
      if (out.owner) out.controller = out.owner;
      return out;
    }

    /** Force `add_country_modifier.duration` to DAYS before it leaves the UI. */
    function normalizePayloadEffects(effects) {
      return (effects || []).map((effect) => {
        if (!effect || effect.effect !== 'add_country_modifier') return effect;
        const params = { ...(effect.params || {}) };
        const hasYears = params.years !== undefined && params.years !== '';
        const hasDays = params.daysText !== undefined && params.daysText !== '';
        if (hasYears || hasDays) {
          params.duration = String(durationToNative(params.years ?? '', params.daysText ?? ''));
        } else if (/年|天/.test(String(params.duration ?? ''))) {
          params.duration = String(durationToNative('', params.duration));
        }
        return { ...effect, params };
      });
    }

    /** Height clamp for the auto-resizing textarea (60..400 px by default). */
    function clampTextareaHeight(scrollHeight, minHeight = 60, maxHeight = 400) {
      const raw = Number(scrollHeight);
      const min = Number(minHeight) || 60;
      const max = Math.max(min, Number(maxHeight) || 400);
      if (!Number.isFinite(raw) || raw <= 0) return { height: min, overflow: false };
      return { height: Math.min(Math.max(raw, min), max), overflow: raw > max };
    }

    /**
     * EU4 yml toolbar helpers: insert a paragraph break (`\n`, two characters in
     * the .yml) or wrap the selection in §Y … §! (yellow highlight).
     */
    function insertYmlTool(text, start, end, kind) {
      const source = String(text == null ? '' : text);
      const from = Math.max(0, Math.min(Number(start) || 0, source.length));
      const to = Math.max(from, Math.min(Number(end) || from, source.length));
      const selected = source.slice(from, to);
      if (kind === 'highlight') {
        return {
          value: source.slice(0, from) + '§Y' + selected + '§!' + source.slice(to),
          caret: from + 2 + selected.length + 2,
        };
      }
      const inserted = '\\n';
      return { value: source.slice(0, from) + inserted + source.slice(to), caret: from + inserted.length };
    }

    /** Default target Tag for the startup bind: the header Tag when unset. */
    function effectiveTargetTag(form, activeTag) {
      return String(form?.targetTag || activeTag || '').trim().toUpperCase();
    }

    /**
     * Multi-line textarea that grows with its content. Height follows
     * scrollHeight, clamped to [minHeight, maxHeight]; past maxHeight it scrolls.
     * Used by every long localisation field (event/decision/idea/mission desc,
     * GUI tooltip, notes).
     */
    function AutoTextArea({ value, onChange, placeholder, minHeight = 60, maxHeight = 400, toolbar = false, className = '', rows = 3 }) {
      const { t } = useLocale();
      const ref = useRef(null);
      const resize = () => {
        const el = ref.current;
        if (!el) return;
        el.style.height = 'auto';
        const measured = clampTextareaHeight(el.scrollHeight, minHeight, maxHeight);
        el.style.height = measured.height + 'px';
        el.style.overflowY = measured.overflow ? 'auto' : 'hidden';
      };
      const useResizeEffect = typeof window === 'undefined' ? useEffect : React.useLayoutEffect;
      useResizeEffect(() => { resize(); }, [value, minHeight, maxHeight]);
      useEffect(() => {
        const timer = setTimeout(resize, 0);
        if (typeof window !== 'undefined') window.addEventListener('resize', resize);
        return () => {
          clearTimeout(timer);
          if (typeof window !== 'undefined') window.removeEventListener('resize', resize);
        };
      }, []);
      const applyTool = (kind) => {
        const el = ref.current;
        const source = String(value || '');
        const start = el && typeof el.selectionStart === 'number' ? el.selectionStart : source.length;
        const end = el && typeof el.selectionEnd === 'number' ? el.selectionEnd : start;
        const result = insertYmlTool(source, start, end, kind);
        onChange(result.value);
        if (typeof window !== 'undefined') {
          window.requestAnimationFrame(() => {
            try { el.focus(); el.setSelectionRange(result.caret, result.caret); } catch { /* ignore */ }
          });
        }
      };
      return h('div', { className: 'eu4w-autotext' },
        toolbar ? h('div', { className: 'eu4w-autotext-tools' },
          h('button', {
            type: 'button', className: 'eu4w-btn', title: t('text.insertNewline'),
            onMouseDown: (e) => e.preventDefault(), onClick: () => applyTool('newline'),
          }, t('text.newline')),
          h('button', {
            type: 'button', className: 'eu4w-btn', title: t('text.highlight'),
            onMouseDown: (e) => e.preventDefault(), onClick: () => applyTool('highlight'),
          }, t('text.highlightLabel')),
          h('span', { className: 'eu4w-muted' }, t('text.toolsHint')),
        ) : null,
        h('textarea', {
          ref,
          className: ('eu4w-area eu4w-autotext-area ' + className).trim(),
          rows,
          value: value || '',
          placeholder,
          spellCheck: false,
          style: { minHeight, maxHeight },
          onChange: (e) => { onChange(e.target.value); resize(); },
          onInput: () => resize(),
        }),
      );
    }

    const API = '/eu4-workbench/api';
    const DIPLOMACY_RELATIONS = [
      ['alliance', '同盟 (Alliance)'],
      ['royal_marriage', '王室联姻 (Royal Marriage)'],
      ['vassal', '附庸 (Vassal)'],
      ['union', '联统 (Personal Union)'],
      ['war', '战争 (War)'],
      ['truce', '停战期 (Truce)'],
      ['guarantee', '保障独立 (Guarantee)'],
      ['rival', '宿敌 (Rival)'],
    ];
    const TABS = [
      ['workspace', 'tab.workspace'],
      ['map', 'tab.map'],
      ['province', 'tab.province'],
      ['country', 'tab.country'],
      ['ideas', 'tab.ideas'],
      ['government', 'tab.government'],
      ['missions', 'tab.missions'],
      ['events', 'tab.events'],
      ['decisions', 'tab.decisions'],
      ['diplomacy', 'tab.diplomacy'],
      ['gui', 'tab.gui'],
      ['mechanic', 'tab.mechanic'],
      ['validate', 'tab.validate'],
      ['tools', 'tab.tools'],
      ['batch', 'tab.batch'],
    ];

    // One shared selection for every panel. The value is also persisted by the
    // Host (`POST /api/tag`) so the AI tool can query the tag the user is on.
    const TagContext = React.createContext({ activeTag: '', setActiveTag: () => {} });
    const useTagContext = () => React.useContext(TagContext);
    const ProvinceFocusContext = React.createContext({ focusId: 0, setFocusId: () => {} });
    const useProvinceFocus = () => React.useContext(ProvinceFocusContext);

    // UI language pack is fetched once from the Host; a missing key renders the
    // English key itself (never blank), and `{name}` placeholders are filled.
    // These fallbacks keep recently added labels readable when the Host still
    // runs an older locale pack (e.g. before a restart), instead of raw keys.
    const CLIENT_MESSAGES = {
      'map.jump': '定位省份',
      'map.jumpHint': '按 ID / 中文 / 英文搜索并选中省份',
      'map.adjacent': '相邻省份',
      'map.adjacentEmpty': '没有可用的相邻数据',
      'neighbor.pickOnMap': '先在地图选择一个省份，再挑选相邻省份',
      'neighbor.hint': '省份 {id} 的相邻省份（🌊 = 跨海海峡）',
      'neighbor.empty': '该省没有相邻省份数据',
      'map.intentPick': '按名称加入省份 ID',
      'map.intentChips': '已选省份（交给 AI 时仍是纯数字 ID）',
      'map.hoverHint': '悬停省份网格可查看 [ID] 中文名 (English)',
      'map.dictCoverage': '中文省名 {cn}/{total}',
      'map.dictUnreadable': '{files} 个本地化文件无法解码',
      'map.dictNoChinese': '字典里没有中文省名，回退英文（请检查汉化包是否为 UTF-8/GBK）',
      'province.pickerPlaceholder': '搜索省份：ID / 中文 / 英文，如 2664、皮尔森、Plz',
      'province.pickerEmpty': '没有匹配项；可直接输入数字 ID 后回车',
      'province.useId': '使用 ID {id}（暂无名称）',
      'province.selected': '已选：{label}',
      'province.syncName': '同时写入省份名称本地化（PROV{id}）',
      'province.cnSource': '中文名来源：{file}',
      'province.noCn': '该省份未汉化，回退显示英文名',
      'province.idOnly': '纯数字 ID（脚本落脚点）',
      'ideas.exists': '文件已存在',
      'ideas.newFile': '将新建文件',
      'ideas.addModifier': '添加修正',
      'ideas.autoReloaded': '文件已更新，已自动重新读取。',
      'ideas.stale': '文件已在磁盘上更新，但你有未保存的修改。',
      'ideas.reload': '重新读取文件',
      'ideas.tagHint': '输入 3 位 Tag；回车或离开输入框即读取该国的理念文件',
      'tab.decisions': '决议',
      'tab.diplomacy': '外交关系',
      'dip.title': '开局外交关系',
      'dip.hint': '配置 1437 年剧本开局的外交状态；所有关系写入 Mod 文件，不改原版。',
      'dip.a': '国家 A (Tag)',
      'dip.b': '国家 B (Tag)',
      'dip.type': '关系类型',
      'dip.start': '开始生效时间',
      'dip.cb': '开战理由 (Casus Belli)',
      'dip.truceYear': '停战结束年份',
      'dip.swap': '交换 A/B',
      'dip.add': '加入队列',
      'dip.queued': '已加入外交关系队列',
      'dip.err.empty': 'Tag A 与 Tag B 都不能为空',
      'dip.err.same': 'Tag A 与 Tag B 不能相同',
      'dip.err.tag': 'Tag 必须是 3 位字母/数字（如 TBO）',
      'dip.err.cb': '战争必须填写 Casus Belli，如 cb_conquest',
      'dip.err.year': '停战期必须填写 4 位结束年份，如 1442',
      'dip.err.date': '开始时间格式应为 1437.1.1',
      'dip.rules': '生成规则',
      'dip.rule1': 'history/diplomacy 不使用日期块：关系块内写 start_date = 1437.1.1（不是 1437.1.1 = { ... }）。',
      'dip.rule2': '附庸 first=宗主、second=附庸；联统 first=主导国、second=被联统国；战争写入 history/wars，停战/宿敌写入 on_startup。',
      'dip.rule3': '停战/宿敌在 on_startup 双向绑定；EU4 的 add_truce_with 默认 5 年，结束年份仅作记录。',
      'category.decision': '国家决议',
      'decision.tagOnly': '仅显示 {tag} 的决议',
      'decision.reload': '刷新列表',
      'decision.new': '新建决议',
      'decision.count': '共 {count} 条',
      'decision.empty': '当前没有匹配的决议',
      'decision.newTitle': '新建国家决议',
      'decision.editTitle': '编辑国家决议',
      'decision.file': '决议文件',
      'decision.id': '决议 ID',
      'decision.titleCn': '中文标题',
      'decision.descCn': '中文描述',
      'decision.titlePlaceholder': '如：最后的防线',
      'decision.descPlaceholder': '决议描述的中文文本',
      'decision.icon': '决议图标（可选）',
      'decision.aiWillDo': 'AI 倾向 (ai_will_do)',
      'decision.locHint': '本地化固定为 {title}:0 "…" / {desc}:0 "…"，由 AI 写入 localisation',
      'decision.potential': '显示条件 (potential)',
      'decision.potentialHint': '决定决议是否出现在列表里；默认绑定当前 Tag。',
      'decision.allow': '执行条件 (allow)',
      'decision.allowHint': '决定决议能否点击；不满足时可见但置灰。',
      'decision.effects': '决议效果 (effect)',
      'decision.idInvalid': '决议 ID 只能包含字母、数字、下划线、点和短横线',
      'decision.fileInvalid': '决议文件必须是 decisions/ 下的 .txt',
      'decision.locMissing': '中文标题和中文描述都必须填写',
      'event.titleText': '标题（中文文本）',
      'event.descText': '描述（中文文本）',
      'event.triggerMode': '触发方式',
      'event.triggerNormal': '普通（条件 / 随机触发）',
      'event.triggerStartup': '开局强制触发（写入国家历史文件）',
      'event.targetTag': '目标国家 Tag',
      'event.bindDate': '绑定日期',
      'event.localisationFile': '本地化文件',
      'event.keysHint': '代码固定写成 title = "{title}" / desc = "{desc}"；中文只写入 localisation。',
      'event.preview': '预览最终代码',
      'preview.title': '生成的最终结构（统合前预览）',
      'preview.clean': '结构检查通过（无警告）',
      'preview.codeLabel': '事件文件 {file}',
      'preview.locLabel': '本地化 {file}',
      'preview.historyLabel': '国家历史绑定 {file}',
      'paths.check': '校验写入路径',
      'paths.ok': '位于 Mod 目录（安全）',
      'paths.outside': '不在 Mod 目录（会被拒绝）',
      'mod.valid': 'Mod 目录有效：{root}',
      'mod.invalid': '写入失败：目标路径不是合法的 Mod 目录（缺少 descriptor.mod），请检查设置！',
      'preview.absolutePath': '绝对路径',
      'verify.run': '回读验证',
      'event.startupHint': '将在 {file} 末尾追加：{line}',
      'modifier.idPlaceholder': '修正英文 ID（必填），如 last_stand_modifier',
      'modifier.zhPlaceholder': '修正中文名称，如 最后一战',
      'modifier.check': '检索',
      'modifier.exists': '已加载现有修正',
      'modifier.willCreate': '未找到定义，将作为新修正创建',
      'effect.durationTitle': '持续时间',
      'effect.yearsPlaceholder': '年数',
      'effect.daysPlaceholder': '天数',
      'effect.yearsUnit': '年',
      'effect.daysUnit': '天',
      'effect.durationHint': '1 年 = 365 天；底层只写纯天数（5 年 = 1825），不要填年数。',
      'text.newline': '换行',
      'text.highlightLabel': '高亮',
      'text.insertNewline': '插入段落换行（\\n）',
      'text.highlight': '给选中文字加黄色高亮（§Y…§!）',
      'text.toolsHint': 'EU4 yml 排版工具',
      'effect.eventPlaceholder': '搜索事件 ID / 中文标题，如 hus_event.1、布拉格之战',
      'effect.daysLabel': '延迟天数 (days)',
      'effect.eventMod': 'Mod',
      'effect.eventVanilla': '原版',
      'event.noneFound': '没有匹配的事件',
      'cond.addToLocalDictionary': '添加到本地字典',
      'cond.provincePlaceholder': '请输入省份 ID（如 2664）',
      'cond.provinceSearchPlaceholder': '搜索省份：中文 / 英文 / ID，如 布尔诺、Brno、265',
      'cond.tagPlaceholder': '请输入 3 位字母 Tag（如 TBO）',
      'cond.yearPlaceholder': '请输入年份（如 1437）',
      'cond.flagPlaceholder': '请输入 flag 名（如 tbo_reform）',
      'cond.valuePlaceholder': '值：省份 ID / 年份 / TAG / flag / 脚本',
      'cond.dictionaryValuePlaceholder': '中文翻译',
      'cond.dictionarySave': '保存',
      'cond.dictionarySaved': '已保存：{key}',
      'modifier.searchPlaceholder': '搜索修正：中文 / 英文 Key，如 士气、morale、global_unrest',
    };
    let SIDEBAR_LABEL = 'EU4 Workbench';
    const LocaleContext = React.createContext({ t: (key) => key, reload: async () => {} });
    const useLocale = () => React.useContext(LocaleContext);
    const DictionaryContext = React.createContext({ triggers: [], effects: [], modifiers: [], modifierTree: [], categories: [], techGroups: [], governments: [], religions: [], cultures: [], cultureGroups: [] });
    const useDictionary = () => React.useContext(DictionaryContext);
    const QueueContext = React.createContext({ queue: [], count: 0, enqueue: async () => ({}), refresh: async () => {} });
    const useQueue = () => React.useContext(QueueContext);

    /* ------------------------------------------------------------------
     * Form memory. Whatever a panel was editing survives a tab switch, but
     * there is no draft layer any more: no localStorage, no dirty flags, no
     * save/restore buttons, no "leave this page?" prompt. Values live in
     * memory for the lifetime of the panel and are dropped on reload.
     * ---------------------------------------------------------------- */
    const formMemory = new Map();
    function rememberForm(key, initial) {
      if (!formMemory.has(key)) formMemory.set(key, initial);
      return formMemory.get(key);
    }
    function updateFormMemory(key, next) {
      formMemory.set(key, next);
      return next;
    }
    /** Same contract as useState, but the value is kept across tab unmounts. */
    function useFormState(key, initial) {
      const [value, setValue] = useState(() => rememberForm(key, initial));
      const update = useCallback((updater) => {
        setValue((prev) => updateFormMemory(key, typeof updater === 'function' ? updater(prev) : updater));
      }, [key]);
      const reset = useCallback((next = initial) => {
        setValue(updateFormMemory(key, typeof next === 'function' ? next(initial) : next));
      }, [key, initial]);
      return [value, update, { reset }];
    }

    /* Header clipboard: the form of the visible tab, in memory only. */
    const ClipboardContext = React.createContext({ register: () => () => {} });
    /** Bumped by the header refresh button; panels re-read their file on change. */
    const RefreshContext = React.createContext(0);
    /**
     * Which form-memory keys belong to which tab. The header refresh clears
     * them so a stale form can never shadow freshly written files.
     */
    const TAB_FORM_KEYS = {
      province: ['provinceForm'],
      country: ['countryForm'],
      ideas: ['ideaForm.traditions', 'ideaForm.ambition', 'ideaForm.ideas', 'ideaForm.meta'],
      government: ['governmentReform', 'governmentTag'],
      missions: ['missionForm.path', 'missionForm.nodes'],
      events: ['eventForm', 'eventForm.isNew'],
      diplomacy: ['diplomacyForm'],
      gui: ['guiForm'],
      mechanic: ['mechanicForm', 'mechanicForm.name'],
      validate: ['validateForm.script', 'validateForm.scope'],
    };
    function clearFormMemory(keys) {
      for (const key of keys || []) formMemory.delete(key);
    }
    function useRegisterForm(key, value, onPaste) {
      const latest = useRef({ value, onPaste });
      latest.current = { value, onPaste };
      const { register } = React.useContext(ClipboardContext);
      useEffect(() => register({
        key,
        getValue: () => latest.current.value,
        onPaste: (data) => latest.current.onPaste(data),
      }), [key, register]);
    }
    const fillParams = (template, params) => String(template).replace(/\{(\w+)\}/g, (match, name) => (
      params && params[name] !== undefined ? String(params[name]) : match
    ));

    const EFFECT_CHOICES = [
      'add_prestige', 'add_stability', 'add_legitimacy', 'add_adm_power', 'add_dip_power', 'add_mil_power',
      'add_treasury', 'add_manpower', 'add_army_tradition', 'add_navy_tradition', 'add_republican_tradition',
      'add_devotion', 'add_mercantilism', 'add_inflation', 'add_corruption', 'add_war_exhaustion',
      'add_years_of_income', 'add_country_modifier', 'add_core', 'add_claim', 'add_casus_belli',
      'add_loan', 'create_advisor', 'create_general', 'create_admiral', 'change_religion',
      'country_event', 'custom',
    ];
    const CONDITION_CHOICES = [
      ['owns', 'cond.owns'],
      ['controls', 'cond.controls'],
      ['year', 'cond.year'],
      ['is_year', 'cond.is_year'],
      ['tag', 'cond.tag'],
      ['has_country_flag', 'cond.has_country_flag'],
      ['religion', 'cond.religion'],
      ['government', 'cond.government'],
      ['has_regency', 'cond.has_regency'],
      ['legitimacy', 'cond.legitimacy'],
      ['custom', 'cond.custom'],
    ];
    const PICTURE_CHOICES = ['painting', 'event_picture', 'administration', 'diplomacy', 'military', 'trade', 'religion'];

    const field = (label, node) => h('label', { className: 'eu4w-col' },
      h('span', { className: 'eu4w-muted' }, label),
      node,
    );

    /**
     * Inline quick-add for a missing localisation key. Saves the raw game key
     * (e.g. phoenician) to the user custom dictionary, then reloads messages.
     */
    function DictionaryQuickAdd({ wordKey }) {
      const { t, reload } = useLocale();
      const [editing, setEditing] = useState(false);
      const [text, setText] = useState('');
      const [msg, setMsg] = useState('');
      const stop = (event) => { event.preventDefault(); event.stopPropagation(); };
      const save = async () => {
        const value = text.trim();
        if (!value) return;
        try {
          await api('/dictionary/custom', { method: 'POST', body: JSON.stringify({ key: wordKey, value }) });
          setEditing(false);
          setText('');
          setMsg('');
          if (reload) await reload();
        } catch (e) {
          setMsg(String(e.message || e));
        }
      };
      if (!editing) {
        return h('span', {
          className: 'eu4w-quickadd', title: t('quick.add'),
          onMouseDown: (e) => { stop(e); setEditing(true); },
        }, '✏️');
      }
      return h('span', { className: 'eu4w-quickadd-edit', onMouseDown: stop },
        h('input', {
          className: 'eu4w-input', style: { width: 92 }, value: text, placeholder: t('quick.placeholder'),
          onChange: (e) => setText(e.target.value),
          onKeyDown: (e) => { if (e.key === 'Enter') save(); },
        }),
        h('button', { className: 'eu4w-btn', type: 'button', onMouseDown: (e) => { stop(e); save(); } }, '✓'),
        h('button', { className: 'eu4w-btn', type: 'button', onMouseDown: (e) => { stop(e); setEditing(false); } }, '×'),
        msg ? h('span', { className: 'eu4w-err' }, msg) : null,
      );
    }

    /**
     * Searchable dropdown: displays a Chinese label, searches labels + pinyin
     * keywords + English value, but binds/passes only the English code.
     */
    function SearchSelect({ value, options, onChange, prefix, placeholder, allowCustom }) {
      const { t } = useLocale();
      const [open, setOpen] = useState(false);
      const [query, setQuery] = useState('');
      const picked = useRef(false);
      const labelOf = (option) => {
        const key = (prefix ? prefix + '.' : '') + option.value;
        const text = t(key);
        if (text !== key) return text;
        // User quick-added dictionary entries are plain `code: 中文` keys.
        const raw = t(option.value);
        return raw !== option.value ? raw : (option.label || option.value);
      };
      const selected = (options || []).find((option) => option.value === value);
      const q = query.trim().toLowerCase();
      const list = (options || []).filter((option) => {
        if (!q) return true;
        return `${labelOf(option)} ${option.keywords || ''} ${option.value} ${option.group_name || ''}`.toLowerCase().includes(q);
      }).slice(0, 500);
      const rows = [];
      let lastGroup = null;
      for (const option of list) {
        if (option.group) {
          const groupLabel = option.group_name || t('culture_group.' + option.group);
          if (groupLabel !== lastGroup) {
            rows.push(h('div', { className: 'eu4w-search-group', key: 'group-' + option.group }, groupLabel));
          }
          lastGroup = groupLabel;
        }
        const key = (prefix ? prefix + '.' : '') + option.value;
        const translated = t(key) !== key;
        const editable = ['religion', 'government', 'techgroup'].includes(prefix);
        rows.push(h('div', {
          key: option.value,
          className: 'eu4w-search-row' + (option.value === value ? ' on' : ''),
        },
          h('button', {
            type: 'button',
            className: 'eu4w-search-pick',
            onMouseDown: (e) => {
              e.preventDefault();
              picked.current = true;
              onChange(option.value);
              setOpen(false);
              setQuery('');
            },
          }, h('span', null, translated && editable ? `${labelOf(option)} (${option.value})` : labelOf(option))),
          editable && !translated ? h(DictionaryQuickAdd, { wordKey: option.value }) : null,
        ));
      }
      return h('div', { className: 'eu4w-search' },
        h('input', {
          className: 'eu4w-input',
          value: open ? query : (selected ? labelOf(selected) : (value || '')),
          placeholder: placeholder || t('tooltip.search'),
          onFocus: () => { picked.current = false; setOpen(true); setQuery(''); },
          onChange: (e) => { picked.current = false; setOpen(true); setQuery(e.target.value); },
          onBlur: () => setTimeout(() => {
            setOpen(false);
            if (picked.current) { picked.current = false; setQuery(''); return; }
            const custom = query.trim();
            if (allowCustom && custom && !(options || []).some((option) => option.value === custom || labelOf(option) === custom)) {
              onChange(custom);
            }
            setQuery('');
          }, 150),
        }),
        open ? h('div', { className: 'eu4w-search-list' },
          ...rows,
          list.length === 0 ? h('div', { className: 'eu4w-muted', style: { padding: 6 } }, t('search.none')) : null,
        ) : null,
      );
    }

    /* ------------------------------------------------------------------
     * Province catalog. The numeric Province ID is the only value that is
     * ever bound, stored or queued; the label is always derived for display:
     * `[2664] 皮尔森 (Plzeň)` -> `[2664] Plzeň` (no Chinese) -> `[2664]`.
     * Names come from the Host, which parses vanilla + Mod localisation, so
     * nothing here is hard-coded.
     * ---------------------------------------------------------------- */
    const PROVINCE_FOLD = { 'ø': 'o', 'æ': 'ae', 'œ': 'oe', 'ß': 'ss', 'ł': 'l', 'đ': 'd', 'ð': 'd', 'þ': 'th', 'ı': 'i', 'ŋ': 'n' };
    /** Same folding as the Host so the local filter and the API agree. */
    function normalizeProvinceText(value) {
      return String(value ?? '')
        .toLowerCase()
        .replace(/[øæœßłđðþıŋ]/g, (ch) => PROVINCE_FOLD[ch] || ch)
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    }
    function provinceLabelOf(entry, fallbackId) {
      const id = Number(entry?.id ?? fallbackId);
      const cn = String(entry?.name_cn || '').trim();
      const en = String(entry?.name_en || entry?.name || '').trim();
      const head = '[' + (Number.isFinite(id) ? id : '?') + ']';
      if (cn && en && cn !== en) return head + ' ' + cn + ' (' + en + ')';
      if (cn) return head + ' ' + cn;
      if (en) return head + ' ' + en;
      return head;
    }
    /** `[2664] 皮尔森 (Plzeň)` — card main + sub line for the map grid. */
    function provinceCardText(province) {
      const id = Number(province?.id);
      const cn = String(province?.name_cn || '').trim();
      const en = String(province?.name_en || province?.name || '').trim();
      const owner = String(province?.owner || '').trim();
      const main = cn || en || (Number.isFinite(id) ? String(id) : '—');
      const idText = '[' + (Number.isFinite(id) ? id : '') + ']';
      const detail = cn && en ? idText + ' ' + en : idText;
      return {
        main,
        mainIsChinese: Boolean(cn),
        sub: owner ? detail + ' · ' + owner : detail,
        tip: provinceLabelOf(province),
      };
    }
    /**
     * Ideas file JSON -> editable slots. Values stay in native EU4 units
     * (0.10) so the rows can show 10%; names/descs come from localisation.
     */
    function ideasToSlots(data) {
      const start = Array.isArray(data?.traditions) ? data.traditions : [];
      const traditions = Array.from({ length: Math.max(2, start.length) }, (_, i) => ({
        modifiers: start[i]
          ? [{ modifier: String(start[i].modifier), value: String(start[i].value) }]
          : [{ modifier: 'land_morale', value: '0' }],
      }));
      const bonus = Array.isArray(data?.ambitionModifiers) && data.ambitionModifiers.length
        ? data.ambitionModifiers
        : (data?.ambition ? [data.ambition] : []);
      const ambition = {
        modifiers: (bonus.length ? bonus : [{ modifier: 'core_creation', value: '-0.1' }])
          .map((m) => ({ modifier: String(m.modifier), value: String(m.value) })),
      };
      const ideas = Array.from({ length: 7 }, (_, i) => {
        const idea = (Array.isArray(data?.ideas) ? data.ideas : [])[i];
        if (!idea) return { id: 'idea_' + (i + 1), name: '', desc: '', modifiers: [{ modifier: 'land_morale', value: '0' }] };
        const modifiers = (Array.isArray(idea.modifiers) && idea.modifiers.length ? idea.modifiers : [{ modifier: 'land_morale', value: '0' }])
          .map((m) => ({ modifier: String(m.modifier), value: String(m.value) }));
        return { id: idea.id, name: idea.name || '', desc: idea.desc || '', modifiers };
      });
      return { traditions, ambition, ideas };
    }
    function provinceMatchScore(entry, tokens) {
      if (!tokens.length) return 5;
      const idText = String(entry?.id ?? '');
      const cn = normalizeProvinceText(entry?.name_cn);
      const en = normalizeProvinceText(entry?.name_en || entry?.name);
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
    /** Instant local filtering: `2664`, `皮尔森` and `Plz` all hit the same row. */
    function filterProvinces(entries, query, limit = 60) {
      const list = Array.isArray(entries) ? entries : [];
      const tokens = normalizeProvinceText(query).split(' ').filter(Boolean);
      if (!tokens.length) return list.slice(0, limit);
      const scored = [];
      for (const entry of list) {
        const score = provinceMatchScore(entry, tokens);
        if (score >= 0) scored.push({ entry, score });
      }
      scored.sort((left, right) => left.score - right.score || Number(left.entry.id) - Number(right.entry.id));
      return scored.slice(0, limit).map((item) => item.entry);
    }
    let provinceCatalogCache = null;
    let provinceCatalogMeta = null;
    let provinceCatalogPromise = null;
    function loadProvinceCatalog() {
      if (!provinceCatalogPromise) {
        provinceCatalogPromise = api('/provinces/dictionary?limit=12000')
          .then((data) => {
            const items = (data.items || []).map((item) => ({ ...item, label: item.label || provinceLabelOf(item) }));
            provinceCatalogMeta = {
              chineseCount: Number(data.chineseCount) || 0,
              provinceCount: Number(data.provinceCount) || items.length,
              unreadableFiles: Number(data.unreadableFiles) || 0,
              localisationFiles: Number(data.localisationFiles) || 0,
              roots: Array.isArray(data.roots) ? data.roots : [],
            };
            provinceCatalogCache = items;
            return { items, meta: provinceCatalogMeta };
          })
          .catch((error) => { provinceCatalogPromise = null; throw error; });
      }
      return provinceCatalogPromise;
    }
    /** One shared fetch per session; every picker filters the same list. */
    function useProvinceCatalog() {
      const [items, setItems] = useState(() => provinceCatalogCache || []);
      const [meta, setMeta] = useState(() => provinceCatalogMeta);
      const [error, setError] = useState('');
      useEffect(() => {
        let alive = true;
        loadProvinceCatalog()
          .then((data) => { if (alive) { setItems(data.items); setMeta(data.meta); } })
          .catch((e) => { if (alive) setError(String(e.message || e)); });
        return () => { alive = false; };
      }, []);
      return { items, meta, error };
    }

    /**
     * Searchable province picker. `onChange(id, item)` always receives a
     * Number, so a form can never hold a province name where an ID belongs.
     */
    function ProvincePicker({ value, items, onChange, placeholder, disabled }) {
      const { t } = useLocale();
      const [open, setOpen] = useState(false);
      const [query, setQuery] = useState('');
      const picked = useRef(false);
      const current = useMemo(() => (items || []).find((item) => Number(item.id) === Number(value)), [items, value]);
      const typed = query.trim();
      const results = useMemo(() => filterProvinces(items || [], typed, 60), [items, typed]);
      const numeric = /^\d+$/.test(typed) ? Number(typed) : null;
      const pick = (item) => {
        picked.current = true;
        onChange(Number(item.id), item);
        setOpen(false);
        setQuery('');
      };
      return h('div', { className: 'eu4w-search' },
        h('input', {
          className: 'eu4w-input',
          value: open ? query : (current ? (current.label || provinceLabelOf(current)) : (value ? provinceLabelOf(null, value) : '')),
          placeholder: placeholder || t('province.pickerPlaceholder'),
          disabled,
          onFocus: () => { picked.current = false; setOpen(true); setQuery(''); },
          onChange: (e) => { picked.current = false; setOpen(true); setQuery(e.target.value); },
          onKeyDown: (e) => {
            if (e.key === 'Enter') {
              if (results.length) { e.preventDefault(); pick(results[0]); }
              else if (numeric) { e.preventDefault(); pick({ id: numeric }); }
            } else if (e.key === 'Escape') {
              setOpen(false);
              setQuery('');
            }
          },
          onBlur: () => setTimeout(() => {
            setOpen(false);
            if (picked.current) { picked.current = false; setQuery(''); return; }
            if (numeric) onChange(numeric, null);
            setQuery('');
          }, 150),
        }),
        open ? h('div', { className: 'eu4w-search-list' },
          ...results.map((item) => h('div', {
            key: item.id,
            className: 'eu4w-search-row' + (Number(value) === Number(item.id) ? ' on' : ''),
          },
            h('button', {
              type: 'button',
              className: 'eu4w-search-pick',
              onMouseDown: (e) => { e.preventDefault(); pick(item); },
            }, h('span', null, item.label || provinceLabelOf(item))),
          )),
          results.length === 0 ? h('div', { className: 'eu4w-muted', style: { padding: 6 } }, t('province.pickerEmpty')) : null,
          numeric && !(items || []).some((item) => Number(item.id) === numeric)
            ? h('button', {
              type: 'button',
              className: 'eu4w-search-pick',
              onMouseDown: (e) => { e.preventDefault(); pick({ id: numeric }); },
            }, t('province.useId', { id: numeric }))
            : null,
        ) : null,
      );
    }

    /**
     * Culture tree select: two-level collapsible tree (group -> culture).
     * Groups are NOT selectable; only a concrete culture id is bound.
     */
    function CultureTreeSelect({ value, groups, cultures, onChange, placeholder }) {
      const { t } = useLocale();
      const [open, setOpen] = useState(false);
      const [query, setQuery] = useState('');
      const [expanded, setExpanded] = useState(() => new Set());
      const picked = useRef(false);
      const PINYIN = {
        germanic: 'rierman', latin: 'lading', west_slavic: 'xishilafu',
        south_slavic: 'nanshilafu', british: 'buliedian', french: 'falanxi',
        iberian: 'iyibiya', scandinavian: 'sikandinaweiya',
        prussian: 'pulushi', saxon: 'sakesen', austrian: 'aodili',
        czech: 'jieke', polish: 'bolan', sicilian: 'xixili', piedmontese: 'piaimengte',
        english: 'yinggelan', castillian: 'kasidiliya', russian: 'eluosi',
        turkish: 'tuerqi', greek: 'xila', swedish: 'ruidian', danish: 'danmai',
        norwegian: 'nuowei', finnish: 'fenlan', hungarian: 'xiongyali',
        romanian: 'luomaniya', bulgarian: 'baojialiya', serbian: 'saierweiya',
        japanese: 'riben', korean: 'chaoxian', vietnamese: 'yuenan', mongol: 'menggu',
      };
      const tree = useMemo(() => {
        const source = groups && groups.length
          ? groups.map((group) => ({
            key: group.group_id,
            label: group.group_name || t('culture_group.' + group.group_id),
            children: (group.cultures || []).map((culture) => {
              const key = 'culture.' + culture.id;
              const text = t(key);
              return {
                key: culture.id,
                value: culture.id,
                label: text === key ? (culture.name || culture.id) : text,
                translated: text !== key,
                keywords: culture.keywords || '',
              };
            }),
          }))
          : (() => {
            const byGroup = new Map();
            for (const culture of cultures || []) {
              const id = culture.group || 'other';
              if (!byGroup.has(id)) byGroup.set(id, { key: id, label: culture.group_name || id, children: [] });
              byGroup.get(id).children.push({ key: culture.value, value: culture.value, label: culture.label || culture.value, keywords: culture.keywords || '' });
            }
            return [...byGroup.values()];
          })();
        return source;
      }, [groups, cultures, t]);
      const allCultures = tree.flatMap((group) => group.children);
      const selected = allCultures.find((culture) => culture.value === value);
      useEffect(() => {
        const group = tree.find((entry) => entry.children.some((culture) => culture.value === value));
        if (!group) return;
        setExpanded((prev) => (prev.has(group.key) ? prev : new Set(prev).add(group.key)));
      }, [value, tree]);
      const q = query.trim().toLowerCase();
      const hay = (text, pinyin) => `${text} ${pinyin || ''}`.toLowerCase();
      const filtered = tree.map((group) => {
        const groupHit = !q || hay(group.label, PINYIN[group.key]).includes(q) || group.key.toLowerCase().includes(q);
        const children = group.children.filter((culture) => !q || groupHit
          || hay(culture.label, PINYIN[culture.value]).includes(q)
          || culture.value.toLowerCase().includes(q)
          || (culture.keywords || '').toLowerCase().includes(q));
        return { ...group, groupHit, children };
      }).filter((group) => group.children.length > 0 || (!q && group.children.length === 0));
      const mark = (text) => {
        if (!q) return text;
        const index = String(text).toLowerCase().indexOf(q);
        if (index < 0) return text;
        return [text.slice(0, index), h('mark', { key: 'hl' }, text.slice(index, index + q.length)), text.slice(index + q.length)];
      };
      const toggleGroup = (key) => setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key); else next.add(key);
        return next;
      });
      return h('div', { className: 'eu4w-search eu4w-tree' },
        h('input', {
          className: 'eu4w-input',
          value: open ? query : (selected ? selected.label : (value || '')),
          placeholder: placeholder || t('tooltip.search'),
          onFocus: () => { picked.current = false; setOpen(true); setQuery(''); },
          onChange: (e) => { picked.current = false; setOpen(true); setQuery(e.target.value); },
          onBlur: () => setTimeout(() => { setOpen(false); setQuery(''); }, 150),
        }),
        open ? h('div', { className: 'eu4w-search-list eu4w-tree-list' },
          ...filtered.map((group) => {
            const isOpen = expanded.has(group.key) || (q && (group.groupHit || group.children.length > 0));
            return h('div', { key: group.key, className: 'eu4w-tree-groupblock' },
              h('button', {
                type: 'button',
                className: 'eu4w-tree-group',
                onMouseDown: (e) => { e.preventDefault(); picked.current = true; toggleGroup(group.key); },
              },
                h('span', { className: 'eu4w-tree-arrow' }, isOpen ? '▼' : '▶'),
                h('span', null, mark(group.label)),
                h('small', null, String(group.children.length)),
              ),
              isOpen ? h('div', { className: 'eu4w-tree-children' },
                ...group.children.map((culture) => h('div', {
                  key: culture.value,
                  className: 'eu4w-search-row' + (culture.value === value ? ' on' : ''),
                },
                  h('button', {
                    type: 'button',
                    className: 'eu4w-search-pick eu4w-tree-item',
                    onMouseDown: (e) => {
                      e.preventDefault();
                      picked.current = true;
                      onChange(culture.value);
                      setOpen(false);
                      setQuery('');
                    },
                  }, h('span', null, culture.translated ? [mark(culture.label), ` (${culture.value})`] : mark(culture.label))),
                  culture.translated ? null : h(DictionaryQuickAdd, { wordKey: culture.value }),
                )),
              ) : null,
            );
          }),
          filtered.length === 0 ? h('div', { className: 'eu4w-muted', style: { padding: 6 } }, t('search.none')) : null,
        ) : null,
      );
    }

    /**
     * Filter the modifier tree for the selector. Matches the Chinese label, the
     * English key and pinyin/keyword aliases; returns categories/groups that
     * still have hits, so the dropdown can show `[军事] 陆军士气 (land_morale)`.
     */
    function filterModifierTree(tree, query) {
      const q = String(query || '').trim().toLowerCase();
      const out = [];
      for (const category of tree || []) {
        const groups = [];
        for (const group of category.groups || []) {
          const items = (group.items || []).filter((item) => {
            if (!q) return true;
            return String(item.label || '').toLowerCase().includes(q)
              || String(item.value || '').toLowerCase().includes(q)
              || String(item.keywords || '').toLowerCase().includes(q);
          });
          if (items.length) groups.push({ ...group, items });
        }
        if (groups.length) out.push({ ...category, groups, total: groups.reduce((sum, group) => sum + group.items.length, 0) });
      }
      return out;
    }

    /** Reverse lookup for a raw English key; falls back to the key itself. */
    function modifierLabelFrom(options, key) {
      if (!key) return '';
      const found = (options || []).find((option) => option.value === key);
      return found ? found.label : key;
    }

    /**
     * Category -> group -> modifier tree selector. Binds the plain English key;
     * the input and rows show Chinese. Search covers label/key/pinyin.
     */
    function ModifierTreeSelector({ value, options, tree, onChange, placeholder }) {
      const { t } = useLocale();
      const [open, setOpen] = useState(false);
      const [query, setQuery] = useState('');
      const [collapsed, setCollapsed] = useState({});
      const picked = useRef(false);
      const current = (options || []).find((option) => option.value === value);
      /** Chinese label for a key; falls back to the host locale pack, then the key. */
      const labelOf = (key) => {
        const found = (options || []).find((option) => option.value === key);
        if (found && found.label) return found.label;
        const translated = t('modifier.' + key);
        return translated === 'modifier.' + key ? key : translated;
      };
      // Older hosts may not send the tree yet; fall back to one flat group so
      // the selector still works (labels come with the options either way).
      const effectiveTree = (tree && tree.length)
        ? tree
        : [{ id: 'all', label: '全部', groups: [{ id: 'all', label: '修正', items: options || [] }] }];
      const filtered = useMemo(() => filterModifierTree(effectiveTree, query), [effectiveTree, query]);
      const searching = String(query || '').trim() !== '';
      const allMatches = useMemo(
        () => filtered.flatMap((category) => category.groups.flatMap((group) => group.items)),
        [filtered],
      );
      const toggle = (key) => setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
      const pick = (item) => {
        picked.current = true;
        onChange(item.value);
        setOpen(false);
        setQuery('');
      };
      const rows = [];
      for (const category of filtered) {
        const categoryOpen = searching || !collapsed['c:' + category.id];
        rows.push(h('div', { className: 'eu4w-tree-cat', key: 'c-' + category.id },
          h('button', {
            type: 'button',
            className: 'eu4w-tree-toggle',
            onMouseDown: (e) => { e.preventDefault(); toggle('c:' + category.id); },
          }, `${categoryOpen ? '▼' : '▶'} ${category.label} (${category.total})`),
        ));
        if (!categoryOpen) continue;
        for (const group of category.groups) {
          const groupKey = 'g:' + category.id + '.' + group.id;
          const groupOpen = searching || !collapsed[groupKey];
          rows.push(h('div', { className: 'eu4w-tree-group', key: groupKey },
            h('button', {
              type: 'button',
              className: 'eu4w-tree-toggle sub',
              onMouseDown: (e) => { e.preventDefault(); toggle(groupKey); },
            }, `${groupOpen ? '▾' : '▸'} ${group.label} (${group.items.length})`),
          ));
          if (!groupOpen) continue;
          for (const item of group.items) {
            rows.push(h('div', {
              key: item.value,
              className: 'eu4w-search-row' + (item.value === value ? ' on' : ''),
            },
              h('button', {
                type: 'button',
                className: 'eu4w-search-pick',
                onMouseDown: (e) => { e.preventDefault(); pick(item); },
              },
                h('span', null, `[${category.label}] ${item.label} (${item.value})`),
                h('small', null, item.type === 'percentage' ? '%' : item.type === 'integer' ? '#' : '≈'),
              ),
            ));
          }
        }
      }
      return h('div', { className: 'eu4w-search eu4w-tree' },
        h('input', {
          className: 'eu4w-input',
          value: open ? query : (value ? labelOf(value) : ''),
          placeholder: placeholder || t('modifier.searchPlaceholder'),
          title: value || '',
          onFocus: () => { picked.current = false; setOpen(true); setQuery(''); },
          onChange: (e) => { picked.current = false; setOpen(true); setQuery(e.target.value); },
          onKeyDown: (e) => {
            if (e.key === 'Enter' && allMatches.length) { e.preventDefault(); pick(allMatches[0]); }
            else if (e.key === 'Escape') { setOpen(false); setQuery(''); }
          },
          onBlur: () => setTimeout(() => {
            if (picked.current) { picked.current = false; }
            setOpen(false);
            setQuery('');
          }, 160),
        }),
        open ? h('div', { className: 'eu4w-search-list eu4w-tree-list' },
          ...rows,
          filtered.length === 0 ? h('div', { className: 'eu4w-muted', style: { padding: 6 } }, t('search.none')) : null,
        ) : null,
      );
    }

    /** Filter the event catalogue by id, namespace or Chinese title. */
    function filterEventCatalog(items, query) {
      const q = String(query || '').trim().toLowerCase();
      const list = items || [];
      if (!q) return list.slice(0, 400);
      return list.filter((item) => String(item.id || '').toLowerCase().includes(q)
        || String(item.title || '').toLowerCase().includes(q)
        || String(item.namespace || '').toLowerCase().includes(q)).slice(0, 400);
    }

    function eventCatalogLabel(item) {
      if (!item) return '';
      return item.title ? item.id + ' — ' + item.title : item.id;
    }

    /**
     * Searchable event picker: searches English id / Chinese title, binds the
     * plain event id string (never a number, so a wrong value cannot crash the
     * game by resolving to a non-existent event).
     */
    function EventSelect({ value, items, onChange, placeholder }) {
      const { t } = useLocale();
      const [open, setOpen] = useState(false);
      const [query, setQuery] = useState('');
      const picked = useRef(false);
      const catalog = items || [];
      const current = catalog.find((item) => item.id === value);
      const list = filterEventCatalog(catalog, query);
      return h('div', { className: 'eu4w-search' },
        h('input', {
          className: 'eu4w-input', style: { minWidth: 240 },
          value: open ? query : (current ? eventCatalogLabel(current) : (value || '')),
          placeholder: placeholder || t('effect.eventPlaceholder'),
          title: value || '',
          onFocus: () => { picked.current = false; setOpen(true); setQuery(''); },
          onChange: (e) => { picked.current = false; setOpen(true); setQuery(e.target.value); },
          onKeyDown: (e) => { if (e.key === 'Escape') { setOpen(false); setQuery(''); } },
          onBlur: () => setTimeout(() => {
            setOpen(false);
            if (!picked.current) {
              const typed = query.trim();
              // A manually typed id is allowed (event may not be indexed yet),
              // but a bare number is rejected: it is the crash we are fixing.
              if (typed && /^[A-Za-z0-9_.\-]+$/.test(typed) && !/^\d+$/.test(typed)
                && !catalog.some((item) => item.id === typed)) {
                onChange(typed);
              }
            }
            setQuery('');
            picked.current = false;
          }, 160),
        }),
        open ? h('div', { className: 'eu4w-search-list' },
          ...list.map((item) => h('div', {
            key: item.id,
            className: 'eu4w-search-row' + (item.id === value ? ' on' : ''),
          },
            h('button', {
              type: 'button',
              className: 'eu4w-search-pick',
              onMouseDown: (e) => {
                e.preventDefault();
                picked.current = true;
                onChange(item.id);
                setOpen(false);
                setQuery('');
              },
            },
              h('span', null, eventCatalogLabel(item)),
              h('small', null, item.source === 'mod' ? t('effect.eventMod') : t('effect.eventVanilla')),
            ),
          )),
          list.length === 0 ? h('div', { className: 'eu4w-muted', style: { padding: 6 } }, t('event.noneFound')) : null,
        ) : null,
      );
    }

    /** Hint for an unknown trigger/effect code, with an inline dictionary add. */
    function UnknownHint({ code }) {
      const { t, reload } = useLocale();
      const [editing, setEditing] = useState(false);
      const [text, setText] = useState('');
      const [saved, setSaved] = useState('');
      const [msg, setMsg] = useState('');
      if (!code) return null;
      const save = async () => {
        const value = text.trim();
        if (!value) return;
        try {
          await api('/dictionary/custom', { method: 'POST', body: JSON.stringify({ key: code, value }) });
          setEditing(false);
          setText('');
          setMsg('');
          setSaved(t('cond.dictionarySaved', { key: code }));
          if (reload) await reload();
        } catch (e) { setMsg(String(e.message || e)); }
      };
      return h('div', { className: 'eu4w-col eu4w-warn' },
        h('div', { className: 'eu4w-row' },
          h('span', null, t('cond.unknown', { code })),
          !editing ? h('button', { className: 'eu4w-btn', onClick: () => setEditing(true) }, t('cond.addToLocalDictionary')) : null,
          saved && !editing ? h('span', { className: 'eu4w-ok' }, saved) : null,
        ),
        editing ? h('div', { className: 'eu4w-row' },
          h('input', {
            className: 'eu4w-input', style: { width: 200 }, value: text,
            placeholder: t('cond.dictionaryValuePlaceholder'),
            onChange: (e) => setText(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') save(); },
          }),
          h('button', { className: 'eu4w-btn primary', onClick: save }, t('cond.dictionarySave')),
          h('button', { className: 'eu4w-btn', onClick: () => { setEditing(false); setText(''); setMsg(''); } }, t('common.cancel')),
          msg ? h('span', { className: 'eu4w-err' }, msg) : null,
        ) : null,
      );
    }

    /** Neighbour picker for `any_neighbor_province` (uses the map focus). */
    function NeighborPicker({ provinceId, value, onChange }) {
      const { t } = useLocale();
      const [data, setData] = useState(null);
      useEffect(() => {
        if (!provinceId) { setData(null); return undefined; }
        let alive = true;
        api('/provinces/adjacent?id=' + provinceId)
          .then((d) => { if (alive) setData(d); })
          .catch(() => { if (alive) setData({ items: [], warning: '读取相邻省份失败' }); });
        return () => { alive = false; };
      }, [provinceId]);
      if (!provinceId) return h('div', { className: 'eu4w-muted' }, t('neighbor.pickOnMap'));
      if (!data) return h('div', { className: 'eu4w-muted' }, t('common.loading'));
      return h('div', { className: 'eu4w-col' },
        h('div', { className: 'eu4w-muted' }, t('neighbor.hint', { id: provinceId })),
        data.items && data.items.length
          ? h('div', { className: 'eu4w-chips' }, ...data.items.map((item) => h('button', {
            key: item.id, type: 'button',
            className: 'eu4w-btn' + (String(value) === String(item.id) ? ' primary' : ''),
            title: item.label,
            onClick: () => onChange(item.id),
          }, (item.water ? '🌊 ' : '') + item.label)))
          : h('div', { className: 'eu4w-muted' }, data.note || t('neighbor.empty')),
        data.warning ? h('div', { className: 'eu4w-warn' }, data.warning) : null,
      );
    }

    /** Type-specific value hint: no more one-size-fits-all placeholder. */
    function conditionPlaceholder(type, t) {
      if (type === 'owns' || type === 'controls') return t('cond.provincePlaceholder');
      if (type === 'tag') return t('cond.tagPlaceholder');
      if (type === 'year' || type === 'is_year') return t('cond.yearPlaceholder');
      if (type === 'has_country_flag') return t('cond.flagPlaceholder');
      return t('cond.valuePlaceholder');
    }

    /** UI shape `{type,...}` -> payload shape `{condition, op, value}`. */
    function conditionPayload(node) {
      if (!node || typeof node !== 'object') return node;
      const out = {
        condition: node.condition || node.type,
        op: node.op || '=',
        value: String(node.value ?? ''),
      };
      if (Array.isArray(node.children)) out.children = node.children.map(conditionPayload);
      return out;
    }
    function conditionPayloads(rows) {
      return (Array.isArray(rows) ? rows : []).map(conditionPayload);
    }

    function ConditionNode({ node, onChange, onRemove, depth }) {
      const { t } = useLocale();
      const { triggers } = useDictionary();
      const { focusId } = useProvinceFocus();
      const catalog = useProvinceCatalog();
      const provinceCondition = node.type === 'owns' || node.type === 'controls';
      const isLogic = node.type === 'AND' || node.type === 'OR' || node.type === 'NOT';
      if (isLogic) {
        return h('div', { className: 'eu4w-logic' },
          h('div', { className: 'eu4w-row' },
            h('select', {
              className: 'eu4w-select', value: node.type,
              onChange: (e) => onChange({ ...node, type: e.target.value }),
            }, ...['AND', 'OR', 'NOT'].map((value) => h('option', { key: value, value }, value))),
            h('button', { className: 'eu4w-btn danger', onClick: onRemove }, t('common.delete')),
          ),
          depth >= 4
            ? h('div', { className: 'eu4w-col' },
              h('div', { className: 'eu4w-muted' }, t('cond.sourceMode')),
              h('textarea', {
                className: 'eu4w-area', rows: 3, value: node.raw || '',
                onChange: (e) => onChange({ ...node, raw: e.target.value }),
              }))
            : h(ConditionRows, {
              rows: node.children || [],
              depth: depth + 1,
              onChange: (children) => onChange({ ...node, children }),
            }),
        );
      }
      if (node.type === 'custom' || node.complex) {
        return h('div', { className: 'eu4w-logic' },
          h('div', { className: 'eu4w-muted' }, t('cond.sourceMode')),
          h('textarea', {
            className: 'eu4w-area', rows: 3, value: node.raw || node.value || '',
            onChange: (e) => onChange({ ...node, raw: e.target.value, value: e.target.value, complex: true }),
          }),
          h('button', { className: 'eu4w-btn danger', onClick: onRemove }, t('common.delete')),
        );
      }
      const base = triggers.length ? triggers : CONDITION_CHOICES.map(([value]) => ({ value, keywords: value }));
      const options = node.type && !base.some((option) => option.value === node.type)
        ? [{ value: node.type, keywords: node.type }, ...base]
        : base;
      return h('div', { className: 'eu4w-col' },
        h('div', { className: 'eu4w-row' },
          h(SearchSelect, {
            value: node.type,
            options,
            onChange: (value) => onChange({ ...node, type: value, unknown: false }),
            prefix: 'trigger',
          }),
          ['year', 'is_year', 'legitimacy'].includes(node.type) ? h('select', {
            className: 'eu4w-select', value: node.op || '=',
            onChange: (e) => onChange({ ...node, op: e.target.value }),
          }, ...['>', '>=', '=', '<=', '<'].map((op) => h('option', { key: op, value: op }, op))) : null,
          provinceCondition ? h(ProvincePicker, {
            value: node.value || '',
            items: catalog.items,
            placeholder: t('cond.provinceSearchPlaceholder'),
            onChange: (provinceId) => onChange({ ...node, value: String(provinceId) }),
          }) : h('input', {
            className: 'eu4w-input', style: { flex: 1, minWidth: 140 },
            value: node.value || '', placeholder: conditionPlaceholder(node.type, t),
            onChange: (e) => onChange({ ...node, value: e.target.value }),
          }),
          h('button', { className: 'eu4w-btn danger', onClick: onRemove }, t('common.delete')),
        ),
        node.unknown && !triggers.some((option) => option.value === node.type) ? h(UnknownHint, { code: node.type }) : null,
        node.type === 'any_neighbor_province' ? h(NeighborPicker, {
          provinceId: focusId,
          value: node.value,
          onChange: (id) => onChange({ ...node, value: String(id) }),
        }) : null,
      );
    }

    function ConditionRows({ rows, onChange, depth = 0 }) {
      const { t } = useLocale();
      const list = rows || [];
      return h('div', { className: 'eu4w-col' },
        ...list.map((node, i) => h(ConditionNode, {
          key: i,
          node,
          depth,
          onChange: (next) => onChange(list.map((item, idx) => (idx === i ? next : item))),
          onRemove: () => onChange(list.filter((_, idx) => idx !== i)),
        })),
        h('div', { className: 'eu4w-row' },
          h('button', { className: 'eu4w-btn', onClick: () => onChange([...list, { type: 'owns', op: '=', value: '' }]) }, t('cond.add')),
          h('button', { className: 'eu4w-btn', onClick: () => onChange([...list, { type: 'AND', op: '=', value: '', children: [] }]) }, t('cond.addGroup')),
        ),
      );
    }

    /** Reward/effect builder plus the add_country_modifier stats editor. */
    function EffectRows({ rows, onChange }) {
      const { t } = useLocale();
      const { effects = [], modifiers = [], modifierTree = [] } = useDictionary();
      const [modifierMsg, setModifierMsg] = useState({});
      const attempted = useRef(new Set());
      const list = rows || [];
      const update = (i, patch) => onChange(list.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
      const modifierOptions = modifiers.length ? modifiers : [{ value: 'land_morale', keywords: 'land_morale' }];
      /** Full event id index for the `country_event` effect (server-cached). */
      const [eventCatalog, setEventCatalog] = useState([]);
      useEffect(() => {
        let alive = true;
        api('/events/catalog')
          .then((data) => { if (alive) setEventCatalog(data.items || []); })
          .catch(() => {});
        return () => { alive = false; };
      }, []);
      const loadModifier = async (i, name) => {
        const target = String(name || '').trim();
        if (!target) return;
        setModifierMsg((prev) => ({ ...prev, [i]: { state: 'checking', text: t('modifier.loading') } }));
        try {
          const data = await api('/modifier?name=' + encodeURIComponent(target));
          const stats = {};
          for (const stat of data.stats || []) stats[stat.key] = stat.value;
          update(i, { params: { ...(list[i].params || {}), name: target, stats, existing: true, newModifier: false } });
          setModifierMsg((prev) => ({ ...prev, [i]: { state: 'existing', text: t('modifier.exists') } }));
        } catch {
          // Not found: keep whatever stats the user typed and mark it as a new modifier.
          update(i, { params: { ...(list[i].params || {}), name: target, existing: false, newModifier: true } });
          setModifierMsg((prev) => ({ ...prev, [i]: { state: 'new', text: t('modifier.willCreate') } }));
        }
      };
      useEffect(() => {
        list.forEach((row, i) => {
          const name = row.params?.name;
          if (row.effect !== 'add_country_modifier' || !name || row.params?.stats) return;
          if (row.params?.newModifier === true || row.params?.existing === false) return;
          const token = i + ':' + name;
          if (attempted.current.has(token)) return;
          attempted.current.add(token);
          loadModifier(i, name);
        });
      }, [rows]);
      return h('div', { className: 'eu4w-col' },
        ...list.map((row, i) => {
          const isModifier = row.effect === 'add_country_modifier';
          const isCustom = row.effect === 'custom';
          const isEventEffect = ['country_event', 'province_event', 'news_event'].includes(row.effect);
          const eventId = String(row.params?.id || '');
          const eventDays = row.params?.days === undefined || String(row.params?.days) === '' ? '0' : String(row.params?.days);
          const effectType = valueTypeOf(effects, row.effect, 'integer');
          const effectKnown = isCustom || !effects.length || effects.some((option) => option.value === row.effect);
          const stats = row.params?.stats || {};
          const durSplit = durationSplit(row.params?.duration);
          const durYears = row.params?.years !== undefined ? String(row.params.years) : String(durSplit.years);
          const durDays = row.params?.daysText !== undefined ? String(row.params.daysText) : String(durSplit.days);
          const durTotal = row.params?.duration !== undefined ? String(row.params.duration) : String(durationToNative(durYears, durDays));
          const setDuration = (patch) => {
            const years = patch.years !== undefined ? patch.years : durYears;
            const daysText = patch.daysText !== undefined ? patch.daysText : durDays;
            update(i, { params: { ...(row.params || {}), years, daysText, duration: String(durationToNative(years, daysText)) } });
          };
          const statOptions = (key) => {
            const base = modifierOptions;
            return key && !base.some((option) => option.value === key)
              ? [{ value: key, keywords: key }, ...base]
              : base;
          };
          return h('div', { className: 'eu4w-col', key: i },
            h('div', { className: 'eu4w-row' },
              h(SearchSelect, {
                value: row.effect,
                options: (() => {
                  const base = effects.length ? effects : EFFECT_CHOICES.map((value) => ({ value, keywords: value }));
                  return row.effect && !base.some((option) => option.value === row.effect)
                    ? [{ value: row.effect, keywords: row.effect }, ...base]
                    : base;
                })(),
                onChange: (value) => {
                  const nextType = valueTypeOf(effects, value, 'integer');
                  const shown = toDisplayValue(row.value, effectType);
                  const nextIsEvent = ['country_event', 'province_event', 'news_event'].includes(value);
                  const kept = { ...(row.params || {}) };
                  delete kept.id;
                  delete kept.days;
                  const params = nextIsEvent
                    ? { ...kept, id: String(row.params?.id || ''), days: row.params?.days ?? '0' }
                    : (value === 'add_country_modifier' ? row.params : (Object.keys(kept).length ? kept : undefined));
                  update(i, { effect: value, value: String(toNativeValue(shown, nextType)), params });
                },
                prefix: 'effect',
              }),
              isCustom
                ? h('textarea', {
                  className: 'eu4w-area', rows: 2, style: { flex: 1, minWidth: 220 },
                  value: row.value || row.raw || '', placeholder: t('effect.customPlaceholder'),
                  onChange: (e) => update(i, { value: e.target.value, raw: e.target.value }),
                })
                : isEventEffect
                  ? [
                    h(EventSelect, {
                      key: 'event',
                      value: eventId,
                      items: eventCatalog,
                      onChange: (id) => update(i, { params: { ...(row.params || {}), id, days: eventDays }, value: '' }),
                    }),
                    h('input', {
                      key: 'days', className: 'eu4w-input', style: { width: 90 }, type: 'number', min: 0,
                      value: eventDays, placeholder: '0',
                      onChange: (e) => update(i, { params: { ...(row.params || {}), id: eventId, days: e.target.value } }),
                    }),
                    h('span', { key: 'daysLabel', className: 'eu4w-muted' }, t('effect.daysLabel')),
                  ]
                : isModifier
                  ? h('div', { key: 'modifier', className: 'eu4w-col', style: { flex: 1, minWidth: 320 } },
                    h('div', { className: 'eu4w-row' },
                      h('input', {
                        key: 'id', className: 'eu4w-input', style: { width: 210 },
                        value: row.params?.name || '', placeholder: t('modifier.idPlaceholder'),
                        onChange: (e) => {
                          setModifierMsg((prev) => { const next = { ...prev }; delete next[i]; return next; });
                          update(i, { params: { ...(row.params || {}), name: e.target.value.trim(), existing: undefined, newModifier: undefined } });
                        },
                        onBlur: () => {
                          const name = row.params?.name;
                          const checked = modifierMsg[i]?.state;
                          if (name && checked !== 'existing' && checked !== 'new') loadModifier(i, name);
                        },
                      }),
                      h('input', {
                        key: 'zh', className: 'eu4w-input', style: { width: 160 },
                        value: row.params?.nameZh || '', placeholder: t('modifier.zhPlaceholder'),
                        onChange: (e) => update(i, { params: { ...(row.params || {}), nameZh: e.target.value } }),
                      }),
                      h('button', {
                        key: 'check', className: 'eu4w-btn',
                        onClick: () => loadModifier(i, row.params?.name),
                      }, t('modifier.check')),
                    ),
                    modifierMsg[i]?.text ? h('div', {
                      key: 'status',
                      className: modifierMsg[i].state === 'new' ? 'eu4w-warn' : 'eu4w-muted',
                      style: { fontSize: 11 },
                    }, modifierMsg[i].text) : null,
                    h('div', { className: 'eu4w-row', key: 'duration' },
                      h('span', { className: 'eu4w-muted' }, t('effect.durationTitle')),
                      h('input', {
                        className: 'eu4w-input', style: { width: 82 }, value: durYears, placeholder: t('effect.yearsPlaceholder'),
                        onChange: (e) => setDuration({ years: e.target.value }),
                      }),
                      h('span', { className: 'eu4w-muted' }, t('effect.yearsUnit')),
                      h('input', {
                        className: 'eu4w-input', style: { width: 92 }, value: durDays, placeholder: t('effect.daysPlaceholder'),
                        onChange: (e) => setDuration({ daysText: e.target.value }),
                      }),
                      h('span', { className: 'eu4w-muted' }, t('effect.daysUnit')),
                      h('span', { className: 'eu4w-mono eu4w-muted' }, `= ${durTotal} ${t('effect.daysUnit')}`),
                    ),
                    h('div', { className: 'eu4w-muted', style: { fontSize: 11 } }, t('effect.durationHint')),
                  )
                  : [h('input', {
                    className: 'eu4w-input', style: { width: 110 }, type: 'number',
                    value: toDisplayValue(row.value, effectType),
                    placeholder: effectType === 'percentage' ? '5' : '20',
                    onChange: (e) => update(i, { value: String(toNativeValue(e.target.value, effectType)) }),
                  }),
                  effectType === 'percentage' ? h('span', { className: 'eu4w-muted' }, '%') : null],
              h('button', { className: 'eu4w-btn danger', onClick: () => onChange(list.filter((_, idx) => idx !== i)) }, t('common.delete')),
            ),
            isModifier ? h('div', { className: 'eu4w-stat' },
              h('div', { className: 'eu4w-muted' }, t('modifier.stats')),
              ...Object.entries(stats).map(([key, value]) => {
                const statType = valueTypeOf(modifierOptions, key);
                return h('div', { className: 'eu4w-row', key },
                  h(ModifierTreeSelector, {
                    value: key,
                    options: statOptions(key),
                    onChange: (nextKey) => {
                      const nextType = valueTypeOf(modifierOptions, nextKey);
                      const shown = toDisplayValue(value, statType);
                      const nextStats = { ...stats };
                      delete nextStats[key];
                      nextStats[nextKey] = toNativeValue(shown, nextType);
                      update(i, { params: { ...(row.params || {}), stats: nextStats, newModifier: true } });
                    },
                    tree: modifierTree,
                  }),
                  h('input', {
                    className: 'eu4w-input', style: { width: 90 }, type: 'number',
                    value: toDisplayValue(value, statType),
                    placeholder: statType === 'percentage' ? '5' : '20',
                    onChange: (e) => update(i, { params: { ...(row.params || {}), stats: { ...stats, [key]: toNativeValue(e.target.value, statType) }, newModifier: true } }),
                  }),
                  statType === 'percentage' ? h('span', { className: 'eu4w-muted' }, '%') : null,
                  h('button', {
                    className: 'eu4w-btn danger',
                    onClick: () => {
                      const nextStats = { ...stats };
                      delete nextStats[key];
                      update(i, { params: { ...(row.params || {}), stats: nextStats, newModifier: true } });
                    },
                  }, t('common.delete')),
                );
              }),
              h('div', { className: 'eu4w-row' },
                h('button', {
                  className: 'eu4w-btn',
                  onClick: () => update(i, { params: { ...(row.params || {}), stats: { ...stats, land_morale: 0.05 }, newModifier: true } }),
                }, t('modifier.addStat')),
                modifierMsg[i]?.text ? h('span', { className: modifierMsg[i].state === 'new' ? 'eu4w-warn' : 'eu4w-muted' }, modifierMsg[i].text) : null,
              ),
            ) : null,
            !effectKnown ? h(UnknownHint, { code: row.effect }) : null,
          );
        }),
        h('button', { className: 'eu4w-btn', onClick: () => onChange([...list, { effect: 'add_prestige', value: '' }]) }, t('effect.add')),
      );
    }

    /** Prompt preview + copy + optional pending handoff. */
    function AIPromptCard({ prompt, message, onCopy, onSave }) {
      const { t } = useLocale();
      if (!prompt) return null;
      return h('div', { className: 'eu4w-card' },
        h('h3', null, t('ai.cardTitle')),
        h('textarea', { className: 'eu4w-area', rows: 10, value: prompt, readOnly: true, spellCheck: false }),
        h('div', { className: 'eu4w-row' },
          h('button', { className: 'eu4w-btn primary', onClick: onCopy }, t('ai.copy')),
          onSave ? h('button', { className: 'eu4w-btn', onClick: onSave }, t('ai.savePending')) : null,
          message ? h('span', { className: 'eu4w-muted' }, message) : null,
        ),
        h('p', { className: 'eu4w-muted' }, t('ai.note')),
      );
    }

    const CSS = `
      .eu4w-root{--eu4-bg:#0d1117;--eu4-panel:#151b23;--eu4-panel2:#1b2430;--eu4-line:#2b3644;--eu4-text:#e6edf3;--eu4-muted:#8b98a8;--eu4-gold:#d6b45a;--eu4-blue:#79b8ff;--eu4-red:#ff7b72;--eu4-green:#7ee787;color-scheme:dark;display:flex;flex-direction:column;height:100%;min-height:0;background:var(--eu4-bg);color:var(--eu4-text);font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;overflow:hidden}
      .eu4w-head{display:flex;align-items:center;gap:12px;padding:10px 14px;border-bottom:1px solid var(--eu4-line);background:var(--eu4-panel);flex:none}
      .eu4w-title{font-size:15px;font-weight:700;letter-spacing:.2px;white-space:nowrap}
      .eu4w-sub{color:var(--eu4-muted);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .eu4w-spacer{flex:1}
      .eu4w-tabs{display:flex;gap:2px;padding:0 10px;border-bottom:1px solid var(--eu4-line);background:var(--eu4-panel);flex:none;overflow-x:auto}
      .eu4w-tab{border:0;background:transparent;color:var(--eu4-muted);padding:9px 12px;border-bottom:2px solid transparent;cursor:pointer;white-space:nowrap;font:inherit}
      .eu4w-tab:hover{color:var(--eu4-text)}
      .eu4w-tab.on{color:var(--eu4-gold);border-bottom-color:var(--eu4-gold)}
      .eu4w-body{flex:1;min-height:0;overflow:auto;padding:14px}
      .eu4w-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px}
      .eu4w-card{background:var(--eu4-panel);border:1px solid var(--eu4-line);border-radius:8px;padding:12px;min-width:0}
      .eu4w-card h3{margin:0 0 8px;font-size:13px;color:var(--eu4-gold);font-weight:650}
      .eu4w-kv{display:grid;grid-template-columns:96px 1fr;gap:4px 8px;font-size:12px}
      .eu4w-kv b{color:var(--eu4-muted);font-weight:500}
      .eu4w-kv span{word-break:break-all}
      .eu4w-input,.eu4w-select,.eu4w-area{background:#0a0f15;border:1px solid var(--eu4-line);color:var(--eu4-text);border-radius:6px;padding:6px 8px;font:inherit;min-width:0}
      .eu4w-area{width:100%;box-sizing:border-box;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;line-height:1.5;resize:vertical}
    .eu4w-autotext{display:flex;flex-direction:column;gap:4px;width:100%}
    .eu4w-autotext-area{resize:none;overflow:hidden;line-height:1.55;transition:height 80ms ease}
    .eu4w-autotext-tools{display:flex;gap:4px;align-items:center;flex-wrap:wrap}
    .eu4w-autotext-tools .eu4w-btn{font-size:10px;padding:2px 6px}
      .eu4w-btn{border:1px solid var(--eu4-line);background:var(--eu4-panel2);color:var(--eu4-text);border-radius:6px;padding:6px 10px;cursor:pointer;font:inherit;white-space:nowrap}
      .eu4w-btn:hover{border-color:var(--eu4-gold);color:var(--eu4-gold)}
      .eu4w-btn:disabled{opacity:.45;cursor:not-allowed}
      .eu4w-btn.primary{background:#2b2412;border-color:#7a6425;color:#f0d78c}
      .eu4w-btn.danger{color:var(--eu4-red);border-color:#5a2a2a}
      .eu4w-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
      .eu4w-col{display:flex;flex-direction:column;gap:8px}
      .eu4w-muted{color:var(--eu4-muted)}
      .eu4w-pill{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--eu4-line);border-radius:999px;padding:2px 8px;font-size:11px;color:var(--eu4-muted)}
      .eu4w-dot{width:7px;height:7px;border-radius:50%;background:var(--eu4-muted)}
      .eu4w-ok{color:var(--eu4-green)}.eu4w-warn{color:var(--eu4-gold)}.eu4w-err{color:var(--eu4-red)}
      .eu4w-map{display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:6px}
      .eu4w-prov{border:1px solid var(--eu4-line);background:var(--eu4-panel);border-radius:6px;padding:6px;cursor:pointer;text-align:left;color:var(--eu4-text);min-height:50px;overflow:hidden}
      .eu4w-prov:hover{border-color:var(--eu4-blue)}
      .eu4w-prov.sel{border-color:var(--eu4-gold);background:#2a2414}
      .eu4w-prov.core{border-color:#8a6d2a;box-shadow:inset 0 0 0 1px #8a6d2a33}
      .eu4w-prov.core.sel{border-color:var(--eu4-gold);box-shadow:inset 0 0 0 2px #d6b45a55}
      .eu4w-prov b{display:block;font-size:12px;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
      .eu4w-prov small{display:block;color:var(--eu4-muted);font-size:10px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.eu4w-tip{position:fixed;z-index:60;pointer-events:none;max-width:360px;padding:5px 9px;border-radius:6px;border:1px solid var(--eu4-gold);background:#0d1117f2;color:var(--eu4-text);font-size:12px;white-space:nowrap;box-shadow:0 8px 20px rgba(0,0,0,.55)}
.eu4w-chips{display:flex;flex-wrap:wrap;gap:4px;align-items:center;max-height:120px;overflow:auto;padding:2px 0}
.eu4w-tree-cat{padding:2px 2px}
.eu4w-tree-toggle{display:block;width:100%;text-align:left;border:0;background:transparent;color:var(--eu4-gold);font:inherit;font-size:11px;font-weight:650;padding:4px 6px;cursor:pointer}
.eu4w-tree-toggle.sub{color:var(--eu4-text);font-weight:400;padding-left:16px}
.eu4w-tree-group{padding:0 2px}
      .eu4w-split{display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:12px;align-items:start}
      .eu4w-scroll{max-height:calc(100vh - 210px);overflow:auto;min-height:240px}
      .eu4w-canvas{position:relative;background:#0a0f15;border:1px solid var(--eu4-line);border-radius:8px;overflow:auto;min-height:420px}
      .eu4w-node{position:absolute;width:180px;background:var(--eu4-panel2);border:1px solid var(--eu4-line);border-radius:8px;padding:8px;cursor:grab;user-select:none;box-shadow:0 4px 14px #0006}
      .eu4w-node.sel{border-color:var(--eu4-gold);box-shadow:0 0 0 1px #d6b45a66,0 4px 14px #0006}
      .eu4w-node.pre{border-color:var(--eu4-blue)}
      .eu4w-node.suc{border-color:var(--eu4-green)}
      .eu4w-node h4{margin:0 0 4px;font-size:12px;color:var(--eu4-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .eu4w-node p{margin:0;color:var(--eu4-muted);font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .eu4w-edge{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
      .eu4w-issue{border-left:3px solid var(--eu4-line);padding:7px 10px;margin:0 0 6px;background:var(--eu4-panel)}
      .eu4w-issue.error{border-color:var(--eu4-red)}.eu4w-issue.warning{border-color:var(--eu4-gold)}.eu4w-issue.info{border-color:var(--eu4-blue)}
      .eu4w-issue b{font-size:12px}.eu4w-issue p{margin:2px 0 0;color:var(--eu4-muted);font-size:12px}
      .eu4w-mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px}
      .eu4w-pre{white-space:pre-wrap;word-break:break-word;background:#0a0f15;border:1px solid var(--eu4-line);border-radius:6px;padding:8px;max-height:260px;overflow:auto;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px}
      .eu4w-tool{display:grid;grid-template-columns:180px 100px 1fr auto;gap:10px;align-items:center;border-bottom:1px solid var(--eu4-line);padding:9px 0}
      .eu4w-tagbox{display:flex;align-items:center;gap:6px}
      .eu4w-check{display:inline-flex;align-items:center;gap:5px;color:var(--eu4-muted);font-size:12px;user-select:none;white-space:nowrap}
      .eu4w-check input{accent-color:var(--eu4-gold)}
      .eu4w-search{position:relative;flex:1;min-width:170px}
      .eu4w-search-list{position:absolute;left:0;right:0;top:100%;z-index:30;margin-top:2px;max-height:260px;overflow:auto;background:var(--eu4-panel2);border:1px solid var(--eu4-line);border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,.45)}
      .eu4w-search-item{display:flex;justify-content:space-between;gap:8px;width:100%;text-align:left;border:0;background:transparent;color:var(--eu4-text);padding:6px 8px;font:inherit;cursor:pointer}
      .eu4w-search-item:hover,.eu4w-search-item.on{background:#233246;color:var(--eu4-gold)}
      .eu4w-search-item small{color:var(--eu4-muted);font-family:ui-monospace,Consolas,monospace}
      .eu4w-search-group{position:sticky;top:0;background:#101821;color:var(--eu4-gold);font-size:11px;font-weight:650;padding:5px 8px;border-bottom:1px solid var(--eu4-line)}
      .eu4w-tree-group{display:flex;align-items:center;gap:6px;width:100%;text-align:left;border:0;background:#101821;color:var(--eu4-gold);padding:6px 8px;font:inherit;cursor:pointer;border-bottom:1px solid var(--eu4-line)}
      .eu4w-tree-group:hover{background:#233246}
      .eu4w-tree-group small{margin-left:auto;color:var(--eu4-muted);font-size:10px}
      .eu4w-tree-arrow{width:14px;color:var(--eu4-muted);font-size:10px}
      .eu4w-tree-children{padding-left:14px;border-left:1px solid var(--eu4-line);margin-left:8px}
      .eu4w-tree-item{padding-left:8px}
      .eu4w-search-list mark{background:#5a4a1f;color:#ffe8a3;border-radius:2px;padding:0 1px}
      .eu4w-search-row{display:flex;align-items:center;gap:2px}
      .eu4w-search-row:hover,.eu4w-search-row.on{background:#233246;color:var(--eu4-gold)}
      .eu4w-search-pick{flex:1;display:flex;justify-content:space-between;align-items:center;border:0;background:transparent;color:inherit;text-align:left;padding:6px 8px;font:inherit;cursor:pointer}
      .eu4w-quickadd{cursor:pointer;padding:2px 6px;margin-right:4px;border:1px solid var(--eu4-line);border-radius:4px;color:var(--eu4-gold);font-size:11px;white-space:nowrap}
      .eu4w-quickadd-edit{display:flex;gap:4px;align-items:center;padding:2px 4px;flex-wrap:wrap}
      .eu4w-logic{border-left:2px solid var(--eu4-gold);background:rgba(214,180,90,.06);padding:8px 0 8px 10px;border-radius:4px}
      .eu4w-nl{border-color:#7a6425;background:linear-gradient(180deg,rgba(214,180,90,.10),rgba(21,27,35,.2))}
      .eu4w-stat{border:1px dashed var(--eu4-line);border-radius:6px;padding:6px}
      .eu4w-tagbox .eu4w-input{width:64px}
      @media(max-width:980px){.eu4w-split{grid-template-columns:1fr}.eu4w-tool{grid-template-columns:1fr}.eu4w-scroll{max-height:none}}
    `;

    async function api(path, options) {
      const res = await fetch(API + path, {
        headers: { 'content-type': 'application/json', 'x-eu4-workbench': '1' },
        ...options,
      });
      const body = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
      if (!res.ok || body.ok === false) throw new Error(body.error || `HTTP ${res.status}`);
      return body.data;
    }

    function Panel() {
      const [tab, setTab] = useState('workspace');
      const [state, setState] = useState(null);
      const [err, setErr] = useState('');
      const [busy, setBusy] = useState(false);
      const [activeTag, setActiveTagState] = useState('');
      const [tagDraft, setTagDraft] = useState('');
      const [messages, setMessages] = useState(null);
      const [dictionary, setDictionary] = useState(null);
      const [queue, setQueue] = useState([]);
      const [activeForm, setActiveForm] = useState(null);
      const [clipboardData, setClipboardData] = useState(null);
      const [storeMsg, setStoreMsg] = useState('');
      const [refreshToken, setRefreshToken] = useState(0);
      const [focusProvinceId, setFocusProvinceId] = useState(0);
      const tabRef = useRef(tab);
      tabRef.current = tab;
      const hydrated = useRef(false);
      const reloadLocales = useCallback(async () => {
        try {
          const [locales, dict] = await Promise.all([api('/ui/locales'), api('/eu4/options')]);
          const pack = locales.messages || {};
          SIDEBAR_LABEL = pack['app.sidebarLabel'] || 'EU4 Workbench';
          setMessages(pack);
          setDictionary(dict || { triggers: [], effects: [], modifiers: [], modifierTree: [], categories: [], techGroups: [], governments: [], religions: [], cultures: [], cultureGroups: [] });
        } catch {
          setMessages((prev) => prev || {});
          setDictionary((prev) => prev || { triggers: [], effects: [], modifiers: [], modifierTree: [], categories: [], techGroups: [], governments: [], religions: [], cultures: [], cultureGroups: [] });
        }
      }, []);
      useEffect(() => { reloadLocales(); }, [reloadLocales]);
      const t = useCallback((key, params) => {
        const raw = (messages && messages[key]) || CLIENT_MESSAGES[key] || key;
        return params ? fillParams(raw, params) : raw;
      }, [messages]);
      const refresh = useCallback(async () => {
        try {
          setBusy(true);
          // Drop the front-end dictionary so V8 can reclaim it before the new
          // Host dictionary arrives (the panel remounts below anyway).
          setDictionary(null);
          await api('/refresh', { method: 'POST', body: '{}' }).catch(() => {});
          setState(await api('/state'));
          await reloadLocales();
          // Force-refresh: drop this tab's remembered form and remount it, so
          // the panel re-reads the file instead of showing stale values.
          clearFormMemory(TAB_FORM_KEYS[tabRef.current]);
          setRefreshToken((value) => value + 1);
          setErr('');
        } catch (e) {
          setErr(String(e.message || e));
        } finally {
          setBusy(false);
        }
      }, [reloadLocales]);
      const refreshQueue = useCallback(async () => {
        try {
          const data = await api('/queue');
          setQueue(data.items || []);
        } catch {
          /* queue is optional; keep the last view */
        }
      }, []);
      const enqueue = useCallback(async (item) => {
        const data = await api('/queue', { method: 'POST', body: JSON.stringify(item) });
        // New files may have been written since the last scan: invalidate the
        // Host caches immediately so the next panel read sees them.
        await api('/refresh', { method: 'POST', body: '{}' }).catch(() => {});
        await refreshQueue();
        return data;
      }, [refreshQueue]);
      useEffect(() => { refresh(); refreshQueue(); }, [refresh, refreshQueue]);
      // A tab registers its form while it is mounted; the header can then copy
      // from it or paste into it. Nothing is persisted between reloads.
      const registerForm = useCallback((form) => {
        setActiveForm(form);
        return () => setActiveForm((current) => (current === form ? null : current));
      }, []);
      const clipboardValue = useMemo(() => ({ register: registerForm }), [registerForm]);
      const copyForm = () => {
        if (!activeForm) { setStoreMsg(t('clip.noForm')); return; }
        const value = activeForm.getValue();
        if (value === undefined || value === null) { setStoreMsg(t('clip.noForm')); return; }
        try {
          setClipboardData({ data: JSON.parse(JSON.stringify(value)), source: activeForm.key, copiedAt: Date.now() });
          setStoreMsg(t('clip.copied'));
        } catch (e) {
          setStoreMsg(String(e.message || e));
        }
      };
      const pasteForm = () => {
        if (!activeForm) { setStoreMsg(t('clip.noForm')); return; }
        if (!clipboardData) { setStoreMsg(t('clip.empty')); return; }
        try {
          activeForm.onPaste(clipboardData.data);
          setStoreMsg(t('clip.pasted'));
        } catch (e) {
          setStoreMsg(String(e.message || e));
        }
      };
      const clearClipboard = () => {
        setClipboardData(null);
        setStoreMsg(t('clip.cleared'));
      };
      useEffect(() => {
        if (!state || hydrated.current) return;
        hydrated.current = true;
        const tag = String(state.activeTag || '');
        setActiveTagState(tag);
        setTagDraft(tag);
      }, [state]);

      const applyTag = useCallback(async (next) => {
        const tag = String(next || '').trim().toUpperCase();
        if (tag !== '' && !/^[A-Z0-9]{3}$/.test(tag)) {
          setErr(t('app.tagInvalid'));
          return;
        }
        setActiveTagState(tag);
        setTagDraft(tag);
        try {
          await api('/tag', { method: 'POST', body: JSON.stringify({ tag }) });
          setErr('');
        } catch (e) {
          setErr(String(e.message || e));
        }
      }, [t]);

      if (messages === null || dictionary === null) {
        return h('div', { className: 'eu4w-root' },
          h('style', null, CSS),
          h('div', { className: 'eu4w-muted', style: { padding: 20 } }, '…'),
        );
      }

      const body = (() => {
        if (tab === 'workspace') return h(WorkspaceTab, { state, refresh, setState, setErr });
        if (tab === 'map') return h(MapTab, { state, setErr });
        if (tab === 'province') return h(ProvinceTab, { setErr });
        if (tab === 'country') return h(CountryTab, { setErr });
        if (tab === 'ideas') return h(IdeasTab, { setErr });
        if (tab === 'government') return h(GovernmentTab, { setErr });
        if (tab === 'missions') return h(MissionsTab, { state, setErr });
        if (tab === 'events') return h(EventsTab, { state, setErr });
        if (tab === 'decisions') return h(DecisionsTab, { state, setErr });
        if (tab === 'diplomacy') return h(DiplomacyTab, { state, setErr });
        if (tab === 'gui') return h(GUITab, { setErr });
        if (tab === 'mechanic') return h(MechanicTab, { setErr });
        if (tab === 'validate') return h(ValidateTab, { setErr });
        if (tab === 'batch') return h(BatchTab, { setErr });
        return h(ToolsTab, { state, setErr });
      })();

      return h(LocaleContext.Provider, { value: { t, reload: reloadLocales } },
        h(DictionaryContext.Provider, { value: dictionary },
          h(QueueContext.Provider, { value: { queue, count: queue.length, enqueue, refresh: refreshQueue } },
          h(ClipboardContext.Provider, { value: clipboardValue },
          h(TagContext.Provider, { value: { activeTag, setActiveTag: applyTag } },
          h(ProvinceFocusContext.Provider, { value: { focusId: focusProvinceId, setFocusId: setFocusProvinceId } },
          h('div', { className: 'eu4w-root' },
            h('style', null, CSS),
            h('div', { className: 'eu4w-head' },
              h('div', null,
                h('div', { className: 'eu4w-title' }, t('app.title')),
                h('div', { className: 'eu4w-sub' }, state
                  ? t('app.subtitle', { root: state.eu4Root || t('app.noGameDir'), files: state.vanillaFileCount || 0, mods: state.mods?.length || 0 })
                  : t('app.loadingWorkspace')),
              ),
              h('div', { className: 'eu4w-spacer' }),
              h('div', { className: 'eu4w-tagbox' },
                h('span', { className: 'eu4w-muted' }, t('app.tagLabel')),
                h('input', {
                  className: 'eu4w-input', value: tagDraft, maxLength: 3, placeholder: 'BOH',
                  onChange: (e) => setTagDraft(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')),
                  onKeyDown: (e) => { if (e.key === 'Enter') applyTag(tagDraft); },
                }),
                h('button', { className: 'eu4w-btn', onClick: () => applyTag(tagDraft) }, t('common.apply')),
                activeTag ? h('button', { className: 'eu4w-btn danger', onClick: () => applyTag('') }, t('common.clear')) : null,
                h('span', { className: activeTag ? 'eu4w-warn' : 'eu4w-muted' }, activeTag ? t('app.tagActive', { tag: activeTag }) : t('common.none')),
              ),
              err ? h('span', { className: 'eu4w-err', title: err }, t('error.prefix', { message: err })) : null,
              h('button', { className: 'eu4w-btn', onClick: refresh, disabled: busy }, busy ? t('app.loading') : t('common.refresh')),
              queue.length ? h('button', { className: 'eu4w-btn primary', onClick: () => setTab('batch') }, t('queue.count', { count: queue.length })) : null,
              h('button', { className: 'eu4w-btn', style: { fontSize: 11 }, onClick: copyForm, disabled: !activeForm }, t('clip.copy')),
              h('button', { className: 'eu4w-btn', style: { fontSize: 11 }, onClick: pasteForm, disabled: !activeForm || !clipboardData }, t('clip.paste')),
              h('button', { className: 'eu4w-btn', style: { fontSize: 11 }, onClick: clearClipboard, disabled: !clipboardData }, t('clip.clear')),
              storeMsg ? h('span', { className: 'eu4w-muted', style: { fontSize: 11 } }, storeMsg) : null,
            ),
            h('div', { className: 'eu4w-tabs' }, ...TABS.map(([id, labelKey]) =>
              h('button', { key: id, className: 'eu4w-tab' + (tab === id ? ' on' : ''), onClick: () => setTab(id) }, t(labelKey)),
            )),
            h(RefreshContext.Provider, { value: refreshToken },
              h('div', {
                // A new key remounts the tab after a forced refresh, so every
                // panel re-reads its file instead of keeping stale form state.
                className: 'eu4w-body',
                key: tab + ':' + refreshToken,
              }, body),
            ),
          ),
        ),
        ),
        ),
        ),
        ),
      );
    }

    /** Mechanic panel: read a modifier definition and enqueue its stats. */
    function MechanicTab({ setErr }) {
      const { t } = useLocale();
      const { enqueue } = useQueue();
      const { modifiers, modifierTree } = useDictionary();
      const [name, setName] = useFormState('mechanicForm.name', 'thriving_arms_industry');
      const [mod, setMod] = useFormState('mechanicForm', null);
      const [msg, setMsg] = useState('');
      const statOptions = modifiers.length ? modifiers : [{ value: 'land_morale', keywords: 'land_morale' }];
      const load = async () => {
        const target = String(name || '').trim();
        if (!target) { setMsg(t('mechanic.empty')); return; }
        try {
          const data = await api('/modifier?name=' + encodeURIComponent(target));
          setMod({ ...data, name: target, stats: Object.fromEntries((data.stats || []).map((s) => [s.key, s.value])), isNew: false });
          setMsg(t('mechanic.loaded', { file: data.file || '' }));
        } catch {
          setMod({ name: target, file: 'common/event_modifiers/' + target + '.txt', stats: {}, isNew: true });
          setMsg(t('mechanic.notFound'));
        }
      };
      const newMod = () => {
        const target = 'new_modifier';
        setName(target);
        setMod({ name: target, file: 'common/event_modifiers/' + target + '.txt', stats: { land_morale: 0.05 }, isNew: true });
        setMsg('');
      };
      const updateStat = (oldKey, nextKey, value) => {
        setMod((prev) => {
          if (!prev) return prev;
          const stats = { ...(prev.stats || {}) };
          delete stats[oldKey];
          stats[nextKey] = value;
          return { ...prev, stats };
        });
      };
      const queue = async () => {
        const target = String(mod?.name || name).trim();
        if (!target) { setMsg(t('mechanic.empty')); return; }
        try {
          const result = await enqueue({
            targetType: 'mechanic',
            action: mod?.isNew ? 'create' : 'modify',
            targetId: target,
            targetFile: mod?.file || 'common/event_modifiers/' + target + '.txt',
            data: { name: target, file: mod?.file || 'common/event_modifiers/' + target + '.txt', stats: mod?.stats || {} },
          });
          setMsg(t('queue.added', { count: result.count || 1 }));
        } catch (e) {
          setErr(String(e.message || e));
        }
      };
      useRegisterForm('mechanicForm', mod, (clip) => {
        if (clip && typeof clip === 'object') setMod((prev) => ({ ...(prev || {}), ...clip }));
      });
      return h('div', { className: 'eu4w-col' },
        h('div', { className: 'eu4w-card' },
          h('h3', null, t('mechanic.title')),
          h('div', { className: 'eu4w-row' },
            h('input', { className: 'eu4w-input', style: { width: 240 }, value: name, placeholder: t('mechanic.name'), onChange: (e) => setName(e.target.value) }),
            h('button', { className: 'eu4w-btn', onClick: load }, t('mechanic.load')),
            h('button', { className: 'eu4w-btn', onClick: newMod }, t('mechanic.new')),
            h('button', { className: 'eu4w-btn primary', onClick: queue }, t('mechanic.enqueue')),
            msg ? h('span', { className: 'eu4w-muted' }, msg) : null,
          ),
          h('div', { className: 'eu4w-muted' }, mod?.file || t('mechanic.empty')),
          mod ? h('div', { className: 'eu4w-stat' },
            h('div', { className: 'eu4w-muted' }, t('mechanic.stats')),
            ...Object.entries(mod.stats || {}).map(([key, value]) => {
              const statType = valueTypeOf(statOptions, key);
              return h('div', { className: 'eu4w-row', key },
                h(ModifierTreeSelector, {
                  value: key,
                  options: statOptions.some((option) => option.value === key)
                    ? statOptions
                    : [{ value: key, keywords: key }, ...statOptions],
                  tree: modifierTree,
                  onChange: (nextKey) => {
                    const nextType = valueTypeOf(statOptions, nextKey);
                    const shown = toDisplayValue(value, statType);
                    updateStat(key, nextKey, toNativeValue(shown, nextType));
                  },
                }),
                h('input', {
                  className: 'eu4w-input', style: { width: 100 }, type: 'number',
                  value: toDisplayValue(value, statType),
                  onChange: (e) => updateStat(key, key, toNativeValue(e.target.value, statType)),
                }),
                statType === 'percentage' ? h('span', { className: 'eu4w-muted' }, '%') : null,
                h('button', {
                  className: 'eu4w-btn danger',
                  onClick: () => setMod((prev) => {
                    const stats = { ...(prev?.stats || {}) };
                    delete stats[key];
                    return { ...prev, stats };
                  }),
                }, t('common.delete')),
              );
            }),
            h('button', {
              className: 'eu4w-btn',
              onClick: () => setMod((prev) => ({ ...prev, stats: { ...(prev?.stats || {}), land_morale: 0.05 } })),
            }, t('mechanic.addStat')),
          ) : null,
        ),
      );
    }

    /** Batch panel: view the queue and build/submit one consolidated prompt. */
    function BatchTab({ setErr }) {
      const { t } = useLocale();
      const { queue, refresh } = useQueue();
      const catalog = useProvinceCatalog();
      const provinceById = useMemo(() => {
        const map = new Map();
        for (const item of catalog.items || []) map.set(Number(item.id), item);
        return map;
      }, [catalog.items]);
      const [prompt, setPrompt] = useState('');
      const [msg, setMsg] = useState('');
      const [pathReport, setPathReport] = useState(null);
      const [modCheck, setModCheck] = useState(null);
      const [readbacks, setReadbacks] = useState(null);
      useEffect(() => {
        api('/mod/verify').then((data) => setModCheck(data)).catch(() => setModCheck(null));
      }, []);
      const verifyQueue = async () => {
        try {
          const rows = [];
          for (const item of queue) {
            const data = await api('/verify/readback', {
              method: 'POST',
              body: JSON.stringify({
                targetType: item.targetType,
                targetId: item.targetId,
                targetFile: item.targetFile,
                action: item.action,
                historyTag: item.data?.targetTag || '',
                bindDate: item.data?.bindDate || '',
                triggerMode: item.data?.triggerMode || '',
                removedNodeIds: item.data?.removedNodeIds || [],
                owner: item.data?.owner || '',
                tagA: item.data?.tagA || '',
                tagB: item.data?.tagB || '',
                relationType: item.data?.relationType || '',
                extraParams: item.data?.extraParams || '',
                startDate: item.data?.startDate || item.data?.date || '1437.1.1',
                localisationFile: item.data?.localisationFile || (item.targetType === 'event' ? 'localisation/zz_eu4_workbench_l_simp_chinese.yml' : ''),
              }),
            }).catch((e) => ({ ok: false, error: String(e.message || e), targetId: item.targetId }));
            rows.push({ item, data });
          }
          setReadbacks(rows);
        } catch (e) { setErr(String(e.message || e)); }
      };
      const label = (prefix, value) => {
        const key = prefix + '.' + value;
        const text = t(key);
        return text === key ? value : text;
      };
      /** Queued items always carry the numeric ID; the label is display only. */
      const itemLabel = (item) => {
        if (item.targetType !== 'province_history') return item.targetId;
        const id = Number(item.targetId);
        const fromCatalog = provinceById.get(id);
        const data = item.data || {};
        const entry = fromCatalog || { id, name_cn: data.name_cn, name_en: data.name_en, name: data.name };
        return entry.label || provinceLabelOf(entry);
      };
      const build = async () => {
        try {
          const data = await api('/queue/build', { method: 'POST', body: '{}' });
          setPrompt(data.prompt);
          setMsg('');
        } catch (e) {
          setErr(String(e.message || e));
        }
      };
      const submit = async () => {
        try {
          const data = await api('/queue/submit', { method: 'POST', body: '{}' });
          setPrompt(data.prompt);
          setMsg(t('queue.pending'));
          await api('/refresh', { method: 'POST', body: '{}' }).catch(() => {});
          // Agent writes asynchronously; re-read the targets shortly afterwards.
          setTimeout(() => { verifyQueue(); }, 4000);
        } catch (e) {
          setErr(String(e.message || e));
        }
      };
      /** Execution-time path guard: every queued target must be under the Mod root. */
      const checkPaths = async () => {
        try {
          const rows = [];
          for (const item of queue) {
            if (!item.targetFile) continue;
            const data = await api('/paths/check?path=' + encodeURIComponent(item.targetFile));
            rows.push({ target: item.targetId, file: item.targetFile, ...data });
          }
          setPathReport(rows);
        } catch (e) { setErr(String(e.message || e)); }
      };
      const remove = async (id) => {
        await api('/queue/remove', { method: 'POST', body: JSON.stringify({ id }) });
        await refresh();
        setPrompt('');
      };
      const clear = async () => {
        await api('/queue/clear', { method: 'POST', body: '{}' });
        await refresh();
        setPrompt('');
        setMsg('');
      };
      return h('div', { className: 'eu4w-col' },
        h('div', { className: 'eu4w-card' },
          h('div', { className: 'eu4w-row' },
            h('h3', null, t('queue.title')),
            h('span', { className: 'eu4w-pill' }, String(queue.length)),
            h('div', { className: 'eu4w-spacer' }),
            h('button', { className: 'eu4w-btn', onClick: refresh }, t('common.refresh')),
            h('button', { className: 'eu4w-btn danger', onClick: clear, disabled: !queue.length }, t('queue.clear')),
          ),
          modCheck && !modCheck.ok
            ? h('div', { className: 'eu4w-err', style: { fontWeight: 700 } }, '⛔ ' + modCheck.message)
            : modCheck
              ? h('div', { className: 'eu4w-mono eu4w-muted' }, t('mod.valid', { root: modCheck.modRoot }))
              : null,
          queue.length === 0
            ? h('div', { className: 'eu4w-muted' }, t('queue.empty'))
            : h('div', { className: 'eu4w-col' },
              ...queue.map((item) => h('div', { className: 'eu4w-tool', key: item.id },
                h('span', { className: 'eu4w-pill' }, label('queue.target', item.targetType)),
                h('span', { className: 'eu4w-pill' }, label('queue.action', item.action)),
                h('span', null, itemLabel(item)),
                h('span', { className: 'eu4w-mono eu4w-muted' }, item.targetFile || ''),
                h('button', { className: 'eu4w-btn danger', onClick: () => remove(item.id) }, t('queue.remove')),
              )),
            ),
          h('div', { className: 'eu4w-row' },
            h('button', { className: 'eu4w-btn primary', onClick: build, disabled: !queue.length }, t('queue.build')),
            h('button', { className: 'eu4w-btn', onClick: submit, disabled: !queue.length }, t('queue.submit')),
            h('button', { className: 'eu4w-btn', onClick: checkPaths, disabled: !queue.length }, t('paths.check')),
            h('button', { className: 'eu4w-btn', onClick: verifyQueue, disabled: !queue.length }, t('verify.run')),
            msg ? h('span', { className: 'eu4w-muted' }, msg) : null,
          ),
          readbacks ? h('div', { className: 'eu4w-col eu4w-stat' },
            ...readbacks.map((row, i) => {
              const info = readbackLabel(row.data);
              return h('div', { key: i, className: 'eu4w-col' },
                h('div', { className: row.data.ok ? 'eu4w-ok' : 'eu4w-err', style: { fontWeight: 600 } },
                  (row.data.ok ? '✓ ' : '✗ ') + row.item.targetId + ' · ' + info.text),
                row.data.absolute ? h('div', { className: 'eu4w-mono eu4w-muted' }, row.data.absolute) : null,
                row.data.province && row.data.province.mismatch ? h('div', { className: 'eu4w-warn' }, '⚠ 省份所有权与控制权不一致，可能导致被占领状态异常') : null,
                row.data.province && row.data.province.inDateBlock === false ? h('div', { className: 'eu4w-warn' }, '⚠ owner/controller 不在日期块内，可能被原版 1444 定义覆盖') : null,
                row.data.diplomacy?.warning ? h('div', { className: 'eu4w-warn' }, row.data.diplomacy.warning) : null,
                row.data.localisation?.warning ? h('div', { className: 'eu4w-warn' }, row.data.localisation.warning) : null,
              );
            }),
          ) : null,
          pathReport ? h('div', { className: 'eu4w-col eu4w-stat' },
            ...pathReport.map((row, i) => h('div', { key: i, className: 'eu4w-col' },
              h('div', { className: row.ok ? 'eu4w-ok' : 'eu4w-err' },
                (row.ok ? '✓ ' : '✗ ') + t(row.ok ? 'paths.ok' : 'paths.outside')),
              h('div', { className: 'eu4w-mono eu4w-muted' }, row.absolute),
            )),
          ) : null,
          prompt ? h('div', { className: 'eu4w-col' },
            h('div', { className: 'eu4w-muted' }, t('queue.prompt')),
            h('textarea', { className: 'eu4w-area', rows: 12, value: prompt, readOnly: true, spellCheck: false }),
            h('button', {
              className: 'eu4w-btn',
              onClick: () => { try { navigator.clipboard.writeText(prompt); } catch { /* ignore */ } },
            }, t('ai.copy')),
          ) : null,
        ),
      );
    }

    /** Province-history panel: Chinese form -> ProvinceHistoryConfig. */
    function ProvinceTab({ setErr }) {
      const { t } = useLocale();
      const { enqueue } = useQueue();
      const { religions, cultures, cultureGroups } = useDictionary();
      const catalog = useProvinceCatalog();
      const [cfg, setCfg, cfgDraft] = useFormState('provinceForm', {
        id: 2664, name: '', name_cn: '', name_en: '', owner: '', controller: '', religion: '', culture: '',
        base_tax: '', base_production: '', base_manpower: '', trade_goods: '', localisation: false,
      });
      const [file, setFile] = useState('');
      const [msg, setMsg] = useState('');
      const selected = useMemo(() => (catalog.items || []).find((item) => Number(item.id) === Number(cfg.id)) || null, [catalog.items, cfg.id]);
      const set = (key, value) => setCfg((prev) => {
        const next = { ...prev, [key]: value };
        if (key === 'owner' && value) next.controller = value;
        return next;
      });
      const loadFile = async (id, name) => {
        try {
          const d = await api('/history/province?id=' + id + '&name=' + encodeURIComponent(name || ''));
          setFile(d.file || '');
        } catch { setFile(''); }
      };
      const load = async (overrideId, overrideName) => {
        const id = Number(overrideId ?? cfg.id);
        if (!id) { setErr(t('nl.empty')); return; }
        try {
          const d = await api('/map?provinceId=' + id);
          const p = (d.provinces || [])[0];
          if (p) setCfg((prev) => ({ ...prev, ...p, base_tax: p.base_tax ?? '', base_production: p.base_production ?? '', base_manpower: p.base_manpower ?? '', trade_goods: p.trade_goods || '' }));
          await loadFile(id, overrideName || p?.name || '');
          setErr('');
        } catch (e) { setErr(String(e.message || e)); }
      };
      /** Picking a row binds the numeric ID and preloads the bilingual names. */
      const pickProvince = (id, item) => {
        const numericId = Number(id);
        setCfg((prev) => ({
          ...prev,
          id: numericId,
          name: item?.name || prev.name,
          name_cn: item ? (item.name_cn || '') : prev.name_cn,
          name_en: item ? (item.name_en || item.name || '') : prev.name_en,
        }));
        if (numericId) load(numericId, item?.name_en || item?.name);
      };
      const applyNL = (config) => {
        const p = config?.province;
        if (!p) { setErr(t('nl.invalidJson')); return; }
        setCfg((prev) => ({ ...prev, ...p, base_tax: p.base_tax ?? '', base_production: p.base_production ?? '', base_manpower: p.base_manpower ?? '', trade_goods: p.trade_goods || '' }));
        if (p.id) loadFile(p.id, p.name);
        setMsg(t('nl.filled'));
      };
      const apply = async () => {
        const id = Number(cfg.id);
        if (!id) { setErr(t('nl.empty')); return; }
        // The queued JSON keeps the numeric ID; names ride along only as the
        // localisation payload the agent writes later.
        const data = { id, name: cfg.name || '' };
        if (cfg.localisation) {
          if (cfg.name_cn) data.name_cn = cfg.name_cn;
          if (cfg.name_en) data.name_en = cfg.name_en;
          data.localisation = true;
        }
        for (const key of ['owner', 'controller', 'religion', 'culture', 'trade_goods']) if (cfg[key]) data[key] = cfg[key];
        if (data.owner) data.controller = data.owner;
        for (const key of ['base_tax', 'base_production', 'base_manpower']) {
          const n = Number(cfg[key]);
          if (Number.isFinite(n) && cfg[key] !== '') data[key] = n;
        }
        try {
          const result = await enqueue({
            targetType: 'province_history',
            action: 'modify',
            targetId: String(id),
            targetFile: file || `history/provinces/${id} - ${cfg.name || id}.txt`,
            data,
          });
          setMsg(t('queue.added', { count: result.count || 1 }));
          cfgDraft.reset();
        } catch (e) { setErr(String(e.message || e)); }
      };
      useRegisterForm('provinceForm', cfg, (clip) => {
        if (clip && typeof clip === 'object') setCfg((prev) => ({ ...prev, ...clip }));
      });
      const selectedLabel = selected
        ? (selected.label || provinceLabelOf(selected))
        : provinceLabelOf(null, cfg.id);
      return h('div', { className: 'eu4w-col' },
        h(NLAssistant, { kind: 'province_history', form: cfg, onApply: applyNL }),
        h('div', { className: 'eu4w-card' },
          h('h3', null, t('province.title')),
          h('div', { className: 'eu4w-row' },
            h('div', { style: { flex: 1, minWidth: 260 } },
              h(ProvincePicker, {
                value: cfg.id,
                items: catalog.items,
                placeholder: t('province.pickerPlaceholder'),
                onChange: pickProvince,
              }),
            ),
            h('button', { className: 'eu4w-btn', onClick: () => load() }, t('province.load')),
            file ? h('span', { className: 'eu4w-mono eu4w-muted' }, t('province.file', { file })) : null,
          ),
          h('div', { className: 'eu4w-row' },
            h('span', { className: 'eu4w-pill' }, selectedLabel),
            h('span', { className: 'eu4w-mono eu4w-muted' }, t('province.idOnly') + ' = ' + String(cfg.id)),
            h('span', { className: 'eu4w-muted' },
              !selected ? '' : (selected.name_cn ? t('province.cnSource', { file: selected.name_cn_source || '—' }) : t('province.noCn'))),
            catalog.error ? h('span', { className: 'eu4w-err' }, catalog.error) : null,
          ),
          h('div', { className: 'eu4w-grid' },
            field(t('province.nameCn'), h('input', { className: 'eu4w-input', value: cfg.name_cn || '', onChange: (e) => set('name_cn', e.target.value) })),
            field(t('province.nameEn'), h('input', { className: 'eu4w-input', value: cfg.name_en || '', onChange: (e) => set('name_en', e.target.value) })),
            field(t('province.owner'), h('input', { className: 'eu4w-input', value: cfg.owner || '', onChange: (e) => set('owner', e.target.value.toUpperCase()) })),
            field(t('province.controller'), h('input', { className: 'eu4w-input', value: cfg.controller || '', onChange: (e) => set('controller', e.target.value.toUpperCase()) })),
            field(t('province.religion'), h(SearchSelect, {
              value: cfg.religion || '',
              options: religions.length ? religions : [{ value: 'catholic', keywords: 'catholic' }],
              prefix: 'religion',
              allowCustom: true,
              onChange: (value) => set('religion', value),
            })),
            field(t('province.culture'), h(CultureTreeSelect, {
              value: cfg.culture || '',
              groups: cultureGroups,
              cultures,
              placeholder: t('province.culture'),
              onChange: (value) => set('culture', value),
            })),
            field(t('province.base_tax'), h('input', { className: 'eu4w-input', type: 'number', value: cfg.base_tax, onChange: (e) => set('base_tax', e.target.value) })),
            field(t('province.base_production'), h('input', { className: 'eu4w-input', type: 'number', value: cfg.base_production, onChange: (e) => set('base_production', e.target.value) })),
            field(t('province.base_manpower'), h('input', { className: 'eu4w-input', type: 'number', value: cfg.base_manpower, onChange: (e) => set('base_manpower', e.target.value) })),
            field(t('province.trade_goods'), h('input', { className: 'eu4w-input', value: cfg.trade_goods || '', onChange: (e) => set('trade_goods', e.target.value) })),
          ),
          h('label', { className: 'eu4w-check' },
            h('input', {
              type: 'checkbox',
              checked: Boolean(cfg.localisation),
              onChange: (e) => set('localisation', e.target.checked),
            }),
            t('province.syncName', { id: cfg.id }),
          ),
          h('div', { className: 'eu4w-muted' }, t('province.localisationHint')),
          h('div', { className: 'eu4w-row' },
            h('button', { className: 'eu4w-btn primary', onClick: apply }, t('province.apply')),
            msg ? h('span', { className: 'eu4w-muted' }, msg) : null,
          ),
        ),
      );
    }

    /** Country management: modify an existing tag or create a brand-new one. */
    function CountryTab({ setErr }) {
      const { t } = useLocale();
      const { enqueue } = useQueue();
      const { techGroups, governments, religions, cultures, cultureGroups } = useDictionary();
      const [mode, setMode] = useState('modify');
      const [cfg, setCfg, cfgDraft] = useFormState('countryForm', {
        tag: 'BOH', name: 'Bohemia', government: '', religion: '',
        technology_group: '', primary_culture: '', capital: '',
        monarchName: '', adm: '', dip: '', mil: '', birthDate: '', deathDate: '',
        localisation: true,
      });
      const [file, setFile] = useState('');
      const [msg, setMsg] = useState('');
      const set = (key, value) => setCfg((prev) => ({ ...prev, [key]: value }));
      const flatten = (src) => ({
        ...src,
        capital: src.capital ?? '',
        monarchName: src.add_monarch?.name || '', adm: src.add_monarch?.adm ?? '',
        dip: src.add_monarch?.dip ?? '', mil: src.add_monarch?.mil ?? '',
        birthDate: src.add_monarch?.birth_date || '', deathDate: src.add_monarch?.death_date || '',
        localisation: src.localisation !== false,
      });
      const applyNL = (config) => {
        if (config?.newTag) { setMode('new'); setCfg(flatten(config.newTag)); setFile(''); setMsg(t('nl.filled')); return; }
        if (config?.country) { setMode('modify'); setCfg(flatten(config.country)); setMsg(t('nl.filled')); return; }
        setErr(t('nl.invalidJson'));
      };
      const load = async () => {
        try {
          const d = await api('/history/country?tag=' + encodeURIComponent(cfg.tag));
          setFile(d.file || '');
          setCfg((prev) => ({ ...prev, name: d.name || prev.name, tag: d.tag || prev.tag }));
          setErr('');
        } catch (e) { setErr(String(e.message || e)); }
      };
      const apply = async () => {
        const tag = String(cfg.tag || '').trim().toUpperCase();
        if (!/^[A-Z0-9]{3}$/.test(tag)) { setErr(t('app.tagInvalid')); return; }
        const data = { tag };
        for (const key of ['name', 'government', 'religion', 'technology_group', 'primary_culture']) if (cfg[key]) data[key] = cfg[key];
        if (Number(cfg.capital)) data.capital = Number(cfg.capital);
        if (cfg.monarchName) {
          data.add_monarch = {
            name: cfg.monarchName, adm: Number(cfg.adm) || 0,
            dip: Number(cfg.dip) || 0, mil: Number(cfg.mil) || 0,
            birth_date: cfg.birthDate || '', death_date: cfg.deathDate || '',
          };
        }
        if (mode === 'new') data.localisation = true;
        try {
          const targetType = mode === 'new' ? 'new_tag' : 'country_history';
          const targetFile = mode === 'new'
            ? `history/countries/${tag} - ${cfg.name || tag}.txt`
            : (file || `history/countries/${tag} - ${tag}.txt`);
          const result = await enqueue({
            targetType,
            action: mode === 'new' ? 'create' : 'modify',
            targetId: tag,
            targetFile,
            data,
          });
          setMsg(t('queue.added', { count: result.count || 1 }));
          cfgDraft.reset();
        } catch (e) { setErr(String(e.message || e)); }
      };
      useRegisterForm('countryForm', cfg, (clip) => {
        if (clip && typeof clip === 'object') setCfg((prev) => ({ ...prev, ...clip }));
      });
      return h('div', { className: 'eu4w-col' },
        h(NLAssistant, { key: mode, kind: mode === 'new' ? 'new_tag' : 'country_history', form: cfg, onApply: applyNL }),
        h('div', { className: 'eu4w-card' },
          h('div', { className: 'eu4w-row' },
            h('h3', null, t('country.title')),
            h('button', { className: 'eu4w-btn' + (mode === 'modify' ? ' primary' : ''), onClick: () => { setMode('modify'); setFile(''); } }, t('country.mode.modify')),
            h('button', { className: 'eu4w-btn' + (mode === 'new' ? ' primary' : ''), onClick: () => { setMode('new'); setFile(''); } }, t('country.mode.new')),
          ),
          h('div', { className: 'eu4w-row' },
            h('input', { className: 'eu4w-input', style: { width: 80 }, maxLength: 3, value: cfg.tag, onChange: (e) => set('tag', e.target.value.toUpperCase()) }),
            mode === 'modify' ? h('button', { className: 'eu4w-btn', onClick: load }, t('country.load')) : null,
            file ? h('span', { className: 'eu4w-mono eu4w-muted' }, t('map.countryFile', { file })) : null,
          ),
          h('div', { className: 'eu4w-grid' },
            field(t('country.name'), h('input', { className: 'eu4w-input', value: cfg.name, onChange: (e) => set('name', e.target.value) })),
            field(t('country.government'), h(SearchSelect, {
              value: cfg.government,
              options: governments.length ? governments : [{ value: 'monarchy', keywords: 'monarchy' }],
              prefix: 'government',
              allowCustom: true,
              onChange: (value) => set('government', value),
            })),
            field(t('country.religion'), h(SearchSelect, {
              value: cfg.religion,
              options: religions.length ? religions : [{ value: 'catholic', keywords: 'catholic' }],
              prefix: 'religion',
              allowCustom: true,
              onChange: (value) => set('religion', value),
            })),
            field(t('country.technology_group'), h(SearchSelect, {
              value: cfg.technology_group,
              options: techGroups.length ? techGroups : [{ value: 'eastern', keywords: 'eastern' }],
              prefix: 'techgroup',
              onChange: (value) => set('technology_group', value),
            })),
            field(t('country.primary_culture'), h(CultureTreeSelect, {
              value: cfg.primary_culture,
              groups: cultureGroups,
              cultures,
              placeholder: t('country.primary_culture'),
              onChange: (value) => set('primary_culture', value),
            })),
            field(t('country.capital'), h('input', { className: 'eu4w-input', type: 'number', value: cfg.capital, onChange: (e) => set('capital', e.target.value) })),
          ),
          h('h4', null, t('map.monarch')),
          h('div', { className: 'eu4w-grid' },
            field(t('map.monarchName'), h('input', { className: 'eu4w-input', value: cfg.monarchName, onChange: (e) => set('monarchName', e.target.value) })),
            field(t('map.adm'), h('input', { className: 'eu4w-input', type: 'number', value: cfg.adm, onChange: (e) => set('adm', e.target.value) })),
            field(t('map.dip'), h('input', { className: 'eu4w-input', type: 'number', value: cfg.dip, onChange: (e) => set('dip', e.target.value) })),
            field(t('map.mil'), h('input', { className: 'eu4w-input', type: 'number', value: cfg.mil, onChange: (e) => set('mil', e.target.value) })),
            field(t('map.birthDate'), h('input', { className: 'eu4w-input', value: cfg.birthDate, placeholder: '1444.11.11', onChange: (e) => set('birthDate', e.target.value) })),
            field(t('map.deathDate'), h('input', { className: 'eu4w-input', value: cfg.deathDate, placeholder: '1460.1.1', onChange: (e) => set('deathDate', e.target.value) })),
          ),
          mode === 'new' ? h('div', { className: 'eu4w-warn' }, t('country.flagNote')) : null,
          h('div', { className: 'eu4w-row' },
            h('button', { className: 'eu4w-btn primary', onClick: apply }, t('country.apply')),
            msg ? h('span', { className: 'eu4w-muted' }, msg) : null,
          ),
        ),
      );
    }

    /** National ideas: 2 traditions + 1 ambition + 7 ideas, English modifier keys. */
    function IdeasTab({ setErr }) {
      const { t } = useLocale();
      const { enqueue } = useQueue();
      const { modifiers, modifierTree } = useDictionary();
      const { activeTag } = useTagContext();
      const refreshToken = React.useContext(RefreshContext);
      const modifierOptions = modifiers.length ? modifiers : [{ value: 'land_morale', keywords: 'land_morale' }];
      const defaultIdeas = () => Array.from({ length: 7 }, (_, i) => ({
        id: 'boh_idea_' + (i + 1), name: '', desc: '', modifiers: [{ modifier: 'land_morale', value: '0' }],
      }));
      // The tag defaults to the shared header Tag, never a hard-coded BOH.
      const [tag, setTag, tagDraft] = useFormState('ideaForm.tag', activeTag || 'BOH');
      const [traditions, setTraditions, traditionsDraft] = useFormState('ideaForm.traditions', [
        { modifiers: [{ modifier: 'land_morale', value: '0.1' }] },
        { modifiers: [{ modifier: 'discipline', value: '0.05' }] },
      ]);
      const [ambition, setAmbition, ambitionDraft] = useFormState('ideaForm.ambition', {
        modifiers: [{ modifier: 'core_creation', value: '-0.1' }],
      });
      const [ideas, setIdeas, ideasDraft] = useFormState('ideaForm.ideas', defaultIdeas());
      // mtime/dirty/tag survive tab switches, so returning to the tab cannot
      // clobber edits — and switching the tag always forces a fresh read.
      const [loadMeta, setLoadMeta] = useFormState('ideaForm.meta', { mtimeMs: 0, tag: '', dirty: false });
      const [file, setFile] = useState('');
      const [exists, setExists] = useState(false);
      const [msg, setMsg] = useState('');
      const [staleHint, setStaleHint] = useState(false);
      const metaRef = useRef(loadMeta);
      metaRef.current = loadMeta;
      const tagRef = useRef(tag);
      tagRef.current = tag;
      const markDirty = () => setLoadMeta((prev) => (prev.dirty ? prev : { ...prev, dirty: true }));

      /** File -> form slots. Native values stay native; the rows convert to %. */
      const applyParsed = (d, { silent } = {}) => {
        const slots = ideasToSlots(d);
        setTraditions(slots.traditions);
        setAmbition(slots.ambition);
        setIdeas(slots.ideas);
        setLoadMeta((prev) => ({
          ...prev,
          mtimeMs: Number(d.mtimeMs) || 0,
          tag: String(d.tag || tagRef.current || '').toUpperCase(),
          dirty: false,
        }));
        setStaleHint(false);
        setMsg(silent ? t('ideas.autoReloaded') : '');
      };

      /** Changing the tag wipes every slot immediately (no stale country data). */
      const clearForTag = () => {
        const empty = ideasToSlots({ traditions: [], ambition: null, ambitionModifiers: [], ideas: [] });
        setTraditions(empty.traditions);
        setAmbition(empty.ambition);
        setIdeas(empty.ideas);
        setLoadMeta((prev) => ({ ...prev, tag: '', mtimeMs: 0, dirty: false }));
        setStaleHint(false);
        setMsg('');
      };

      const fetchIdeas = async () => {
        const requested = String(tagRef.current || '').trim().toUpperCase();
        const d = await api('/ideas/file?tag=' + encodeURIComponent(requested));
        setFile(d.file || '');
        setExists(d.exists === true);
        return d;
      };
      /** Explicit read: clear first, then read with the *current* tag. */
      const load = async () => {
        const requested = String(tagRef.current || '').trim().toUpperCase();
        if (!/^[A-Z0-9]{3}$/.test(requested)) { setErr(t('app.tagInvalid')); return; }
        try {
          await api('/refresh', { method: 'POST', body: '{}' }).catch(() => {});
          clearForTag();
          const d = await fetchIdeas();
          applyParsed(d, {});
          setErr('');
        } catch (e) { setErr(String(e.message || e)); }
      };
      /** Poll + focus: re-read when the file OR the requested tag changed. */
      useEffect(() => {
        let alive = true;
        const check = async (initial) => {
          try {
            const d = await fetchIdeas();
            if (!alive) return;
            const wanted = String(tagRef.current || '').trim().toUpperCase();
            const loaded = String(metaRef.current.tag || '').toUpperCase();
            const tagChanged = wanted !== loaded;
            const fileChanged = (Number(d.mtimeMs) || 0) !== metaRef.current.mtimeMs;
            if (!tagChanged && !fileChanged) return;
            if (!tagChanged && metaRef.current.dirty) { setStaleHint(true); return; }
            applyParsed(d, { silent: !initial });
          } catch { /* polling never surfaces errors */ }
        };
        check(true);
        const timer = setInterval(() => check(false), 3000);
        const onFocus = () => check(false);
        window.addEventListener('focus', onFocus);
        return () => { alive = false; clearInterval(timer); window.removeEventListener('focus', onFocus); };
      }, [tag, t]);
      // Top-bar refresh: re-read even if the form was marked dirty.
      useEffect(() => {
        if (refreshToken > 0) load();
      }, [refreshToken]);

      const normalizeTag = (value) => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
      const handleTagChange = (event) => {
        const next = normalizeTag(event.target.value);
        const previous = String(tagRef.current || '').toUpperCase();
        setTag(next);
        if (next !== previous) clearForTag();
      };
      const handleTagKeyDown = (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        load();
      };
      const handleTagBlur = () => {
        const current = String(tagRef.current || '').trim().toUpperCase();
        if (!/^[A-Z0-9]{3}$/.test(current)) return;
        if (current === String(metaRef.current.tag || '').toUpperCase()) return;
        load();
      };
      // Follow the shared header Tag when it changes (manual tags stay put until
      // the header itself is switched).
      const lastHeaderTag = useRef(activeTag);
      useEffect(() => {
        if (!activeTag || lastHeaderTag.current === activeTag) return;
        lastHeaderTag.current = activeTag;
        const next = normalizeTag(activeTag);
        if (next && next !== String(tagRef.current || '').toUpperCase()) {
          setTag(next);
          clearForTag();
        }
      }, [activeTag]);

      const updateSlot = (index, patch) => {
        markDirty();
        setTraditions((prev) => prev.map((slot, i) => i === index ? { ...slot, ...patch } : slot));
      };
      const updateIdea = (index, patch) => {
        markDirty();
        setIdeas((prev) => prev.map((idea, i) => i === index ? { ...idea, ...patch } : idea));
      };
      /** One row per modifier; native value in state, percent in the input. */
      const modifierRows = (slot, onChangeSlot) => [
        ...(slot.modifiers || []).map((mod, i) => {
          const type = valueTypeOf(modifierOptions, mod.modifier);
          return h('div', { className: 'eu4w-row', key: 'mod-' + i },
            h(ModifierTreeSelector, {
              value: mod.modifier,
              options: modifierOptions.some((option) => option.value === mod.modifier)
                ? modifierOptions
                : [{ value: mod.modifier, keywords: mod.modifier }, ...modifierOptions],
              tree: modifierTree,
              onChange: (value) => {
                const nextType = valueTypeOf(modifierOptions, value);
                const shown = toDisplayValue(mod.value, type);
                onChangeSlot({ modifiers: slot.modifiers.map((m, j) => j === i ? { modifier: value, value: String(toNativeValue(shown, nextType)) } : m) });
              },
            }),
            h('input', {
              className: 'eu4w-input', style: { width: 110 }, type: 'number',
              value: toDisplayValue(mod.value, type),
              placeholder: type === 'percentage' ? '5' : '20',
              onChange: (e) => onChangeSlot({
                modifiers: slot.modifiers.map((m, j) => j === i ? { ...m, value: String(toNativeValue(e.target.value, type)) } : m),
              }),
            }),
            h('span', { className: 'eu4w-muted' }, type === 'percentage' ? '%' : ''),
            (slot.modifiers || []).length > 1
              ? h('button', {
                className: 'eu4w-btn danger',
                onClick: () => onChangeSlot({ modifiers: slot.modifiers.filter((_, j) => j !== i) }),
              }, '×')
              : null,
          );
        }),
        h('button', {
          className: 'eu4w-btn', style: { fontSize: 11 },
          onClick: () => onChangeSlot({ modifiers: [...(slot.modifiers || []), { modifier: 'land_morale', value: '0' }] }),
        }, t('ideas.addModifier')),
      ];
      const slotPayload = (slot) => {
        const list = (slot.modifiers || []).map((mod) => ({ modifier: mod.modifier, value: Number(mod.value) || 0 }));
        if (list.length === 1) return list[0];
        return { modifiers: list };
      };
      const apply = async () => {
        const upper = String(tag || '').trim().toUpperCase();
        if (!/^[A-Z0-9]{3}$/.test(upper)) { setErr(t('app.tagInvalid')); return; }
        let targetFile = file;
        let fileExists = exists;
        if (!targetFile) {
          try {
            const d = await api('/ideas/file?tag=' + encodeURIComponent(upper));
            targetFile = d.file || '';
            fileExists = d.exists === true;
            setFile(targetFile);
            setExists(fileExists);
          } catch { /* fall back to default below */ }
        }
        const data = {
          tag: upper,
          traditions: traditions.map(slotPayload),
          ambition: slotPayload(ambition),
          ideas: ideas.map((idea) => ({
            id: idea.id,
            name: idea.name,
            desc: idea.desc,
            ...slotPayload(idea),
          })),
        };
        try {
          const result = await enqueue({
            targetType: 'national_ideas',
            action: fileExists ? 'modify' : 'create',
            targetId: upper,
            targetFile: targetFile || `common/ideas/${upper}_ideas.txt`,
            data,
          });
          setMsg(t('queue.added', { count: result.count || 1 }));
          // Keep the edited values on screen; the mtime poll fills in the
          // written file as soon as the Agent saves it.
          setLoadMeta((prev) => ({ ...prev, dirty: false }));
        } catch (e) { setErr(String(e.message || e)); }
      };
      const pasteIdeas = (clip) => {
        if (!clip || typeof clip !== 'object') return;
        if (typeof clip.tag === 'string') setTag(clip.tag);
        if (Array.isArray(clip.traditions)) setTraditions(clip.traditions.map((slot) => ({ modifiers: Array.isArray(slot.modifiers) ? slot.modifiers : [{ modifier: slot.modifier, value: slot.value }] })));
        if (clip.ambition && typeof clip.ambition === 'object') setAmbition({ modifiers: Array.isArray(clip.ambition.modifiers) ? clip.ambition.modifiers : [{ modifier: clip.ambition.modifier, value: clip.ambition.value }] });
        if (Array.isArray(clip.ideas)) setIdeas(clip.ideas.map((idea) => ({ ...idea, modifiers: Array.isArray(idea.modifiers) ? idea.modifiers : [{ modifier: idea.modifier, value: idea.value }] })));
      };
      useRegisterForm('ideaForm', { tag, traditions, ambition, ideas }, pasteIdeas);
      return h('div', { className: 'eu4w-col' },
        h('div', { className: 'eu4w-card' },
          h('h3', null, t('ideas.title')),
          h('div', { className: 'eu4w-row' },
            h('input', {
              className: 'eu4w-input', style: { width: 90 }, maxLength: 3, value: tag,
              placeholder: 'RUS',
              title: t('ideas.tagHint'),
              onChange: handleTagChange,
              onKeyDown: handleTagKeyDown,
              onBlur: handleTagBlur,
            }),
            h('button', { className: 'eu4w-btn', onClick: load }, t('ideas.load')),
            file ? h('span', { className: 'eu4w-mono eu4w-muted' }, t('ideas.file', { file })) : null,
            exists ? h('span', { className: 'eu4w-pill eu4w-ok' }, t('ideas.exists')) : h('span', { className: 'eu4w-pill' }, t('ideas.newFile')),
          ),
          staleHint
            ? h('div', { className: 'eu4w-warn' },
              t('ideas.stale'),
              h('button', { className: 'eu4w-btn', style: { marginLeft: 8 }, onClick: load }, t('ideas.reload')),
            )
            : null,
          h('h4', null, t('ideas.traditions')),
          ...traditions.map((slot, i) => h('div', { key: 'tradition-' + i, className: 'eu4w-col' },
            h('div', { className: 'eu4w-muted' }, t('ideas.idea', { index: i + 1 })),
            ...modifierRows(slot, (patch) => { markDirty(); updateSlot(i, patch); }),
          )),
          h('h4', null, t('ideas.ambition')),
          ...modifierRows(ambition, (patch) => { markDirty(); setAmbition((prev) => ({ ...prev, ...patch })); }),
        ),
        h('div', { className: 'eu4w-card' },
          h('h3', null, t('ideas.title')),
          ...ideas.map((idea, i) => h('div', { className: 'eu4w-card', key: 'idea-' + i },
            h('h4', null, t('ideas.idea', { index: i + 1 })),
            h('div', { className: 'eu4w-grid' },
              field(t('ideas.id'), h('input', { className: 'eu4w-input', value: idea.id, onChange: (e) => updateIdea(i, { id: e.target.value }) })),
              field(t('ideas.name'), h('input', { className: 'eu4w-input', value: idea.name, onChange: (e) => updateIdea(i, { name: e.target.value }) })),
              field(t('ideas.desc'), h(AutoTextArea, {
              value: idea.desc, minHeight: 60, toolbar: true,
              onChange: (v) => updateIdea(i, { desc: v }),
            })),
            ),
            ...modifierRows(idea, (patch) => updateIdea(i, patch)),
          )),
          h('div', { className: 'eu4w-row' },
            h('button', { className: 'eu4w-btn primary', onClick: apply }, t('ideas.apply')),
            msg ? h('span', { className: 'eu4w-muted' }, msg) : null,
          ),
        ),
      );
    }

    /** Governments & reforms: reform definition + tag binding. */
    function GovernmentTab({ setErr }) {
      const { t } = useLocale();
      const { enqueue } = useQueue();
      const { governments, modifiers, modifierTree } = useDictionary();
      const [mode, setMode] = useState('reform');
      const [reformAction, setReformAction] = useState('create');
      const [reform, setReform, reformDraft] = useFormState('governmentReform', {
        id: 'boh_reform_1', name: '', tier: 1, potential_government: '',
        modifiers: [{ modifier: 'discipline', value: '0.05' }],
      });
      const [reformFile, setReformFile] = useState('common/governments/00_reforms.txt');
      const [tagCfg, setTagCfg, tagDraft] = useFormState('governmentTag', { tag: 'BOH', government_type: 'monarchy', reforms: ['boh_reform_1'] });
      const [tagFile, setTagFile] = useState('');
      const [msg, setMsg] = useState('');
      const modifierOptions = modifiers.length ? modifiers : [{ value: 'discipline', keywords: 'discipline' }];
      const governmentOptions = governments.length ? governments : [{ value: 'monarchy', keywords: 'monarchy' }];
      const setReformField = (key, value) => setReform((prev) => ({ ...prev, [key]: value }));
      const updateModifier = (index, patch) => setReform((prev) => ({
        ...prev,
        modifiers: prev.modifiers.map((item, i) => i === index ? { ...item, ...patch } : item),
      }));
      const applyReform = async () => {
        const id = String(reform.id || '').trim();
        if (!id) { setErr(t('gov.reformId')); return; }
        const data = {
          id,
          name: reform.name,
          tier: Number(reform.tier) || 1,
          potential_government: reform.potential_government || '',
          modifiers: reform.modifiers.map((item) => ({ modifier: item.modifier, value: Number(item.value) || 0 })),
        };
        try {
          const result = await enqueue({
            targetType: 'government_reform',
            action: reformAction,
            targetId: id,
            targetFile: reformFile,
            data,
          });
          setMsg(t('queue.added', { count: result.count || 1 }));
          reformDraft.reset();
        } catch (e) { setErr(String(e.message || e)); }
      };
      const loadCountry = async () => {
        try {
          const d = await api('/history/country?tag=' + encodeURIComponent(tagCfg.tag));
          setTagFile(d.file || '');
          setErr('');
        } catch (e) { setErr(String(e.message || e)); }
      };
      const applyTag = async () => {
        const tag = String(tagCfg.tag || '').trim().toUpperCase();
        if (!/^[A-Z0-9]{3}$/.test(tag)) { setErr(t('app.tagInvalid')); return; }
        const data = {
          tag,
          government_type: tagCfg.government_type,
          reforms: tagCfg.reforms.map((id) => String(id).trim()).filter(Boolean),
        };
        try {
          const result = await enqueue({
            targetType: 'tag_government',
            action: 'modify',
            targetId: tag,
            targetFile: tagFile || `history/countries/${tag} - ${tag}.txt`,
            data,
          });
          setMsg(t('queue.added', { count: result.count || 1 }));
          tagDraft.reset();
        } catch (e) { setErr(String(e.message || e)); }
      };
      const modifierRow = (slot, onChange) => {
        const type = valueTypeOf(modifierOptions, slot.modifier);
        return h('div', { className: 'eu4w-row' },
          h(ModifierTreeSelector, {
            value: slot.modifier,
            options: modifierOptions.some((option) => option.value === slot.modifier)
              ? modifierOptions
              : [{ value: slot.modifier, keywords: slot.modifier }, ...modifierOptions],
            tree: modifierTree,
            onChange: (value) => {
              const nextType = valueTypeOf(modifierOptions, value);
              const shown = toDisplayValue(slot.value, type);
              onChange({ modifier: value, value: String(toNativeValue(shown, nextType)) });
            },
          }),
          h('input', {
            className: 'eu4w-input', style: { width: 110 }, type: 'number',
            value: toDisplayValue(slot.value, type),
            placeholder: type === 'percentage' ? '5' : '20',
            onChange: (e) => onChange({ value: String(toNativeValue(e.target.value, type)) }),
          }),
          type === 'percentage' ? h('span', { className: 'eu4w-muted' }, '%') : null,
        );
      };
      const pasteGov = (clip) => {
        if (!clip || typeof clip !== 'object') return;
        if (clip.tier !== undefined || clip.potential_government !== undefined || Array.isArray(clip.modifiers)) {
          setReform((prev) => ({ ...prev, ...clip }));
        }
        if (clip.government_type !== undefined || Array.isArray(clip.reforms) || clip.tag !== undefined) {
          setTagCfg((prev) => ({ ...prev, ...clip }));
        }
      };
      useRegisterForm('governmentForm', { mode, reform, tagCfg }, pasteGov);
      return h('div', { className: 'eu4w-col' },
        h('div', { className: 'eu4w-row' },
          h('h3', null, t('gov.title')),
          h('button', { className: 'eu4w-btn' + (mode === 'reform' ? ' primary' : ''), onClick: () => setMode('reform') }, t('gov.tabReform')),
          h('button', { className: 'eu4w-btn' + (mode === 'assign' ? ' primary' : ''), onClick: () => setMode('assign') }, t('gov.tabAssign')),
        ),
        mode === 'reform' ? h('div', { className: 'eu4w-card' },
          h('div', { className: 'eu4w-row' },
            h('span', null, t('gov.action')),
            h('select', { className: 'eu4w-select', value: reformAction, onChange: (e) => setReformAction(e.target.value) },
              h('option', { value: 'create' }, t('gov.create')),
              h('option', { value: 'modify' }, t('gov.modify')),
            ),
          ),
          h('div', { className: 'eu4w-grid' },
            field(t('gov.reformId'), h('input', { className: 'eu4w-input', value: reform.id, onChange: (e) => setReformField('id', e.target.value) })),
            field(t('gov.name'), h('input', { className: 'eu4w-input', value: reform.name, onChange: (e) => setReformField('name', e.target.value) })),
            field(t('gov.tier'), h('select', { className: 'eu4w-select', value: reform.tier, onChange: (e) => setReformField('tier', e.target.value) },
              ...Array.from({ length: 8 }, (_, i) => h('option', { key: i + 1, value: i + 1 }, String(i + 1))),
            )),
            field(t('gov.potential'), h(SearchSelect, {
              value: reform.potential_government,
              options: governmentOptions,
              prefix: 'government',
              allowCustom: true,
              placeholder: t('gov.optional'),
              onChange: (value) => setReformField('potential_government', value),
            })),
            field(t('gov.file', { file: reformFile }), h('input', { className: 'eu4w-input', value: reformFile, onChange: (e) => setReformFile(e.target.value) })),
          ),
          h('h4', null, t('gov.modifiers')),
          ...reform.modifiers.map((slot, i) => h('div', { key: i }, modifierRow(slot, (patch) => updateModifier(i, patch)))),
          h('div', { className: 'eu4w-row' },
            h('button', {
              className: 'eu4w-btn',
              onClick: () => setReform((prev) => ({ ...prev, modifiers: [...prev.modifiers, { modifier: 'discipline', value: '0.05' }] })),
            }, t('gov.addModifier')),
            h('button', { className: 'eu4w-btn primary', onClick: applyReform }, t('gov.applyReform')),
            msg ? h('span', { className: 'eu4w-muted' }, msg) : null,
          ),
        ) : h('div', { className: 'eu4w-card' },
          h('div', { className: 'eu4w-row' },
            h('input', { className: 'eu4w-input', style: { width: 80 }, maxLength: 3, value: tagCfg.tag, onChange: (e) => setTagCfg((prev) => ({ ...prev, tag: e.target.value.toUpperCase() })) }),
            h('button', { className: 'eu4w-btn', onClick: loadCountry }, t('gov.load')),
            tagFile ? h('span', { className: 'eu4w-mono eu4w-muted' }, t('gov.file', { file: tagFile })) : null,
          ),
          h('div', { className: 'eu4w-grid' },
            field(t('gov.governmentType'), h(SearchSelect, {
              value: tagCfg.government_type,
              options: governmentOptions,
              prefix: 'government',
              allowCustom: true,
              onChange: (value) => setTagCfg((prev) => ({ ...prev, government_type: value })),
            })),
          ),
          h('h4', null, t('gov.reforms')),
          ...tagCfg.reforms.map((id, i) => h('div', { className: 'eu4w-row', key: i },
            h('input', {
              className: 'eu4w-input', value: id, placeholder: t('gov.reformPlaceholder'),
              onChange: (e) => setTagCfg((prev) => ({ ...prev, reforms: prev.reforms.map((item, idx) => idx === i ? e.target.value : item) })),
            }),
            h('button', {
              className: 'eu4w-btn danger',
              onClick: () => setTagCfg((prev) => ({ ...prev, reforms: prev.reforms.filter((_, idx) => idx !== i) })),
            }, t('common.delete')),
          )),
          h('div', { className: 'eu4w-row' },
            h('button', {
              className: 'eu4w-btn',
              onClick: () => setTagCfg((prev) => ({ ...prev, reforms: [...prev.reforms, ''] })),
            }, t('gov.addReform')),
            h('button', { className: 'eu4w-btn primary', onClick: applyTag }, t('gov.applyTag')),
            msg ? h('span', { className: 'eu4w-muted' }, msg) : null,
          ),
        ),
      );
    }

    function WorkspaceTab({ state, refresh, setState, setErr }) {
      const { t } = useLocale();
      const [eu4Root, setEu4Root] = useState(state?.eu4Root || '');
      const [modDir, setModDir] = useState(state?.modDir || '');
      const [selectedMod, setSelectedMod] = useState(state?.selectedMod || '');
      useEffect(() => { setEu4Root(state?.eu4Root || ''); setModDir(state?.modDir || ''); setSelectedMod(state?.selectedMod || ''); }, [state]);
      const save = async () => {
        try {
          const data = await api('/workspace', { method: 'POST', body: JSON.stringify({ eu4Root, modDir, selectedMod }) });
          setState(data); setErr('');
        } catch (e) { setErr(String(e.message || e)); }
      };
      const reindex = async () => {
        try {
          const data = await api('/reindex', { method: 'POST', body: '{}' });
          setState(data); setErr('');
        } catch (e) { setErr(String(e.message || e)); }
      };
      if (!state) return h('div', { className: 'eu4w-muted' }, t('app.loading'));
      return h('div', { className: 'eu4w-col' },
        h('div', { className: 'eu4w-grid' },
          h('div', { className: 'eu4w-card' },
            h('h3', null, t('ws.pathsTitle')),
            h('div', { className: 'eu4w-col' },
              h('label', { className: 'eu4w-muted' }, t('ws.eu4Root')),
              h('input', { className: 'eu4w-input', value: eu4Root, onChange: (e) => setEu4Root(e.target.value), placeholder: 'D:\\SteamLibrary\\steamapps\\common\\Europa Universalis IV' }),
              h('label', { className: 'eu4w-muted' }, t('ws.modDir')),
              h('input', { className: 'eu4w-input', value: modDir, onChange: (e) => setModDir(e.target.value), placeholder: 'Documents/Paradox Interactive/Europa Universalis IV/mod' }),
              h('label', { className: 'eu4w-muted' }, t('ws.currentMod')),
              h('select', { className: 'eu4w-select', value: selectedMod, onChange: (e) => setSelectedMod(e.target.value) },
                h('option', { value: '' }, t('ws.modNone')),
                ...(state.mods || []).map((m) => h('option', { key: m.id, value: m.id }, `${m.name} [${m.id}]`)),
              ),
              h('div', { className: 'eu4w-row' },
                h('button', { className: 'eu4w-btn primary', onClick: save }, t('ws.saveReindex')),
                h('button', { className: 'eu4w-btn', onClick: async () => { await refresh(); }, disabled: false }, t('ws.discard')),
                h('button', { className: 'eu4w-btn', onClick: reindex }, t('ws.reindex')),
              ),
            ),
          ),
          h('div', { className: 'eu4w-card' },
            h('h3', null, t('ws.indexTitle')),
            h('div', { className: 'eu4w-kv' },
              h('b', null, t('ws.vanillaFiles')), h('span', null, String(state.vanillaFileCount || 0)),
              h('b', null, t('ws.indexedAt')), h('span', null, state.indexedAt || t('ws.notIndexed')),
              h('b', null, t('ws.docs')), h('span', null, t('ws.docsValue', { entries: state.docs?.entries || 0, scopes: state.docs?.scopes || 0 })),
              h('b', null, t('ws.docSource')), h('span', { className: 'eu4w-mono' }, state.docs?.source || ''),
              h('b', null, t('ws.docTime')), h('span', null, state.docs?.generatedAt || ''),
            ),
            h('p', { className: 'eu4w-muted' }, t('ws.indexHint')),
          ),
          h('div', { className: 'eu4w-card' },
            h('h3', null, t('ws.modsTitle')),
            (state.mods || []).length ? h('div', { className: 'eu4w-col' }, ...(state.mods || []).map((m) =>
              h('div', { key: m.id, className: 'eu4w-row' },
                h('span', { className: 'eu4w-pill' }, m.id),
                h('span', null, m.name),
                h('span', { className: 'eu4w-muted eu4w-mono' }, m.path || ''),
              ),
            )) : h('div', { className: 'eu4w-muted' }, t('ws.noMods')),
          ),
          h('div', { className: 'eu4w-card' },
            h('h3', null, t('ws.shadowTitle')),
            state.shadow && state.shadow.count
              ? h('div', { className: 'eu4w-col' },
                h('div', { className: 'eu4w-warn' }, t('ws.shadowCount', { count: state.shadow.count })),
                ...(state.shadow.items || []).slice(0, 12).map((x) => h('div', { key: x.path, className: 'eu4w-mono eu4w-muted' }, x.path)),
              )
              : h('div', { className: 'eu4w-muted' }, t('ws.noShadow')),
          ),
        ),
        h('div', { className: 'eu4w-card' },
          h('h3', null, t('ws.countsTitle')),
          h('div', { className: 'eu4w-row' }, ...Object.entries(state.counts || {}).map(([k, v]) => h('span', { className: 'eu4w-pill', key: k }, `${k}: ${v}`))),
        ),
      );
    }

    function MapTab({ state, setErr }) {
      const { t } = useLocale();
      const { activeTag } = useTagContext();
      const { enqueue } = useQueue();
      const { religions, cultures, cultureGroups } = useDictionary();
      const catalog = useProvinceCatalog();
      const provinceById = useMemo(() => {
        const map = new Map();
        for (const item of catalog.items || []) map.set(Number(item.id), item);
        return map;
      }, [catalog.items]);
      const [hover, setHover] = useState(null);
      const [data, setData] = useState(null);
      const [selected, setSelected] = useState(null);
      const [adjacent, setAdjacent] = useState(null);
      const { setFocusId } = useProvinceFocus();
      const [startDate, setStartDate] = useState(state?.currentStartDate || '1437.1.1');
      const [provinceDraft, setProvinceDraft] = useState(null);
      const [provinceFile, setProvinceFile] = useState('');
      const [mapMsg, setMapMsg] = useState('');
      const [q, setQ] = useState('');
      const [ownersOnly, setOwnersOnly] = useState(false);
      const [coresOnly, setCoresOnly] = useState(false);
      const [intent, setIntent] = useState({ tag: 'FRA', ids: '', op: 'owner', value: '' });
      const [intentText, setIntentText] = useState(t('map.intentDefault'));
      const [generated, setGenerated] = useState(null);
      const [loading, setLoading] = useState(false);
      const load = useCallback(async (nextTag, nextQ, filters) => {
        try {
          setLoading(true);
          const params = new URLSearchParams();
          if (nextTag) params.set('tag', nextTag);
          if (nextQ) params.set('q', nextQ);
          // Filter server-side when possible: mods with more than the page cap
          // still return every owned/core province instead of the first slice.
          if (filters?.ownersOnly && nextTag) params.set('ownerTag', nextTag);
          if (filters?.coresOnly && nextTag) params.set('coresOnly', '1');
          params.set('limit', '12000');
          const d = await api('/map?' + params.toString());
          setData(d); setErr('');
        } catch (e) { setErr(String(e.message || e)); }
        finally { setLoading(false); }
      }, [setErr]);
      useEffect(() => { load(activeTag, '', { ownersOnly, coresOnly }); }, [activeTag, ownersOnly, coresOnly, load]);
      useEffect(() => {
        if (state?.currentStartDate) setStartDate(state.currentStartDate);
      }, [state?.currentStartDate]);
      useEffect(() => {
        if (!activeTag) { setOwnersOnly(false); setCoresOnly(false); }
      }, [activeTag]);
      useEffect(() => { setFocusId(selected?.id || 0); }, [selected?.id, setFocusId]);
      useEffect(() => {
        if (!selected?.id) { setAdjacent(null); return undefined; }
        let alive = true;
        api('/provinces/adjacent?id=' + selected.id)
          .then((d) => { if (alive) setAdjacent(d); })
          .catch(() => { if (alive) setAdjacent({ items: [], warning: '读取相邻省份失败' }); });
        return () => { alive = false; };
      }, [selected?.id]);
      useEffect(() => {
        if (!selected?.id) { setProvinceDraft(null); setProvinceFile(''); return undefined; }
        setProvinceDraft({ ...selected });
        let alive = true;
        api('/history/province?id=' + selected.id + '&name=' + encodeURIComponent(selected.name || ''))
          .then((d) => { if (alive) setProvinceFile(d.file || ''); })
          .catch(() => { if (alive) setProvinceFile(''); });
        return () => { alive = false; };
      }, [selected?.id]);
      const coreSet = useMemo(() => new Set(data?.coreIds || []), [data]);
      const visible = useMemo(() => {
        const list = data?.provinces || [];
        if (!activeTag) return list;
        let out = list;
        if (ownersOnly) out = out.filter((p) => String(p.owner || '').toUpperCase() === activeTag);
        if (coresOnly) out = out.filter((p) => coreSet.has(p.id) || (p.cores || []).includes(activeTag));
        return out;
      }, [data, activeTag, ownersOnly, coresOnly, coreSet]);
      const jumpTo = async (id) => {
        const numericId = Number(id);
        let item = provinceById.get(numericId);
        if (!item) {
          try { const d = await api('/map?provinceId=' + numericId); item = (d.provinces || [])[0]; } catch { /* ignore */ }
        }
        setSelected(item ? { ...item } : { id: numericId });
        if (!visible.some((p) => Number(p.id) === numericId)) {
          setOwnersOnly(false); setCoresOnly(false); setQ('');
          load(activeTag, '', { ownersOnly: false, coresOnly: false });
        }
      };
      const generate = async () => {
        try {
          const ids = intent.ids.split(/[^0-9]+/).filter(Boolean).map(Number);
          const d = await api('/map/intent', { method: 'POST', body: JSON.stringify({ tag: intent.tag, provinceIds: ids, operation: ids.length ? intent.op : undefined, value: intent.value, text: intentText }) });
          setGenerated(d); setErr('');
        } catch (e) { setErr(String(e.message || e)); }
      };
      const applyStartDate = async () => {
        try {
          const d = await api('/startdate', { method: 'POST', body: JSON.stringify({ date: startDate }) });
          setStartDate(d.currentStartDate || startDate);
          await load(activeTag, q, { ownersOnly, coresOnly });
          setErr('');
        } catch (e) { setErr(String(e.message || e)); }
      };
      const setProvinceField = (key, value) => setProvinceDraft((prev) => {
        if (!prev) return prev;
        const next = { ...prev, [key]: value };
        if (key === 'owner' && value) next.controller = value;
        return next;
      });
      const stageProvince = async () => {
        if (!provinceDraft) return;
        const id = Number(provinceDraft.id);
        // The queued JSON keeps `id` numeric; names are only the localisation
        // payload, and only when the user explicitly asks for it.
        const cfg = { id, name: provinceDraft.name || '' };
        if (provinceDraft.localisation) {
          if (provinceDraft.name_cn) cfg.name_cn = provinceDraft.name_cn;
          if (provinceDraft.name_en) cfg.name_en = provinceDraft.name_en;
          cfg.localisation = true;
        }
        if (provinceDraft.owner) cfg.owner = provinceDraft.owner;
        if (provinceDraft.controller) cfg.controller = provinceDraft.controller;
        if (provinceDraft.religion) cfg.religion = provinceDraft.religion;
        if (provinceDraft.culture) cfg.culture = provinceDraft.culture;
        cfg.base_tax = Number(provinceDraft.base_tax) || 0;
        cfg.base_production = Number(provinceDraft.base_production) || 0;
        cfg.base_manpower = Number(provinceDraft.base_manpower) || 0;
        if (provinceDraft.trade_goods) cfg.trade_goods = provinceDraft.trade_goods;
        if (cfg.owner) cfg.controller = cfg.owner;
        try {
          const result = await enqueue({
            targetType: 'province_history',
            action: 'modify',
            targetId: String(id),
            targetFile: provinceFile || `history/provinces/${id} - ${provinceDraft.name || id}.txt`,
            data: cfg,
          });
          setMapMsg(t('map.staged', { count: result.count || 1 }));
        } catch (e) { setErr(String(e.message || e)); }
      };
      /** `[2664] 皮尔森 (Plzeň)` — server label, catalog label, then local fallback. */
      const provinceLabel = (province) => {
        if (!province) return '';
        if (province.label) return province.label;
        const fromCatalog = provinceById.get(Number(province.id));
        if (fromCatalog) return fromCatalog.label || provinceLabelOf(fromCatalog);
        return provinceLabelOf(province);
      };
      /** Batch ids stay plain numbers, separated by commas. */
      const intentIdList = useMemo(
        () => String(intent.ids || '').split(/[^0-9]+/).filter(Boolean).map(Number),
        [intent.ids],
      );
      const addIntentId = (id) => {
        const numericId = Number(id);
        if (!Number.isFinite(numericId) || numericId <= 0) return;
        const list = String(intent.ids || '').split(/[^0-9]+/).filter(Boolean);
        if (!list.includes(String(numericId))) list.push(String(numericId));
        setIntent((prev) => ({ ...prev, ids: list.join(', ') }));
      };
      return h('div', { className: 'eu4w-split' },
        h('div', { className: 'eu4w-col' },
          h('div', { className: 'eu4w-row' },
            h('span', { className: 'eu4w-muted' }, t('map.startDate')),
            h('input', {
              className: 'eu4w-input', style: { width: 110 }, value: startDate,
              placeholder: '1437.1.1', title: t('map.startDateHint'),
              onChange: (e) => setStartDate(e.target.value),
              onKeyDown: (e) => { if (e.key === 'Enter') applyStartDate(); },
            }),
            h('button', { className: 'eu4w-btn', onClick: applyStartDate }, t('map.applyDate')),
            h('span', { className: activeTag ? 'eu4w-warn' : 'eu4w-muted' }, activeTag ? t('map.tagLinked', { tag: activeTag }) : t('map.noLinkedTag')),
            h('label', { className: 'eu4w-check' },
              h('input', {
                type: 'checkbox', checked: ownersOnly, disabled: !activeTag,
                onChange: (e) => setOwnersOnly(e.target.checked),
              }),
              t('map.onlyOwner', { tag: activeTag || t('map.thisTag') }),
            ),
            h('label', { className: 'eu4w-check' },
              h('input', {
                type: 'checkbox', checked: coresOnly, disabled: !activeTag,
                onChange: (e) => setCoresOnly(e.target.checked),
              }),
              t('map.onlyCore'),
            ),
            h('input', { className: 'eu4w-input', style: { width: 160 }, value: q, placeholder: t('map.searchPlaceholder'), onChange: (e) => setQ(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') load(activeTag, q, { ownersOnly, coresOnly }); } }),
            h('button', { className: 'eu4w-btn', onClick: () => load(activeTag, q, { ownersOnly, coresOnly }) }, t('map.filter')),
            loading ? h('span', { className: 'eu4w-muted' }, t('common.loading')) : null,
            h('span', { className: 'eu4w-muted' }, t('map.showing', { shown: visible.length, total: data?.total || 0 })),
            data?.coreIds?.length ? h('span', { className: 'eu4w-pill eu4w-warn' }, t('map.coreCount', { tag: activeTag || 'Tag', count: data.coreIds.length })) : null,
            data?.warningCount ? h('span', { className: 'eu4w-warn', title: (data.warnings || []).join('\n') }, t('map.historyWarnings', { count: data.warningCount, date: data.startDate || startDate })) : null,
          ),
          h('div', { className: 'eu4w-row' },
            h('span', { className: 'eu4w-muted' }, t('map.jump')),
            h('div', { style: { flex: 1, minWidth: 240 } },
              h(ProvincePicker, {
                value: selected?.id || '',
                items: catalog.items,
                placeholder: t('map.jumpHint'),
                onChange: (id) => {
                  const numericId = Number(id);
                  const item = provinceById.get(numericId);
                  setSelected(item ? { ...item } : { id: numericId });
                },
              }),
            ),
            h('span', { className: 'eu4w-muted', style: { fontSize: 11 } }, t('map.hoverHint')),
          ),
          h('div', { className: 'eu4w-map eu4w-scroll' }, ...visible.map((p) => {
            const card = provinceCardText(p);
            return h('button', {
              key: p.id, className: 'eu4w-prov' + (selected?.id === p.id ? ' sel' : '') + (coreSet.has(p.id) ? ' core' : ''),
              onClick: () => setSelected(p), title: card.tip,
              // Hover tooltip: same three-in-one label as every list and picker.
              onMouseEnter: (e) => setHover({ x: e.clientX, y: e.clientY, text: card.tip }),
              onMouseLeave: () => setHover(null),
            },
              h('b', { className: card.mainIsChinese ? 'cn' : undefined }, card.main),
              h('small', null, card.sub),
            );
          })),
          h('p', { className: 'eu4w-muted' }, t('map.simpleHint')),
          catalog.meta
            ? h('p', {
              className: catalog.meta.chineseCount > 0 ? 'eu4w-muted' : 'eu4w-warn',
              title: (catalog.meta.roots || []).join('\n'),
            },
              t('map.dictCoverage', { cn: catalog.meta.chineseCount, total: catalog.meta.provinceCount }),
              catalog.meta.unreadableFiles > 0
                ? ' · ' + t('map.dictUnreadable', { files: catalog.meta.unreadableFiles })
                : null,
              catalog.meta.chineseCount === 0
                ? ' · ' + t('map.dictNoChinese')
                : null,
            )
            : null,
          hover ? h('div', {
            className: 'eu4w-tip',
            style: { left: hover.x + 14, top: hover.y + 14 },
          }, hover.text) : null,
        ),
        h('div', { className: 'eu4w-col' },
          h('div', { className: 'eu4w-card' },
            h('h3', null, selected ? provinceLabel(selected) : t('map.details')),
            selected ? h('div', { className: 'eu4w-kv' },
              h('b', null, t('map.id')), h('span', null, String(selected.id)),
              h('b', null, t('header.name')), h('span', null, selected.name_cn ? `${selected.name_cn}${selected.name_en ? ` (${selected.name_en})` : ''}` : (selected.name_en || selected.name || '')),
              h('b', null, t('map.owner')), h('span', { className: selected.unresolved ? 'eu4w-warn' : undefined }, selected.unresolved ? t('map.unowned') : (selected.owner || '—')),
              h('b', null, t('map.controller')), h('span', null, selected.controller || '—'),
              h('b', null, t('map.culture')), h('span', null, selected.culture || '—'),
              h('b', null, t('map.religion')), h('span', null, selected.religion || '—'),
              h('b', null, t('map.baseTax')), h('span', null, String(selected.base_tax ?? '—')),
              h('b', null, t('map.cores')), h('span', null, (selected.cores || []).join(', ') || '—'),
            ) : h('div', { className: 'eu4w-muted' }, t('map.clickProvince')),
            selected ? h('div', { className: 'eu4w-col' },
              h('h4', null, t('map.adjacent')),
              adjacent
                ? (adjacent.items && adjacent.items.length
                  ? h('div', { className: 'eu4w-chips' }, ...adjacent.items.map((item) => h('button', {
                    key: item.id, type: 'button', className: 'eu4w-btn', title: item.label,
                    onClick: () => jumpTo(item.id),
                  }, (item.water ? '🌊 ' : '') + item.label)))
                  : h('div', { className: 'eu4w-muted' }, adjacent.note || t('map.adjacentEmpty')))
                : h('div', { className: 'eu4w-muted' }, t('common.loading')),
              adjacent?.warning ? h('div', { className: 'eu4w-warn' }, adjacent.warning) : null,
            ) : null,
          ),
          h('div', { className: 'eu4w-card' },
            h('h3', null, t('map.provinceEdit')),
            provinceDraft ? h('div', { className: 'eu4w-col' },
              h('div', { className: 'eu4w-mono eu4w-muted' }, provinceFile || '…'),
              h('div', { className: 'eu4w-grid' },
                field(t('map.owner'), h('input', { className: 'eu4w-input', value: provinceDraft.owner || '', onChange: (e) => setProvinceField('owner', e.target.value.toUpperCase()) })),
                field(t('map.controller'), h('input', { className: 'eu4w-input', value: provinceDraft.controller || '', onChange: (e) => setProvinceField('controller', e.target.value.toUpperCase()) })),
                field(t('map.religion'), h(SearchSelect, {
                  value: provinceDraft.religion || '',
                  options: religions.length ? religions : [{ value: 'catholic', keywords: 'catholic' }],
                  prefix: 'religion',
                  allowCustom: true,
                  onChange: (value) => setProvinceField('religion', value),
                })),
                field(t('map.culture'), h(CultureTreeSelect, {
                  value: provinceDraft.culture || '',
                  groups: cultureGroups,
                  cultures,
                  placeholder: t('map.culture'),
                  onChange: (value) => setProvinceField('culture', value),
                })),
                field(t('map.baseTax'), h('input', { className: 'eu4w-input', type: 'number', value: provinceDraft.base_tax || '', onChange: (e) => setProvinceField('base_tax', e.target.value) })),
                field(t('map.baseProduction'), h('input', { className: 'eu4w-input', type: 'number', value: provinceDraft.base_production || '', onChange: (e) => setProvinceField('base_production', e.target.value) })),
                field(t('map.baseManpower'), h('input', { className: 'eu4w-input', type: 'number', value: provinceDraft.base_manpower || '', onChange: (e) => setProvinceField('base_manpower', e.target.value) })),
                field(t('map.tradeGoods'), h('input', { className: 'eu4w-input', value: provinceDraft.trade_goods || '', onChange: (e) => setProvinceField('trade_goods', e.target.value) })),
                field(t('province.nameCn'), h('input', { className: 'eu4w-input', value: provinceDraft.name_cn || '', onChange: (e) => setProvinceField('name_cn', e.target.value) })),
                field(t('province.nameEn'), h('input', { className: 'eu4w-input', value: provinceDraft.name_en || '', onChange: (e) => setProvinceField('name_en', e.target.value) })),
              ),
              h('label', { className: 'eu4w-check' },
                h('input', {
                  type: 'checkbox',
                  checked: Boolean(provinceDraft.localisation),
                  onChange: (e) => setProvinceField('localisation', e.target.checked),
                }),
                t('province.syncName', { id: provinceDraft.id }),
              ),
              h('div', { className: 'eu4w-muted' }, t('province.localisationHint')),
              h('div', { className: 'eu4w-row' },
                h('button', { className: 'eu4w-btn primary', onClick: stageProvince }, t('map.stage')),
                mapMsg ? h('span', { className: 'eu4w-muted' }, mapMsg) : null,
              ),
            ) : h('div', { className: 'eu4w-muted' }, t('map.clickProvince')),
          ),
          h('div', { className: 'eu4w-card' },
            h('h3', null, t('map.batchTitle')),
            h('div', { className: 'eu4w-col' },
              h('div', { className: 'eu4w-row' },
                h('input', { className: 'eu4w-input', style: { width: 62 }, value: intent.tag, maxLength: 3, onChange: (e) => setIntent({ ...intent, tag: e.target.value.toUpperCase() }) }),
                h('select', { className: 'eu4w-select', value: intent.op, onChange: (e) => setIntent({ ...intent, op: e.target.value }) },
                  h('option', { value: 'owner' }, 'owner'),
                  h('option', { value: 'controller' }, 'controller'),
                  h('option', { value: 'core' }, 'add_core'),
                  h('option', { value: 'remove_core' }, 'remove_core'),
                  h('option', { value: 'base_tax' }, 'base_tax'),
                  h('option', { value: 'religion' }, 'religion'),
                  h('option', { value: 'culture' }, 'culture'),
                ),
              ),
              h('div', { className: 'eu4w-row' },
                h('span', { className: 'eu4w-muted' }, t('map.intentPick')),
                h('div', { style: { flex: 1, minWidth: 220 } },
                  h(ProvincePicker, {
                    value: '',
                    items: catalog.items,
                    placeholder: t('province.pickerPlaceholder'),
                    onChange: addIntentId,
                  }),
                ),
              ),
              h('input', { className: 'eu4w-input', value: intent.ids, placeholder: t('map.intentIdsPlaceholder'), onChange: (e) => setIntent({ ...intent, ids: e.target.value }) }),
              intentIdList.length ? h('div', { className: 'eu4w-chips' },
                h('span', { className: 'eu4w-muted', style: { fontSize: 11 } }, t('map.intentChips')),
                ...intentIdList.slice(0, 40).map((id) => {
                  const item = provinceById.get(Number(id));
                  return h('span', { key: id, className: 'eu4w-pill', title: String(id) }, item ? (item.label || provinceLabelOf(item)) : provinceLabelOf(null, id));
                }),
              ) : null,
              h('input', { className: 'eu4w-input', value: intent.value, placeholder: t('map.valuePlaceholder'), onChange: (e) => setIntent({ ...intent, value: e.target.value }) }),
              h('textarea', { className: 'eu4w-area', rows: 3, value: intentText, placeholder: t('map.intentPlaceholder'), onChange: (e) => setIntentText(e.target.value) }),
              h('button', { className: 'eu4w-btn primary', onClick: generate }, t('map.generate')),
              generated?.error ? h('div', { className: 'eu4w-err' }, generated.error) : null,
              generated && !generated.error ? h('div', { className: 'eu4w-pre' }, generated.files.map((f) => `# ${f.path}\n${f.content}`).join('\n')) : null,
            ),
          ),
        ),
      );
    }

    function MissionsTab({ state, setErr }) {
      const { t } = useLocale();
      const { activeTag } = useTagContext();
      const { enqueue } = useQueue();
      const [path, setPath, pathDraft] = useFormState('missionForm.path', 'missions/zz_eu4_workbench_missions.txt');
      const [nodes, setNodes, nodesDraft] = useFormState('missionForm.nodes', []);
      const [removedNodes, setRemovedNodes] = useState([]);
      const [selected, setSelected] = useState(null);
      const [linkFrom, setLinkFrom] = useState(null);
      const [dragging, setDragging] = useState(null);
      const [aiPrompt, setAiPrompt] = useState('');
      const [aiMessage, setAiMessage] = useState('');
      const [busy, setBusy] = useState(false);
      const [queueMsg, setQueueMsg] = useState('');
      const [nlFilled, setNlFilled] = useState(false);
      const [nlDirty, setNlDirty] = useState(false);
      const canvasRef = useRef(null);
      const loadFrom = async (nextPath) => {
        try {
          await api('/refresh', { method: 'POST', body: '{}' }).catch(() => {});
          const d = await api('/missions?path=' + encodeURIComponent(nextPath));
          if (d.error) throw new Error(d.error);
          setRemovedNodes([]);
          setNodes((d.missions || []).map((m, i) => ({
            ...m,
            title: m.title || m.id,
            desc: m.desc || '',
            conditions: m.conditions || [],
            rewards: m.rewards || [],
            isNew: false,
            x: 40 + (i % 3) * 240,
            y: 40 + Math.floor(i / 3) * 120,
          })));
          setSelected(null); setAiPrompt(''); setAiMessage(''); setErr('');
          setNlFilled(false); setNlDirty(false);
        } catch (e) { setErr(String(e.message || e)); }
      };
      const load = () => loadFrom(path);
      const loadTagMissions = async () => {
        if (!activeTag) return;
        try {
          const found = await api('/missions/find?tag=' + encodeURIComponent(activeTag));
          if (!found.path) { setErr(t('mission.noFile', { tag: activeTag })); return; }
          setPath(found.path);
          await loadFrom(found.path);
        } catch (e) { setErr(String(e.message || e)); }
      };
      const add = () => {
        setNlDirty(true);
        const id = 'new_mission_' + (nodes.length + 1);
        setNodes([...nodes, {
          id, title: id, desc: '', icon: '', required: [], conditions: [], rewards: [], isNew: true,
          x: 40 + (nodes.length % 3) * 240, y: 40 + Math.floor(nodes.length / 3) * 120,
        }]);
      };
      const demo = () => {
        setNodes([
          { id: 'open_the_road', title: 'open_the_road', desc: '', icon: '', required: [], conditions: [{ type: 'tag', op: '=', value: 'FRA' }], rewards: [{ effect: 'add_prestige', value: '10' }], isNew: true, x: 40, y: 40 },
          { id: 'secure_the_border', title: 'secure_the_border', desc: '', icon: '', required: ['open_the_road'], conditions: [{ type: 'tag', op: '=', value: 'FRA' }], rewards: [{ effect: 'add_stability', value: '1' }], isNew: true, x: 300, y: 160 },
        ]);
        setAiPrompt(''); setAiMessage('');
      };
      const connect = (targetId) => {
        if (!linkFrom || linkFrom === targetId) return;
        setNlDirty(true);
        setNodes(nodes.map((n) => n.id === targetId ? { ...n, required: [...new Set([...(n.required || []), linkFrom])] } : n));
        setLinkFrom(null);
      };
      const update = (patch) => {
        if (!selected) return;
        setNlDirty(true);
        setNodes(nodes.map((n) => n.id === selected ? { ...n, ...patch } : n));
      };
      const applyNL = (config) => {
        const mission = config?.mission;
        if (!mission || typeof mission !== 'object') { setErr(t('nl.invalidJson')); return; }
        setPath(mission.file || 'missions/zz_nl_missions.txt');
        setNodes((mission.nodes || []).map((node, i) => ({
          ...node,
          title: node.name || node.id,
          icon: node.slot || '',
          isNew: true,
          x: 40 + (i % 3) * 240,
          y: 40 + Math.floor(i / 3) * 120,
        })));
        setSelected(null); setAiPrompt(''); setAiMessage('');
        setNlFilled(true); setNlDirty(false);
      };
      const missionPayload = () => ({
        file: path,
        tag: activeTag || null,
        removedNodeIds: removedNodes,
        nodes: nodes.map((n) => ({
          id: n.id,
          slot: n.icon || '',
          name: n.title || n.id,
          description: n.desc || '',
          required: n.required || [],
          conditions: conditionPayloads(n.conditions || []),
          rewards: n.rewards || [],
          isNew: n.isNew === true,
        })),
      });
      // AI payload says "update", the change queue says "modify": keep both
      // vocabularies apart so enqueue() never sends an unrepresentable action.
      const missionAction = () => nodes.some((n) => !n.isNew) ? 'update' : 'create';
      const queueAction = () => nodes.some((n) => !n.isNew) ? 'modify' : 'create';
      const buildPrompt = async () => {
        setBusy(true);
        try {
          const result = await api('/ai/build', { method: 'POST', body: JSON.stringify({ kind: 'mission', action: missionAction(), data: missionPayload(), max_tokens: AI_MAX_TOKENS }) });
          setAiPrompt(result.prompt); setAiMessage(''); setErr('');
        } catch (e) { setErr(String(e.message || e)); }
        finally { setBusy(false); }
      };
      const queueChange = async () => {
        try {
          const result = await enqueue({
            targetType: 'mission',
            action: queueAction(),
            targetId: path,
            targetFile: path,
            data: missionPayload(),
          });
          setQueueMsg(t('queue.added', { count: result.count || 1 }));
          nodesDraft.reset();
          pathDraft.reset();
        } catch (e) {
          setErr(String(e.message || e));
        }
      };
      const savePrompt = async () => {
        try {
          await api('/ai/submit', { method: 'POST', body: JSON.stringify({ kind: 'mission', action: missionAction(), data: missionPayload(), max_tokens: AI_MAX_TOKENS }) });
          setAiMessage(t('ai.saved'));
        } catch (e) { setErr(String(e.message || e)); }
      };
      const copyPrompt = async () => {
        try { await navigator.clipboard.writeText(aiPrompt); setAiMessage(t('ai.copied')); }
        catch { setAiMessage(t('ai.copyFailed')); }
      };
      useEffect(() => {
        if (!dragging) return undefined;
        const move = (e) => {
          const rect = canvasRef.current?.getBoundingClientRect();
          if (!rect) return;
          const x = Math.max(0, Math.min(1200, e.clientX - rect.left - 70));
          const y = Math.max(0, Math.min(700, e.clientY - rect.top - 24));
          setNodes((prev) => prev.map((n) => n.id === dragging ? { ...n, x, y } : n));
        };
        const up = () => setDragging(null);
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
        return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
      }, [dragging]);
      const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
      const edges = [];
      for (const n of nodes) for (const r of n.required || []) {
        const a = byId.get(r); if (!a) continue;
        edges.push({ from: a, to: n, key: r + '>' + n.id });
      }
      const sel = nodes.find((n) => n.id === selected);
      const pasteMission = (clip) => {
        if (!clip || typeof clip !== 'object') return;
        if (Array.isArray(clip.nodes)) { setNodes(clip.nodes); return; }
        const effects = Array.isArray(clip.options)
          ? clip.options.flatMap((option) => option.effects || [])
          : Array.isArray(clip.rewards) ? clip.rewards
          : Array.isArray(clip.effects) ? clip.effects : null;
        if (!effects) return;
        const targetId = selected || nodes[0]?.id;
        if (!targetId) {
          const id = 'pasted_mission_1';
          setNodes([{ id, title: id, desc: '', icon: '', required: [], conditions: [], rewards: effects, isNew: true, x: 40, y: 40 }]);
          setSelected(id);
          return;
        }
        setNodes((prev) => prev.map((node) => node.id === targetId ? { ...node, rewards: effects } : node));
      };
      useRegisterForm('missionForm', missionPayload(), pasteMission);
      return h('div', { className: 'eu4w-col' },
        h(NLAssistant, { kind: 'mission', form: missionPayload(), onApply: applyNL }),
        nlFilled || nlDirty ? h('div', { className: nlDirty ? 'eu4w-warn' : 'eu4w-ok' }, nlDirty ? t('nl.dirty') : t('nl.filled')) : null,
        h('div', { className: 'eu4w-row' },
          h('input', { className: 'eu4w-input', style: { flex: 1, minWidth: 260 }, value: path, onChange: (e) => setPath(e.target.value) }),
          h('button', { className: 'eu4w-btn', onClick: load }, t('mission.import')),
          h('button', { className: 'eu4w-btn', onClick: add }, t('mission.addNode')),
          h('button', { className: 'eu4w-btn', onClick: demo }, t('mission.demo')),
          activeTag ? h('button', { className: 'eu4w-btn primary', onClick: loadTagMissions }, t('mission.loadTag', { tag: activeTag })) : null,
          h('button', { className: 'eu4w-btn primary', onClick: queueChange, disabled: busy, title: t('tooltip.ai_action') }, t('queue.add')),
          queueMsg ? h('span', { className: 'eu4w-muted' }, queueMsg) : null,
          linkFrom ? h('span', { className: 'eu4w-pill eu4w-warn' }, t('mission.front', { id: linkFrom })) : null,
        ),
        h('div', { className: 'eu4w-split' },
          h('div', { className: 'eu4w-canvas', ref: canvasRef, style: { height: 520 } },
            h('svg', { className: 'eu4w-edge', viewBox: '0 0 1400 700', preserveAspectRatio: 'none' },
              ...edges.map((e) => h('line', {
                key: e.key, x1: e.from.x + 180, y1: e.from.y + 30, x2: e.to.x, y2: e.to.y + 30,
                stroke: '#6e7f92', strokeWidth: 1.5, 'marker-end': 'url(#eu4w-arrow)',
              })),
              h('defs', null, h('marker', { id: 'eu4w-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto' }, h('path', { d: 'M0,0 L10,5 L0,10 z', fill: '#6e7f92' }))),
            ),
            ...nodes.map((n) => h('div', {
              key: n.id, className: 'eu4w-node' + (selected === n.id ? ' sel' : '') + (linkFrom && n.id === linkFrom ? ' pre' : ''),
              style: { left: n.x, top: n.y },
              onMouseDown: (e) => { if (e.target.tagName === 'BUTTON') return; setDragging(n.id); setSelected(n.id); },
              onClick: (e) => { e.stopPropagation(); if (linkFrom && linkFrom !== n.id) connect(n.id); else setSelected(n.id); },
            },
              h('h4', null, n.title || n.id),
              h('p', null, n.id),
              h('div', { className: 'eu4w-row', style: { marginTop: 5 } },
                h('button', { className: 'eu4w-btn', style: { padding: '2px 6px', fontSize: 10 }, onMouseDown: (e) => e.stopPropagation(), onClick: (e) => { e.stopPropagation(); setLinkFrom(n.id); } }, t('mission.setFront')),
              ),
            )),
          ),
          h('div', { className: 'eu4w-col' },
            h('div', { className: 'eu4w-card' },
              h('h3', null, t('mission.nodeProps')),
              sel ? h('div', { className: 'eu4w-row' },
                sel.isNew ? h('span', { className: 'eu4w-pill eu4w-warn' }, t('mission.newBadge')) : null,
                h('button', {
                  className: 'eu4w-btn danger',
                  onClick: () => { setNlDirty(true); setRemovedNodes((prev) => (prev.includes(sel.id) ? prev : [...prev, sel.id])); setNodes(nodes.filter((n) => n.id !== sel.id)); setSelected(null); },
                }, t('common.delete')),
              ) : null,
              sel ? h('div', { className: 'eu4w-col' },
                field(t('mission.taskId'), h('input', {
                  className: 'eu4w-input', value: sel.id,
                  onChange: (e) => {
                    const old = sel.id; const next = e.target.value;
                    setNodes(nodes.map((n) => n.id === old ? { ...n, id: next } : { ...n, required: (n.required || []).map((r) => r === old ? next : r) }));
                    setSelected(next);
                  },
                })),
                field(t('mission.slot'), h('input', {
                  className: 'eu4w-input', value: sel.icon || '', placeholder: t('mission.slotPlaceholder'),
                  onChange: (e) => update({ icon: e.target.value }),
                })),
                field(t('header.name'), h('input', {
                  className: 'eu4w-input', value: sel.title || '',
                  onChange: (e) => update({ title: e.target.value }),
                })),
                field(t('header.desc_key'), h(AutoTextArea, {
                  value: sel.desc || '', placeholder: t('mission.descPlaceholder'), minHeight: 60, toolbar: true,
                  onChange: (v) => update({ desc: v }),
                })),
                h('label', { className: 'eu4w-muted' }, t('mission.required')),
                h('div', { className: 'eu4w-row' }, ...(sel.required || []).map((r) => h('span', { key: r, className: 'eu4w-pill' }, r))),
                h('div', { className: 'eu4w-row' },
                  h('select', {
                    className: 'eu4w-select', value: '',
                    onChange: (e) => {
                      const value = e.target.value;
                      if (value) update({ required: [...new Set([...(sel.required || []), value])] });
                      e.target.value = '';
                    },
                  },
                    h('option', { value: '' }, t('mission.addRequired')),
                    ...nodes.filter((n) => n.id !== sel.id && !(sel.required || []).includes(n.id)).map((n) => h('option', { key: n.id, value: n.id }, n.id)),
                  ),
                  (sel.required || []).length ? h('button', { className: 'eu4w-btn danger', onClick: () => update({ required: [] }) }, t('mission.clearRequired')) : null,
                ),
                h('h4', null, t('label.trigger')),
                h(ConditionRows, { rows: sel.conditions || [], onChange: (rows) => update({ conditions: rows }) }),
                h('h4', null, t('label.effect')),
                h(EffectRows, { rows: sel.rewards || [], onChange: (rows) => update({ rewards: rows }) }),
              ) : h('div', { className: 'eu4w-muted' }, t('mission.clickEdit')),
            ),
            h('div', { className: 'eu4w-card' },
              h('h3', null, t('mission.payloadPreview')),
              h('pre', { className: 'eu4w-pre' }, JSON.stringify(nodes.map((n) => ({
                id: n.id, slot: n.icon || '', name: n.title || '', description: n.desc || '',
                required: n.required || [], conditions: n.conditions || [], rewards: n.rewards || [],
              })), null, 2)),
            ),
          ),
        ),
        h(AIPromptCard, { prompt: aiPrompt, message: aiMessage, onCopy: copyPrompt, onSave: savePrompt }),
      );
    }

    /** Tolerant JSON reader for an AI reply (fenced block or prose + object). */
    function parseAIJson(raw) {
      let text = String(raw || '').trim();
      const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
      if (fence) text = fence[1].trim();
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start < 0 || end <= start) throw new Error('no JSON object');
      const parsed = JSON.parse(text.slice(start, end + 1));
      const kind = ['event', 'mission', 'province_history', 'country_history', 'new_tag'].includes(parsed.kind)
        ? parsed.kind
        : parsed.province ? 'province_history'
        : parsed.country ? 'country_history'
        : parsed.newTag ? 'new_tag'
        : parsed.mission ? 'mission'
        : 'event';
      const key = kind === 'new_tag' ? 'newTag' : kind === 'province_history' ? 'province'
        : kind === 'country_history' ? 'country' : kind;
      const body = parsed[key];
      if (!body || typeof body !== 'object') throw new Error('missing ' + key);
      return {
        kind,
        needs_confirmation: parsed.needs_confirmation !== false,
        confidence: Number(parsed.confidence) || 0.5,
        complex: parsed.complex === true || typeof parsed.raw_script === 'string',
        raw_script: parsed.raw_script || '',
        notes: Array.isArray(parsed.notes) ? parsed.notes : [],
        warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
        [key]: body,
      };
    }

    /** Natural-language assistant card used by the event and mission trees. */
    function NLAssistant({ kind, form, onApply }) {
      const { t } = useLocale();
      const { enqueue } = useQueue();
      const examples = kind === 'mission'
        ? [t('nl.exampleMission1'), t('nl.exampleMission2')]
        : kind === 'province_history'
          ? [t('nl.exampleProvince1'), t('nl.exampleProvince2')]
          : kind === 'country_history'
            ? [t('nl.exampleCountry1')]
            : kind === 'new_tag'
              ? [t('nl.exampleNewTag1')]
              : [t('nl.exampleEvent1'), t('nl.exampleEvent2')];
      const [text, setText] = useState('');
      const [busy, setBusy] = useState(false);
      const [msg, setMsg] = useState('');
      const [result, setResult] = useState(null);
      const [aiJson, setAiJson] = useState('');
      const [rawCode, setRawCode] = useState('');
      const [codeMsg, setCodeMsg] = useState('');
      const [showJson, setShowJson] = useState(false);
      const parse = async (value, mode = 'json') => {
        const request = String(value ?? text).trim();
        if (!request) { setMsg(t('nl.empty')); return; }
        setBusy(true); setMsg(t('nl.parsing'));
        try {
          const data = await api('/nl2json', { method: 'POST', body: JSON.stringify({ kind, text: request, mode, form: form || {}, max_tokens: AI_MAX_TOKENS }) });
          setResult(data);
          if (mode === 'code') {
            setMsg('');
            setShowJson(false);
          } else {
            const warnings = data.warnings || [];
            setMsg(warnings.length ? t('nl.warnings', { message: warnings.join('; ') }) : t('nl.parsed'));
            if (!data.config?.complex) onApply(data.config, data);
          }
        } catch (e) {
          setMsg(String(e.message || e));
        } finally {
          setBusy(false);
        }
      };
      const requestPrompt = async () => {
        if (!result?.prompt) await parse();
        setShowJson(true);
      };
      const applyJson = () => {
        try {
          const config = parseAIJson(aiJson);
          onApply(config, { raw: config.raw_script || '', advanced: config.complex });
          setMsg(t('nl.parsed'));
        } catch {
          setMsg(t('nl.invalidJson'));
        }
      };
      const writeCode = async () => {
        const code = rawCode.trim();
        if (!code) { setCodeMsg(t('nl.codeEmpty')); return; }
        try {
          const file = form?.file || (kind === 'mission' ? 'missions/zz_nl_missions.txt' : 'events/zz_nl_events.txt');
          const result = await enqueue({
            targetType: kind,
            action: 'modify',
            targetId: form?.id || file,
            targetFile: file,
            data: { file, rawScript: code },
          });
          setCodeMsg(t('queue.added', { count: result.count || 1 }));
        } catch (e) {
          setCodeMsg(String(e.message || e));
        }
      };
      return h('div', { className: 'eu4w-card eu4w-nl' },
        h('h3', null, t('nl.title')),
        h('div', { className: 'eu4w-row' },
          h('input', {
            className: 'eu4w-input', style: { flex: 1, minWidth: 260 }, value: text,
            placeholder: t('nl.placeholder'),
            onChange: (e) => setText(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') parse(); },
          }),
          h('button', { className: 'eu4w-btn primary', disabled: busy, onClick: () => parse() }, busy ? t('nl.parsing') : t('nl.parse')),
          h('button', { className: 'eu4w-btn', disabled: busy, onClick: () => parse(undefined, 'code') }, t('nl.oneShot')),
          h('button', { className: 'eu4w-btn', onClick: requestPrompt }, t('nl.aiPrompt')),
        ),
        h('div', { className: 'eu4w-row' },
          h('span', { className: 'eu4w-muted' }, t('nl.examples')),
          ...examples.map((example) => h('button', {
            key: example, className: 'eu4w-btn', style: { fontSize: 11 },
            onClick: () => { setText(example); parse(example); },
          }, example)),
        ),
        msg ? h('div', { className: 'eu4w-muted' }, msg) : null,
        result?.config?.complex ? h('div', { className: 'eu4w-col eu4w-logic' },
          h('div', { className: 'eu4w-warn' }, t('nl.advanced')),
          h('textarea', { className: 'eu4w-area', rows: 8, value: result.raw || '', readOnly: true, spellCheck: false }),
          h('button', {
            className: 'eu4w-btn primary',
            onClick: () => onApply(result.config, { ...result, advanced: true }),
          }, t('nl.advancedConfirm')),
        ) : null,
        showJson && result?.mode !== 'code' ? h('div', { className: 'eu4w-col' },
          h('div', { className: 'eu4w-muted' }, t('nl.aiPrompt')),
          result?.prompt ? h('textarea', { className: 'eu4w-area', rows: 8, value: result.prompt, readOnly: true, spellCheck: false }) : null,
          result?.prompt ? h('button', {
            className: 'eu4w-btn',
            onClick: () => { try { navigator.clipboard.writeText(result.prompt); } catch { /* ignore */ } },
          }, t('ai.copy')) : null,
          h('textarea', {
            className: 'eu4w-area', rows: 6, value: aiJson,
            placeholder: t('nl.jsonPlaceholder'),
            onChange: (e) => setAiJson(e.target.value),
          }),
          h('button', { className: 'eu4w-btn primary', onClick: applyJson }, t('nl.applyJson')),
        ) : null,
        result?.mode === 'code' ? h('div', { className: 'eu4w-col eu4w-logic' },
          h('div', { className: 'eu4w-muted' }, t('nl.codeMode')),
          h('textarea', { className: 'eu4w-area', rows: 8, value: result.prompt || '', readOnly: true, spellCheck: false }),
          h('button', {
            className: 'eu4w-btn',
            onClick: () => { try { navigator.clipboard.writeText(result.prompt || ''); } catch { /* ignore */ } },
          }, t('ai.copy')),
          h('textarea', {
            className: 'eu4w-area', rows: 8, value: rawCode,
            placeholder: t('nl.codePlaceholder'),
            onChange: (e) => setRawCode(e.target.value),
          }),
          h('button', { className: 'eu4w-btn primary', onClick: writeCode }, t('nl.writeCode')),
          codeMsg ? h('div', { className: 'eu4w-muted' }, codeMsg) : null,
        ) : null,
      );
    }

    function EventsTab({ state, setErr }) {
      const { t } = useLocale();
      const { activeTag } = useTagContext();
      const { enqueue } = useQueue();
      const [namespace, setNamespace] = useState('');
      const [data, setData] = useState(null);
      const [selected, setSelected] = useState(null);
      const [form, setForm, eventDraft] = useFormState('eventForm', null);
      const [isNew, setIsNew, isNewDraft] = useFormState('eventForm.isNew', false);
      const [nlFilled, setNlFilled] = useState(false);
      const [nlDirty, setNlDirty] = useState(false);
      const categoryLabel = (code) => {
        const key = 'category.' + code;
        const text = t(key);
        return text === key ? code : text;
      };
      const [formMsg, setFormMsg] = useState('');
      const [aiPrompt, setAiPrompt] = useState('');
      const [aiMessage, setAiMessage] = useState('');
      const [preview, setPreview] = useState(null);
      const [category, setCategory] = useState('all');
      const [tagOnly, setTagOnly] = useState(false);
      useEffect(() => { setTagOnly(Boolean(activeTag)); }, [activeTag]);
      const load = async () => {
        try {
          await api('/refresh', { method: 'POST', body: '{}' }).catch(() => {});
          const d = await api('/events?namespace=' + encodeURIComponent(namespace));
          setData(d); setSelected(null); setErr('');
          setNlFilled(false); setNlDirty(false);
        } catch (e) { setErr(String(e.message || e)); }
      };
      useEffect(() => { load(); }, []);
      useEffect(() => {
        if (isNew) return undefined;
        if (!selected?.path || !selected?.id) { return undefined; }
        let alive = true;
        setFormMsg(t('event.formLoading'));
        api('/event/form?path=' + encodeURIComponent(selected.path) + '&id=' + encodeURIComponent(selected.id))
          .then((d) => {
            if (!alive) return;
            setForm({ ...d, targetTag: d.targetTag || activeTag || '' }); setFormMsg(''); setAiPrompt(''); setAiMessage('');
            setNlFilled(false); setNlDirty(false);
          })
          .catch((e) => { if (alive) { setForm(null); setFormMsg(String(e.message || e)); } });
        return () => { alive = false; };
      }, [selected?.path, selected?.id, isNew]);
      const newEvent = () => {
        setIsNew(true);
        setSelected(null);
        setForm({
          file: 'events/zz_eu4_workbench_events.txt',
          absolute: '',
          id: 'new_event.1',
          kind: 'country_event',
          namespace: 'new_event',
          title: '',
          desc: '',
          picture: '',
          triggerMode: 'normal',
          targetTag: activeTag || '',
          bindDate: (state && state.currentStartDate) || '1437.1.1',
          localisationFile: 'localisation/zz_eu4_workbench_l_simp_chinese.yml',
          fireOnlyOnce: false,
          major: false,
          conditions: [],
          options: [{ name: '', effects: [{ effect: 'add_prestige', value: '' }] }],
          original: '',
        });
        setAiPrompt(''); setAiMessage(''); setFormMsg('');
        setNlFilled(false); setNlDirty(false);
        api('/event/examples?count=2')
          .then((data) => setForm((prev) => (prev ? { ...prev, examples: data.examples || [] } : prev)))
          .catch(() => {});
      };
      const applyNL = (config, meta) => {
        const event = config?.event;
        if (!event || typeof event !== 'object') { setErr(t('nl.invalidJson')); return; }
        setIsNew(true);
        setSelected(null);
        setForm({
          file: event.file || 'events/zz_nl_events.txt',
          kind: event.kind || 'country_event',
          id: event.id || 'nl_event.1',
          namespace: event.namespace || 'nl_event',
          title: event.title || '',
          desc: event.desc || '',
          picture: event.picture || '',
          triggerMode: event.triggerMode === 'startup' ? 'startup' : 'normal',
          targetTag: event.targetTag || activeTag || '',
          bindDate: event.bindDate || (state && state.currentStartDate) || '1437.1.1',
          localisationFile: event.localisationFile || 'localisation/zz_eu4_workbench_l_simp_chinese.yml',
          fireOnlyOnce: event.fireOnlyOnce === true,
          major: event.major === true,
          conditions: conditionPayloads(event.conditions || []),
          options: event.options || [],
          original: '',
        });
        setAiPrompt(''); setAiMessage('');
        setFormMsg(meta?.advanced ? t('nl.advanced') : '');
        setNlFilled(true); setNlDirty(false);
      };
      const setField = (key, value) => {
        setNlDirty(true);
        setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
      };
      const setOption = (index, patch) => {
        setNlDirty(true);
        setForm((prev) => (prev ? {
          ...prev,
          options: (prev.options || []).map((option, i) => (i === index ? { ...option, ...patch } : option)),
        } : prev));
      };
      const addOption = () => {
        setNlDirty(true);
        setForm((prev) => (prev ? {
          ...prev,
          options: [...(prev.options || []), { name: '', effects: [{ effect: 'add_prestige', value: '' }] }],
        } : prev));
      };
      const removeOption = (index) => {
        setNlDirty(true);
        setForm((prev) => (prev ? {
          ...prev,
          options: (prev.options || []).filter((_, i) => i !== index),
        } : prev));
      };
      /** Payload form: effective target Tag + days-only modifier durations. */
      const effectiveForm = (source) => ({
        ...source,
        targetTag: effectiveTargetTag(source, activeTag),
        options: (source.options || []).map((option) => ({
          ...option,
          effects: normalizePayloadEffects(option.effects),
        })),
      });
      useEffect(() => {
        if (!form) return;
        if (form.triggerMode === 'startup' && !String(form.targetTag || '').trim() && activeTag) {
          setForm((prev) => (prev ? { ...prev, targetTag: activeTag } : prev));
        }
      }, [form?.triggerMode, form?.targetTag, activeTag]);
      const buildPrompt = async () => {
        if (!form) return;
        setFormMsg(t('ai.thinking'));
        try {
          const payloadForm = effectiveForm(form);
          const result = await api('/ai/build', { method: 'POST', body: JSON.stringify({ kind: 'event', action: isNew ? 'create' : 'update', data: payloadForm, max_tokens: AI_MAX_TOKENS }) });
          setAiPrompt(result.prompt); setAiMessage(''); setFormMsg('');
        } catch (e) { setFormMsg(String(e.message || e)); }
      };
      /** Deterministic preview: event block + localisation + history bind. */
      const previewGenerated = async () => {
        if (!form) return;
        try {
          const payloadForm = effectiveForm(form);
          const data = await api('/ai/preview', { method: 'POST', body: JSON.stringify({ kind: 'event', data: payloadForm }) });
          setPreview(data);
          setFormMsg('');
        } catch (e) { setFormMsg(String(e.message || e)); }
      };
      const queueChange = async () => {
        if (!form) return;
        const payloadForm = effectiveForm(form);
        const data = {
          file: payloadForm.file,
          kind: payloadForm.kind,
          id: payloadForm.id,
          namespace: payloadForm.namespace,
          title: payloadForm.title,
          desc: payloadForm.desc,
          titleKey: `${payloadForm.id}.t`,
          descKey: `${payloadForm.id}.d`,
          picture: payloadForm.picture,
          triggerMode: payloadForm.triggerMode === 'startup' ? 'startup' : 'normal',
          targetTag: payloadForm.targetTag,
          bindDate: payloadForm.bindDate || '1437.1.1',
          localisationFile: payloadForm.localisationFile || 'localisation/zz_eu4_workbench_l_simp_chinese.yml',
          fireOnlyOnce: payloadForm.fireOnlyOnce === true,
          major: payloadForm.major === true,
          conditions: payloadForm.conditions || [],
          options: payloadForm.options || [],
        };
        try {
          const result = await enqueue({
            targetType: 'event',
            action: isNew ? 'create' : 'modify',
            targetId: form.id,
            targetFile: form.file,
            data,
          });
          setFormMsg(t('queue.added', { count: result.count || 1 }));
          eventDraft.reset();
          isNewDraft.reset();
          setSelected(null);
        } catch (e) {
          setFormMsg(String(e.message || e));
        }
      };
      const queueDelete = async () => {
        if (!form) return;
        const confirmed = typeof window === 'undefined' || !window.confirm
          ? true
          : window.confirm(t('event.deleteConfirm', { id: form.id }));
        if (!confirmed) return;
        try {
          const result = await enqueue({
            targetType: 'event',
            action: 'delete',
            targetId: form.id,
            targetFile: form.file,
            data: { file: form.file, id: form.id, kind: form.kind },
          });
          setFormMsg(t('event.deleteQueued', { count: result.count || 1 }));
          eventDraft.reset();
          isNewDraft.reset();
          setSelected(null);
        } catch (e) {
          setFormMsg(String(e.message || e));
        }
      };
      const savePrompt = async () => {
        if (!form) return;
        try {
          await api('/ai/submit', { method: 'POST', body: JSON.stringify({ kind: 'event', action: isNew ? 'create' : 'update', data: effectiveForm(form), max_tokens: AI_MAX_TOKENS }) });
          setAiMessage(t('ai.saved'));
        } catch (e) { setFormMsg(String(e.message || e)); }
      };
      const copyPrompt = async () => {
        try { await navigator.clipboard.writeText(aiPrompt); setAiMessage(t('ai.copied')); }
        catch { setAiMessage(t('ai.copyFailed')); }
      };
      const nodes = data?.nodes || [];
      const edges = data?.edges || [];
      const matchesCategory = (n) => category === 'all' || (category === 'special' ? !!n.special : !n.special);
      const matchesTag = (n) => {
        if (!tagOnly || !activeTag) return true;
        const ns = String(n.namespace || '').toLowerCase();
        return ns.includes(activeTag.toLowerCase()) || (n.triggerTags || []).includes(activeTag);
      };
      const kept = nodes.filter((n) => matchesCategory(n) && matchesTag(n));
      const keptIds = new Set(kept.map((n) => n.id));
      const keptEdges = edges.filter((e) => keptIds.has(e.from) && keptIds.has(e.to));
      useEffect(() => {
        if (selected && !keptIds.has(selected.id)) setSelected(null);
      }, [selected?.id, category, tagOnly, activeTag, nodes.length]);
      const byId = new Map(kept.map((n) => [n.id, n]));
      const depthGroups = new Map();
      for (const n of kept) {
        const d = n.depth || 0;
        if (!depthGroups.has(d)) depthGroups.set(d, []);
        depthGroups.get(d).push(n);
      }
      const positions = new Map();
      for (const [d, list] of depthGroups) list.forEach((n, i) => positions.set(n.id, { x: 30 + d * 260, y: 30 + i * 110 }));
      const predecessors = new Set();
      const successors = new Set();
      if (selected) {
        for (const e of keptEdges) { if (e.to === selected.id) predecessors.add(e.from); if (e.from === selected.id) successors.add(e.to); }
      }
      const width = Math.max(800, (Math.max(0, ...positions.values().map((p) => p.x)) + 300));
      const height = Math.max(420, (Math.max(0, ...positions.values().map((p) => p.y)) + 140));
      const pasteEvent = (clip) => {
        if (!clip || typeof clip !== 'object') return;
        if (Array.isArray(clip.effects) && form) {
          setForm((prev) => prev ? ({ ...prev, options: [{ name: prev.options?.[0]?.name || 'option.a', effects: clip.effects }] }) : prev);
          return;
        }
        if (Array.isArray(clip.nodes)) {
          const effects = clip.nodes[0]?.rewards || [];
          if (effects.length) setForm((prev) => prev ? ({ ...prev, options: [{ name: prev.options?.[0]?.name || 'option.a', effects }] }) : prev);
          return;
        }
        if (Array.isArray(clip.options)) {
          setForm((prev) => ({ ...(prev || {}), options: clip.options, conditions: clip.conditions || prev?.conditions || [] }));
          return;
        }
        if (Array.isArray(clip.conditions)) setForm((prev) => prev ? { ...prev, conditions: clip.conditions } : prev);
      };
      useRegisterForm('eventForm', form, pasteEvent);
      return h('div', { className: 'eu4w-col' },
        h(NLAssistant, { kind: 'event', form, onApply: applyNL }),
        h('div', { className: 'eu4w-row' },
          h('input', { className: 'eu4w-input', style: { width: 220 }, value: namespace, placeholder: t('event.namespacePlaceholder'), onChange: (e) => setNamespace(e.target.value) }),
          h('button', { className: 'eu4w-btn', onClick: load }, t('event.load')),
          h('button', { className: 'eu4w-btn', onClick: newEvent }, t('event.new')),
          h('span', { className: 'eu4w-muted' }, t('event.category')),
          ...[['all', t('event.all')], ['regular', t('event.regular')], ['special', t('event.special')]].map(([id, label]) =>
            h('button', { key: id, className: 'eu4w-btn' + (category === id ? ' primary' : ''), onClick: () => setCategory(id) }, label),
          ),
          h('label', { className: 'eu4w-check' },
            h('input', {
              type: 'checkbox', checked: tagOnly, disabled: !activeTag,
              onChange: (e) => setTagOnly(e.target.checked),
            }),
            t('event.tagToggle', { tag: activeTag || 'Tag' }),
          ),
          data ? h('span', { className: 'eu4w-pill' }, t('event.count', { kept: kept.length, total: nodes.length, edges: keptEdges.length })) : null,
          activeTag && tagOnly ? h('span', { className: 'eu4w-pill eu4w-warn' }, t('event.tagLinked', { tag: activeTag })) : null,
          keptEdges.some((e) => e.missing) ? h('span', { className: 'eu4w-pill eu4w-err' }, t('event.missing', { count: keptEdges.filter((e) => e.missing).length })) : null,
          h('span', { className: 'eu4w-muted' }, t('event.redHint')),
        ),
        h('div', { className: 'eu4w-split' },
          h('div', { className: 'eu4w-canvas', style: { height: 540 } },
            kept.length === 0
              ? h('div', { className: 'eu4w-muted', style: { padding: 18 } }, t('event.empty'))
              : h('div', { style: { position: 'relative', width, height } },
                h('svg', { className: 'eu4w-edge', viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'none' },
                  ...keptEdges.map((e, i) => {
                    const a = positions.get(e.from); const b = positions.get(e.to);
                    if (!a || !b) return null;
                    const active = selected && (e.from === selected.id || e.to === selected.id);
                    const decisionEdge = e.dashed === true;
                    return h('line', {
                      key: i, x1: a.x + 180, y1: a.y + 28, x2: b.x, y2: b.y + 28,
                      stroke: e.missing ? '#ff7b72' : decisionEdge ? '#b58cff' : active ? '#d6b45a' : '#6e7f92',
                      strokeWidth: e.missing ? 2 : 1.4,
                      strokeDasharray: e.missing ? '6 4' : decisionEdge ? '5 3' : undefined,
                      opacity: active || !selected ? 1 : .35,
                    });
                  }),
                ),
                ...kept.map((n) => {
                  const p = positions.get(n.id) || { x: 0, y: 0 };
                  const cls = 'eu4w-node' + (selected?.id === n.id ? ' sel' : '') + (predecessors.has(n.id) ? ' pre' : '') + (successors.has(n.id) ? ' suc' : '') + (n.kind === 'decision' ? ' decision' : '');
                  return h('div', { key: n.id, className: cls, style: { left: p.x, top: p.y, width: 180 }, onClick: () => { setIsNew(false); setSelected(n); } },
                    h('h4', null, n.id),
                    h('p', null, `${categoryLabel(n.kind)} · ${n.source}${n.special ? ' · ' + t('category.DHE') : ''}`),
                    h('p', { style: { color: n.edges.some((e) => e.missing) ? '#ff7b72' : undefined } }, n.edges.some((e) => e.missing) ? t('event.hasMissing') : t('event.outEdgeCount', { count: n.edges.length })),
                  );
                }),
              ),
          ),
          h('div', { className: 'eu4w-col' },
            h('div', { className: 'eu4w-card' },
              h('h3', null, t('event.details')),
              selected ? h('div', { className: 'eu4w-kv' },
                h('b', null, 'ID'), h('span', null, selected.id),
                h('b', null, t('event.type')), h('span', null, categoryLabel(selected.kind)),
                h('b', null, t('event.titleKey')), h('span', null, selected.title || '—'),
                h('b', null, t('header.desc_key')), h('span', null, selected.desc || '—'),
                h('b', null, t('event.file')), h('span', { className: 'eu4w-mono' }, selected.path),
                h('b', null, t('event.line')), h('span', null, String(selected.line)),
              ) : h('div', { className: 'eu4w-muted' }, t('event.clickNode')),
            ),
            selected ? h('div', { className: 'eu4w-card' },
              h('h3', null, t('event.outEdges')),
              selected.edges.length ? h('div', { className: 'eu4w-col' }, ...selected.edges.map((e, i) =>
                h('div', { key: i, className: e.missing ? 'eu4w-err' : '' }, `${e.option} → ${e.to}${e.missing ? t('event.edgeMissingSuffix') : ''}`),
              )) : h('div', { className: 'eu4w-muted' }, t('event.noEdges')),
            ) : null,
            (selected || isNew || form) ? h('div', { className: 'eu4w-card' },
              h('h3', null, isNew ? t('event.createTitle') : t('event.form')),
              form ? h('div', { className: 'eu4w-col' },
                nlFilled || nlDirty ? h('div', { className: nlDirty ? 'eu4w-warn' : 'eu4w-ok' }, nlDirty ? t('nl.dirty') : t('nl.filled')) : null,
                isNew
                  ? field(t('event.fileLabel'), h('input', { className: 'eu4w-input', value: form.file || '', onChange: (e) => setField('file', e.target.value) }))
                  : h('div', { className: 'eu4w-mono eu4w-muted' }, `${form.file} · ${categoryLabel(form.kind)} · ${form.id}`),
                h('div', { className: 'eu4w-grid' },
                  field(t('label.event_id'), h('input', { className: 'eu4w-input', value: form.id || '', onChange: (e) => setField('id', e.target.value) })),
                  field(t('event.titleText'), h('input', { className: 'eu4w-input', value: form.title || '', placeholder: '布拉格之战', onChange: (e) => setField('title', e.target.value) })),
                  field(t('event.descText'), h(AutoTextArea, {
                    value: form.desc || '', placeholder: '事件描述的中文文本', toolbar: true, minHeight: 90,
                    onChange: (v) => setField('desc', v),
                  })),
                  field(t('event.pictureLabel'), h('div', { className: 'eu4w-col' },
                    h('input', { className: 'eu4w-input', list: 'eu4w-pictures', value: form.picture || '', onChange: (e) => setField('picture', e.target.value) }),
                    h('datalist', { id: 'eu4w-pictures' }, ...PICTURE_CHOICES.map((value) => h('option', { key: value, value }))),
                  )),
                ),
                h('div', { className: 'eu4w-muted' }, t('event.keysHint', { title: `${form.id}.t`, desc: `${form.id}.d` })),
                h('div', { className: 'eu4w-row' },
                  h('span', { className: 'eu4w-muted' }, t('event.triggerMode')),
                  h('select', {
                    className: 'eu4w-select',
                    value: form.triggerMode === 'startup' ? 'startup' : 'normal',
                    onChange: (e) => { const mode = e.target.value; setNlDirty(true); setForm((prev) => (prev ? { ...prev, triggerMode: mode, targetTag: mode === 'startup' && !prev.targetTag ? (activeTag || '') : prev.targetTag } : prev)); },
                  },
                    h('option', { value: 'normal' }, t('event.triggerNormal')),
                    h('option', { value: 'startup' }, t('event.triggerStartup')),
                  ),
                  h('span', { className: 'eu4w-mono eu4w-muted' }, form.localisationFile || ''),
                ),
                form.triggerMode === 'startup'
                  ? h('div', { className: 'eu4w-col' },
                    h('div', { className: 'eu4w-row' },
                      field(t('event.targetTag'), h('input', {
                        className: 'eu4w-input', style: { width: 90 }, maxLength: 3,
                        value: form.targetTag || '', placeholder: activeTag || 'TBO',
                        onChange: (e) => setField('targetTag', String(e.target.value || '').toUpperCase()),
                      })),
                      field(t('event.bindDate'), h('input', {
                        className: 'eu4w-input', style: { width: 120 },
                        value: form.bindDate || '1437.1.1',
                        onChange: (e) => setField('bindDate', e.target.value),
                      })),
                      field(t('event.localisationFile'), h('input', {
                        className: 'eu4w-input', style: { minWidth: 260 },
                        value: form.localisationFile || '',
                        onChange: (e) => setField('localisationFile', e.target.value),
                      })),
                    ),
                    h('div', { className: 'eu4w-muted' }, t('event.startupHint', {
                      file: `history/countries/${form.targetTag || activeTag || '<TAG>'}.txt`,
                      line: `${form.bindDate || '1437.1.1'} = { country_event = { id = ${form.id} days = 0 } }`,
                    })),
                  )
                  : null,
                h('div', { className: 'eu4w-row' },
                  h('label', { className: 'eu4w-check' },
                    h('input', { type: 'checkbox', checked: form.fireOnlyOnce === true, onChange: (e) => setField('fireOnlyOnce', e.target.checked) }),
                    t('event.fireOnlyOnce'),
                  ),
                  h('label', { className: 'eu4w-check' },
                    h('input', { type: 'checkbox', checked: form.major === true, onChange: (e) => setField('major', e.target.checked) }),
                    t('event.major'),
                  ),
                ),
                h('h4', null, t('label.trigger')),
                h(ConditionRows, { rows: form.conditions || [], onChange: (rows) => setField('conditions', rows) }),
                h('h4', null, t('event.options')),
                ...(form.options || []).map((option, index) => h('div', { className: 'eu4w-card', key: index },
                  h('div', { className: 'eu4w-row' },
                    h('input', {
                      className: 'eu4w-input', value: option.name || '', placeholder: t('event.optionPlaceholder'),
                      onChange: (e) => setOption(index, { name: e.target.value }),
                    }),
                    h('button', { className: 'eu4w-btn danger', onClick: () => removeOption(index) }, t('event.deleteOption')),
                  ),
                  h(EffectRows, { rows: option.effects || [], onChange: (rows) => setOption(index, { effects: rows }) }),
                )),
                h('div', { className: 'eu4w-row' },
                  h('button', { className: 'eu4w-btn', onClick: addOption }, t('btn.add_option')),
                  h('button', { className: 'eu4w-btn', onClick: previewGenerated }, t('event.preview')),
                  h('button', { className: 'eu4w-btn primary', onClick: queueChange, title: t('tooltip.ai_action') }, t('queue.add')),
                  !isNew ? h('button', { className: 'eu4w-btn danger', onClick: queueDelete }, t('event.delete')) : null,
                  formMsg ? h('span', { className: 'eu4w-muted' }, formMsg) : null,
                ),
                preview ? h('div', { className: 'eu4w-card eu4w-nl' },
                  h('h4', null, t('preview.title')),
                  preview.absolutePath ? h('div', {
                    className: 'eu4w-err',
                    style: { fontWeight: 700, wordBreak: 'break-all' },
                  }, '📍 ' + t('preview.absolutePath') + '：' + preview.absolutePath) : null,
                  preview.modVerified === false ? h('div', { className: 'eu4w-err', style: { fontWeight: 700 } },
                    '⛔ ' + t('mod.invalid')) : null,
                  preview.namespace ? h('div', {
                    className: preview.namespaceOk ? 'eu4w-ok' : 'eu4w-err',
                    style: { fontWeight: 600 },
                  },
                    (preview.namespaceOk ? '✅ ' : '✖ ') + 'namespace = ' + (preview.namespace.namespace || '（缺失）')
                    + (preview.namespaceOk ? '' : '（应为 ' + preview.namespaceExpected + '）')) : null,
                  preview.localisationCheck ? h('div', {
                    className: preview.localisationCheck.ok ? 'eu4w-ok' : 'eu4w-err',
                    style: { fontWeight: 600 },
                  },
                    (preview.localisationCheck.ok ? '✅ ' : '✖ ') + '中文本地化：'
                    + (preview.localisationCheck.simp.file || '')
                    + '（' + (preview.localisationCheck.simp.size || 0) + ' bytes, BOM '
                    + (preview.localisationCheck.simp.bom ? '✅' : '✖') + '）'
                    + (preview.localisationCheck.active
                      ? '；游戏语言 ' + preview.activeLanguage + ' 文件 '
                        + (preview.localisationCheck.active.ok ? '✅' : '✖（会显示英文）')
                      : '')) : null,
                  preview.warnings && preview.warnings.length
                    ? h('div', { className: 'eu4w-col eu4w-warn' }, ...preview.warnings.map((w, i) => h('div', { key: i }, '⚠ ' + w)))
                    : h('div', { className: 'eu4w-ok' }, t('preview.clean')),
                  h('div', { className: 'eu4w-muted' }, t('preview.codeLabel', { file: preview.file })),
                  h('textarea', { className: 'eu4w-area', rows: 12, readOnly: true, value: preview.code, spellCheck: false }),
                  h('div', { className: 'eu4w-muted' }, t('preview.locLabel', { file: preview.localisationFile })),
                  h('textarea', { className: 'eu4w-area', rows: 2, readOnly: true, value: (preview.localisation || []).join('\n'), spellCheck: false }),
                  preview.history ? h('div', null,
                    h('div', {
                      className: preview.history.ok === false ? 'eu4w-err' : 'eu4w-ok',
                      style: { fontWeight: 600 },
                    },
                      preview.history.ok === false
                        ? '✖ 历史文件缺少开局触发行（is_triggered_only 事件不会触发）'
                        : '✅ 开局引线已绑定'),
                    h('div', { className: 'eu4w-muted' }, t('preview.historyLabel', { file: preview.history.file })),
                    h('textarea', { className: 'eu4w-area', rows: 2, readOnly: true, value: preview.history.line, spellCheck: false }),
                  ) : null,
                  preview.onAction ? h('div', {
                    className: preview.onAction.bound ? 'eu4w-ok' : 'eu4w-err',
                    style: { fontWeight: 600 },
                  },
                    (preview.onAction.bound ? '✅ ' : '✖ ') + 'on_startup 兜底：'
                    + (preview.onAction.bound ? '已绑定（' + preview.onAction.file + '）' : '缺少触发行（' + preview.onAction.file + '）')) : null,
                  preview.onActionCode ? h('div', null,
                    h('div', { className: 'eu4w-muted' }, 'on_startup 兜底代码（common/on_actions/zz_eu4_workbench_on_actions.txt）'),
                    h('textarea', { className: 'eu4w-area', rows: 8, readOnly: true, value: preview.onActionCode, spellCheck: false }),
                  ) : null,
                ) : null,
                h(AIPromptCard, { prompt: aiPrompt, message: aiMessage, onCopy: copyPrompt, onSave: savePrompt }),
              ) : h('div', { className: 'eu4w-muted' }, formMsg || t('event.formLoading')),
            ) : null,
          ),
        ),
      );
    }

    /** Human label for a read-back result: deletes never show a size. */
    function readbackLabel(data) {
      const operation = data?.operation === 'delete-file' ? '删除文件'
        : (data?.operation === 'delete-node' || data?.operation === 'delete-nodes') ? '删除节点'
        : data?.operation === 'create' ? '新建'
        : data?.operation === 'modify' ? '修改'
        : data?.operation === 'missing' ? '写入'
        : '验证';
      const isDelete = String(data?.operation || '').startsWith('delete');
      let verdict;
      if (isDelete) {
        verdict = data.ok
          ? (data.operation === 'delete-file' ? '文件已成功删除' : '节点已成功移除')
          : (data.operation === 'delete-file' ? '删除失败，文件仍存在' : '删除失败，节点仍存在');
      } else if (data.found === false) {
        verdict = '未找到';
      } else if (data.namespaceExpected && data.namespaceOk === false) {
        verdict = 'namespace 不匹配';
      } else if (data.trigger && data.trigger.expected && !data.trigger.ok) {
        verdict = '已找到（开局引线未绑定）';
      } else {
        verdict = '已写入/已找到';
      }
      let text = '操作类型：' + operation + ' → 验证结果：' + verdict;
      if (data?.namespaceExpected) {
        text += '；namespace ' + (data.namespaceOk ? '✅ ' + (data.namespace || '') : '✖ 应为 ' + data.namespaceExpected);
      }
      if (data?.trigger && data.trigger.expected) {
        text += '；开局引线 ' + (data.trigger.ok ? '✅ 已绑定' : '✖ 未绑定');
        const historyOk = Boolean(data.trigger.history && data.trigger.history.ok);
        const onActionOk = Boolean(data.trigger.onAction && data.trigger.onAction.bound);
        text += '（history ' + (historyOk ? '✅' : '✖') + ' / on_startup ' + (onActionOk ? '✅' : '✖') + '）';
      }
      return { operation, verdict, isDelete, text };
    }

    /** Pure DecisionConfig mapping (English JSON, numbers normalised). */
    function decisionConfigOf(form) {
      const rawAi = form?.ai_will_do;
      const ai = rawAi === '' || rawAi === null || rawAi === undefined ? 1 : Number(rawAi);
      return {
        id: String(form?.id || '').trim(),
        title_cn: String(form?.title_cn || '').trim(),
        desc_cn: String(form?.desc_cn || '').trim(),
        potential: conditionPayloads(form?.potential),
        allow: conditionPayloads(form?.allow),
        effects: Array.isArray(form?.effects) ? form.effects : [],
        ai_will_do: Number.isFinite(ai) ? ai : 1,
      };
    }

    /** Pure validation so the UI and tests share one rule set. */
    function diplomacyValidation(form) {
      const a = String(form?.tagA || '').trim().toUpperCase();
      const b = String(form?.tagB || '').trim().toUpperCase();
      const rel = String(form?.relationType || 'alliance');
      const extra = String(form?.extraParams || '').trim();
      if (!a || !b) return 'dip.err.empty';
      if (a === b) return 'dip.err.same';
      if (!/^[A-Z][A-Z0-9]{2}$/.test(a) || !/^[A-Z][A-Z0-9]{2}$/.test(b)) return 'dip.err.tag';
      if (rel === 'war' && !/^cb_[a-z0-9_]+$/.test(extra)) return 'dip.err.cb';
      if (rel === 'truce' && !/^\d{4}$/.test(extra)) return 'dip.err.year';
      if (!/^\d{1,4}\.\d{1,2}\.\d{1,2}$/.test(String(form?.startDate || ''))) return 'dip.err.date';
      return '';
    }

    /** Opening diplomacy: native blocks + war/truce/rival routing. */
    function DiplomacyTab({ state, setErr }) {
      const { t } = useLocale();
      const { enqueue } = useQueue();
      const [form, setForm] = useFormState('diplomacyForm', {
        tagA: 'TBO', tagB: 'BOH', relationType: 'alliance', extraParams: '',
        startDate: state?.currentStartDate || '1437.1.1',
      });
      const [msg, setMsg] = useState('');
      const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
      useEffect(() => {
        if (state?.currentStartDate) setForm((prev) => ({ ...prev, startDate: state.currentStartDate }));
      }, [state?.currentStartDate]);
      const a = String(form.tagA || '').trim().toUpperCase();
      const b = String(form.tagB || '').trim().toUpperCase();
      const rel = String(form.relationType || 'alliance');
      const errorKey = diplomacyValidation(form);
      const error = errorKey ? t(errorKey) : '';
      const fileFor = (type) => type === 'war'
        ? 'history/wars/zz_eu4_workbench_diplomacy_wars.txt'
        : (type === 'truce' || type === 'rival')
          ? 'common/on_actions/zz_eu4_workbench_on_actions.txt'
          : 'history/diplomacy/zz_eu4_workbench_diplomacy.txt';
      const add = async () => {
        if (error) { setErr(error); return; }
        try {
          await enqueue({
            targetType: 'diplomacy', action: 'modify',
            targetId: a + '-' + b + '-' + rel,
            targetFile: fileFor(rel),
            data: {
              tagA: a, tagB: b, relationType: rel,
              extraParams: String(form.extraParams || '').trim(),
              startDate: String(form.startDate || '').trim(),
              file: fileFor(rel),
            },
          });
          setErr('');
          setMsg(t('dip.queued'));
        } catch (e) { setErr(String(e.message || e)); }
      };
      return h('div', { className: 'eu4w-col' },
        h('div', { className: 'eu4w-card' },
          h('h3', null, t('dip.title')),
          h('div', { className: 'eu4w-muted' }, t('dip.hint')),
          h('div', { className: 'eu4w-grid' },
            h('label', { className: 'eu4w-field' }, h('span', null, t('dip.a')),
              h('input', {
                className: 'eu4w-input', value: form.tagA || '', maxLength: 3,
                onChange: (e) => set('tagA', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')),
              })),
            h('label', { className: 'eu4w-field' }, h('span', null, t('dip.b')),
              h('input', {
                className: 'eu4w-input', value: form.tagB || '', maxLength: 3,
                onChange: (e) => set('tagB', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')),
              })),
            h('label', { className: 'eu4w-field' }, h('span', null, t('dip.type')),
              h('select', {
                className: 'eu4w-select', value: rel,
                onChange: (e) => set('relationType', e.target.value),
              }, ...DIPLOMACY_RELATIONS.map(([value, label]) => h('option', { key: value, value }, label)))),
            h('label', { className: 'eu4w-field' }, h('span', null, t('dip.start')),
              h('input', {
                className: 'eu4w-input', value: form.startDate || '',
                onChange: (e) => set('startDate', e.target.value),
              })),
            rel === 'war' ? h('label', { className: 'eu4w-field' }, h('span', null, t('dip.cb')),
              h('input', {
                className: 'eu4w-input', value: form.extraParams || '', placeholder: 'cb_conquest',
                onChange: (e) => set('extraParams', e.target.value.trim()),
              })) : null,
            rel === 'truce' ? h('label', { className: 'eu4w-field' }, h('span', null, t('dip.truceYear')),
              h('input', {
                className: 'eu4w-input', value: form.extraParams || '', placeholder: '1442',
                onChange: (e) => set('extraParams', e.target.value.replace(/[^0-9]/g, '')),
              })) : null,
          ),
          h('div', { className: 'eu4w-row' },
            h('button', { className: 'eu4w-btn', onClick: () => setForm((prev) => ({ ...prev, tagA: b, tagB: a })) }, t('dip.swap')),
            h('button', { className: 'eu4w-btn primary', onClick: add }, t('dip.add')),
            msg ? h('span', { className: 'eu4w-ok' }, msg) : null,
          ),
          error ? h('div', { className: 'eu4w-err' }, error) : null,
        ),
        h('div', { className: 'eu4w-card' },
          h('h3', null, t('dip.rules')),
          h('div', { className: 'eu4w-muted' }, t('dip.rule1')),
          h('div', { className: 'eu4w-muted' }, t('dip.rule2')),
          h('div', { className: 'eu4w-warn' }, t('dip.rule3')),
        ),
      );
    }

    function DecisionsTab({ state, setErr }) {
      const { t } = useLocale();
      const { activeTag } = useTagContext();
      const { enqueue } = useQueue();
      const [form, setForm] = useFormState('decisionForm', null);
      const [items, setItems] = useState([]);
      const [msg, setMsg] = useState('');
      const [tagOnly, setTagOnly] = useState(Boolean(activeTag));
      const [loadedId, setLoadedId] = useState('');
      const [aiPrompt, setAiPrompt] = useState('');
      const [aiMessage, setAiMessage] = useState('');
      const defaultDecision = (tag) => ({
        file: tag ? `decisions/${tag}_decisions.txt` : 'decisions/zz_eu4_workbench_decisions.txt',
        id: '',
        title_cn: '',
        desc_cn: '',
        icon: '',
        potential: tag ? [{ type: 'tag', op: '=', value: tag }] : [],
        allow: [],
        effects: [{ effect: 'add_stability', value: '1' }],
        ai_will_do: '1',
        localisationFile: 'localisation/zz_eu4_workbench_decisions_l_simp_chinese.yml',
      });
      const newDecision = () => {
        setLoadedId('');
        setForm(defaultDecision(activeTag));
        setMsg(''); setAiPrompt(''); setAiMessage('');
      };
      const load = async () => {
        try {
          await api('/refresh', { method: 'POST', body: '{}' }).catch(() => {});
          const query = tagOnly && activeTag ? '?tag=' + encodeURIComponent(activeTag) : '';
          const data = await api('/decisions' + query);
          setItems(data.items || []);
          setErr('');
        } catch (e) { setErr(String(e.message || e)); }
      };
      useEffect(() => { load(); }, [tagOnly, activeTag]);
      useEffect(() => {
        if (!form) setForm(defaultDecision(activeTag));
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      const pick = (item) => {
        setLoadedId(item.id);
        setForm({
          file: item.file,
          id: item.id,
          title_cn: item.title_cn || '',
          desc_cn: item.desc_cn || '',
          icon: item.icon || '',
          potential: item.potential || [],
          allow: item.allow || [],
          effects: item.effects || [],
          ai_will_do: String(item.ai_will_do ?? 1),
          localisationFile: 'localisation/zz_eu4_workbench_decisions_l_simp_chinese.yml',
        });
        setMsg(''); setAiPrompt(''); setAiMessage('');
      };
      const setField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
      const validate = () => {
        const config = decisionConfigOf(form);
        if (!/^[A-Za-z0-9_.\-]+$/.test(config.id)) return t('decision.idInvalid');
        if (!config.title_cn || !config.desc_cn) return t('decision.locMissing');
        if (!form?.file || !/\.txt$/i.test(form.file)) return t('decision.fileInvalid');
        return '';
      };
      const queueDecision = async () => {
        const problem = validate();
        if (problem) { setMsg(problem); return; }
        const config = decisionConfigOf(form);
        try {
          const result = await enqueue({
            targetType: 'decision',
            action: loadedId ? 'modify' : 'create',
            targetId: config.id,
            targetFile: form.file,
            data: { ...config, file: form.file, icon: form.icon || '', localisationFile: form.localisationFile },
          });
          setMsg(t('queue.added', { count: result.count || 1 }));
          setLoadedId(config.id);
          await load();
        } catch (e) { setMsg(String(e.message || e)); }
      };
      const queueDelete = async () => {
        const config = decisionConfigOf(form);
        if (!config.id || !loadedId) return;
        try {
          const result = await enqueue({
            targetType: 'decision',
            action: 'delete',
            targetId: config.id,
            targetFile: form?.file || '',
            data: { id: config.id, file: form?.file || '' },
          });
          setMsg(t('queue.added', { count: result.count || 1 }));
          setLoadedId('');
          await load();
        } catch (e) { setMsg(String(e.message || e)); }
      };
      const buildPrompt = async () => {
        const problem = validate();
        if (problem) { setMsg(problem); return; }
        try {
          const result = await api('/ai/build', { method: 'POST', body: JSON.stringify({ kind: 'decision', action: loadedId ? 'update' : 'create', data: form }) });
          setAiPrompt(result.prompt); setAiMessage(''); setMsg('');
        } catch (e) { setMsg(String(e.message || e)); }
      };
      const paste = (clip) => {
        if (!clip || typeof clip !== 'object') return;
        setForm((prev) => ({ ...(prev || defaultDecision(activeTag)), ...clip }));
      };
      useRegisterForm('decisionForm', form, paste);
      return h('div', { className: 'eu4w-col' },
        h('div', { className: 'eu4w-row' },
          h('label', { className: 'eu4w-check' },
            h('input', { type: 'checkbox', checked: tagOnly, disabled: !activeTag, onChange: (e) => setTagOnly(e.target.checked) }),
            t('decision.tagOnly', { tag: activeTag || 'Tag' }),
          ),
          h('button', { className: 'eu4w-btn', onClick: load }, t('decision.reload')),
          h('button', { className: 'eu4w-btn primary', onClick: newDecision }, t('decision.new')),
          h('span', { className: 'eu4w-muted' }, t('decision.count', { count: items.length })),
          msg ? h('span', { className: 'eu4w-muted' }, msg) : null,
        ),
        items.length
          ? h('div', { className: 'eu4w-chips' },
            ...items.slice(0, 200).map((item) => h('button', {
              key: item.id,
              className: 'eu4w-btn' + (loadedId === item.id ? ' primary' : ''),
              title: item.id + ' · ' + item.file,
              onClick: () => pick(item),
            }, `${item.id}${item.title_cn ? ' · ' + item.title_cn : ''}`)),
          )
          : h('div', { className: 'eu4w-muted' }, t('decision.empty')),
        form ? h('div', { className: 'eu4w-card' },
          h('h3', null, loadedId ? t('decision.editTitle') : t('decision.newTitle')),
          h('div', { className: 'eu4w-grid' },
            field(t('decision.file'), h('input', { className: 'eu4w-input', value: form.file || '', onChange: (e) => setField('file', e.target.value) })),
            field(t('decision.id'), h('input', { className: 'eu4w-input', value: form.id || '', placeholder: 'tbo_decision.1', onChange: (e) => setField('id', e.target.value) })),
            field(t('decision.titleCn'), h('input', { className: 'eu4w-input', value: form.title_cn || '', placeholder: t('decision.titlePlaceholder'), onChange: (e) => setField('title_cn', e.target.value) })),
            field(t('decision.descCn'), h(AutoTextArea, {
              value: form.desc_cn || '', placeholder: t('decision.descPlaceholder'), toolbar: true, minHeight: 90,
              onChange: (v) => setField('desc_cn', v),
            })),
            field(t('decision.icon'), h('input', { className: 'eu4w-input', value: form.icon || '', placeholder: 'mission_icon', onChange: (e) => setField('icon', e.target.value) })),
            field(t('decision.aiWillDo'), h('input', { className: 'eu4w-input', type: 'number', value: form.ai_will_do ?? '1', onChange: (e) => setField('ai_will_do', e.target.value) })),
          ),
          h('div', { className: 'eu4w-muted' }, t('decision.locHint', { title: `${form.id}_title`, desc: `${form.id}_desc` })),
          h('h4', null, t('decision.potential')),
          h('div', { className: 'eu4w-muted' }, t('decision.potentialHint')),
          h(ConditionRows, { rows: form.potential || [], onChange: (rows) => setField('potential', rows) }),
          h('h4', null, t('decision.allow')),
          h('div', { className: 'eu4w-muted' }, t('decision.allowHint')),
          h(ConditionRows, { rows: form.allow || [], onChange: (rows) => setField('allow', rows) }),
          h('h4', null, t('decision.effects')),
          h(EffectRows, { rows: form.effects || [], onChange: (rows) => setField('effects', rows) }),
          h('div', { className: 'eu4w-row' },
            h('button', { className: 'eu4w-btn primary', onClick: queueDecision }, t('queue.add')),
            h('button', { className: 'eu4w-btn', onClick: buildPrompt }, t('ai.build')),
            loadedId ? h('button', { className: 'eu4w-btn danger', onClick: queueDelete }, t('common.delete')) : null,
            msg ? h('span', { className: 'eu4w-muted' }, msg) : null,
          ),
          h(AIPromptCard, {
            prompt: aiPrompt, message: aiMessage,
            onCopy: async () => { try { await navigator.clipboard.writeText(aiPrompt); setAiMessage(t('ai.copied')); } catch { setAiMessage(t('ai.copyFailed')); } },
            onSave: async () => {
              try { await api('/ai/submit', { method: 'POST', body: JSON.stringify({ kind: 'decision', action: loadedId ? 'update' : 'create', data: form }) }); setAiMessage(t('ai.saved')); }
              catch (e) { setMsg(String(e.message || e)); }
            },
          }),
        ) : null,
      );
    }

    function GUITab({ setErr }) {
      const { t } = useLocale();
      const { activeTag } = useTagContext();
      const { enqueue } = useQueue();
      const [guiType, setGuiType] = useState('topbar-button');
      const [action, setAction] = useState('create');
      const [form, setForm, formDraft] = useFormState('guiForm', {
        name: 'hussite_zeal_button',
        imagePath: 'gfx/interface/topbar/hussite.dds',
        tooltipText: t('gui.tooltipDefault'),
        buttonText: t('gui.buttonDefault'),
        anchor: 'left_of_coins',
        visibility: 'always',
        clickAction: 'hussite.2',
        targetFile: '',
        width: '',
        height: '',
        closeButtonPosition: t('gui.closeTopRight'),
        strategy: 'insert',
        notes: '',
      });
      const [options, setOptions] = useState({ anchors: [], visibilities: [] });
      const [aiPrompt, setAiPrompt] = useState('');
      const [aiMessage, setAiMessage] = useState('');
      const [msg, setMsg] = useState('');
      useEffect(() => {
        let alive = true;
        api('/gui/options')
          .then((data) => { if (alive) setOptions(data); })
          .catch(() => { /* use the built-in labels as a fallback */ });
        return () => { alive = false; };
      }, []);
      const setField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
      const changeType = (next) => {
        setGuiType(next);
        setAiPrompt('');
        if (next === 'custom-panel') {
          setForm((prev) => ({
            ...prev,
            name: 'hussite_religion',
            imagePath: 'gfx/interface/panels/hussite_religion.dds',
            tooltipText: t('gui.panelTooltipDefault'),
            buttonText: '',
            anchor: 'top_center',
            visibility: 'always',
            targetFile: 'interface/hussite_religion.gui',
            strategy: 'insert',
            width: '600',
            height: '400',
          }));
        } else {
          setForm((prev) => ({
            ...prev,
            name: 'hussite_zeal_button',
            imagePath: 'gfx/interface/topbar/hussite.dds',
            tooltipText: t('gui.tooltipDefault'),
            buttonText: t('gui.buttonDefault'),
            anchor: 'left_of_coins',
            visibility: 'always',
            clickAction: 'hussite.2',
            targetFile: '',
            width: '',
            height: '',
          }));
        }
      };
      const fallbackAnchors = ['left_of_coins', 'right_of_coins', 'left_of_stability', 'right_of_stability', 'top_center', 'top_left', 'top_right'];
      const fallbackVisibilities = ['always', 'tag = BOH', 'religion = hussite'];
      const anchorOptions = options.anchors?.length ? options.anchors.map((option) => option.value) : fallbackAnchors;
      const visibilityOptions = options.visibilities?.length ? options.visibilities.map((option) => option.value) : fallbackVisibilities;
      const dynamicVisibility = activeTag && !visibilityOptions.includes(`tag = ${activeTag}`) ? [`tag = ${activeTag}`] : [];
      const visibilityLabel = (value) => value === `tag = ${activeTag}`
        ? t('visibility.activeTag', { tag: activeTag })
        : t('visibility.' + value);
      const guiData = () => ({
        guiType,
        name: form.name,
        imagePath: form.imagePath,
        tooltipText: form.tooltipText,
        buttonText: form.buttonText,
        anchor: form.anchor,
        visibility: form.visibility,
        width: Number(form.width) || undefined,
        height: Number(form.height) || undefined,
        clickAction: form.clickAction,
        closeButtonPosition: form.closeButtonPosition,
        targetFile: guiType === 'custom-panel' ? form.targetFile : 'interface/topbar.gui',
        strategy: form.strategy,
        notes: form.notes,
        tag: activeTag || null,
      });
      const buildPrompt = async () => {
        setMsg(t('ai.thinking'));
        try {
          const result = await api('/ai/build', { method: 'POST', body: JSON.stringify({ kind: 'gui', action, data: guiData(), max_tokens: AI_MAX_TOKENS }) });
          setAiPrompt(result.prompt); setAiMessage(''); setMsg('');
        } catch (e) { setMsg(String(e.message || e)); }
      };
      const queueChange = async () => {
        try {
          const result = await enqueue({
            targetType: 'gui',
            action: action === 'update' ? 'modify' : 'create',
            targetId: form.name,
            targetFile: form.targetFile || '',
            data: guiData(),
          });
          setMsg(t('queue.added', { count: result.count || 1 }));
          formDraft.reset();
        } catch (e) {
          setMsg(String(e.message || e));
        }
      };
      const savePrompt = async () => {
        try {
          await api('/ai/submit', { method: 'POST', body: JSON.stringify({ kind: 'gui', action, data: guiData(), max_tokens: AI_MAX_TOKENS }) });
          setAiMessage(t('ai.saved'));
        } catch (e) { setMsg(String(e.message || e)); }
      };
      const copyPrompt = async () => {
        try { await navigator.clipboard.writeText(aiPrompt); setAiMessage(t('ai.copied')); }
        catch { setAiMessage(t('ai.copyFailed')); }
      };
      const isButton = guiType === 'topbar-button';
      useRegisterForm('guiForm', form, (clip) => {
        if (clip && typeof clip === 'object') setForm((prev) => ({ ...prev, ...clip }));
      });
      return h('div', { className: 'eu4w-col' },
        h('div', { className: 'eu4w-card' },
          h('h3', null, t('gui.title')),
          h('p', { className: 'eu4w-muted' }, t('gui.hint')),
          h('div', { className: 'eu4w-row' },
            h('span', { className: 'eu4w-muted' }, t('gui.scene')),
            h('select', { className: 'eu4w-select', value: guiType, onChange: (e) => changeType(e.target.value) },
              h('option', { value: 'topbar-button' }, t('gui.topbar')),
              h('option', { value: 'custom-panel' }, t('gui.panel')),
            ),
            h('span', { className: 'eu4w-muted' }, t('gui.action')),
            h('select', { className: 'eu4w-select', value: action, onChange: (e) => setAction(e.target.value) },
              h('option', { value: 'create' }, t('gui.create')),
              h('option', { value: 'update' }, t('gui.update')),
            ),
          ),
          h('div', { className: 'eu4w-grid' },
            field(t('gui.elementName'), h('input', { className: 'eu4w-input', value: form.name, onChange: (e) => setField('name', e.target.value) })),
            field(t('gui.imagePath'), h('div', { className: 'eu4w-col' },
              h('input', { className: 'eu4w-input', value: form.imagePath, placeholder: 'gfx/interface/topbar/hussite.dds', onChange: (e) => setField('imagePath', e.target.value) }),
              h('span', { className: 'eu4w-warn', style: { fontSize: 11 } }, t('gui.imageWarning')),
            )),
            field(t('gui.tooltipText'), h(AutoTextArea, {
          value: form.tooltipText, placeholder: t('gui.tooltipDefault'), toolbar: true, minHeight: 60,
          onChange: (v) => setField('tooltipText', v),
        })),
            field(t('gui.buttonText'), h('input', { className: 'eu4w-input', value: form.buttonText, placeholder: t('gui.buttonDefault'), onChange: (e) => setField('buttonText', e.target.value) })),
            isButton ? null : field(t('gui.targetFile'), h('input', { className: 'eu4w-input', value: form.targetFile, placeholder: 'interface/hussite_religion.gui', onChange: (e) => setField('targetFile', e.target.value) })),
          ),
          h('div', { className: 'eu4w-grid' },
            field(t('gui.anchor'), h('select', { className: 'eu4w-select', value: form.anchor, onChange: (e) => setField('anchor', e.target.value) },
              ...anchorOptions.map((value) => h('option', { key: value, value }, t('anchor.' + value))),
            )),
            field(t('gui.visibility'), h('select', { className: 'eu4w-select', value: form.visibility, onChange: (e) => setField('visibility', e.target.value) },
              ...visibilityOptions.concat(dynamicVisibility).map((value) => h('option', { key: value, value }, visibilityLabel(value))),
            )),
          ),
          isButton ? h('div', { className: 'eu4w-grid' },
            field(t('gui.clickAction'), h('input', { className: 'eu4w-input', value: form.clickAction, onChange: (e) => setField('clickAction', e.target.value) })),
            field(t('gui.buttonWidth'), h('input', { className: 'eu4w-input', type: 'number', value: form.width, placeholder: t('gui.sizePlaceholder'), onChange: (e) => setField('width', e.target.value) })),
            field(t('gui.buttonHeight'), h('input', { className: 'eu4w-input', type: 'number', value: form.height, placeholder: t('gui.sizePlaceholder'), onChange: (e) => setField('height', e.target.value) })),
          ) : h('div', { className: 'eu4w-grid' },
            field(t('gui.panelWidth'), h('input', { className: 'eu4w-input', type: 'number', value: form.width, onChange: (e) => setField('width', e.target.value) })),
            field(t('gui.panelHeight'), h('input', { className: 'eu4w-input', type: 'number', value: form.height, onChange: (e) => setField('height', e.target.value) })),
            field(t('gui.closePos'), h('input', { className: 'eu4w-input', value: form.closeButtonPosition, onChange: (e) => setField('closeButtonPosition', e.target.value) })),
          ),
          h('div', { className: 'eu4w-row' },
            h('span', { className: 'eu4w-muted' }, t('gui.strategy')),
            h('select', { className: 'eu4w-select', value: form.strategy, onChange: (e) => setField('strategy', e.target.value) },
              h('option', { value: 'insert' }, t('gui.insert')),
              h('option', { value: 'overwrite' }, t('gui.overwrite')),
            ),
          ),
          field(t('gui.notes'), h(AutoTextArea, {
          value: form.notes, placeholder: t('gui.notesPlaceholder'), minHeight: 60, maxHeight: 300,
          onChange: (v) => setField('notes', v),
        })),
          h('div', { className: 'eu4w-warn' }, t('gui.imageWarningLong')),
          h('div', { className: 'eu4w-row' },
            h('button', { className: 'eu4w-btn primary', onClick: queueChange, title: t('tooltip.ai_action') }, t('queue.add')),
            msg ? h('span', { className: 'eu4w-muted' }, msg) : null,
          ),
          h(AIPromptCard, { prompt: aiPrompt, message: aiMessage, onCopy: copyPrompt, onSave: savePrompt }),
        ),
        h('div', { className: 'eu4w-card' },
          h('h3', null, t('gui.checkTitle')),
          h('ul', { className: 'eu4w-muted' },
            h('li', null, t('gui.check1')),
            h('li', null, t('gui.check2')),
            h('li', null, t('gui.check3')),
            h('li', null, t('gui.check4')),
            h('li', null, t('gui.check5')),
          ),
        ),
      );
    }

    function ValidateTab({ setErr }) {
      const { t } = useLocale();
      const [script, setScript] = useFormState('validateForm.script', 'country_event = {\n\tid = test.1\n\ttrigger = {\n\t\tadd_prestige = 10\n\t}\n\timmediate = {\n\t\tprestige = 10\n\t}\n}');
      const [scope, setScope] = useFormState('validateForm.scope', '');
      const [result, setResult] = useState(null);
      const localizeIssue = (issue) => {
        const message = String(issue.message || '');
        if (/[\u4e00-\u9fa5]/.test(message)) return message;
        const key = 'issue.' + issue.code;
        const translated = t(key);
        return translated === key ? message : translated;
      };
      const run = async () => {
        try {
          const d = await api('/validate', { method: 'POST', body: JSON.stringify({ script, scope: scope || undefined }) });
          setResult(d); setErr('');
        } catch (e) { setErr(String(e.message || e)); }
      };
      return h('div', { className: 'eu4w-split' },
        h('div', { className: 'eu4w-col' },
          h('div', { className: 'eu4w-row' },
            h('select', { className: 'eu4w-select', value: scope, onChange: (e) => setScope(e.target.value) },
              h('option', { value: '' }, t('validate.scopeAuto')),
              h('option', { value: 'country' }, 'country'),
              h('option', { value: 'province' }, 'province'),
              h('option', { value: 'trade_node' }, 'trade_node'),
            ),
            h('button', { className: 'eu4w-btn primary', onClick: run }, t('validate.run')),
            h('button', { className: 'eu4w-btn', onClick: () => setScript('province_event = {\n\tid = test.2\n\timmediate = {\n\t\tadd_prestige = 10\n\t}\n}') }, t('validate.insertError')),
          ),
          h('textarea', { className: 'eu4w-area', rows: 20, value: script, onChange: (e) => setScript(e.target.value), spellCheck: false }),
        ),
        h('div', { className: 'eu4w-col' },
          h('div', { className: 'eu4w-card' },
            h('h3', null, result ? result.summary : t('validate.result')),
            result ? h('div', { className: 'eu4w-col' },
              ...result.issues.map((i, idx) => h('div', { key: idx, className: 'eu4w-issue ' + i.severity },
                h('b', null, `${i.code}${i.line ? ' · ' + t('validate.line', { line: i.line }) : ''}`),
                h('p', null, localizeIssue(i)),
              )),
              result.loc ? h('p', { className: 'eu4w-muted' }, t('validate.locCheck', { keys: result.loc.keys.length, missing: result.loc.missing.length })) : null,
            ) : h('div', { className: 'eu4w-muted' }, t('validate.noResult')),
          ),
        ),
      );
    }

    function ToolsTab({ setErr }) {
      const { t } = useLocale();
      const [tools, setTools] = useState([]);
      const [msg, setMsg] = useState('');
      const statusLabel = (status) => {
        const key = 'status.' + status;
        const text = t(key);
        return text === key ? status : text;
      };
      const probe = async () => {
        try { setTools(await api('/tools')); setErr(''); }
        catch (e) { setErr(String(e.message || e)); }
      };
      useEffect(() => { probe(); }, []);
      const open = async (id) => {
        try { const d = await api('/tools/open', { method: 'POST', body: JSON.stringify({ id }) }); setMsg(t('tools.launched', { path: d.path })); }
        catch (e) { setMsg(String(e.message || e)); }
      };
      return h('div', { className: 'eu4w-col' },
        h('div', { className: 'eu4w-row' },
          h('button', { className: 'eu4w-btn primary', onClick: probe }, t('tools.probe')),
          h('span', { className: 'eu4w-muted' }, t('tools.hint')),
          msg ? h('span', { className: 'eu4w-muted' }, msg) : null,
        ),
        h('div', { className: 'eu4w-card' },
          h('h3', null, t('tools.bridgeTitle')),
          h('div', { className: 'eu4w-tool', style: { color: '#8b98a8', fontSize: 11 } },
            h('b', null, t('tools.colTool')), h('b', null, t('tools.colStatus')), h('b', null, t('tools.colReason')), h('b', null, t('tools.colAction'))),
          ...tools.map((tool) => h('div', { key: tool.id, className: 'eu4w-tool' },
            h('div', null, h('div', null, tool.name), h('div', { className: 'eu4w-mono eu4w-muted' }, tool.path || tool.url || '')),
            h('span', { className: 'eu4w-pill ' + (tool.status === 'connected' ? 'eu4w-ok' : tool.status === 'not-installed' || tool.status === 'unreachable' ? 'eu4w-err' : 'eu4w-warn') }, statusLabel(tool.status)),
            h('div', { className: 'eu4w-muted' }, tool.reason),
            tool.status === 'installed' || tool.status === 'connected'
              ? h('button', { className: 'eu4w-btn', onClick: () => open(tool.id) }, t('tools.open'))
              : h('span', { className: 'eu4w-muted' }, '—'),
          )),
        ),
        h('div', { className: 'eu4w-card' },
          h('h3', null, t('tools.installTitle')),
          h('p', { className: 'eu4w-muted' }, t('tools.installHint')),
        ),
      );
    }

    function Icon({ size }) {
      const s = size || 18;
      return h('svg', { width: s, height: s, viewBox: '0 0 64 64', 'aria-hidden': true, style: { display: 'block' } },
        h('rect', { x: 4, y: 4, width: 56, height: 56, rx: 12, fill: '#142033', stroke: '#c9a227', strokeWidth: 3 }),
        h('path', { d: 'M32 10 38 26 54 32 38 38 32 54 26 38 10 32 26 26Z', fill: '#c9a227' }),
        h('circle', { cx: 32, cy: 32, r: 5, fill: '#0d1117' }),
      );
    }

    /**
     * Headless render helper used by `test/client-smoke.mjs` only: mounts one
     * tab inside the real context providers with stub data, so the markup can
     * be checked without a browser or a running Host.
     */
    function renderTabForTest(name, React, ReactDOMServer, overrides = {}) {
      const noop = async () => ({});
      // Mirror a Host without the newest locale pack: known keys use the
      // client-side fallbacks, everything else renders as the key itself.
      const t = (key, params) => {
        const template = CLIENT_MESSAGES[key] || key;
        return params ? fillParams(template, params) : template;
      };
      const tabs = { ProvinceTab, MapTab, BatchTab, EventsTab, DecisionsTab, DiplomacyTab, MissionsTab, IdeasTab, ValidateTab, MechanicTab };
      const component = tabs[name];
      if (!component) throw new Error('unknown tab: ' + name);
      const defaults = {
        triggers: [], effects: [], modifiers: [], modifierTree: [], categories: [], techGroups: [],
        governments: [], religions: [{ value: 'catholic', label: 'catholic' }], cultures: [], cultureGroups: [],
      };
      const dictionary = { ...defaults, ...(overrides.dictionary || {}) };
      const element = React.createElement(component, { setErr: () => {}, state: overrides.state ?? null });
      const withTag = React.createElement(TagContext.Provider, { value: { activeTag: overrides.activeTag || '', setActiveTag: noop } }, element);
      const withClipboard = React.createElement(ClipboardContext.Provider, { value: { register: () => () => {} } }, withTag);
      const withQueue = React.createElement(QueueContext.Provider, { value: { queue: [], count: 0, enqueue: noop, refresh: noop } }, withClipboard);
      const withDictionary = React.createElement(DictionaryContext.Provider, { value: dictionary }, withQueue);
      const withLocale = React.createElement(LocaleContext.Provider, { value: { t, reload: noop } }, withDictionary);
      return ReactDOMServer.renderToStaticMarkup(withLocale);
    }

    return {
      inject: ['slots'],
      // Pure helpers, exported only so the headless tests can assert the
      // three-in-one label, the id/中文/English filter, and the form memory.
      testInternals: {
        normalizeProvinceText, provinceLabelOf, provinceCardText, provinceMatchScore, filterProvinces, renderTabForTest,
        rememberForm, updateFormMemory, formMemory, clearFormMemory, TAB_FORM_KEYS, ideasToSlots,
        filterModifierTree, modifierLabelFrom, ModifierTreeSelector,
        filterEventCatalog, eventCatalogLabel, EventSelect,
        durationPartDays, durationToNative, durationSplit, normalizePayloadEffects, effectiveTargetTag, syncProvinceController,
        decisionConfigOf, DecisionsTab, DiplomacyTab, DIPLOMACY_RELATIONS, diplomacyValidation, conditionPlaceholder, conditionPayload, conditionPayloads,
        AutoTextArea, clampTextareaHeight, insertYmlTool, readbackLabel, NeighborPicker, Panel,
      },
      apply(ctx) {
        // Slots are declared by the entries that own them, which may activate
        // before or after this plugin. `slots.inject` defers each registration
        // until its slot declaration exists, and its disposer is bound to this
        // plugin's fiber. Registering directly here fails the whole web boot
        // with `slot "main" is not declared` when the layout entry starts later.
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main', key: 'eu4-workbench',
        }, Panel));
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: 'eu4-workbench', order: 25,
          label: () => SIDEBAR_LABEL,
        }, Icon));
      },
    };
  },
});
