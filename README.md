# EU4 Mod Workbench

一个 DeepSeek Harness 插件与 Agent 预设，用于 EU4 Mod 制作时的**查证、校验、浏览和导出**。

## 它不做什么

- 不凭记忆生成 EU4 语法；`query_script_doc` 只返回随包索引或游戏文件中的真实条目。
- 不画像素地图；地图是简化的省份网格，点击返回真实省份 ID。
- 不在后台启动外部程序；所有桥接程序必须由用户点击。
- 不替用户决定覆盖 Mod 文件；导出只写显式路径，并拒绝 `..` 逃逸。

## 组成

```
eu4-mod-workbench/          Host 工具 + HTTP API + 侧栏面板
  index.ts                  TypeScript 入口（可读源码）
  index.js                  由 scripts/build.mjs 生成的运行文件
  lib/engine.ts             文档索引、解析、校验、地图/任务/事件
  lib/server.ts             仅回环的 HTTP 路由
  client.js                 浏览器端 React 面板
  lib/docs-data.json        1901 条脚本文档 + 28 个作用域
```

配套的 Agent 预设 `eu4-mod-preset/` 是独立 bundle（可另建仓库，或用本地目录安装）：
`agent.cordis.yml` 是旧式声明，`cordis.patch.yml` 是现代安装入口，`prompt.md` 是 Persona 与纪律。

## 安装

### 从 GitHub 安装

在 DSH 的 `plugin_manager` 中选择 `install_bundle`，`target` 填（把 `<用户名>` 换成仓库所属账号）：

```
github:<用户名>/eu4-mod-workbench
```

或者先 `git clone` 到本地，`target` 填该目录的绝对路径。

仓库里已提交 `index.js`、`client.js`、`lib/*.js`，安装时不需要构建。

### 本地开发

修改 `index.ts` / `lib/*.ts` 后，用 `node scripts/build.mjs` 重新生成运行文件。
`test/client-smoke.mjs` 会自动从当前 DSH profile 解析 React；`test/smoke.mjs` 和
`test/http.mjs` 需要本机安装 EU4（默认 Steam 路径，可用 `EU4_ROOT` 覆盖）。

插件 bundle 的 patch 只插入一个 Host 行 `eu4-mod-workbench`。  
预设 bundle 插入 `preset-eu4-mod`。**不要重复挂载 workbench**：它拥有 webServer
路由和侧栏面板，重复挂载会产生重复工具；`index.ts` 里已用全局活动标记防重。

MCP 适配器 `@auggieteo/dsh-mcp-adapter` 是 Host-level bundle，安装一次即可；它不应该
被预设再次挂载。`agent.cordis.yml` 保留了用户要求的声明，实际运行使用 Host 行。

## 配置

插件 Config 支持：

| 键 | 说明 |
|---|---|
| `eu4Root` | EU4 游戏根目录；留空自动探测 Steam/环境变量 |
| `modDir` | 用户 Mod 目录 |
| `statePath` | 工作区 JSON；默认 `DSH_HOME/eu4-mod-workbench/workspace.json` |
| `clausewitzMcpUrl` | clausewitz-mcp Streamable HTTP 端点 |
| `clausewitzMcpCommand` | 可执行名或路径（默认 `clausewitz-mcp`） |
| `eu4ModEditingToolPath` | Eu4-Mod-Editing-Tool 路径 |
| `emtPath` | EMT 路径 |
| `paradoxCodePath` | ParadoxCode 路径 |
| `maxIndexFiles` | 索引上限，默认 30000 |

## 工具

- `query_script_doc` — trigger/effect/scope/modifier 的签名与作用域
- `find_definition` — 定义位置与引用位置
- `search_script_docs` — 模糊检索候选名称
- `validate_script` — 作用域、trigger/effect 混用、localisation
- `check_loc_keys` — 提取并检查 localisation 键
- `eu4_map_query` — 省份/核心省份查询；`ownerTag` 只保留该 Tag 拥有的省份，`coresOnly` 只保留其核心省份
- `eu4_batch_history` — 生成 history 片段与省份 ID 列表
- `eu4_mission_export` — 任务节点图 → missions 脚本（写入前校验）
- `eu4_event_graph` — 事件因果图，缺失引用 `missing: true`；可选 `category` / `tag` / `activeTagOnly`
- `query_events_by_category` — 按 `all | regular | special` 查询；`activeTagOnly` 使用面板当前选中的 Tag
- `eu4_probe_tools` — 外部工具状态
- `eu4_workspace_status` — 工作区与索引状态（含 `activeTag`）

## Tag 全局联动

顶部「国家 Tag」选择器维护一个全局 `activeTag`，地图、事件树、任务树自动响应：

- **地图**：`仅显示 <TAG> 省份` 只保留 `history/provinces` 中 `owner = TAG` 的省份；
  `仅核心省份` 再按 `add_core` 过滤。省份归属按 1444 开局（忽略带日期的后续变更块）。
- **事件树**：类别按钮（全部 / 常规 / 特殊 DHE）+ `仅显示关联 <TAG> 的事件`。
  判定规则：事件文件的 `namespace` 含该 Tag，或事件的 `trigger` 在任意嵌套层级含 `tag = TAG`。
  `special` 定义为 `fire_only_once = yes` 或 `major = yes`。
- **任务树**：选中 Tag 后出现「载入 <TAG> 任务」按钮，先按文件名找
  `missions/<TAG>_missions.txt`，找不到再异步扫描任务文件内容中的 `tag = TAG`。
- **持久化 / AI**：`activeTag` 写入工作区 JSON（`POST /api/tag`），
  `query_events_by_category` 的 `activeTagOnly` 直接使用它。过滤只影响渲染，
  不改任何游戏/Mod 文件；Tag 为空时所有过滤关闭，显示全部内容。

## 事件 / 任务编辑：只生成 AI 指令

UI **不再直接写任何 `.txt`**。原来的“校验并保存 / 校验并导出”已经移除，旧写入路由
`/api/file/save`、`/api/missions/save` 现在直接返回 `410`。编辑流程改为：

1. 面板用表单编辑（事件：ID/标题/描述/图片、选项与 effect、触发器；任务：槽位/名称/描述/前置/条件/奖励）。
2. 点“生成 AI 指令”后，前端把表单 JSON 发给 `POST /api/ai/build`，由
   `buildAIPayload(kind, action, data)` 拼成带【文件路径】【目标定位】【修改内容】【校验要求】的 Prompt。
