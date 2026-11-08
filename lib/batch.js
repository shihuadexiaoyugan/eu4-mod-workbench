/**
 * Global change queue: collect edits from every panel and build one clean,
 * sectioned Agent prompt. Data is pure JSON; no prose is mixed into the items.
 */
import { normalizeEffectForPayload } from './ai.js'

                                                                                                                                                                                                               
                                                         

                             
            
                          
                      
                  
                     
                               
                    
 

export const MAX_BATCH_TOKENS = 2000

/**
 * Optional, display-only helpers for the prompt text. They never enter the
 * JSON payload or the generated script: the destination of every province
 * reference stays the numeric Province ID.
 */
                                     
                                                                                 
                                        
                                                           
                  
                                                                 
                  
                                                             
                       
                                                                                 
                    
                                                                                 
                         
 

const TARGET_LABEL                               = {
  event: 'event (events/*.txt)',
  mission: 'mission (missions/*.txt)',
  decision: 'country decision (decisions/*.txt)',
  mechanic: 'mechanic (common/event_modifiers/<name>.txt)',
  gui: 'gui (.gui + .gfx + .yml)',
  province_history: 'province history (history/provinces/[ID] - [Name].txt)',
  country_history: 'country history (history/countries/[TAG] - [Name].txt)',
  new_tag: 'new country tag (tag + country definition + history + localisation)',
  national_ideas: 'national ideas (common/ideas/<TAG>_ideas.txt + localisation)',
  government_reform: 'government reform (common/governments/00_reforms.txt + localisation)',
  tag_government: 'tag government (history/countries/[TAG] - [Name].txt + localisation)',
  diplomacy: 'opening diplomacy (history/diplomacy | history/wars | on_actions)',
}

/** Days-only duration normalisation for queued effect lists. */
function normalizeChangeDurations(item            )             {
  const data = (item.data || {})                       
  if (!data || typeof data !== 'object') return item
  const clone = JSON.parse(JSON.stringify(data))
  if (item.targetType === 'province_history' && clone.owner) clone.controller = clone.owner
  const fix = (effects       ) => (Array.isArray(effects) ? effects.map((effect) => normalizeEffectForPayload(effect)) : effects)
  if (Array.isArray(clone.options)) clone.options = clone.options.map((option     ) => ({ ...option, effects: fix(option.effects) }))
  if (Array.isArray(clone.effects)) clone.effects = fix(clone.effects)
  if (Array.isArray(clone.nodes)) clone.nodes = clone.nodes.map((node     ) => ({ ...node, rewards: fix(node.rewards) }))
  return { ...item, data: clone }
}

