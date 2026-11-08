/**
 * AI payload builder — turns a structured edit form into a ready-to-use prompt.
 *
 * This module is pure: it never reads or writes a file. The Web panel (or the
 * `plugin_manager`-installed tool) sends the form JSON here, and the result is
 * either copied into the conversation or stored as a pending edit that the
 * agent can fetch with `eu4_pending_edit`.
 *
 * The prompt deliberately carries the file path, the target block id, the
 * structured intent, and the verification steps, so an agent can locate and
 * apply the change without guessing.
 */
import { buildRawPreview } from './nl2code.js';

                                                                
                                                        

                                                       

/**
 * Form data for the GUI panel. The panel only collects parameters; the prompt
 * tells the agent how to write the `.gui` and register the image in `.gfx`.
 * Images are the user's responsibility — the agent never generates binaries.
 */
                            
                   
                                                
               
                                                                                                     
                    
                                                    
                       
                                                          
                      
                                                                     
                  
                                                                               
                      
                                                                          
                 
                  
                                                              
                       
                                                
                               
                                                      
                      
                                                         
                                    
                                            
                 
                      
 

                                  
                                                                              
               
                                     
                 
                                                   
                               
                                                                      
               
                                                                     
                    
                                                          
                    
 

                               
                 
                 
                                                                         
                                  
                                                                                      
               
                    
                    
 

                                  
               
                          
 

                                
                                                                                 
               
             
                
                     
                 
                
                   
                         
                  
                                                    
                                     
                                                                              
                     
                                                  
                    
                                                   
                            
                                 
                              
                                                                 
                    
                                                                    
                      
 

                                 
                                                                    
                
             
                    
                   
                
                           
                                
                             
                            
                           
                               
                            
 

/** Opening diplomacy relation (history/diplomacy, history/wars or on_startup). */
                                  
              
              
                      
                     
                   
 

                                  
             
                
                
                       
                      
                                 
                           
                                                                                         
                  
 

                                  
               
                      
                            
 

                                  
                 
                     
                 
                                   
         
                 
                   
                             
                                                  
                      
    
 

/** Hard limit for a single Agent generation (tokens, output side). */
export const MAX_AI_TOKENS = 1000;
/** Only this many lines of the target block are ever sent to the model. */
export const MAX_ORIGINAL_LINES = 100;

const ACTION_LABELS                             = {
  create: 'Create',
  update: 'Update (replace the target block)',
  delete: 'Delete',
};

function requiredString(value         , field        )         {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`missing required field: ${field}`);
  return text;
}

function clip(text                    , max = MAX_ORIGINAL_LINES)         {
  const value = String(text ?? '');
  const lines = value.split('\n');
  if (lines.length <= max) return value;
  return lines.slice(0, max).join('\n') + `\n... (truncated to ${max} lines to save tokens)`;
}

function activeTagOf(data                   )                {
  const tag = String(data.tag ?? '').trim().toUpperCase();
  return /^[A-Z0-9]{3}$/.test(tag) ? tag : null;
}

function commonRules()           {
  return [
    '1. Read [File] first and locate the target block and line range; replace only that block and preserve every other event, mission, comment and indentation.',
    '2. Run validate_script on the generated script before writing; fix scope errors and trigger/effect misuse.',
    '3. Run check_loc_keys for title/desc localisation keys; add missing keys to the correct localisation file.',
    '4. Run validate_script again after writing, then re-read the target block and confirm braces and indentation.',
    '5. Report the file path, line numbers, a change summary and both validation results; never claim success without running validation.',
  ];
}

