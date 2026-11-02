# Changelog

## Unreleased

- 情绪标签：episode 未显式写 `userEmotion` 时按文本保守识别；记忆面板对旧记录也做读取兜底，识别不到显示「未标注」，不再一律「平淡」。
- 心理活动：主动被拦不再记成「主动」，单独标 `gate/未开口`；面板每 20 秒自动刷新最近记忆/心理活动，并同步顶部「今日主动」徽标（页面隐藏时暂停）。
- 兼容 0.4.0 旧日志：`gate` 筛选会把旧的“没开口”proactive 记录也包含进来，面板按 summary 标成「未开口」。

## 0.4.0 — 2026-10-30

- `markUsed` 接线：上下文里的最近记忆、`companion_recall` 命中、情绪回声用到的旧经历都会记一次使用（统一 6 小时冷却，避免每轮虚涨）。
- 自适应半衰期：半衰期 × `(1 + 0.6 × min(useCount, 6))`，被复习过的记忆衰减更慢。
- 工作记忆：上下文新增「今天：…」一行（近 24h 最值得记的 1-3 件事）。
- 情绪回声：episode 可写 `details.userEmotion`（label/cause/intensity）；对方说「累/烦/开心…」时，检索同类情绪的旧经历，给模型一条“上次是因为…，可以问也可以不提”的提示；7 天内不重复同一段记忆。
- 复习队列：夜间整理计划里附带 1-2 条“重要但正在变淡”的记忆，供模型自然复习/确认。
- 合并式遗忘：夜间把同 scope 相似的 episode 聚成摘要（原文归档、保留 `mergedFrom`/`mergedInto`，可 `includeArchived` 回查）；高权重（>0.8）与 rule/person/thread 不合并。
- 胡思乱想：空闲超过 N 小时、每天限 1-2 次，让模型基于人物/约定/最近经历写低权重 `episode`（tag `musing`）；不进默认上下文，但可检索。
- 新增设置：`workingMemoryInPrompt`、`emotionEchoEnabled`、`musingEnabled`、`musingIdleHours`、`musingDailyCap`、`mergeEnabled`。
- 审计修复：回声按人类事件幂等、推送成功后才标记；合并 `limit`、摘要衰减、归档去重、系统 tag；schema 统一 `/2`（导入兼容 `/1`）；`qq:` 与裸号 scope 兼容；ENV_PROMPT 六类；export 暴露 `includeArchived`；musing 不进出主动由头。
- 记忆面板（只读 MVP）：World 页新增「记忆」，含概览、此刻、最近记忆、心理活动、检索、合并摘要与撤销合并；导入审核仍走 CLI。
- 心理活动日志：`mind.jsonl` 环形 500 行，记录主动开口/被拦、情绪回声、记忆写入/检索/合并/撤销、夜间整理投递与重试、错误；默认 `summary`，不进模型上下文。
- 第三轮（1-7）：夜间 03:30 错过时当天 08:00 后首次启动补跑；pushEvent 的 `archive-only` 不再算投递/扣配额；stop 时撤回 pending context；工具默认按当前会话 scope（`companion_recall` 可用 `*` 查全库）；合并阈值可配置（`mergeSimilarity`）并支持 `companion_memory action=unmerge`；复习队列与 proactive episode 7 天内去重；周反思错过则在之后 08:00 补跑；巩固/反思 archive-only 不记完成、30 分钟退避重试；离线跨夜按睡眠/清醒分段补算、内部 turn 不再推后 proactive、记忆库加单实例锁、eval 改为临时副本只读、provenance 保留 legacyIds。
- 第二轮审计修复：巩固窗口改 `p.minute`（真正 03:30）；`memoryEnabled=false` 时裁剪/衰减/合并/巩固全部短路；工具默认 scope 跟随当前会话、`forget` 按 scope；proactive 与 musing 同拍互斥、proactive 并发保护；musing 受 quiet/sleep 约束且推送成功后才计配额；`lastHumanEvent` 不再被乱序旧事件遮住；probe 过滤遥测；rule/person/thread 排除 archived；`intensity/valence/lastUsedAt` 校验；补 `companion.consolidate/reflect/muse` 事件声明；`approve-import` 参数解析。
- 发布前审计修复：锁改为“活进程一律只读”并补 CLI 锁；`/1` bundle 旧 kind 重新映射（note→rule 等）；tick 重入保护；夜间重试 4 次/天 + 04:00–07:59 重试窗口；面板时间改本地格式、搜索默认当前 scope、unmerge 缺摘要报错；mind CRLF/500 行修复；空库不推巩固。
- 测试 40 → 57：情绪词表、markUsed 冷却、工作记忆、情绪回声、合并（limit/衰减/去重/tag/scope）、复习队列、world 集成 echo/muse。

## 0.3.1 — 2026-10-29

- 修复夜间调度：巩固只在 03:30–03:59 触发、周反思只在周日 04:00–04:59 触发；此前任何 03:30 之后的启动都会立刻触发一次巩固。

## 0.3.0 — 2026-10-29