3. 可以“复制指令”粘贴到对话，或“保存为待办”写入 `workspace.json` 的 `pendingEdit`；
   之后让 Agent 调 `eu4_pending_edit`（`clear=true` 读取并清除）即可接手。
4. 真正写文件的是 Agent 的编辑工具，且 Prompt 要求它先 `read` 定位、写入前后各跑一次
   `validate_script`，并用 `check_loc_keys` 补齐 localisation。

### 触发国家事件：事件选择器（禁止裸数字）

- 效果选「触发国家事件」时不再出现数字输入框，而是一个可搜索的事件下拉框：
  `GET /api/events/catalog` 扫描当前 Mod + 原版的全部 `events/*.txt`，返回 `{id, title, titleKey, kind, namespace, source, file}`；
  标题经 localisation 解析成中文（本机实测 6408 条事件 / 6398 条有中文标题，首次约 2.1s，之后 30s 缓存）。
- 搜索支持事件 ID、中文标题、namespace（`hus_event.1`、`布拉格之战`、`flavor_boh` 都能命中）；选择后底层绑定**事件 ID 字符串**，手工输入裸数字会被拒绝，避免生成不存在的 ID 导致闪退。
- 旁边是「延迟天数 (days)」输入框，默认 `0`；Payload 固定生成
  `country_event = { id = flavor_boh.1 days = 0 }`，不再输出 `country_event = 43`。
- AI Prompt 与批量指令都明确：`params.id` 是带点的字符串、`params.days` 是整数，禁止把裸数字当事件 ID。

### 字典未收录：一键补词

- 未知 trigger/effect 的「字典未收录」提示旁新增「添加到本地字典」：就地输入中文翻译，`POST /api/dictionary/custom` 写入 `custom-dictionary.json` 并刷新语言包；之后该 Key 在所有下拉框/提示中直接显示中文，可长期复用。

### 添加国家修正：ID/中文名分离 + 年天换算 + 现场建修正

- 效果「添加国家修正 (add_country_modifier)」拆成两个输入：**修正英文 ID（必填）** 与 **修正中文名称**。ID 失焦或点「检索」会调用 `GET /api/modifier?name=` 自动判定：
  - 找到 → 显示「已加载现有修正」，并回填其属性；
  - 找不到 → 显示「未找到定义，将作为新修正创建」，属性区可自由添加。
- 持续时间改为「年 + 天」两格（1 年 = 365 天），任一格也支持智能文本：`5年`、`90天`、`2年 30天`。底层 `params.duration` 始终是纯天数——`5年` → `1825`。
- 属性编辑复用 `ModifierTreeSelector`：行内显示 `[军事] 陆军士气 (land_morale)`，输入 `20` 显示 `%`，底层存 `0.2`。
- 入队时，事件/任务里带 stats 的新修正会自动展开成一个 **mechanic ChangeItem**（`common/event_modifiers/<id>.txt`），并排在事件任务之前；再次入队会去重，删掉属性会同步移除该 mechanic 任务。
- 统合 Prompt 增加 `[New modifier tasks / 新修正强指令]`：
  1. 在 `common/event_modifiers/<id>.txt` 生成新修正并补本地化显示名 `id:0 "中文名"`；
  2. 在事件选项 effect 写 `add_country_modifier = { name = <id> duration = <纯天数> }` 并调用 `validate_script`。
- UI 元数据（`newModifier` / `nameZh` / `years` / `daysText`）只用于 Prompt 与队列，**不会**写进 `.txt`；raw 预览只输出 `name` 与 `duration`。

### 事件本地化契约

- 标题/描述输入框填**中文文本**；事件代码固定生成 `title = "<ID>.t"` 与 `desc = "<ID>.d"`（带引号），`.txt` 里禁止出现中文。
- Payload 里给出 `title_key`/`desc_key`/`title_zh`/`desc_zh`/`localisation_file`；Prompt 要求在 `l_simp_chinese` 块写入 `<ID>.t:0 "中文标题"` 与 `<ID>.d:0 "中文描述"`（UTF-8 BOM，已有文件则追加）。
- `GET /api/event/form` 同时返回 `titleKey`/`descKey` 和从 localisation 解析出的中文文本，UI 直接回填；读不到译文时回退显示键名。
- **强制文件**：`localisation/zz_eu4_workbench_l_simp_chinese.yml`；目录不存在先创建，文件必须是 **UTF-8 with BOM**（首字节 `EF BB BF`），大小 >3 字节；键格式严格为 `hus_event.1.t:0 "中文标题"`（冒号后一个英文空格）。
- **游戏语言兜底**：读取用户目录 `settings.txt` 的 `language`；若当前是 `l_english`，还必须把同一批中文键写入 `localisation/zz_eu4_workbench_l_english.yml`（头 `l_english:`，同样 BOM）。否则游戏只会加载英文文件，中文永远不会显示。
- 回读校验：`localisationFileState` 检查文件存在、BOM、`size > 3`、`.t`/`.d` 键；UI 显示 `中文 yml ✅（67 bytes, BOM ✅）`，游戏语言文件缺失时黄色警告“会显示英文”。
- 事件文件顶部必须有 `namespace = <ID 前缀>`（EU4 的正确语法是 `namespace =`，**不是 `add_namespace`**；后者会被游戏忽略）。预览显示 `✅ namespace = hus_event` 或红字 `✖`，回读按前缀校验。
- `is_triggered_only = yes` 的事件必须有触发（开局 history / on_action / 其他脚本）；预览与回读额外验证“开局引线”，缺少时 UI 红字拦截。
- **on_startup 兜底**：统合时还会生成/合并 `common/on_actions/zz_eu4_workbench_on_actions.txt`：
  ```txt
  on_startup = {
      effect = {
          if = {
              limit = { exists = TBO }
              TBO = { country_event = { id = hus_event.1 days = 1 } }
          }
      }
  }
  ```
  历史文件绑定被吞掉时，on_startup 仍会在开局检查 Tag 并直接触发。回读会同时验证 history 与 on_actions，任一缺失即红字。

### 条件构建器（Trigger）