function eventPrompt(action            , data               )                  {
  const file = requiredString(data.file, 'file');
  const id = requiredString(data.id, 'id');
  const kind = data.kind || 'country_event';
  const tag = activeTagOf(data);

  // title/desc are always the derived localisation keys; Chinese text lives in
  // the .yml only. The UI fields carry the Chinese text, not script fragments.
  const titleKey = id + '.t';
  const descKey = id + '.d';
  const triggerMode = data.triggerMode === 'startup' ? 'startup' : 'normal';
  const rawTarget = String(data.targetTag || '').trim().toUpperCase();
  const targetTag = /^[A-Z0-9]{3}$/.test(rawTarget) ? rawTarget : (tag || '');
  const bindDate = /^\d{1,4}\.\d{1,2}\.\d{1,2}$/.test(String(data.bindDate || '').trim())
    ? String(data.bindDate).trim()
    : '1437.1.1';
  const localisationFile = String(data.localisationFile || '').trim()
    || 'localisation/zz_eu4_workbench_l_simp_chinese.yml';
  const activeLanguage = String(data.activeLanguage || '').trim() || 'l_english';
  const activeLocalisationFile = activeLanguage === 'l_simp_chinese'
    ? ''
    : 'localisation/zz_eu4_workbench_' + activeLanguage + '.yml';
  const historyFile = targetTag ? 'history/countries/' + targetTag + '.txt' : 'history/countries/<TARGET_TAG>.txt';
  const historyLine = bindDate + ' = { country_event = { id = ' + id + ' days = 0 } }';

  const payload = {
    id,
    kind,
    namespace: data.namespace || id.split('.')[0] || '',
    title_key: titleKey,
    desc_key: descKey,
    title_zh: data.title || '',
    desc_zh: data.desc || '',
    picture: data.picture || '',
    trigger_mode: triggerMode,
    is_triggered_only: triggerMode === 'startup',
    ...(triggerMode === 'startup'
      ? { target_tag: targetTag, bind_date: bindDate, history_file: historyFile, history_line: historyLine }
      : {}),
    localisation_file: localisationFile,
    active_language: activeLanguage,
    ...(activeLocalisationFile ? { localisation_file_active: activeLocalisationFile } : {}),
    fire_only_once: data.fireOnlyOnce === true,
    major: data.major === true,
    conditions: data.conditions || [],
    options: (data.options || []).map((option) => ({
      name: option.name || '',
      effects: (option.effects || []).map(normalizeEffectForPayload),
    })),
  };

  const prompt = [
    'You are an EU4 modding assistant. Perform one EVENT edit and change only the target event block.',
    '',
    '[File] ' + file,
    '[Target] ' + kind + ' `' + id + '`',
    '[Action] ' + ACTION_LABELS[action],
    tag ? '[Active tag] ' + tag : '',
    '',
    ...(action === 'create'
      ? [
        '[Create mode] No existing file is sent. Build the block from the JSON below.',
        ...(data.examples && data.examples.length
          ? [
            '[Format references (structure only; do not copy ids or text)]',
            ...data.examples.slice(0, 2).map((example) => '```\n' + clip(example, 40) + '\n```'),
          ]
          : ['[Format reference] Use standard EU4 event structure: id/title/desc/trigger/option.']),
      ]
      : [
        '[Original event block (target only, max 100 lines; do not rewrite the whole file)]',
        '```',
        clip(data.original),
        '```',
      ]),
    '',
    '[Structured configuration (JSON; the final output must be valid EU4 script)]',
    '```json',
    JSON.stringify(payload, null, 2),
    '```',
    '',
    '[Localisation contract]',
    '- `title` must be exactly `' + titleKey + '` and `desc` exactly `' + descKey + '`, always double-quoted: `title = "' + titleKey + '"`, `desc = "' + descKey + '"`.',
    '- NEVER put Chinese text inside the event .txt file; the .txt only carries the keys above.',
    '- Forced Chinese file: `' + localisationFile + '` (create `localisation/` if missing). It MUST be UTF-8 with BOM (first bytes EF BB BF) and larger than 3 bytes; header `l_simp_chinese:`.',
    '- Exact format with one ASCII space after the colon: `' + titleKey + ':0 "中文标题"` and `' + descKey + ':0 "中文描述"`.',
    ...(activeLocalisationFile
      ? ['- The game language is `' + activeLanguage + '`: ALSO write the SAME Chinese keys into `' + activeLocalisationFile + '` with header `' + activeLanguage + ':` and UTF-8 BOM. Otherwise the game shows English.']
      : []),
    '- Check that the .txt title/desc keys and both .yml keys are identical; never write English text over the Chinese values.',
    '',
    '[Event shell (must match exactly)]',
    '```',
    kind + ' = {',
    '\tid = ' + id,
    '\ttitle = "' + titleKey + '"',
    '\tdesc = "' + descKey + '"',
    ...(triggerMode === 'startup' ? ['\tis_triggered_only = yes'] : []),
    '\ttrigger = { ... }   # only when conditions exist',
    '\toption = { ... }',
    '}',
    '```',
    '- The block MUST start with `' + kind + ' = {` and end with the matching `}`; title/desc come immediately after id.',
    '- conditions items use `{ condition, op, value }` (not `type`). Generate `<condition> <op> <value>`.',
    '- `controls` MUST become `controls = <province id>` and must NEVER be rewritten as `owns`; `owns` stays `owns = <province id>`.',
    '- `any_neighbor_province` becomes `any_neighbor_province = { province_id = <id> }`.',
    '- Option names must be localisation keys like `' + id + '.a` / `' + id + '.b`; never Chinese text.',
    '- `duration` is an integer number of DAYS: 5 years = 1825. If the JSON only gives years, multiply by 365; never write a year count into duration.',
    '',
    '[Namespace (required)]',
    '- The file top MUST contain `namespace = ' + (id.split('.')[0] || '') + '` before the first event block.',
    '- EU4 syntax is `namespace =`, NOT `add_namespace`; `add_namespace` is ignored by the game.',
    '- If the file already has a namespace, keep it; if missing, insert it once at the top; never hijack another namespace.',
    '',
    '[Trigger wiring]',
    '- If the event has `is_triggered_only = yes`, it MUST be fired by a country history bind (startup mode) or another script; otherwise it never fires.',
    '- Ensure title/desc keys `' + titleKey + '` / `' + descKey + '` exist in the .yml.',
    '',
    ...(triggerMode === 'startup'
      ? [
        '[Startup trigger (required)]',
        '- Generate the event with `is_triggered_only = yes`.',
        '- Do NOT write a `mean_time_to_happen` block.',
        '- In `' + historyFile + '`, merge `' + historyLine + '` into the existing `' + bindDate + ' = {` block when one exists; only append a new date block when the file has none. Duplicate date blocks can be ignored by the game.',
        '- Never rewrite existing monarchs, marriages, comments or other date blocks.',
        '  ' + historyLine,
        '- on_startup fallback: write or merge `common/on_actions/zz_eu4_workbench_on_actions.txt`:',
        '```',
        'on_startup = {',
        '    effect = {',
        '        if = {',
        '            limit = { exists = ' + targetTag + ' }',
        '            ' + targetTag + ' = { country_event = { id = ' + id + ' days = 1 } }',
        '        }',
        '    }',
        '}',
        '```',
        '- If the file already has an `on_startup` block, merge the new `if` block into it; never define `on_startup` twice.',
        '',
        '[Required instructions]',
        "Generate an event with is_triggered_only = yes. Ensure title is '" + titleKey + "' and desc is '" + descKey + "'. Update the localisation yml file with the provided Chinese text. Also, modify '" + historyFile + "': if a '" + bindDate + " = {' block already exists, merge 'country_event = { id = " + id + " days = 0 }' into it; otherwise append the block at the end of the file. Additionally, ensure 'common/on_actions/zz_eu4_workbench_on_actions.txt' contains an on_startup effect that fires this event for the target tag. Write the Chinese title/desc into the forced UTF-8-BOM file and, when the game language is not Chinese, into the active-language file as well.",
        '',
      ]
      : []),
    '[Field conventions]',
    '- conditions: {type, op, value} intents; owns = province ownership (value is a province id), year/is_year = year, tag = country tag, has_country_flag = flag, religion = religion, government = government, has_regency = regency, legitimacy = legitimacy, any_neighbor_province = neighbor check (value is the province id; write `any_neighbor_province = { province_id = <id> }`), custom = raw script line.',
    '- conditions may be nested: {type: "AND" | "OR" | "NOT", children: [...]} is a logical block; preserve the nesting from the JSON.',
    '- Nodes with complex=true or raw are source-mode fallbacks: keep their raw text verbatim instead of reinterpreting it.',
    '- options[].effects: {effect, value, params} intents; simple effects use value; add_country_modifier uses params.name (English id), params.nameZh (Chinese display name), params.duration (pure integer days; 1 year = 365) and optional params.stats (native values, e.g. {land_morale: "0.2"}). When params.stats is present and params.newModifier is true, create/update `common/event_modifiers/<name>.txt` with one `<key> = <value>` line per stat and add `<name>:0 "<nameZh>"` to the mod localisation; when newModifier is false, only reference the existing modifier. `newModifier`/`nameZh`/`existing`/`years`/`daysText` are UI metadata: never write them into the event .txt.',
    '- country_event / province_event / news_event: use params.id (event id string, e.g. "hus_event.1") and params.days (integer, default 0); write `country_event = { id = <id> days = <days> }`. Never write a bare number as the event id.',
    '- Omit picture when empty. Do not change the event id unless payload.id differs from the target; then create a new event and keep the old one.',
    '',
    '[Output limit] max_tokens = 1000. Return only the changed EU4 block plus the required verification report; no restatement of this prompt.',
    '',
    '[Verification (perform every step)]',
    ...commonRules(),
  ].filter(Boolean).join('\n');

  return {
    kind: 'event',
    action,
    prompt,
    payload,
    meta: { file, target: id, activeTag: tag, maxTokens: MAX_AI_TOKENS },
  };
}