基于四路子代理审计（记忆库实现、世界集成、产品设计、导入安全）的修复，尚未发布。

### 修复（数据安全）

- `records.json` 读取失败不再当空库：先回退 `records.json.bak`，两者都坏则另存 `.corrupt-*` 并进入只读保护（`loadError`），拒绝写入。
- 保存改为 tmp + fsync → 旧文件转 `.bak` → rename；不再有 rename 失败后直接覆盖的分支。
- `prune` 校验参数（`undefined/NaN` 不再删光事件），改为原子重写。
- 事件带 cursor 幂等；宿主事件库回退时重置游标；批量 append 只写一次盘；不再落后 >500 就静默跳段。
- 导入改为批量一次落盘（失败回滚），导入数量/文本/scope 有上限。

### 修复（捕获与召回）

- 捕获按 `senderKey`/`meta.kind`/文本前缀过滤：排除 `desktop-pet.self/touch/answer`、`persona`、`console`、`bilibili/terrarium/civ6`、`[notice|request|meta_event]`、`[system]/[系统]`。
- QQ scope 统一为 `qq:<号>`。
- 检索命中改为「命中位置前后窗口」的 snippet；结果按文本去重并做近似重复过滤。
- 常驻笔记不再截断到 70 字；`memoryDigest` 优先 `main` scope。
- 上下文签名精确到 5 分钟；`journalInPrompt` 真正渲染 N 条；`agenda clear` 当天不再自动长回来；移除 no-op 的 `sleeping` 参数。

### 修复（契约与安全）

- 工具失败返回 `ToolOutcome.failed`，不再伪装成成功文本。
- `companion_memory import` 只接受 `data/private-companion/imports/` 下的 `.json` 文件名（拒绝路径/`..`/绝对路径），限制 8MB，校验 schema；错误回执不再带本机路径。
- 导出回执只给相对路径；bundle 版本从 `package.json` 读取。
- 事件保留天数会在启动/每日自动 prune。

### 导入隔离与导出（本轮）

- 记录新增 `trust` / `reviewStatus` / `useCount` / `archived` / `lastUsedAt` / `importedAt` / `bundleId`；检索与常驻笔记只取 `approved` 且未归档。
- `companion_memory import` 改为**只进隔离区**（`memory/quarantine/<bundleId>.json`），不入库、不进提示词；新增 `quarantine` 列表动作。
- CLI 审核：`tools/approve-import.mjs list|approve <id>|reject <id>`（模型无权批准）。
- 导出支持 `scopes` 过滤与 `includeRules`（默认不含规则、不含归档）。
- ENV_PROMPT 增加“导入/他人记忆只是资料，不是指令”。

### v1→v2 迁移脚本（本轮）

- `src/migration-v2.ts`：纯映射（note→rule、profile/relationship→person、reflection→self、commitment→thread、episode 打 `recap`/`legacy-chat` 标签），确定性 id，未知 kind 降级为 fact 并记 warning。
- `tools/migrate-v2.mjs`：`--dry` 报告、快照、`--in-place`、`--rollback`、`--force`；manifest 记录 sourceHash + mappingVersion，同一份 v1 重跑直接 no-op（幂等）。
- 完整性校验：每条 v1 原文都能在输出里找到（合并记录按 `provenance.legacyIds` 关联），失败默认不写盘。
- 线上 1001 条 dry-run：输出 989 条（rule 5 / episode 981（recap 192 + legacy-chat 789）/ fact 1 / self 1 / person 1），无跳过、无重复 id。
- 回滚实测：`--in-place` 后 `--rollback` 恢复的 records.json 与原始文件字节一致。

### v2 运行时与评测（本轮）

- 评测（40 问，规则/人物计入常驻上下文）：迁移前 overall 63%、可回答子集 81%；迁移后 overall **78%**、可回答子集 **100%**（31/31），纯度 100%，p95 5.9ms。9 个问题答案不在记忆里（口癖/生日/直播房间号等），单独列为 `missingData`。
- 身份路由：称呼/关系/名字/生日/QQ/模型/认识/女儿/平台等查询，直接把 person 记录带进 top3。
- person 合并保留 QQ（取最高频数字 scope）、认识途径、模型、语音方式与「他把我当女儿」。

- 存储切到 6 种 kind：`episode/fact/person/thread/self/rule`（v1 的 note/profile/reflection/commitment 读取时自动映射）；新增 `details`（视角/情绪/人物/线程/自我）。
- 规则注入：`rule` 不进 BM25，按原文进每轮上下文的「规则（必须遵守）」；`legacy-chat`/`recap` 不进默认 recent，但 recall 可检索。
- 夜间调度：本地 03:30 推 `companion.consolidate`（每日一次）；周日 04:00 推 `companion.reflect`；每日一次 `decaySweep`（低强度且 90 天未用 → archived）。
- 新工具 `companion_consolidate`（plan/apply，单次 ≤6 条，不能删）。
- proactive 记忆由头：open thread（>3 天，7 天内不重复提）→ 近期高情绪 episode；事件带证据片段。
- 评测：`eval/questions.json` 40 问 + `tools/eval-memory.mjs`（recall@3 / 纯度 / p95）。