- `owns`（拥有省份）与 `controls`（控制省份）是两个独立选项，标签分别是「拥有省份」「控制省份」；选中后分别生成 `owns = <ID>` / `controls = <ID>`，**controls 绝不会被改写成 owns**。
- 输入框提示随条件动态变化：省份条件 →「请输入省份 ID（如 2664）」；`tag` →「请输入 3 位字母 Tag（如 TBO）」；`year`/`is_year` →「请输入年份（如 1437）」；`has_country_flag` → flag 名。
- `owns`/`controls` 不再使用普通文本框，而是复用省份字典的 `ProvincePicker`：输入「布尔诺」「Brno」「265」都能选中 `[265] 布尔诺 (Brno)`，底层写入数字 ID。
- Payload 条件格式为 `{ condition: "controls", op: "=", value: "265" }`（逻辑条件带 `children`）；统合 Prompt 明确要求 `controls = 265`，并禁止改写为 `owns`。
- 条件构建器同样支持 `any_neighbor_province` 的相邻省份选择器（见「相邻省份查询」）。

## 开局强制触发（写国家历史文件）

- 表单里“触发方式”选择 **开局强制触发**：事件写 `is_triggered_only = yes`，**不写** `mean_time_to_happen`；**目标 Tag 输入框自动填入顶部全局 Tag**（也可手改），Payload 带 `targetTag`，Prompt 要求修改 `history/countries/<TAG>.txt`：若已有 `1437.1.1 = {` 区块就把 `country_event = { id = <ID> days = 0 }` 合并进去，否则才新建日期块（重复日期块可能被游戏忽略）。
- 统合 Prompt 要求修改 `history/countries/<TAG>.txt`：若文件已有 `1437.1.1 = {` 区块，把 `country_event = { id = <ID> days = 0 }` **合并进已有区块**；只有不存在时才新建日期块（重复日期块可能被游戏忽略，这是“开局事件不触发”的常见原因）。
- Prompt 末尾附一段固定的英文指令（标题键、本地化、历史文件三件事），防止 AI 幻觉：
  `Generate an event with is_triggered_only = yes. Ensure title is '<ID>.t' and desc is '<ID>.d'. Update the localisation yml file with the provided Chinese text. Also, modify 'history/countries/<TAG>.txt': if a '1437.1.1 = {' block already exists, merge 'country_event = { id = <ID> days = 0 }' into it; otherwise append the block at the end of the file.`
- 生成的 raw 预览同样只出现键名与 `is_triggered_only = yes`，不会把中文写进 `.txt`。

数据结构（`lib/ai.ts`）：

```ts
interface ConditionIntent { type: 'owns' | 'year' | 'tag' | 'has_country_flag' | 'custom'; op?: '=' | '>' | '>=' | '<' | '<='; value: string }
interface EffectIntent { effect: string; value?: string; params?: Record<string, string> }
interface EventFormData { file: string; id: string; kind?: string; title?: string; desc?: string; picture?: string; conditions?: ConditionIntent[]; options?: { name: string; effects: EffectIntent[] }[]; original?: string }
interface MissionFormData { file: string; tag?: string | null; nodes: { id: string; slot?: string; name?: string; description?: string; required?: string[]; conditions?: ConditionIntent[]; rewards?: EffectIntent[] }[] }
```

## 界面修改 (GUI)

“界面修改”标签页用表单收集参数，再交给 AI 生成 `.gui` / `.gfx` / `.yml` 三个文件的补丁；工作台本身不写任何文件。

- **新增顶层按钮**：元素名、图片路径、悬浮提示文本、按钮显示文本（可选）、锚点/位置参照、可见条件、按钮尺寸（可选）、点击触发的事件/决议、策略。
- **新增专属面板**：面板名、背景图、宽高、关闭按钮位置、目标 `.gui` 文件。
- **中英映射**：[lib/eu4-dictionary.ts](lib/eu4-dictionary.ts) 维护锚点与可见条件；UI 只显示中文（如“国库(金币)左侧”），JSON/Prompt 只传英文代码（如 `left_of_coins`、`tag = BOH`）。
- **可见条件**会转成 `.gui` 的 `trigger = { ... }`；`always` 表示不写 trigger。
- **策略**默认 `insert`（基于原版容器插入）；`overwrite` 需要说明原因。
- **图片纪律**：图片必须由用户放进 `gfx/interface/...`；AI 只写 `texturefile` 引用，不生成、不转换 `.dds`。
- **Prompt 强制检查**：`.gfx` 的 `spriteType` 结构、`.gui` 括号闭合、1920x1080 / 2560x1440 / 1280x720 的锚定与重叠影响，以及 `.yml` 中按钮文本与 Tooltip 的键值。

## 面板

七个标签共用同一工程状态：

1. 工作区：路径、索引、Mod 列表、vanilla 遮蔽
2. 地图与剧本：省份网格、Tag 核心高亮、Tag 省份/核心过滤、结构化/自然语言批量编辑
3. 任务树：节点/连线/导入；节点属性表单（槽位、名称、描述、前置、条件、奖励）+ 生成 AI 指令
4. 事件树：图、类别与 Tag 联动过滤；选中事件后显示表单化编辑器 + 生成 AI 指令
5. 界面修改：顶层按钮 / 专属面板表单 + 生成 AI 指令（.gui/.gfx）
6. 校验：作用域/混用/loc 结果
7. 工具桥接：已连接/已安装/未配置/不可达及原因

## 界面本地化 (i18n)

- 语言包：[lib/ui-locales.ts](lib/ui-locales.ts)；Web 端通过 `GET /api/ui/locales` 一次加载。
- 游戏数据字典：[lib/eu4-dictionary.ts](lib/eu4-dictionary.ts)（触发器 37、效果 35、修正 42、分类 29，均带中文标签 + 拼音/英文搜索词）；`GET /api/eu4/options` 提供给下拉框。
- 组件内所有可见文本走 `t(key, params)`；`client.js` 中不再有中文硬编码（CJK 扫描为 0）。
- 下拉框使用 `SearchSelect`：显示中文、支持中文/拼音/英文模糊搜索，绑定并回传英文 value（如 `add_prestige`、`land_morale`）。
- 缺词兜底：`t()` 返回英文 key 本身，不会空白或报错；侧栏标题在语言包加载前使用英文 `EU4 Workbench` 兜底。
- 状态/报错：工具状态走 `status.*`（已连接/未安装/未配置路径/不可达），校验 issue 的英文消息按 `issue.<CODE>` 翻译，`AI 正在思考并生成代码…` 用于生成中状态。
- 中英边界：**UI 汉字只来自语言包**；`buildAIPayload` 的 **Prompt 正文、JSON、枚举、EU4 命令**全部英文，锚点/可见条件只传英文代码。用户填写的按钮文本/Tooltip 属于游戏文案，会作为 `.yml` 值进入 Prompt。