/** Target-specific warnings appended to each numbered task. */
function targetNotes(item            , hasProvinceHint = false, startDate = '1437.1.1', activeLanguage = 'l_english')           {
  const data = (item.data || {})                           
  // Deletion has two very different meanings: remove a node vs remove the file.
  const looksLikePath = (value         )          => /[\\/]/.test(String(value || '')) || /\.txt$/i.test(String(value || ''))
  if (item.action === 'delete') {
    const rel = String(item.targetFile || data.file || item.targetId || '')
    const deleteFile = data.deleteFile === true || looksLikePath(item.targetId)
    if (deleteFile) {
      return [
        '- 操作类型：删除整个文件。',
        '- 直接删除 `' + rel + '`；如果它是原版覆盖文件，删除后原版内容会恢复，符合预期。',
        '- 不要动同一目录下的其他文件。',
      ]
    }
    const id = String(data.deleteNodeId || item.targetId || '')
    return [
      '- 操作类型：删除节点（不是删除文件）。',
      '- 在 `' + rel + '` 中精准定位 ID 为 `' + id + '` 的代码块（从 `' + id + ' = {` 到匹配的 `}`），完整删除。',
      '- 保留文件中的其他代码与注释，绝对不能覆盖整个文件；删除后检查括号闭合。',
      '- 若该文件来自原版：先把原版同名文件完整复制到 Mod 同路径，再删除目标节点（完整覆盖）。',
      '- 删除后调用 eu4_readback（action=delete）确认该 ID 已不存在。',
    ]
  }
  if (item.targetType === 'diplomacy') {
    const a = String(data.tagA || '').trim().toUpperCase()
    const b = String(data.tagB || '').trim().toUpperCase()
    const rel = String(data.relationType || '').trim().toLowerCase()
    const extra = String(data.extraParams || '').trim()
    const date = String(data.startDate || startDate || '1437.1.1')
    if (rel === 'war') {
      const cb = extra || 'cb_conquest'
      return [
        '- 目标文件：`history/wars/zz_eu4_workbench_diplomacy_wars.txt`（Mod 文件；严禁修改原版 history/wars）。',
        '- 注意：EU4 的 `history/diplomacy` 不支持 war 关系；战争必须写在 history/wars 的日期块中：',
        '```',
        'name = "' + a + ' - ' + b + ' War"',
        'war_goal = {',
        '    type = take_border',
        '    casus_belli = ' + cb,
        '}',
        '',
        date + ' = {',
        '    add_attacker = ' + a,
        '    add_defender = ' + b,
        '}',
        '```',
        '- 战争必须包含双方：add_attacker 与 add_defender；casus_belli 使用 extraParams（当前 ' + cb + '）。',
        '- 若同名战争已存在则合并，不要重复开战；不要覆盖其他战争文件内容。',
        '- 生成后调用 validate_script 检查语法与括号闭合，再回读验证 attacker/defender/cb。',
      ]
    }
    if (rel === 'truce' || rel === 'rival') {
      const effect = rel === 'truce' ? 'add_truce_with' : 'add_historical_rival'
      return [
        '- 目标文件：`common/on_actions/zz_eu4_workbench_on_actions.txt`（Mod 文件；严禁修改原版 on_actions）。',
        '- 注意：EU4 的 `history/diplomacy` 不支持 ' + rel + '；必须在 on_startup 的 effect 中执行：',
        '```',
        'if = { limit = { exists = ' + a + ' } ' + a + ' = { ' + effect + ' = ' + b + ' } }',
        'if = { limit = { exists = ' + b + ' } ' + b + ' = { ' + effect + ' = ' + a + ' } }',
        '```',
        rel === 'truce'
          ? '- 停战必须双向绑定（两边都 add_truce_with）；EU4 的 add_truce_with 默认 5 年，无法精确指定 extraParams 结束年份，结束年份字段仅作记录。'
          : '- 宿敌必须双向绑定（两边都 add_historical_rival）；不要改原版 history/countries。',
        '- 若文件已有 on_startup = { effect = { ... } }，把 if 块合并进去，不要重复定义 on_startup。',
        '- 生成后调用 validate_script 检查语法与括号闭合，再回读验证两个方向。',
      ]
    }
    const native = rel === 'royal_marriage' ? 'royal_marriage' : rel === 'union' ? 'union' : rel
    const directional = rel === 'vassal'
      ? '- first 是宗主（overlord），second 是附庸（vassal）；若 JSON 的 tagA 实际是附庸，必须交换 first/second 并在报告中说明。'
      : rel === 'union'
        ? '- first 是联统主导国（senior），second 是被联统国（junior）；不要写反。'
        : rel === 'guarantee'
          ? '- first 是保障国（guarantor），second 是被保障国（guaranteed）。'
          : '- first/second 必须同时写，不能只写单边；同盟/联姻/保障为对称关系。'
    return [
      '- 目标文件：`history/diplomacy/zz_eu4_workbench_diplomacy.txt`（Mod 文件；严禁修改原版 history/diplomacy）。',
      '- 关键：EU4 的 history/diplomacy 不使用日期块！不要写 `' + date + ' = { ... }`；每个关系块内写 `start_date = ' + date + '`。',
      '- 生成原生块：',
      '```',
      native + ' = {',
      '    first = ' + a,
      '    second = ' + b,
      '    start_date = ' + date,
      '}',
      '```',
      directional,
      '- 同一对国家若已有 alliance / royal_marriage 等块，合并到同一块，不重复；保留文件其他关系与注释。',
      '- 双向绑定：一个关系块同时包含 first 与 second，不写反向重复块。',
      '- 生成后调用 validate_script 检查语法与括号闭合，再回读验证 first/second/start_date。',
    ]
  }
  if (item.targetType === 'province_history') {
    const date = String((data                       ).date || startDate || '1437.1.1')
    const notes = [
      '- 将 JSON 的英文 Key 转为原生代码，如 `base_tax = 5`、`owner = BOH`、`religion = hussite`。',
      '- 省份历史必须写在日期块内：`' + date + ' = { owner = X controller = X ... }`；`owner` 与 `controller` 必须同时写且值一致（只改 owner 不改 controller，游戏内仍会被原占领）。',
      '- 严格遵守 `1444.11.11` 等年份分段：不要删除、重排或破坏其他日期块与注释。',
    ]
    if (data.name_cn || data.name_en || data.name || data.localisation === true) {
      notes.push('- 省份名称本地化：在对应语言的 `localisation/` 文件中写入 `PROV<id>:0 "中文名"` / `PROV<id>:0 "英文名"`；数字省份 ID 不得改变。')
    }
    if (hasProvinceHint) {
      notes.push('- `province_hint` 只用于识别省份：脚本里一律写数字 ID（`owner = BOH`、`add_core = BOH` 作用于该数字省份），禁止把中文名当 ID 使用。')
    }
    return notes
  }
  if (item.targetType === 'country_history') {
    const notes = [
      '- 将 JSON 的英文 Key 转为原生代码，如 `government = ...`、`religion = ...`、`technology_group = ...`。',
      '- 生成/保留 `monarch = { name = "..." adm = N dip = N mil = N ... }`；妥善处理 `death_date`、继承人逻辑，不得删除既有君主。',
    ]
    if (data.name || data.localisation === true) {
      notes.push('- 国家改名/新建：同时在 `localisation/` 下补全中文与英文国家名称键值。')
    }
    return notes
  }
  if (item.targetType === 'new_tag') {
    return [
      '- 必须按顺序生成四个文件：',
      '  1) `common/country_tags/00_countries.txt`：注册 Tag；',
      '  2) `common/countries/<TAG>.txt`：国家定义；',
      '  3) `history/countries/<TAG> - <Name>.txt`：国家历史；',
      '  4) `localisation/`：中文与英文国家名称键值。',
      '- 在报告中提醒玩家自行放入国旗 `gfx/flags/<TAG>.tga`（本工具不会生成图片）。',
      '- 创建 `monarch` 时处理出生/死亡日期与继承人。',
    ]
  }
  if (item.targetType === 'national_ideas') {
    return [
      '- 完整覆盖该国的国家理念块：恰好 2 条 tradition、1 条 ambition、7 条 ideas；不得保留旧条目或遗漏。',
      '- 每个 `modifier` 必须是英文原生 key（如 `land_morale`、`discipline`），数值原样写入，不要写 JSON。',
      '- 一个理念可有多条修正：JSON 里是 `{ "modifier": "...", "value": 0.1 }` 表示一条，`{ "modifiers": [ ... ] }` 表示多条；按顺序全部写入同一块。',
      '- 本地化联动：为 `<tag>_ideas_title` 以及每个理念的 `name`/`desc` 写 localisation 键值；7 条理念的名称与描述必须完整。',
    ]
  }
  if (item.targetType === 'government_reform') {
    return [
      '- 目标文件：`common/governments/00_reforms.txt`（或任务给出的 target_file）。必须**追加** `[id] = { ... }`，不得覆盖、删除或重排文件中的其他改革。',
      '- 生成 `tier = N`、`potential = { government = <potential_government> }`（若为空则省略 potential），并把 modifiers 写成 `modifier = value` 行。',
      '- 本地化联动：在 `localisation/` 补齐改革的 `<id>_name` 与 `<id>_desc` 键值。',
    ]
  }
  if (item.targetType === 'tag_government') {
    return [
      '- 政体定义位于 `common/governments/00_governments.txt`；若 government_type 是自定义或不存在，先在该文件创建或定位对应政体块。',
      '- 目标文件为 `history/countries/[TAG] - [Name].txt`；将 `government = <government_type>` 精准插入或替换。',
      '- 为 reforms 列表中的每个改革追加 `add_government_reform = <reform_id>`；不要破坏原有君主、首都、日期分段等设定。',
      '- 本地化联动：确保相关改革/政体的 `_name` 与 `_desc` 键存在；修改国家名称时同步更新国家名键。',
    ]
  }
  if (item.targetType === 'mechanic') {
    const name = String(data.name || item.targetId || '').trim()
    const nameZh = String(data.nameZh || '').trim()
    const stats = data.stats && typeof data.stats === 'object' ? data.stats                            : {}
    const statLines = Object.entries(stats).map(([key, value]) => '`' + key + ' = ' + value + '`')
    if (item.action === 'delete') {
      return ['- 删除 `common/event_modifiers/' + name + '.txt` 中的修正 `' + name + '` 定义，保留文件内其他修正。']
    }
    const notes = [
      '- 在 `common/event_modifiers/' + name + '.txt` 写入/替换修正块 `' + name + ' = { ... }`：每个属性一行（' + (statLines.join('、') || '（沿用现有属性）') + '），不要写 JSON。',
    ]
    if (nameZh) {
      notes.push('- 本地化：在 `localisation/` 的 `l_simp_chinese` 块写入 `' + name + ':0 "' + nameZh + '"`（UTF-8 BOM；已有语言文件则追加）。')
    }
    notes.push('- 该修正会被事件 effect 以 `add_country_modifier = { name = ' + name + ' duration = <纯天数> }` 引用；不要把 duration 写进修正文件。')
    return notes
  }
  if (item.targetType === 'gui') {
    return ['- 同步修改 `.gui` + `.gfx` + `.yml`；不要生成或转换图片。']
  }
  if (item.targetType === 'mission') {
    const removed = Array.isArray(data.removedNodeIds) ? data.removedNodeIds.map(String).filter(Boolean) : []
    if (removed.length) {
      return [
        '- 保持 `required_missions` 链接完整。',
        '- 操作类型：删除节点。在 `' + String(item.targetFile || data.file || '') + '` 中删除以下任务节点：' + removed.join(', ') + '；保留其他任务与注释，不要整文件覆盖。',
        '- 若这些节点来自原版文件：先把原版同名文件完整复制到 Mod 同路径，再删除（完整覆盖）。',
        '- 删除后调用 eu4_readback（action=modify, removedNodeIds）确认这些 ID 已不存在。',
      ]
    }
    return ['- 保持 `required_missions` 链接完整，不要删除其他任务节点。']
  }
  if (item.targetType === 'decision') {
    const id = String(data.id || item.targetId || '').trim()
    const title = String(data.title_cn || '').trim()
    const desc = String(data.desc_cn || '').trim()
    const ai = data.ai_will_do === undefined || data.ai_will_do === '' ? '1' : String(data.ai_will_do)
    if (item.action === 'delete') {
      return ['- 删除 `decisions/` 中 `country_decisions = { ' + id + ' = { … } }` 的整个决议块，保留文件内其他决议与注释。']
    }
    return [
      '- 只写入 Mod 的 `decisions/` 目录（' + (item.targetFile || 'decisions/…txt') + '），禁止修改原版文件。',
      '- 结构必须是 `country_decisions = { ' + id + ' = { potential = { … } allow = { … } effect = { … } ai_will_do = { factor = ' + ai + ' } } }`。',
      '- potential 只决定「是否可见」；allow 决定「是否可点击」。不要把 allow 的条件写进 potential，反之亦然。',
      '- effect 由 effects JSON 翻译；`ai_will_do = { factor = ' + ai + ' }`（0 = AI 永不选择）。',
      title ? '- 本地化：`' + id + '_title:0 "' + title + '"`（`l_simp_chinese`，UTF-8 BOM）。' : '- 本地化：补 `<id>_title`。',
      desc ? '- 本地化：`' + id + '_desc:0 "' + desc + '"`。' : '- 本地化：补 `<id>_desc`。',
      '- 生成后调用 validate_script，确认括号闭合与作用域正确。',
    ]
  }
  if (item.targetType === 'event') {
    const id = String(data.id || item.targetId || '').trim()
    const titleKey = id + '.t'
    const descKey = id + '.d'
    const titleText = String(data.title || '')
    const descText = String(data.desc || '')
    const triggerMode = data.triggerMode === 'startup' ? 'startup' : 'normal'
    const targetTag = String(data.targetTag || '').trim().toUpperCase() || '<TARGET_TAG>'
    const bindDate = /^\d{1,4}\.\d{1,2}\.\d{1,2}$/.test(String(data.bindDate || '').trim())
      ? String(data.bindDate).trim()
      : '1437.1.1'
    const localisationFile = String(data.localisationFile || '').trim()
      || 'localisation/zz_eu4_workbench_l_simp_chinese.yml'
    const historyFile = 'history/countries/' + targetTag + '.txt'
    const historyLine = bindDate + ' = { country_event = { id = ' + id + ' days = 0 } }'
    const notes = [
      '- 事件块必须完整：`country_event = { id = … title = "<ID>.t" desc = "<ID>.d" … }`，以匹配的 `}` 结尾；title/desc 紧跟 id。',
      '- 文件顶部必须写 `namespace = <ID 前缀>`（EU4 语法，不是 `add_namespace`）；缺少 namespace 会导致游戏忽略整个文件。',
      '- option 的 name 必须是 `<ID>.a` / `<ID>.b` 这类本地化键，不能写中文文本。',
      '- 事件标题/描述必须是带引号的本地化键：`title = "' + titleKey + '"`、`desc = "' + descKey + '"`；事件 `.txt` 里禁止出现中文。',
      '- 本地化：在 `' + localisationFile + '` 的 `l_simp_chinese` 块写入 `' + titleKey + ':0 "' + titleText + '"` 与 `' + descKey + ':0 "' + descText + '"`（UTF-8 BOM；已有语言文件则追加）。',
      '- 强制：本地化文件必须是 UTF-8 with BOM（首字节 EF BB BF），大小必须 >3 字节；冒号后必须有一个英文空格 `:0 "..."`；键名必须与事件 .txt 的 title/desc 完全一致。',
      ...(activeLanguage && activeLanguage !== 'l_simp_chinese'
        ? ['- 当前游戏语言是 `' + activeLanguage + '`：必须同时把相同的中文键写入 `localisation/zz_eu4_workbench_' + activeLanguage + '.yml`（头 `' + activeLanguage + ':`，UTF-8 BOM）。否则游戏会显示英文。']
        : []),
    ]
    if (triggerMode === 'startup') {
      notes.push('- 触发方式：写 `is_triggered_only = yes`，不要写 `mean_time_to_happen`。')
      notes.push('- 开局强触发：`' + historyFile + '` 已有 `' + bindDate + ' = {` 区块时，把 `' + historyLine + '` **合并进已有区块**；只有不存在时才新建日期块。重复日期块可能被游戏忽略，保留原有君主与注释。')
      notes.push(
        "Generate an event with is_triggered_only = yes. Ensure title is '"
        + titleKey + "' and desc is '" + descKey
        + "'. Update the localisation yml file with the provided Chinese text. Also, modify '"
        + historyFile + "': if a '" + bindDate + " = {' block already exists, merge 'country_event = { id = " + id + " days = 0 }' into it; otherwise append the block at the end of the file.",
      )
    }
    const modifierRefs = [...new Set(
      (Array.isArray(data.options) ? data.options : [])
        .flatMap((option     ) => (option && Array.isArray(option.effects) ? option.effects : []))
        .filter((effect     ) => effect && effect.effect === 'add_country_modifier' && effect.params && effect.params.name)
        .map((effect     ) => String(effect.params.name)),
    )]
    if (modifierRefs.length) {
      notes.push('- 事件 effect 写成 `add_country_modifier = { name = ' + modifierRefs.join(' / ') + ' duration = <纯天数> }`；修正定义由对应的 mechanic 任务生成，不要在事件里重复定义。')
    }
    notes.push('- `add_country_modifier.duration` 单位是天：5 年 = 1825；若 JSON 只给了 years，必须 ×365，绝不能把年数直接写成 duration。')
    if (triggerMode === 'startup') {
      notes.push('- 该事件是 is_triggered_only：必须确认 history/countries 文件里存在对应的 country_event 触发行，否则游戏内永远不会触发。')
      notes.push('- on_startup 兜底：在 `common/on_actions/zz_eu4_workbench_on_actions.txt` 写入以下内容；若文件已有 on_startup，把新的 if 块合并进已有 on_startup = { effect = { ... } }，不要重复定义 on_startup：')
      notes.push('```')
      notes.push('on_startup = {')
      notes.push('    effect = {')
      notes.push('        if = {')
      notes.push('            limit = { exists = ' + targetTag + ' }')
      notes.push('            ' + targetTag + ' = { country_event = { id = ' + id + ' days = 1 } }')
      notes.push('        }')
      notes.push('    }')
      notes.push('}')
      notes.push('```')
    }
    notes.push('- 生成后检查 `is_triggered_only`：若有该标记，必须有 history/on_action/effect 触发；同时确认 `<ID>.t` / `<ID>.d` 已写入本地化。')
    notes.push('- 相邻省份条件写成 `any_neighbor_province = { province_id = <数字ID> }`；不要写中文省名或裸 ID。')
    notes.push('- 条件 JSON 用 `condition` 字段：`controls` 必须生成 `controls = <省份ID>`，绝不能被写成 `owns`；`owns` 保持 `owns = <省份ID>`。')
    return notes
  }
  return ['- 只替换目标事件块，保留其他事件与注释。']
}