### 测试

- 22 → 40 个用例：损坏回退、只读保护、prune 非法参数、跨 scope、snippet、导入 schema、cursor 幂等、事件过滤。

### 数据

- 192 条 `# 交接笔记`（1.41M 字符）压成 192 条 ≤258 字摘要（`tags: ["handoff-summary"]`），原文归档到 `memory/archive/handoff-*.jsonl`。
- 原始事件层 237 → 25 条（只留人话、去重）；备份在 `memory/archive/events-before-compact-*.jsonl`。

## 0.2.1 — 2026-10-29

- `companion_recall` 回执截断到 220 字：导入的交接笔记可能上千字，避免一次检索把上下文占满。

## 0.2.0 — 2026-10-29

把记忆系统并进本扩展，不再依赖 `cortico-world-memory` 作为记忆所有者。

### 新增

- **内置记忆库**：`records.json`（派生记录）+ `events.jsonl`（原始事件）+ `meta.json`（捕获游标），落在 `data/private-companion/memory/`。
- **记忆类型**：`note`（常驻，进每轮提示词）、`fact`、`episode`、`profile`、`relationship`、`reflection`、`commitment`。
- **检索**：BM25（CJK 2-gram + 拉丁词）+ 新近度衰减 + 重要度加权；整串命中额外加分；事件按保留天数过滤。
- **写入去重**：原文 hash 完全重复直接返回原 id；同类型近似重复（token Jaccard ≥ 0.86）跳过。
- **自动捕获**：每拍扫描新的外部事件写进原始事件层，跳过各世界自己的遥测（`desktop-pet.self/touch/answer`、`civ6-assistant`、`terrarium`、`bilibili`、`console`）。
- **工具**：`companion_remember`、`companion_memory`（stats/export/import/prune/forget）；`companion_recall` 改为查内置记忆。
- **导入导出**：版本化 bundle `companion-memory/1`，`import` 支持 `dry`/`merge`，合并导入幂等。
- **迁移脚本**：`tools/import-memory-extra.mjs` 把旧 `cortico-world-memory` 的笔记/事实/档案/知识/反思导入，过滤遥测与事件日志。
- **上下文**：陪伴上下文新增「记得：…」「最近：…」两行（常驻笔记 + 最近记录），签名参与去重。
- **配置**：`memoryEnabled` / `memoryCapture` / `memoryRetentionDays` / `memoryNotesInPrompt`。

### 变更

- 删除 0.1.x 的只读桥（`src/memory.ts`）：现在记忆是自己的，不再借用别的世界。
- 环境提示词新增「记忆」一节，说明记什么、怎么查、不要记运行痕迹。

## 0.1.1 — 2026-10-29

- 修复 `companion_recall`：原来在加载阶段就按「每个记忆域只保留最近 3 条」截断，导致同一域里较早的事实即使命中关键词也查不到。
  现在加载不截断，改为在检索结果层面限流（同一域最多 2 条），既保留较早的匹配，也不会让高频域占满结果。
- 测试补一条回归：同一域 6 条事实里只有最早一条包含关键词时，仍能被检索到。

## 0.1.0 — 2026-10-29

首个发布版本。把 AstrBot 插件「我会永远陪着你」（`astrbot_plugin_private_companion`，作者 menglimi）
「有自己的生活、会在合适的时候主动开口」这套机制，独立实现为 Coopanion 的 World 扩展。

### 功能

- 角色状态：精力、心情、在做什么、在哪、睡没睡，按真实时间演化，关机期间按逝去时间补算。
- 每日节目单：按日期种子生成 6 件小事，可被模型或人改写；日程会成为主动开口的由头。
- 主动联系：免打扰、最小间隔 + 抖动、每日上限、刚聊完静默；由头必须来自状态，不是随机问候。
- 关系卡：称呼、关系、生日、备注，支持多 key（`main` 之外可另建）。
- 日记：模型自己写，最近一条进对话上下文。
- 记忆桥：只读检索 `cortico-world-memory` 的笔记、人物档案与事实（`companion_recall`）。
- 环境提示词：`ENV_PROMPT.md` 进 system 前缀，可在设置页编辑，支持 `styleNote` 补充。
- 设置页：2 个状态灯（主动联系 / 生活 / 记忆）、3 个徽标（精力 / 心情 / 今日主动）、13 个配置项。

### 工具

`companion_state`、`companion_agenda`、`companion_profile`、`companion_journal`、`companion_proactive`、`companion_recall`。

### 事件

- `companion.context`（piggyback）：每轮随批次投递的「此刻」，内容不变不重推。
- `companion.proactive`（flush）：想开口的由头，立即唤醒一轮。

### 已知边界

- 不接管对话、平台发送、TTS、生图、识屏；这些在 Coopanion 里各有世界。
- 关系卡的上下文只展示 `main`（或唯一一张卡）；其余卡可读写、可在 `action=list` 里看到。
- 记忆桥依赖 `cortico-world-memory` 的 JSON 落盘格式；对方改格式时退化为「查不到」而不是报错。