## 反向本地化与 CRUD

- **事件**：事件树顶部新增“新建事件”，新建走 `action=create`，点击画布节点走 `action=update`；更新 Prompt 明确写 “Update (replace the target block)”，不会误建新事件。
- **任务**：每个节点带 `isNew`；新增节点为 true，读取已有节点为 false，Payload 中同时保留该标记，AI 可区分新增/覆盖。
- **英翻中解析**：`conditionsFromNodes()` 递归解析 `AND/OR/NOT`（最多 6 层），`owns/tag/is_year/...` 映射为中文下拉；未知词保留英文并显示“字典未收录 / 复制词条”；复杂块标记 `complex=true` 并保留 `raw` 源码。
- **兜底**：UI 的 `ConditionNode` 在 `complex` 或嵌套超过 4 层时切换为源码模式文本框，并显示“该部分逻辑过于复杂，已保留源码模式”，不会因嵌套逻辑崩溃。
- **修正配置**：`add_country_modifier` 可通过 `GET /api/modifier?name=...` 读取 `common/event_modifiers` / `common/static_modifiers` 的现有定义，UI 用中文修正名 + 数值编辑内部属性（如 `陆军士气 0.05`），Payload 写入 `params.stats`。
- **写操作**：仍然只生成 Prompt/待办，不写任何 `.txt`。

## NL2Code 智能助手

- 事件树/任务树顶部新增“智能助手”输入框与快捷示例，入口组件为 `NLAssistant`。
- `POST /api/nl2json` 返回三样东西：**本地快速草稿**（`EventConfig`/`MissionConfig`）、**发给 Agent 的英文解析 Prompt**、**`.txt` 源码预览**。
- 本地草稿永远带 `needs_confirmation: true`；UI 回填后高亮提示“AI 已经帮你填好了表单，请检查是否正确”。用户改任意字段后切换为“表单已被修改，请确认后再生成脚本”。
- 复杂描述（多个“并且/或者”或显式 AND/OR）会进入高级模式：先展示源码预览，用户点“确认代码并生成指令”后才回填表单。
- Agent 路径：点“生成 AI 解析指令”拿到英文 Prompt，交给 Agent；把 Agent 返回的 JSON 粘贴到“应用 AI 返回的 JSON”，前端用容错解析器去掉 Markdown 代码围栏后回填。非法/空 JSON 会提示“AI 没听懂：返回内容不是合法 JSON，请重试或手动填写。”
- 校验：`/api/nl2json` 用触发器/效果/修正字典做存在性检查，并调用 `validate_script` 检查语法。当前环境 `clausewitz-mcp` 未安装，因此走本地字典 + `validate_script` 的降级校验；连接后可替换为 MCP 校验。
- 所有解析结果仍是 JSON 中间产物；最终写入仍走 `buildAIPayload` → Prompt → Agent 确认/写文件，绝不把自然语言直接交给写文件逻辑。

## Token 优化策略

- **本地字典优先**：`conditionsFromNodes()`、`localParse()` 只用 `eu4-dictionary.ts` / `nl2code.ts` 的本地映射；查不到的词保留英文并给出 `warnings`，绝不为了一个词调用大模型。
- **上下文裁剪**：修改事件时只发送目标事件块，且硬性截断到 **100 行**；新建事件只发送新增 JSON + **2 个原版事件格式参考**（每段最多 40 行）。任务树只发送节点 JSON。
- **一次直达**：智能助手增加“一次生成代码”，把自然语言 + 当前表单数据合并成**一次**请求，要求直接返回最终 `.txt`；只有“解析 → 可视化表单”模式才请求 JSON。两种模式共用 `max_tokens = 1000` 上限。
- **静默兜底**：未知 trigger/effect/stat 原样显示英文，并在 `warnings` 中提示；不触发额外 AI 请求。
- **输出上限**：`buildAIPayload` / `buildNL2JSONPayload` 的 Prompt 与 `meta.maxTokens` 均写入 `max_tokens = 1000`；`/api/ai/raw` 同样限制并保存为待办。
- 插件不直接调用 LLM；所有生成请求都以“Prompt + 上限”交给 Agent，UI 只负责确认与回填。

## 全局修改队列 (Batch)

- `WorkspaceState.changeQueue` 持久化在 `workspace.json`；事件、任务、GUI、机制面板的“加入修改队列”都写入同一条队列。
- `ChangeItem` 为纯 JSON：`{ targetType: event|mission|mechanic|gui, action: create|modify|delete, targetId, targetFile, data, id, createdAt }`。
- **两套 action 词表**：AI 载荷用 `create|update|delete`，队列用 `create|modify|delete`；`POST /api/queue` 在 `addChange` 边界把 `update`/`edit` 归一为 `modify`，其它值仍然报 `invalid action`。任务树和 GUI 面板对“已存在对象”入队时不再把 `update` 直接塞给队列。
- 新标签页：
  - **机制**：读取/新建 `common/event_modifiers` 修正定义，编辑属性后入队。
  - **批量**：查看队列、移除/清空、预览统合 Prompt、提交为待办。
- 统合 Prompt（[lib/batch.ts](lib/batch.ts)）按 `[Change N]` 分节，先给完整 `[Batch JSON]`，再给逐项规则与报告格式；`max_tokens = 2000`。
- 各面板不再直接调用 `/ai/build`；“生成/应用”改为入队，只有批量页的“提交为待办”才把统合 Prompt 交给 Agent。
- 接口：`GET/POST /api/queue`、`POST /api/queue/remove|clear|build|submit`。

## 地图与剧本历史 (Province/Country History)

- 新增 `targetType: province_history | country_history`，JSON 接口见 [lib/map-config.ts](lib/map-config.ts)。
- 地图右侧新增“省份历史修改”：`owner/controller/religion/culture/base_tax/base_production/base_manpower/trade_goods`；点击“暂存修改”入队。
- 新增“国家历史修改”：`government/religion/technology_group/primary_culture/capital`、`add_monarch{name,adm,dip,mil,birth_date,death_date}`、本地化开关；点击“暂存国家修改”入队。
- 精确路径由服务端解析：`GET /api/history/province?id=&name=` → `history/provinces/[ID] - [Name].txt`；`GET /api/history/country?tag=` → `history/countries/[TAG] - [Name].txt`。ChangeItem 的 `targetFile` 直接携带结果，AI 不需要搜索。
- 统合 Prompt 对每个任务给出精确 `target_file`，并强制警告：不得破坏 `1444.11.11 = { ... }` 等日期分段；国家历史保留既有君主/死亡日期/继承人；改名或新建国家须补 `localisation/` 中英文名称键。
- 所有配置 JSON 只出现一次，位于 Prompt **最末尾**（`[Batch JSON — authoritative]`），前面的任务列表不含 JSON，保持缓存前缀稳定。