export function buildBatchPrompt(items              , options                     = {})   
                
                                    
                                                                     
  {
  const list = (Array.isArray(items) ? items.filter((item) => item && item.targetType && item.targetId) : [])
    .map(normalizeChangeDurations)
  if (!list.length) throw new Error('change queue is empty')

  const payload = { changes: list }
  const targets = [...new Set(list.map((item) => item.targetType))]

  /** Display-only province hint: "[2664] 皮尔森 (Plzeň)". */
  const provinceHint = (item            )         => {
    const labeler = options?.provinceLabel
    if (!labeler || item.targetType !== 'province_history') return ''
    const id = Number(item.targetId ?? (item.data                                       )?.id)
    if (!Number.isFinite(id)) return ''
    let label = ''
    try { label = String(labeler(id) || '').trim() } catch { label = '' }
    if (!label) return ''
    return 'province_hint: ' + label + '  (仅供理解：脚本必须写数字 ID ' + id + ')'
  }

  // Task list deliberately contains NO JSON; all configuration JSON is emitted
  // once, at the very end of the prompt, to keep the cached prefix stable.
  const tasks = list.map((item, index) => {
    const hint = provinceHint(item)
    return [
      '[Change ' + (index + 1) + ']',
      'task: ' + (item.targetType === 'province_history' ? '修改省份历史'
        : item.targetType === 'country_history' ? '修改国家历史'
        : item.targetType === 'new_tag' ? '新建全新国家 Tag'
        : item.targetType === 'national_ideas' ? '配置国家理念'
        : item.targetType === 'government_reform' ? '新建/修改政府改革'
        : item.targetType === 'tag_government' ? '将政体/改革绑定给国家'
        : item.targetType === 'mechanic' ? '修改机制/修正'
        : item.targetType === 'decision' ? '新建/修改国家决议'
        : item.targetType === 'gui' ? '修改 GUI'
        : item.targetType === 'mission' ? '修改任务树'
        : item.targetType === 'event' && item.action === 'delete' ? '删除事件'
        : '修改事件'),
      'target_type: ' + item.targetType + '  (' + TARGET_LABEL[item.targetType] + ')',
      'action: ' + item.action,
      'target_id: ' + item.targetId,
      hint,
      item.targetFile ? 'target_file: ' + item.targetFile : '',
      ...targetNotes(item, Boolean(hint), options.startDate, options.activeLanguage),
      '',
    ].filter(Boolean).join('\n')
  }).join('\n')

  /** Explicit two-step instruction for new modifiers created from an effect. */
  const newModifiers = list.filter((item) => item.targetType === 'mechanic' && item.data && (item.data       ).newModifier === true)
  const modifierBlock           = []
  if (newModifiers.length) {
    const refs           = []
    for (const eventItem of list) {
      const data = (eventItem.data || {})                       
      const effects = [
        ...(Array.isArray(data.options) ? data.options.flatMap((option     ) => (Array.isArray(option.effects) ? option.effects : [])) : []),
        ...(Array.isArray(data.nodes) ? data.nodes.flatMap((node     ) => (Array.isArray(node.rewards) ? node.rewards : [])) : []),
        ...(Array.isArray(data.effects) ? data.effects : []),
      ]
      for (const effect of effects) {
        if (!effect || effect.effect !== 'add_country_modifier') continue
        const params = effect.params || {}
        const name = String(params.name || '')
        if (!name || !newModifiers.some((mod) => mod.targetId === name)) continue
        const duration = String(params.duration || '0').replace(/[^\d]/g, '') || '0'
        const ref = name + '|' + eventItem.targetId + '|' + duration
        if (!refs.includes(ref)) refs.push(ref)
      }
    }
    modifierBlock.push(
      '[New modifier tasks / 新修正强指令]',
      ...newModifiers.map((mod) => {
        const d = (mod.data || {})                       
        const stats = Object.entries(d.stats || {}).map(([key, value]) => key + ' = ' + value).join('、')
        const zh = String(d.nameZh || '').trim()
        return '任务：在 `common/event_modifiers/' + mod.targetId + '.txt` 生成新修正 `' + mod.targetId + '`，属性：'
          + (stats || '（无）')
          + (zh ? '；并在本地化文件补充显示名 `' + mod.targetId + ':0 "' + zh + '"`。' : '。')
      }),
      ...refs.map((ref) => {
        const [name, eventId, duration] = ref.split('|')
        return '任务：在事件 `' + eventId + '` 的选项 effect 中添加 `add_country_modifier = { name = ' + name + ' duration = ' + duration + ' }`，并调用 validate_script 检查语法。'
      }),
      '',
    )
  }

  const prompt = [
    '你是一个 EU4 Mod 脚本专家。请将以下结构化配置，精准翻译为 EU4 的原生脚本代码，并安全写入对应文件。',
    '不要直接写 JSON；JSON 只是配置数据，最终输出必须是可写入的 .txt 原生脚本。',
    '必须严格按任务顺序执行；不得合并、重排、改名或丢弃任何 ChangeItem。',
    '每个任务都给出精确目标文件；禁止搜索相似文件名或凭记忆猜测路径。',
    '',
    ...(options.modRoot ? [
      '[Path contract / 路径契约]',
      '- Mod root（唯一可写目录）: ' + options.modRoot,
      ...(options.modVerified === false ? ['- ⛔ Mod directory is INVALID (descriptor.mod missing). Stop and report the error; do not write anything.'] : ['- Mod directory verified: descriptor.mod found.']),
      ...(options.eu4Root ? ['- Forbidden（原版，只读）: ' + options.eu4Root] : []),
      '- 每个输出文件都必须位于 Mod root 之下；禁止写入原版目录，也不要写到桌面或临时目录。',
      '- 写入后必须对每个文件调用 eu4_verify_path；若返回 ok=false（例如误写到原版目录），立即回滚并报错。',
      '- 最终报告必须列出每个已写入文件的绝对路径；如果发现路径不在 Mod root 内，立即停止并报错，不要继续。',
      '- 修改/删除前必须先 read 目标文件，确认目标节点存在，再精确替换或删除整个块；禁止“只写部分文件”然后声称已删除。',
      '- 删除原版任务/事件时，必须把原版同名文件完整复制到 Mod 的同路径，再删除目标节点（完整覆盖）；只在 Mod 里新写一个不含该节点的文件不会删除原版内容，原版仍会透传。',
      '- 写入后必须回读校验：调用 eu4_readback（或 POST /api/verify/readback）确认目标存在/已删除，并在报告中给出绝对路径与文件大小。',
      '',
    ] : []),
    '[Task list / 任务列表]',
    tasks,
    ...modifierBlock,
    '[Execution rules / 通用校验规则]',
    '1. 将 JSON 的英文 Key 转为 EU4 原生代码，如 `base_tax = 5`、`owner = BOH`、`primary_culture = czech`；不要把 JSON 原样写进 .txt。',
    '2. 生成代码前，务必使用 clausewitz-mcp 查询不确定的语法与作用域。',
    '3. 生成代码后，务必调用 validate_script 校验括号闭合、作用域和 trigger/effect 混用。',
    '4. 省份历史必须保留 `1444.11.11 = { ... }` 等原有年份分段；不得删除、重排或覆盖其他日期块。',
    '5. 国家历史必须保留既有君主、配偶、继承人及其 `death_date`，除非 JSON 明确要求替换。',
    '6. 新建 Tag 必须按顺序生成四个文件：注册 Tag、国家定义、国家历史、本地化文本；并在报告中提醒玩家自行放入 `gfx/flags/<TAG>.tga` 国旗。',
    '7. 若修改名称或新建国家/省份，必须在 `localisation/` 补全中文与英文名称键值。',
    '8. `data.rawScript` 若存在，是用户已确认的源码：按原文应用，只修复校验错误。',
    '9. 最终输出总结报告；不要重复本 Prompt 或 JSON。',
    '10. 硬性输出上限：max_tokens = ' + MAX_BATCH_TOKENS + '，每项报告保持简短。',
    '11. `province_hint` 或括号里的中文名只供识别：脚本中的省份引用必须是纯数字 ID（如 `2664`），不得用文本替代。',
    '12. 触发事件的 effect 必须写成 `country_event = { id = 事件ID days = 延迟天数 }`：`id` 是带点的字符串（如 `hus_event.1`），`days` 为整数（默认 0）；禁止写成 `country_event = 43` 这类纯数字。',
    '',
    '[Report / 总结报告]',
    '按任务编号输出：目标、精确文件、行号范围、validate_script 校验结果。',
    '',
    '[Batch JSON — 唯一配置数据，故意放在 Prompt 最末尾]',
    '```json',
    JSON.stringify(payload, null, 2),
    '```',
  ].join('\n')

  return { prompt, payload, meta: { count: list.length, maxTokens: MAX_BATCH_TOKENS, targets } }
}

/** Requested public name for the batch builder. */
export const buildBatchAIPayload = buildBatchPrompt