function missionPrompt(action            , data                 )                  {
  const file = requiredString(data.file, 'file');
  const tag = activeTagOf(data);
  const nodes = (data.nodes || []).map((node) => ({
    id: String(node.id || '').trim(),
    slot: node.slot || '',
    name: node.name || node.id || '',
    description: node.description || '',
    required: node.required || [],
    conditions: node.conditions || [],
    rewards: node.rewards || [],
    isNew: node.isNew === true,
  }));
  const valid = nodes.filter((node) => node.id);
  if (!valid.length) throw new Error('missing required field: nodes (at least one sampled node)');
  const ids = valid.map((node) => node.id);

  const payload = { file, tag, nodes: valid };

  const prompt = [
    'You are an EU4 modding assistant. Add or update mission-tree nodes from the structured configuration.',
    '',
    '[File] ' + file,
    '[Target] mission node(s) ' + valid.map((node) => '`' + node.id + '`').join(', '),
    '[Action] ' + ACTION_LABELS[action],
    tag ? '[Active tag] ' + tag : '',
    '',
    '[Node configuration (JSON; the final output must be valid missions script)]',
    '```json',
    JSON.stringify(payload, null, 2),
    '```',
    '',
    '[Field conventions]',
    '- id = mission key; slot = mission slot/icon; name/description are display text or localisation keys.',
    '- isNew=true marks a node to add; isNew=false/absent marks a node to update in place (replace only that block).',
    '- required lists ids of other missions in the same tree; they must exist, cannot self-reference and must not form a cycle.',
    '- conditions: completion intents; use {type: "AND" | "OR" | "NOT", children: [...]} for logical blocks; nodes with complex=true/raw are source-mode fallbacks and must be kept verbatim.',
    '- rewards: {effect, value, params} intents; add_treasury = gold; add_country_modifier uses params.name (English id), params.nameZh, params.duration (pure integer days; 1 year = 365) and optional params.stats (native values); create/update `common/event_modifiers/<name>.txt` + localisation when params.newModifier is true. country_event uses params.id (event id string) and params.days (default 0); never a bare number.',
    '- localisation: if name/description are not existing keys, derive `<tree prefix>_<node id>.title` and `.desc`, then add them to the mod localisation files (follow the existing language-file style).',
    '',
    '[Output limit] max_tokens = 1000. Return only the changed node block(s) plus the required verification report.',
    '',
    '[Verification (perform every step)]',
    ...commonRules(),
  ].filter(Boolean).join('\n');

  return {
    kind: 'mission',
    action,
    prompt,
    payload,
    meta: { file, target: ids.join(','), activeTag: tag, maxTokens: MAX_AI_TOKENS },
  };
}