## 省份名称三合一

- `PROV<id>` 从**原版 + `dlc_load.json` 里所有已启用 Mod + 当前 Mod** 的 `localisation/` 提取（创意工坊汉化包通常只在这份启用列表里，不在游戏目录下）。
- 每个目录内「普通文件 → `replace/`」扫描，结果缓存为 `{id, name_cn, name_en, name_cn_source, name_en_source}`。
- 语言标记取自文件内的 `l_english:` / `l_simp_chinese:` 行，而不是文件名：
  - 含中文的值一律进 `name_cn`（汉化包常见的「用 `l_english:` 装中文」也能识别）；
  - 只有 `l_english` 的值进 `name_en`，所以原版的 `prov_names_l_spanish.yml` 不会把 `name_en` 变成 `Estocolmo`；
  - 同一目录内优先级：中文标记 > 英文标记 > 其它 CJK（日文），再按 `replace/` 决胜；加载顺序靠后的 Mod 覆盖靠前的。
- 文件编码按字节判断，支持四种来源：
  - 普通 UTF-8（含 BOM）；
  - UTF-16LE / UTF-16BE；
  - GB18030（老式 GBK 汉化包）；
  - **EU4 双字节补丁（matanki-saito/EU4dll）的转义文本**：`[0x10..0x13][低][高]`，`0x11` 低字节 +0x0E、`0x12` 高字节 −9、`0x13` 两者，文件层按 CP1252 字符存储 —— 这是国内汉化包最常见的格式，本工具按官方 C++ 源码 `escape_tool.cpp` 实现，实测 487/487 样例完全一致。
  - 解不出来的文件不猜，计入 `unreadableFiles`。
- 显示统一为 `[2664] 皮尔森 (Plzeň)`；网格卡片大字显示中文名、小字显示 `[ID] 英文名 · Owner`；无中文时回退 `[2664] Plzeň`，连名称都没有时回退 `[2664]`，绝不报错。
- 地图页底部显示字典体检：`中文省名 N/总省数 · X 个本地化文件无法解码`，并可在悬浮提示里看到扫描过的目录。
- 搜索（`foldProvinceText` / `provinceMatchScore`）按 token 匹配 `ID / 中文 / 英文`，大小写与变音符号不敏感：`2664`、`皮尔森`、`Plz`、`Plzen` 都能命中 `Plzeň`；多个 token 需同时命中。
- UI：`ProvincePicker` 下拉框（省份面板、地图定位、批量编辑）实时过滤；地图网格 Hover 提示与队列列表同样使用三合一格式。
- 手工中文名只在勾选「同时写入省份名称本地化（PROV<id>）」时作为 `name_cn`/`name_en` + `localisation: true` 入队，由 AI 写进 `localisation/`；`id` 始终是数字。
- 统合 Prompt 的任务列表会多一行 `province_hint: [2664] 皮尔森 (Plzeň)`（仅帮助理解），JSON 载荷与生成脚本里只有数字 ID。

## 省份历史 / 国家管理

- 新标签页 **省份历史**、**国家管理**；字段名全部来自 `t()`（`province.owner`、`province.base_tax`、`country.capital`、`country.primary_culture` 等）。
- 字段字典在 [lib/eu4-dictionary.ts](lib/eu4-dictionary.ts) 的 `PROVINCE_FIELD_OPTIONS` / `COUNTRY_FIELD_OPTIONS`，服务端合并进 `/api/ui/locales`。
- 省份表单生成 `ProvinceHistoryConfig`，国家表单生成 `CountryHistoryConfig`；新建模式生成 `NewTagConfig`。
- 入队 targetType：`province_history` / `country_history` / `new_tag`。同一 `targetType + targetId` 会覆盖旧队列项（例如重复修改 2664 只保留最新一条）。
- **省份 owner/controller 强制同步**：改 owner 时 UI 自动把 controller 设为同值；入队 Payload 再次强制 `controller = owner`（只改 owner 不改 controller 会让游戏内仍显示原占领）。
- 省份历史必须写在**日期块**内（默认 `1437.1.1 = { owner = MVA controller = MVA ... }`），避免被原版 1444 定义覆盖；回读会检查 owner/controller 一致性与日期块位置，不一致给出黄色警告。
- 新建 Tag 的 Prompt 强制按顺序生成四个文件：注册 Tag、国家定义、国家历史、本地化；并提醒玩家自行放入 `gfx/flags/<TAG>.tga`。
- NL2Code 可识别“把 2664 号省改成…”“把波希米亚改成…”“新建国家 HUS…”并回填对应中文表单。

## 国家理念

- 新标签页 **国家理念**：TAG、2 个起始传统、1 个国家野心、7 个理念（英文 ID + 中文名称/描述 + 修正 + 数值）。
- 修正下拉复用 `MODIFIER_OPTIONS`，UI 显示中文（陆军士气/纪律/造核成本…），JSON 只保存英文 key（`land_morale`/`discipline`）。
- 入队 `targetType: national_ideas`，同一 TAG 覆盖旧项；精确文件由 `GET /api/ideas/file?tag=` 解析（例如 BOH → `common/ideas/00_country_ideas.txt`）。
- **Tag 与数据严格绑定**：Tag 默认取顶部全局 Tag；改 Tag 会立刻清空传统/野心/7 个理念，然后回车、失焦或点「读取理念文件」都按**当前** Tag 重新解析。后端只接受 `<TAG>_ideas` 块，找不到就返回空数据 + warning，绝不复用文件里第一个 `*_ideas`；解析缓存按「文件 + Tag」双键。
- **顶部「刷新」保留 Tag**：只清空理念数据与 mtime，Tag 输入框与全局 Tag 都不变。
- **读取即解析**：`parseNationalIdeas()` 用 `parseCw` 解析文件（注释、缩进、空行、任意修正数量都能处理），返回 `traditions`（= `start`）、`ambition`（= `bonus`）、7 个理念块（id + `modifiers` 数组）以及 `mtimeMs`。名称/描述不在这个文件里，按 `<idea_id>` / `<idea_id>_desc` 从 localisation 回填（优先中文）。
- **数值单位**：解析器返回原生值（`land_morale = 0.10` → `0.1`），UI 按 `MODIFIER_OPTIONS.type` 显示为 `10`；`core_creation = -0.10` 显示为 `-10`；入队时再换回原生值。
- **返回时自动同步**：标签页每 3 秒 + 窗口 focus 时比对文件 `mtimeMs`，变化且表单无未保存修改就自动重新读取并回填；有未保存修改时显示「文件已更新，重新读取」提示，不覆盖你的输入。加入队列后不再清空表单，等 Agent 写入后由轮询回填。
- **顶部「刷新」是强刷新**：清空当前标签的表单记忆（`formMemory` 对应键）并重挂载标签，重新从磁盘读取，旧值不会覆盖新数据。
- 统合 Prompt 强制“完整覆盖”：恰好 2 traditions、1 ambition、7 ideas；一个理念可写 `{ modifier, value }` 或 `{ modifiers: [...] }`；并要求本地化补齐 `<tag>_ideas_title` 与 7 个理念的名称/描述键。

