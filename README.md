# 我会永远陪着你 · Coopanion 版

**内置可迁移记忆**：`companion-memory/2`，支持导入/导出、隔离审核、v1→v2 迁移。

> 把 AstrBot 插件 [`astrbot_plugin_private_companion`](https://github.com/menglimi/astrbot_plugin_private_companion)（中文名同样是「我会永远陪着你」）里
> **“有自己的生活、会在合适的时候主动开口”** 这套机制，独立实现成 Coopanion 的 World 扩展。

npm：`cortico-world-private-companion` · 当前 `0.4.0`（已发布）。首次升级请先备份 `records.json`/`.bak`/`state.json`：0.4 首次启动会按需补跑夜间整理。

## 致谢与来源

- **原作者：menglimi**，原项目：[menglimi/astrbot_plugin_private_companion](https://github.com/menglimi/astrbot_plugin_private_companion)（AstrBot 插件，7.0.0）。
  生活连续、主动联系、关系卡、表达分寸这些产品设计来自原作者，本项目只是把它们搬到桌宠上的另一种实现。
- 原插件文档：[插件 Wiki](https://vue.syuan.org)；提示词的组织方式可参考原仓库的 `docs/PROMPTS_INVENTORY_20261018.md`。
- **本项目是独立实现**：TypeScript 重写，不含上游 Python 代码；`ENV_PROMPT.md` 的分寸文案为本项目自写（只借鉴“要有由头、状态归属、别播报清单”这些结论），不是上游提示词的拷贝。
- 名字与显示名沿用原插件，作为来源标注；如果原作者认为不妥，改掉即可。
- 图标由使用者提供（蓝发精灵形象），仅用于本扩展的卡片头像。

## 它做什么 / 不做什么

| 机制 | 这里有 | 说明 |
| --- | --- | --- |
| 角色状态 | ✅ | 精力、心情、在做什么、在哪、睡没睡；随真实时间演化，关机再回来按逝去时间补算 |
| 每日节目单 | ✅ | 按日期做种子生成几件小事，可被模型或人改写；日程会成为主动开口的由头 |
| 主动联系 | ✅ | 免打扰、最小间隔 + 抖动、每日上限、刚聊完静默；由头必须从状态/时段里推出来，不是随机问候 |
| 关系卡 | ✅ | 称呼、关系、生日、备注；支持多 key，模型可读写 |
| 日记 | ✅ | 模型自己写，最近一条进对话上下文 |
| 内置记忆 | ✅ | 原始事件层 + 六类派生记录（episode/fact/person/thread/self/rule）；BM25（CJK 2-gram）+ 新近度 + 重要度 + 身份信息；规则常驻、人物摘要、工作记忆、情绪回声；完全重复与近似重复去重 |
| 复习与遗忘 | ✅ | `useCount` 强化 + 自适应半衰期；夜间复习队列；相似 episode 合并成摘要（原文归档、`mergedFrom` 可回查） |
| 胡思乱想 | ✅ | 空闲时基于人物/约定/最近经历写低权重 `episode`（tag `musing`），每天 1-2 次；不进默认上下文，可检索 |
| 记忆导入导出 | ✅ | 版本化 bundle（`companion-memory/2`）；`companion_memory` 的 stats/export/import/prune/forget；导入隔离区 + CLI 审核；v1→v2 迁移脚本 |
| 原插件的记忆引擎 | ❌（未照搬） | 原插件 7.x 自带独立 SQLite 记忆（来源记忆/画像/共同经历 + 混合召回 + 每日反思）。本移植没有沿用它的实现，而是内置了自己的记忆库（0.2.0），旧数据可以用脚本导入 |
| 说话分寸 | ✅ | 一段可编辑的环境提示词（`ENV_PROMPT.md`），进 system 前缀 |
| 人格本身 | ❌（不归它管） | 人格仍由 `CONSTITUTION.md` 提供；本扩展只加“过日子”的那一层 |
| 对话管线 / 平台 / TTS / 生图 / 识屏 / 群聊 | ❌ | 这些在 Coopanion 里各有世界（memory / onebot / bilibili / terrarium…），本扩展不碰 |

## 安装

### 从 npm（推荐，便于后续更新）

在 Coopanion 的扩展工作区里加依赖：

```powershell
cd "D:\Coopanion\data\extensions"
# package.json → dependencies 加：
#   "cortico-world-private-companion": "^0.4.0"
node "D:\Coopanion\resources\app\node_modules\pnpm\bin\pnpm.cjs" install --no-frozen-lockfile
```

重启 Coopanion，在 `data/home/companion/config.json` 的 `worlds` 里写 `"companion": { "enabled": true }`
（或在设置页开），再重启一次。扩展是 ESM，运行期不热替换。

> 市场页/`npm search` 对新包有延迟（按 `cortico-world` 关键字抓取），看不到时直接用上面的包名装。

### 本地开发（link）

```powershell
# package.json → "cortico-world-private-companion": "link:D:/path/to/this/package"
node "D:\Coopanion\resources\app\node_modules\pnpm\bin\pnpm.cjs" install --no-frozen-lockfile
```

> 必须用 Coopanion 自带的 pnpm（11.28.x）；`CI=true` 会默认 frozen-lockfile 并先把 `node_modules` 删掉再失败。

数据落在 `<Coopanion>/data/home/companion/data/private-companion/`：`state.json`、`profiles.json`、`journal.jsonl`，
记忆在 `memory/`（`records.json` 派生记录、`events.jsonl` 原始事件、`exports/` 导出）。

## 配置

| 键 | 默认 | 作用 |
| --- | --- | --- |
| `enabled` | false | 世界开关（必须为 true 才挂载） |
| `proactiveEnabled` | true | 主动联系总开关 |
| `proactiveMinGapMin` | 90 | 两次主动的最小间隔 |
| `proactiveJitterMin` | 12 | 在最小间隔上加的随机抖动，避免每天准点 |
| `proactiveDailyCap` | 4 | 每日上限；0 = 不限 |
| `idleGateMin` | 15 | 对方刚说完话的静默窗口 |
| `quietStart` / `quietEnd` | 23:00 / 08:30 | 免打扰时段（支持跨零点） |
| `sleepStart` / `sleepEnd` | 00:30 / 07:30 | 睡觉时段：精力回升，不主动 |
| `agendaEnabled` | true | 自动生成每日节目单 |
| `energyDecayPerHour` | 2.5 | 醒着时每小时掉的精力 |
| `journalInPrompt` | 1 | 上下文里带几条最近日记 |
| `memoryEnabled` | true | 内置记忆总开关 |
| `memoryCapture` | true | 自动把外部消息追加进原始事件层 |
| `memoryRetentionDays` | 45 | 原始事件保留天数 |
| `memoryNotesInPrompt` | 6 | 常驻规则进提示词的条数 |
| `workingMemoryInPrompt` | true | 把「今天聊过什么」压成一行进上下文 |
| `emotionEchoEnabled` | true | 对方有明显情绪时，提示「上次同类情绪的原因」 |
| `musingEnabled` | true | 空闲时允许胡思乱想（多一次模型调用） |
| `musingIdleHours` | 4 | 空闲多少小时后允许胡思乱想 |
| `musingDailyCap` | 2 | 每天最多几次 |
| `mergeEnabled` | true | 夜间是否合并相似经历（合并式遗忘） |
| `mergeSimilarity` | 0.5 | 合并相似度阈值（0.3 激进 / 0.9 保守） |
| `mindLogLevel` | summary | 心理活动日志：off 关闭 / summary 只记决策 |
| `cognitionMode` | off | 背景念头：off / shadow 只记念头 / act 允许写日记、休息（不自动发消息） |
| `cognitionIntervalMin` | 10 | 两次背景念头的最小间隔（分钟） |
| 夜间补跑 | 自动 | 03:30 错过时 08:00 后补跑；archive-only 不记完成，30 分钟退避重试 |
| `styleNote` | 空 | 追加到环境提示词末尾的风格补充 |

## 工具（模型自己用）

- `companion_state` — 读/改自己的状态
- `companion_agenda` — 读/改今日节目单
- `companion_profile` — 读/写关系卡（`action=list` 列出所有卡）
- `companion_journal` — 写/读日记
- `companion_remember` — 写入记忆：`episode`（可带 `userEmotion`）/ `fact` / `person` / `thread` / `self` / `rule`；`tags: ["musing"]` 表示胡思乱想
- `companion_recall` — 在记忆库里检索（记录 + 最近捕获的对话；`includeArchived` 可翻合并前的原文）
- `companion_memory` — 维护：`stats` / `export` / `import` / `prune` / `forget`（import 只读 `data/private-companion/imports/` 下的 `.json`）
- `companion_consolidate` — 夜间整理：`plan` 取材料，`apply` 提交 0-6 条记录
- `companion_proactive` — 检查现在会不会开口、被什么拦着；`trigger` 仅供测试

## 记忆面板

World 页新增「记忆」面板（`src/webui/client.js`）：

- **概览**：记录/事件数、kind 与 scope 分布、规则/人物/话头、归档、合并摘要、隔离区、上次巩固/合并/反思；
- **此刻**：心情/精力/正在做什么/下次主动、今日主动与走神额度；
- **最近记忆**：最近 12 条，带情绪标签、类型、重要度；
- **心理活动**：只记决策的时间线（主动/回声/记忆/夜间/错误），可按类型过滤；
- **检索**：关键词 + scope（`main` / `qq:<号>` / `*`），只读；
- **合并摘要**：列出夜间合并的结果，可点「撤销合并」恢复原文（唯一写操作）；
- **导入审核仍然只走 CLI**：面板不提供批准/拒绝，避免把审核边界搬到浏览器。

## 事件

- `companion.context`（piggyback）：每轮随批次投递的“此刻”，内容没变就不重复推。
- `companion.proactive`（flush）：现在想开口，带一段由头，立即唤醒一轮由角色决定说不说。
- `companion.consolidate`（flush）：03:30 夜间整理；未投递/archive-only 会 30 分钟退避重试，最多 4 次/天。
- `companion.reflect`（flush）：周日 04:00 周反思；错过则在之后每天 08:00 补跑。
- `companion.muse`（flush）：空闲胡思乱想，每天最多 2 次，不主动发消息。

## 开发

```bash
node --test            # 64 个用例：时区/状态/主动/记忆库（损坏恢复、去重、检索、隔离区、导出 scope、裁剪、事件过滤、情绪/复习/合并/musing）
node tools/import-memory-extra.mjs --dry   # 预览从旧记忆库能导多少
node tools/eval-memory.mjs                 # 32 问记忆评测：recall@3 / 纯度 / p95
node tools/eval-persona.mjs                # 6 问人格卡评测（CONSTITUTION）
node tools/smoke.ts    # 假宿主冒烟：状态、工具、主动推送、webUi
node tools/gen-describe.mjs
```

发布流程见 [`PUBLISH.md`](./PUBLISH.md)。

## v1 → v2 迁移（类型收敛）

```bash
# 只报告，不写文件
node tools/migrate-v2.mjs --dry

# 写快照 + migration/records.v2.json（不覆盖 records.json）
node tools/migrate-v2.mjs

# v2 存储上线后正式切换（先快照）
node tools/migrate-v2.mjs --in-place

# 回滚到最近一次快照（字节一致）
node tools/migrate-v2.mjs --rollback
```

同一份 v1 重跑会被 manifest（`migration/v1-to-v2.json` 里的 `sourceHash` + `mappingVersion`）识别为已迁移，直接跳过；`--force` 可强制重跑。

## 从 `cortico-world-memory` 迁移

```bash
# 停掉 Coopanion 后（避免两边同时写）
node tools/import-memory-extra.mjs --data "D:/Coopanion/data/home/companion/data"
```

脚本只读旧库的 `memory-data.json` / `fact-store.json` / `user-profiles.json` / `knowledge-base.json` /
`reflection-data.json`，按类型写进 `private-companion/memory/records.json`；可重复跑（内容 hash 去重）。
QQ 事件日志、动作流水、`terrarium/bilibili/civ6` 等遥测域会被过滤掉，不当作记忆。
迁完后在配置里把 `worlds.memory.enabled` 关掉（或卸载 `cortico-world-memory-extra`），只留本扩展记忆。

## 许可

代码 MIT（见 `LICENSE`）。上游项目未声明许可证，本项目未复制其代码；如要再分发本扩展，请保留上面的致谢。