function guiPrompt(action            , data           )                  {
  const name = requiredString(data.name, 'name');
  const imagePath = requiredString(data.imagePath, 'imagePath');
  const guiType          = data.guiType === 'custom-panel' ? 'custom-panel' : 'topbar-button';
  const slug = name.toLowerCase().replace(/[^a-z0-9_]+/g, '_') || 'custom_gui';
  const defaultFile = guiType === 'topbar-button' ? 'interface/topbar.gui' : `interface/${slug}.gui`;
  const file = String(data.targetFile || defaultFile).trim();
  const tag = activeTagOf(data);
  const strategy = data.strategy === 'overwrite' ? 'overwrite' : 'insert';
  const spriteName = 'GFX_' + slug.replace(/[^a-z0-9_]/g, '_');
  const isButton = guiType === 'topbar-button';
  const guiActionLabel = action === 'create' ? 'Create' : action === 'update' ? 'Update' : 'Delete';
  const anchor = String(data.anchor || 'left_of_coins').trim();
  const visibility = String(data.visibility || 'always').trim();
  const width = Number.isFinite(Number(data.width)) && Number(data.width) > 0 ? Number(data.width) : null;
  const height = Number.isFinite(Number(data.height)) && Number(data.height) > 0 ? Number(data.height) : null;
  const buttonText = String(data.buttonText || '').trim();
  const tooltipText = String(data.tooltipText || '').trim();
  const sizeText = width && height ? `${width}x${height}` : 'the original container size (unspecified)';
  const buttonKey = name;
  const tooltipKey = `${name}_tooltip`;
  const localisationText = tooltipText || `View ${buttonText || name}`;

  const payload = {
    guiType,
    name,
    targetFile: file,
    imagePath,
    anchor,
    visibility,
    width,
    height,
    buttonText,
    tooltipText,
    clickAction: data.clickAction || '',
    closeButtonPosition: data.closeButtonPosition || (isButton ? '' : 'top-right'),
    strategy,
    notes: data.notes || '',
    localisation: { buttonKey, tooltipKey },
    tag,
  };

  const prompt = [
    'You are an EU4 modding assistant. Modify this EU4 Mod GUI and generate/modify all three files: .gui, .gfx and .yml.',
    '',
    '[File] ' + file,
    '[Target] ' + (isButton ? 'new topbar button `' + name + '`' : 'new or updated panel `' + name + '`'),
    '[Action] ' + guiActionLabel,
    '[Anchor] ' + anchor,
    '[Visibility] ' + visibility,
    '[Size] ' + sizeText,
    tag ? '[Active tag] ' + tag : '',
    '',
    '[Structured configuration (JSON; anchor/visibility are already English codes, do not translate them; buttonText/tooltipText are UI copy)]',
    '```json',
    JSON.stringify(payload, null, 2),
    '```',
    '',
    '[Required changes (all of them)]',
    '1. `.gfx`: register a spriteType in the interface .gfx file (reuse it if the same name exists) referencing `' + imagePath + '`; do not generate or convert any .dds/image file.',
    `   spriteType = { name = "${spriteName}" texturefile = "${imagePath}" }`,
    '2. `.gui`: with the `' + strategy + '` strategy, insert the element at `' + anchor + '`; size ' + sizeText + '; change only this element and preserve the rest of the file.',
    '   Copy the position/orientation/size of the existing control at that location; do not squeeze or cover other UI.',
    '3. `.gui` visibility: ' + (visibility === 'always'
      ? '`always` means no trigger is needed; omit it.'
      : 'convert it to `trigger = { ' + visibility + ' }`.'),
    '4. Click behavior: fire `' + (data.clickAction || '(unspecified)') + '`.',
    '5. `.yml` localisation: write `' + buttonKey + ':0 "' + (buttonText || name) + '"` for the button text and `' + tooltipKey + ':0 "' + localisationText + '"` for the tooltip; use the mod existing language files (at least Chinese; if only an English file exists, write l_english and keep the Chinese value).',
    '6. Check brace closure and explain how the new element affects other UI and different resolutions.',
    '',
    '[Image discipline] The user has already placed the image under gfx/interface; only reference the path. Do not generate, download, convert or fabricate .dds/PNG.',
    '',
    '[Output limit] max_tokens = 1000. Return only the changed files/blocks plus the required verification report.',
    '',
    '[Verification and report (answer each item)]',
    '1. The changed locations of all three files (.gui parent/line, .gfx spriteType, .yml keys and file).',
    '2. .gfx spriteType brace/quote/texturefile check result.',
    '3. .gui brace closure and hierarchy check result.',
    '4. Whether visibility was converted to a trigger correctly (always omits it).',
    '5. Anchor/overlap/out-of-bounds impact at 1920x1080, 2560x1440 and 1280x720.',
    '6. Confirm only image paths were referenced, no image was generated, and all three files were updated.',
  ].filter(Boolean).join('\n');

  return {
    kind: 'gui',
    action,
    prompt,
    payload,
    meta: { file, target: name, activeTag: tag, maxTokens: MAX_AI_TOKENS },
  };
}