## 自定义剧本开始时间

- `WorkspaceState.currentStartDate` 默认 `1437.1.1`，可在地图顶部日期框修改并持久化；`POST /api/startdate`。
- `provinceHistoryAt(text, startDate)` 先应用无日期的基础字段，再按时间升序应用所有 `timestamp <= startDate` 的日期块，忽略未来块。
- Mod 的 `history/provinces/` 对同省份 ID 绝对覆盖原版：一旦 Mod 有该省份文件，原版时间线完全不参与。
- 若某省份在开始日期前没有定义，结果 `owner = ''`、`unresolved = true`，并生成 warning；地图显示“无主”，不会崩溃。
- 地图返回 `startDate`、`warnings`、`warningCount`；顶部显示无历史归属的省份数量。

## 写入路径、Mod 目录校验与回读验证

- 预览面板顶部用**红色粗体**显示 AI 将写入的绝对路径（来自 `/api/ai/preview` 的 `absolutePath`）。
- `verifyModDirectory()` 校验 Mod 根目录必须包含 `descriptor.mod`；`/api/queue/build` 与 `/api/queue/submit` 在目录非法时直接返回 **409** 与红色阻断提示，不生成 Prompt。
- 统合 Prompt 固定包含 `[Path contract]`：Mod root 可写、原版只读、报告必须给绝对路径；写入后必须调用 `eu4_verify_path`，并通过 `eu4_readback` / `POST /api/verify/readback` 回读。
- 后端回读成功会在控制台打印 `✅ 成功写入文件：<绝对路径>（N bytes）`；批量面板「回读验证」逐条显示 `✓ 已找到（N bytes）` 或 `✗ 未找到`。统合提交 4 秒后会自动回读一次。
- **删除纪律**：修改/删除前必须先 `read` 目标文件确认节点存在；删除原版任务/事件时，必须把原版同名文件**完整复制到 Mod 同路径**再删除节点（完整覆盖），只在 Mod 里新写一个不含该节点的文件不会删除原版内容。
- **删除验证**：`action=delete` 时按目标类型判定——删除节点要求该 `id = {…}` 已不存在；删除整个文件（`deleteFile: true` 或 targetId 是 `.txt` 路径）要求文件不存在。UI 显示「操作类型：删除节点 → 验证结果：节点已成功移除」，删除操作不再显示文件大小。
- 任务面板删除节点会记录 `removedNodeIds`，回读时逐个检查这些 ID 是否已消失（而不是误把文件路径当节点 ID 去搜索）。
- 注意：插件只负责**排队**；`加入队列` 不会写文件。只有 Agent 执行统合 Prompt（复制指令 / 保存待办后再运行）后，文件才会变化——批量面板的「回读验证」会直接告诉你到底写没写。

## 扫描器与路径守卫

- 事件 / 任务 / 理念 / 决议扫描器都对 **vanilla + 当前 Mod** 递归遍历（子目录也算），Mod 覆盖原版；`GET /api/scan/report` 直接返回 Mod 事件/任务/决议/理念文件的**绝对路径清单**。
- Tag 过滤放宽为三重命中：`namespace` 包含 Tag、事件块内**任意** `tag = <TAG>`（trigger / option trigger / immediate / 其他块）、以及 `history/countries/<TAG>.txt` 里的 `country_event = { id = … }` 绑定（开局事件不必再手写 trigger tag）。
- 面板加载、入队、统合提交都会先调 `POST /api/refresh`，清空事件目录 / 决议 / 理念 / 本地化缓存；Agent 写入新文件后立刻能看到。
- 路径守卫：`/api/queue/build` 的 Prompt 固定带 `[Path contract]`（Mod root 可写、原版只读，报告必须给绝对路径）；Agent 写入后必须调 `eu4_verify_path`，`ok=false` 立即回滚并报错。批量面板的「校验写入路径」按钮会对队列目标逐条调用 `GET /api/paths/check`。
- 事件表单新增「预览最终代码」：代码从 `country_event = {` 开始（不再有注释前缀），统合前展示完整事件块、`<ID>.t` / `<ID>.d` 本地化行、开局 `history/countries` 绑定行，并对“普通触发但无 trigger、无 mtth”“缺 Tag”“缺中文”等给出警告。
- Prompt 里固定附 `[Event shell (must match exactly)]`，强制 `country_event = { id / title = "<ID>.t" / desc = "<ID>.d" ... }` 的完整外壳；`duration` 强调是**天数**（5 年 = 1825），UI 的年/天会先换算再传给 AI。

## 相邻省份查询

- `GET /api/provinces/adjacent?id=265` 返回 `{ items: [{ id, label, type, water, through }], total, land, strait, warning, note }`。
- 后端来源：`map/provinces.bmp` + `definition.csv` 逐像素算**陆地接壤**；`map/adjacencies.csv` 提供**海峡/湖泊**跨海连接（Mod 的 csv 会与 vanilla 合并）。海/湖省份不进入陆地邻居，跨海边标记 `type: "strait" | "lake"` 并带 `through`。
- 结果缓存 10 分钟：首次构建约 2 秒，之后查询 0–1ms。
- 地图右侧「省份详情」新增**相邻省份**标签：`[266] 摩拉维亚 (Moravia)`，跨海连接带 🌊；点击直接跳转并高亮，如果当前筛选把目标省过滤掉会自动清空筛选重新加载。
- 无数据时显示友好提示（`该省没有陆地接壤或海峡连接（可能是孤立海岛/海域）`），读取失败也会显示 warning。
- Trigger 构建器新增 `any_neighbor_province`（拥有相邻省份）：在地图选中省份后，条件行会列出其邻居供勾选，生成 `any_neighbor_province = { province_id = 265 }`。

## 长文本多行输入（Auto-resize Textarea）

- 事件描述、决议描述、理念描述、任务描述、GUI tooltip/备注全部换成 `AutoTextArea` 多行组件；标题/ID 等短字段仍是单行输入。
- 高度跟随内容：每次输入用 `scrollHeight` 重算 `height`，`resize: none; overflow: hidden`；最小 60px、最大 400px（任务描述等可单独覆盖），超过最大高度后内部出现滚动条，右下角不再出现拖拽条。
- 回车正常换行、不会提交表单；深色主题沿用 `.eu4w-area` 的背景/边框/字体。
- 描述框右上角带 EU4 yml 排版工具：**【换行】**插入 `\n`（yml 段落换行），**【高亮】**给选中文字首尾插入 `§Y` / `§!`。
- 换行后高度在 80ms 内平滑过渡；粘贴 500 字会先撑到 400px 上限再内部滚动。

## 国家决议 (Decisions)

- 侧栏新增「决议」标签：解析当前 Mod + 原版 `decisions/*.txt` 的 `country_decisions = { <id> = { … } }`，中文标题/描述取自 `<id>_title` / `<id>_desc`，可勾选「仅显示当前 Tag」。
- 表单：决议 ID、中文标题/描述、图标（可选）、`ai_will_do`（默认 1，0 = AI 永不选择）；条件与效果复用现有构建器。
- **potential 与 allow 严格分离**：`potential` 只决定是否可见（默认 `tag = <activeTag>`），`allow` 决定是否可点击。UI 文案与 AI Prompt 都明确要求不得混用（写反会“一直显示但不能点”或“永远不显示”）。
- 前端打包 `DecisionConfig`（英文 key、中文值）：

  ```json
  { "id": "tbo_decision.1", "title_cn": "最后的防线", "desc_cn": "……",
    "potential": [{ "type": "tag", "op": "=", "value": "TBO" }],
    "allow": [{ "type": "stability", "op": "=", "value": "1" }],
    "effects": [{ "effect": "add_stability", "value": "1" }], "ai_will_do": 1 }
  ```

- 统合队列：`targetType: "decision"`，目标文件只能是 Mod 的 `decisions/*.txt`；效果里的新修正同样自动生成 `mechanic` 任务；Prompt 强令生成 `<id>_title` / `<id>_desc` 本地化并调用 `validate_script`。
- 事件树：决议 effect 引用的事件会生成 `decision:<id>` 节点和紫色虚线边；`potential` 里的 Tag 参与全局 Tag 过滤。
- API：`GET /api/decisions?tag=TBO`、`POST /api/queue`（targetType `decision`）、`POST /api/ai/build`（`kind: "decision"`）。

## 开局外交关系 (Diplomacy)

- 侧栏新增「外交关系」标签：国家 A/B、关系类型（同盟/王室联姻/附庸/联统/战争/停战期/保障独立/宿敌）、额外参数、开始时间；A = B 直接报错，Tag 非 3 位字母数字给警告。
- **语法纠正**：EU4 的 `history/diplomacy` **不使用日期块**，没有 `1437.1.1 = { ... }`；每个关系块内写 `start_date = 1437.1.1`（原版 `AustriaHungaryBohemia_alliances.txt` 即此格式）。写日期块会被解析器当成未知顶层键。
- 关系落点：
  - `alliance` / `royal_marriage` / `vassal` / `union` / `guarantee` → Mod 的 `history/diplomacy/zz_eu4_workbench_diplomacy.txt`；
  - `war` → Mod 的 `history/wars/zz_eu4_workbench_diplomacy_wars.txt`（`war_goal` + 日期块 `add_attacker` / `add_defender`）；
  - `truce` / `rival` → Mod 的 `common/on_actions/zz_eu4_workbench_on_actions.txt` 的 `on_startup`（`add_truce_with` / `add_historical_rival`，双向绑定）。
- 方向约定：`vassal` 的 `first = 宗主`、`second = 附庸`；`union` 的 `first = 主导国`、`second = 被联统国`；`guarantee` 的 `first = 保障国`。回读若发现方向写反会报错并提示交换。
- `DiplomacyConfig`：`{ tagA, tagB, relationType, extraParams, startDate }`；战争 `extraParams = cb_conquest`，停战期填结束年份（EU4 的 `add_truce_with` 默认 5 年，无法精确指定结束年，字段仅记录）。
- 回读：解析原生块/战争文件/on_actions，检查 `first`/`second`/`start_date`/CB/括号闭合；批量面板对外交关系显示黄色警告或红色失败。
- API：`POST /api/queue`（targetType `diplomacy`）、`POST /api/verify/readback`（带 `tagA`/`tagB`/`relationType`/`extraParams`/`startDate`）。

## 内存、缓存与熔断

- 插件**没有** `fs.watch`/chokidar；不存在 BOM 写入监听循环。`.yml` 只由 AI 写入一次，回读只读。
- 本地化扫描改为**逐文件回调**（`parseLocalisationFolder(dir, onEntry)`），只保留中文键（`localisationCache`），不再保留全语言 `localisationAllCache`；原实现 `Object.assign(out, ...)` + 双 Map 在 58MB 原版 localisation 上单次可占约 960MB。
- `localisation()` 用 **single-flight**：`nationalIdeasFile` 的 `Promise.all` 会并发查 14 个键，旧逻辑会同时建 14 份字典（可达 1.2GB）；现在只建一份，并且返回缓存本身而不是每次 `new Map(cache)` 复制 12 万条。
- 事件目录仍逐文件读取（`text` 是局部变量，读完即丢）；每 200 个文件检查堆，邻接 BMP 每 256 行检查堆。
- `adjacencyMap` 的 1150 万像素不再整体放进 `Uint32Array`（省 46MB/次），改为逐行两行缓冲；并发调用用 single-flight 合并。
- `assertHeap()` 默认 **1024MB** 熔断：超过即释放缓存并抛 `MEMORY_GUARD`，不会把 Host 撑到 3.4GB；`GET /api/memory` 可看当前 heap。
- 插件卸载/重载时通过 `ctx.effect` 调用 `wb.dispose()` 清空大缓存，避免 HMR 反复加载后旧引擎残留。

## 修正字典与树状选择