/**
 * Build the prompt + normalized payload for one UI edit.
 *
 * @param type - `event`, `mission` or `gui`.
 * @param action - `create`, `update` or `delete`.
 * @param data - the form JSON produced by the panel.
 * @throws when a required field (file / id / nodes / name / imagePath) is missing.
 */
function decisionPrompt(action            , data                )                  {
  const file = requiredString(data.file, 'file');
  const id = requiredString(data.id, 'id');
  const title = String(data.title_cn || '').trim();
  const desc = String(data.desc_cn || '').trim();
  const rawAi = data.ai_will_do === undefined || data.ai_will_do === '' ? 1 : Number(data.ai_will_do);
  const aiWillDo = Number.isFinite(rawAi) ? rawAi : 1;
  const localisationFile = String(data.localisationFile || '').trim()
    || 'localisation/zz_eu4_workbench_decisions_l_simp_chinese.yml';
  const payload = {
    id,
    file,
    title_key: id + '_title',
    desc_key: id + '_desc',
    title_cn: title,
    desc_cn: desc,
    icon: data.icon || '',
    potential: data.potential || [],
    allow: data.allow || [],
    effects: data.effects || [],
    ai_will_do: aiWillDo,
    localisation_file: localisationFile,
  };
  const prompt = [
    '请在 Mod 的 decisions/ 目录下生成决议代码块。目标 ID: ' + id + '。',
    '要求：',
    '1. 严格按照 `country_decisions = { ' + id + ' = { ... } }` 的结构生成。',
    '2. 将 JSON 中的 potential 翻译为 `potential = { ... }`，allow 翻译为 `allow = { ... }`，effects 翻译为 `effect = { ... }`。',
    '3. 在对应的 localisation 文件中自动生成 `' + id + '_title` 和 `' + id + '_desc` 的中文文本。',
    '4. 生成完毕后，请务必检查括号是否闭合（调用 validate_script）。',
    '',
    '[File] ' + file + '  （只允许写 Mod 的 decisions/ 目录，禁止修改原版文件）',
    '[Target] decision `' + id + '`',
    '[Action] ' + ACTION_LABELS[action],
    '',
    '[Structured configuration (JSON; final output must be valid EU4 script)]',
    '```json',
    JSON.stringify(payload, null, 2),
    '```',
    '',
    '[Field conventions]',
    '- potential 只决定决议「是否可见」；allow 决定决议「是否可以点击」；两者绝不能混用。',
    '- `ai_will_do = { factor = ' + aiWillDo + ' }`；0 表示 AI 永远不会选择该决议。',
    '- effects 按 JSON 的效果意图翻译，例如 add_stability、add_treasury、add_country_modifier、country_event。',
    '- 本地化键固定为 `' + id + '_title` / `' + id + '_desc`，写入 `' + localisationFile + '` 的 `l_simp_chinese` 块（UTF-8 BOM，已有文件则追加）。',
    '- icon 为空时省略 `icon` 行。',
    '',
    '[Output limit] max_tokens = 1000. Return only the changed EU4 block plus the required verification report; no restatement of this prompt.',
    '',
    '[Verification (perform every step)]',
    ...commonRules(),
  ].join('\n');
  return {
    kind: 'decision',
    action,
    prompt,
    payload,
    meta: { file, target: id, maxTokens: MAX_AI_TOKENS },
  };
}