- `MODIFIER_DEFS` 覆盖 **325 条**数值型修正键，全部来自 `lib/docs-data.json`（游戏自身 `modifiers.txt` 的文档），并逐条配中文名；不再暴露 `global_unrest` 这类英文 Key 作为标签。
- 分类树：**军事 / 经济 / 外交 / 内部 / 其他**，每类下再分陆军、海军、将领、要塞、税收、贸易、发展、科技、财政、外交、附庸、战争、间谍、殖民、稳定、叛乱、宗教、文化、省份、舰队等分组。
- `ModifierTreeSelector`：三级折叠树 + 即时搜索（中文名 / 英文 key / 拼音别名，如 `士气`、`shiqi`、`morale`、`global_unrest`）；行内显示 `[分类] 中文名 (english_key)`，选中后输入框只显示中文名，底层绑定与入队的一律是纯英文 key。
- 反查：`modifierLabelOf('global_unrest')` → `全局叛乱度`，`modifierCategoryLabelOf` → `内部`；表单里已有的英文 key 挂载时自动回显中文，未收录的自定义 key 回退显示原始 key。
- 换算：`type` 三态 —— `percentage`（0.10 显示 10%）、`integer`（−3 显示 −3）、`decimal`（0.1 显示 0.1）。`MODIFIER_OPTIONS` / `EFFECT_OPTIONS` 都带 `type`。
- 应用范围：国家理念（起始传统 / 野心 / 7 个理念，支持一个理念多条修正）、政体改革、机制面板、事件/任务效果里的修正参数。

## 修正数值单位

- `MODIFIER_OPTIONS` / `EFFECT_OPTIONS` 的每个词条都带 `type: 'percentage' | 'integer' | 'decimal'`。
- UI 的修正输入框显示**玩家单位**：百分比修正显示 `5` + `%`，底层自动写 `0.05`；整数修正显示 `20`，底层写 `20`；`decimal` 原样显示（如每年绝对主义 `0.1`）。
- 读取已有 JSON 时反向转换：`0.05` 显示为 `5%`，`20` 显示为 `20`；输入 `1.05` 表示 `1.05%`，不会再变成 105%。
- 切换修正类型时保持当前显示数字不变，自动换算底层值。
- 覆盖范围：国家理念、政体改革、事件/任务效果、修正配置器、机制面板。

## 切换标签不丢输入（无草稿层）

- 表单数据放在客户端内存里的 `formMemory`，由 `useFormState(key, initial)` 读写：切换标签（组件卸载/重挂）后回来，输入内容还在。
- **没有草稿机制**：不写 `localStorage`、没有脏标记/草稿角标、没有「保存草稿」按钮、切换标签和关闭页面都不再弹确认。
- 刷新页面会丢弃这些内存值（这是有意的：不再有跨会话草稿）。
- 顶栏保留三个内存剪贴板按钮：**复制当前表单 / 粘贴到当前表单 / 清空剪贴板**；只有当前挂载的标签能作为复制/粘贴目标。
- 跨面板适配仍有效：事件 → 任务粘贴时，事件的 `options[].effects` 会写入任务节点的 `rewards`；任务 → 事件则反向提取。
- 加入统合队列成功后，对应面板调用 `reset()` 回到初始值；未提交的输入留在内存里等待下次编辑。

## 文化全量字典

- [lib/cultures-data.ts](eu4-mod-workbench/lib/cultures-data.ts) 由原版 `common/cultures/00_cultures.txt` 生成：71 个文化组、414 个文化。
- `CULTURE_GROUPS` 保留层级：`{ group_id, group_name, cultures[{id,name}] }`；`CULTURE_OPTIONS` 是带 `group/group_name` 的扁平选项。
- 文化字段使用 `CultureTreeSelect`：一级可折叠文化组（▶/▼，父节点不可选），二级具体文化；选中后输入框只回显中文名，底层绑定英文 id。
- 搜索联动：匹配子文化时自动展开所属组；匹配文化组时保留整组；命中文字用 `<mark>` 高亮。支持中文、英文 id、常见拼音（如 `xixili`、`sikandinaweiya`）。
- 表单记忆/剪贴板恢复 `culture: "sicilian"` 时自动展开“拉丁组”并回显“西西里”。
- 414 个文化已有 414 个中文标签（含失落文化：腓尼基/帕提亚/巴比伦等）；缺词补录仍保留，用于未来 Mod 新增文化。

## 动态本地化与缺词补录

- `parseLocalisationFolder()` / `parseLocalisationText()` 递归扫描 `localisation/`（含 `replace/`），处理 UTF-8 BOM 与 `KEY:0 "值"`，结果缓存在 `localisationCache`。
- 只合并含中文的 `.yml` 值；优先级：**用户 custom-dictionary > Mod .yml > 原版 .yml > 静态字典**。
- 自定义词条写入插件状态目录的 `custom-dictionary.json`；接口 `POST /api/dictionary/custom`。
- 有翻译时显示 `中文 (english_id)`；缺失时显示英文并出现 ✏️，录入后调用 `reloadLocales()` 立即刷新。

## 自检

```bash
node scripts/build.mjs
node test/smoke.mjs
node test/http.mjs
node test/client-smoke.mjs
node test/tag-filter.mjs
node test/ai-payload.mjs
node test/ui-locales.mjs
node test/nl2code.mjs
node test/batch.mjs
node test/startdate.mjs
node test/modifier-values.mjs
node test/store.mjs
node test/cultures.mjs
node test/localisation.mjs
node test/provinces.mjs
node test/queue-actions.mjs
node test/ideas.mjs
node test/modifiers.mjs
node test/event-startup.mjs
node test/event-select.mjs
node test/new-modifier.mjs
node test/decisions.mjs
node test/auto-textarea.mjs
node test/scan-tag.mjs
node test/writeback.mjs
node test/adjacency.mjs
```

## 已知限制

- 脚本文档索引来自 [vawser/EU4-Documentation](https://github.com/vawser/EU4-Documentation)，
  并在 `docs-data.json` 中记录来源；游戏自带 `script_docs` 存在时可优先替换。
- 地图是简化网格，不是像素地图。
- 事件脚本编辑当前以详情 + 文件路径为主；“AI 填空”通过 Agent 工具链完成，不内置 LLM 调用。
- 外部工具未安装时只显示状态，不会自动安装或后台启动。

## 许可

MIT，见 [LICENSE](LICENSE)。`lib/docs-data.json` 的再分发请同时遵守其来源仓库的许可。