/** "5年" / "90天" / bare number -> integer days (1 year = 365). */
function durationTextDays(text         )         {
  const raw = String(text ?? '').trim();
  if (!raw) return 0;
  const num = Number(raw.replace(/[^0-9.\-]/g, ''));
  if (!Number.isFinite(num)) return 0;
  if (/年|y/i.test(raw)) return Math.round(num * 365);
  if (/天|d/i.test(raw)) return Math.round(num);
  return Math.round(num);
}

/**
 * Normalise `add_country_modifier.duration` to plain DAYS. The UI may carry
 * `years` / `daysText` helper fields (5 年 = 1825 天); they must never leak into
 * the .txt and a year count must never be written as `duration`.
 */
export function normalizeEffectForPayload(effect              )               {
  if (!effect || effect.effect !== 'add_country_modifier') return effect;
  const params                      = { ...(effect.params || {}) };
  const hasYears = params.years !== undefined && params.years !== '';
  const hasDaysText = params.daysText !== undefined && params.daysText !== '';
  if (hasYears || hasDaysText) {
    const years = hasYears ? Number(params.years) : 0;
    const total = (Number.isFinite(years) ? years * 365 : 0) + durationTextDays(params.daysText);
    params.duration = String(Math.max(0, Math.round(total)));
  } else if (/年|天|y|d/i.test(String(params.duration ?? ''))) {
    // A duration typed as "5年" / "90天" is converted too.
    params.duration = String(Math.max(0, durationTextDays(params.duration)));
  }
  const numeric = Number(String(params.duration ?? '').replace(/[^\d.-]/g, ''));
  if (Number.isFinite(numeric)) params.duration = String(Math.max(0, Math.round(numeric)));
  delete params.years;
  delete params.daysText;
  return { ...effect, params };
}

                                              
               
               
                           
                         
                                                 
                                                         
                       
                     
 

/**
 * Deterministic preview of what the Agent is about to generate: the event
 * block, the localisation lines and (startup mode) the history bind line.
 */
export function buildEventPreview(data               )               {
  const id = String(data.id || '').trim();
  const file = String(data.file || '').trim();
  const kind = data.kind || 'country_event';
  const triggerMode = data.triggerMode === 'startup' ? 'startup' : 'normal';
  const targetTag = String(data.targetTag || '').trim().toUpperCase();
  const bindDate = /^\d{1,4}\.\d{1,2}\.\d{1,2}$/.test(String(data.bindDate || '').trim())
    ? String(data.bindDate).trim()
    : '1437.1.1';
  const localisationFile = String(data.localisationFile || '').trim()
    || 'localisation/zz_eu4_workbench_l_simp_chinese.yml';
  const normalizedOptions = (data.options || []).map((option) => ({
    ...option,
    effects: (option.effects || []).map(normalizeEffectForPayload),
  }));
  const code = buildRawPreview({
    event: {
      file,
      kind,
      id,
      namespace: data.namespace || id.split('.')[0] || '',
      conditions: data.conditions || [],
      options: normalizedOptions,
      triggerMode,
      targetTag,
      bindDate,
    },
  });
  const localisation = [
    `${id}.t:0 "${data.title || ''}"`,
    `${id}.d:0 "${data.desc || ''}"`,
  ];
  const history = triggerMode === 'startup' && targetTag
    ? { file: `history/countries/${targetTag}.txt`, line: `${bindDate} = { country_event = { id = ${id} days = 0 } }` }
    : null;
  const onActionCode = triggerMode === 'startup' && targetTag
    ? [
      'on_startup = {',
      '    effect = {',
      '        if = {',
      '            limit = { exists = ' + targetTag + ' }',
      '            ' + targetTag + ' = { country_event = { id = ' + id + ' days = 1 } }',
      '        }',
      '    }',
      '}',
    ].join('\n')
    : '';
  const warnings           = [];
  if (!id) warnings.push('缺少事件 ID');
  if (!data.title) warnings.push('缺少中文标题：localisation 的 <ID>.t 会为空');
  if (!data.desc) warnings.push('缺少中文描述：localisation 的 <ID>.d 会为空');
  if (triggerMode === 'startup' && !targetTag) warnings.push('开局强制触发缺少目标国家 Tag：history/countries 绑定无法生成');
  if (triggerMode === 'normal' && !(data.conditions || []).length) warnings.push('普通触发没有 trigger 条件，也不会写 mean_time_to_happen：游戏内可能永远不会触发');
  if (!file || !/^events\/.*\.txt$/i.test(file)) warnings.push('事件文件路径不是 events/*.txt');
  for (const option of data.options || []) {
    for (const effect of option.effects || []) {
      if (effect.effect === 'add_country_modifier' && effect.params?.newModifier === true) {
        warnings.push(`修正 ${String(effect.params.name || '')} 尚不存在：需要同时生成 common/event_modifiers/ 文件`);
      }
    }
  }
  return { file, kind, code, localisationFile, localisation, history, onActionCode, warnings };
}

export function buildAIPayload(type                   , action                     , data         )                  {
  const kind = String(type)            ;
  const act = String(action)              ;
  if (!['event', 'mission', 'gui', 'decision'].includes(kind)) throw new Error('unknown edit kind: ' + String(type));
  if (!['create', 'update', 'delete'].includes(act)) throw new Error('unknown edit action: ' + String(action));
  const form = (data ?? {})                           ;
  if (kind === 'event') return eventPrompt(act, form                            );
  if (kind === 'mission') return missionPrompt(act, form                              );
  if (kind === 'decision') return decisionPrompt(act, form                             );
  return guiPrompt(act, form                        );
}
