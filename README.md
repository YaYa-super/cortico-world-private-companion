# 我会永远陪着你 · Coopanion 版

**内置可迁移记忆 × 可选 QQ/B站通道**：记忆不是孤岛——QQ 的消息、B站的观看、主动开口的由头共用同一份上下文。

> 把 AstrBot 插件 [`astrbot_plugin_private_companion`](https://github.com/menglimi/astrbot_plugin_private_companion)（中文名同样是「我会永远陪着你」）里
> **“有自己的生活、会在合适的时候主动开口”** 这套机制，独立实现成 Coopanion 的 World 扩展。

npm：`cortico-world-private-companion` · 当前 `0.8.2`（已发布）。首次升级请先备份 `records.json`/`.bak`/`state.json`。

## 致谢与来源

- **原作者：menglimi**，原项目：[menglimi/astrbot_plugin_private_companion](https://github.com/menglimi/astrbot_plugin_private_companion)（AstrBot 插件，7.0.0）。
  生活连续、主动联系、关系卡、表达分寸这些产品设计来自原作者，本项目只是把它们搬到桌宠上的另一种实现。
- 原插件文档：[插件 Wiki](https://vue.syuan.org)；提示词的组织方式可参考原仓库的 `docs/PROMPTS_INVENTORY_20261018.md`。
- **本项目是独立实现**：TypeScript 重写，不含上游 Python 代码；`ENV_PROMPT.md` 的分寸文案为本项目自写（只借鉴“要有由头、状态归属、别播报清单”这些结论），不是上游提示词的拷贝。
- 名字与显示名沿用原插件，作为来源标注；如果原作者认为不妥，改掉即可。
- 图标由使用者提供（蓝发精灵形象），仅用于本扩展的卡片头像。

## 记忆 × QQ × B站多功能联动

三个功能不是并排放，而是尽量互相补位、共享上下文：

- **QQ → 记忆**：聊天、图片含义、文件和语音转写进入同一套记忆；群里没点名的消息会成为主动开口的由头。
- **B站 → 记忆**：自己看、一起看、字幕/热评和观看账会留下 episode；刚看完的视频也会成为“想分享”的由头。
- **B站私信 → 上下文**：分享会带 BV、标题和链接；主人私信会明确标注“主人本人”，不会和系统通知混淆。
- **主动开口**：QQ 群聊、B站观看、记忆里的未完成话头、日程/天气/节日一起进入效用判断，决定“现在值不值得开口”，而不是随机问候。
- **模型跨通道做事**：在 QQ 里看到 B站链接可以转去观看/一起看，在 B站看完也可以回到 QQ 分享；通道是工具，不抢对话。

QQ 和 B站都可以单独关闭；只开记忆也完整可用，打开通道后才多出这层联动。

## 它做什么 / 不做什么

| 机制 | 这里有 | 说明 |
| --- | --- | --- |
| 角色状态 | ✅ | 精力、心情、在做什么、在哪、睡没睡；随真实时间演化，关机再回来按逝去时间补算 |
| 每日节目单 | ✅ | 按日期做种子生成几件小事，可被模型或人改写；日程会成为主动开口的由头 |
| 主动联系 | ✅ | 事件/状态触发、免打扰、每日上限、刚聊完静默、同由头 6h 冷却；由头必须从生活/记忆/状态里推出来，不再用计时器 |
| 开口效用 | ✅ | `由头值 − 打扰成本 ≥ 阈值`；忙/刚聊/刚主动/未回应/重复计入成本，黏人度可调；**记忆类由头绕过“刚聊过”**；`gate` 可一键回退旧阈值 |
| QQ / B站通道 | 🧪 | 可选：原生 OneBot 连接/消息/图片/动图抽帧/217 个 action 目录与 `qq_actions`/`qq_call`/接收策略/文件语音/引用回复/群管 UI/`qq_*` 与旧别名工具 + 独立 QQ 面板；B 站（搜索/信息/热评/弹幕/字幕/观看记录/自己看/抽帧/一起看；@/私信后台直推；显式评论/私信回复、点赞/投币/收藏/关注/分享/弹幕/评论操作、图片上传、观察帧分享；是否 @/私信主人由模型判断，账号签名/头像可改）；Screen 截屏可选+ `bili_*` 工具 + 独立 B站面板；登录/字幕/观看记录/一起看后续 |
| 可视化面板 | ✅ | 「记忆」（`life`，只读）：此刻、整行一天时间条（事件带文字标签）、主动联系决策、3D 记忆星图、全库搜索、概览/最近记忆、合并摘要/撤销合并、心理活动筛选、关系与用户模型；旧记忆面板已下线，导入审核继续走 CLI |
| 用户模型 | ✅ | 从记忆推导「我对他的理解」（身份/偏好/作息/近况/心情/假设），有内容时替代人物摘要；假设带「也许」 |
| 关系卡 | ✅ | 称呼、关系、生日、备注；支持多 key，模型可读写 |
| 日记 | ✅ | 模型自己写，最近一条进对话上下文 |
| 内置记忆 | ✅ | 原始事件层 + 六类派生记录（episode/fact/person/thread/self/rule）；BM25（CJK 2-gram）+ 新近度 + 重要度 + 身份信息；规则常驻、人物摘要、工作记忆、情绪回声；完全重复与近似重复去重 |
| 复习与遗忘 | ✅ | `useCount` 强化 + 自适应半衰期；夜间复习队列；相似 episode 合并成摘要（原文归档、`mergedFrom` 可回查） |
| 胡思乱想 | ✅ | 空闲时基于人物/约定/最近经历写低权重 `episode`（tag `musing`），每天 1-2 次；不进默认上下文，可检索 |
| 记忆版本 | ✅ | `subjectKey` 同主语更新为版本，旧版本保留；thread 会从正文/`what` 自动推断主语，fact/person 需显式 `details.subject` / `personId`；`companion_memory_read` 看全文/历史，`companion_memory_timeline` 看时间线 |
| 记忆导入导出 | ✅ | 版本化 bundle（`companion-memory/2`）；`companion_memory` 的 stats/export/import/prune/forget；导入隔离区 + CLI 审核；v1→v2 迁移脚本 |
| GitMem 读穿 | ⚠️ 可选 | 主库仍是 `companion-memory/2`；主库没命中时只读检索旧 GitMem 的 `notes/handoffs`，不写回、不投影、不双向同步 |
| 原插件的记忆引擎 | ❌（未照搬） | 原插件 7.x 自带独立 SQLite 记忆（来源记忆/画像/共同经历 + 混合召回 + 每日反思）。本移植没有沿用它的实现，而是内置了自己的记忆库（0.2.0），旧数据可以用脚本导入 |
| 说话分寸 | ✅ | 一段可编辑的环境提示词（`ENV_PROMPT.md`），进 system 前缀 |
| 人格本身 | ❌（不归它管） | 人格仍由 `CONSTITUTION.md` 提供；本扩展只加“过日子”的那一层 |
| 对话管线 / 生图 / 识屏 | ❌ | 对话仍由 Coopanion 主 session 负责；本扩展只加生活、记忆和可选的 QQ/B站通道，不接管生图/识屏。 |

## 安装

### 从 npm（推荐，便于后续更新）

在 Coopanion 的扩展工作区里加依赖：

```powershell
cd "D:\Coopanion\data\extensions"
# package.json → dependencies 加：
#   "cortico-world-private-companion": "^0.8.2"
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
| `proactiveDailyCap` | 4 | 每日上限；0 = 不限 |
| `proactiveDecision` | utility | 开口决策：`utility` 效用模型 / `shadow` 只记不改行为 / `gate` 旧固定阈值 |
| `proactiveClinginess` | 1.3 | 黏人度 0–2：越大越愿意开口；只放大由头值，不动打扰成本 |
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
| `userModelInPrompt` | true | 「我对他的理解」进上下文；有内容时替代 `他：…` 摘要，没有则回退 |
| `workingMemoryInPrompt` | true | 把「今天聊过什么」压成一行进上下文 |
| `emotionEchoEnabled` | true | 对方有明显情绪时，提示「上次同类情绪的原因」 |
| `musingEnabled` | true | 空闲时允许胡思乱想（多一次模型调用） |
| `musingIdleHours` | 4 | 空闲多少小时后允许胡思乱想 |
| `musingDailyCap` | 2 | 每天最多几次 |
| `mergeEnabled` | true | 夜间是否合并相似经历（合并式遗忘） |
| `mergeSimilarity` | 0.5 | 合并相似度阈值（0.3 激进 / 0.9 保守） |
| `mindLogLevel` | summary | 心理活动日志：off 关闭 / summary 只记决策 |
| `cognitionMode` | off | 背景念头：off / shadow 只记念头 / act 允许写日记、记念头、休息（contact 默认 hold） |
| `cognitionIntervalMin` | 10 | 两次背景念头的最小间隔（分钟） |
| `weatherEnabled` | false | 开启天气触发（Open-Meteo，免费；需填城市） |
| `weatherCity` | 空 | 天气城市名，例如「杭州」「北京」；留空不查询 |
| `holidayEnabled` | false | 节日触发（固定公历 + nager.date 中国法定节假日） |
| `gitmemWorkspace` | 空 | GitMem 工作区；空 = `<botDir>/workspace` |
| `gitmemReadThrough` | false | 主库没命中时只读检索旧 GitMem 的 notes/handoffs；不投影、不写回 |
| `cognitionContactMode` | hold | 实验性：contact 意图到期后 hold（只记）或 send（过复核后发送） |
| 夜间补跑 | 自动 | 03:30 错过时 08:00 后补跑；archive-only 不记完成，30 分钟退避重试 |
| `styleNote` | 空 | 追加到环境提示词末尾的风格补充 |

## 工具（模型自己用）

- `companion_state` — 读/改自己的状态
- `companion_agenda` — 读/改今日节目单
- `companion_profile` — 读/写关系卡（`action=list` 列出所有卡）
- `companion_journal` — 写/读日记
- `companion_remember` — 写入记忆：`episode`（可带 `userEmotion`）/ `fact` / `person` / `thread` / `self` / `rule`；`tags: ["musing"]` 表示胡思乱想；`subjectKey` 用于同一事实/话头的新旧版本归并
- `companion_thread` — 收尾/更新未完成话头（`done` / `cancel` / `update`），配合 follow-up 复核
- `companion_recall` — 在记忆库里检索（记录 + 最近捕获的对话；`includeArchived` 可翻合并前的原文）
- `companion_memory_read` — 按 id 读完整记忆与版本历史
- `companion_memory_timeline` — 按 `subjectKey` 看同一件事的时间线
- `companion_memory` — 维护：`stats` / `export` / `import` / `prune` / `forget`（import 只读 `data/private-companion/imports/` 下的 `.json`）
- `companion_consolidate` — 夜间整理：`plan` 取材料，`apply` 提交 0-6 条记录
- `companion_proactive` — 检查现在会不会开口、被什么拦着；`trigger` 仅供测试

## 主动策略（直接启用）

除了实验性的「念头 → 意图」，日常 proactive 本身已经带 P0/P1 策略：

- **候选评分**：由头/记忆证据先打分，低于阈值只记 `candidate/review`，不开口；
- **候选触发**：日程节点、醒来、低精力/低心情、到期话头、生日、节日、饭点、晚间锚点、长时间没说话、到期/临近/搁置话头、去年今天、天气变化、状态好等事件/状态变化产生候选；**不再用 90 分钟 + 抖动计时器**；
- **未回应降速**：联系后 3 小时无回复，累计未回应；连续 2 次未回应不再联系；
- **发送前复核**：当前日程繁忙、连续未回应、同一 thread 当天已触发、最近 24h 说过相似内容时暂缓；
- **回执区分**：proactive 唤醒后通过主 session 输出回执记 `spoken`（真有可见正文）或 `silent`（只唤醒/只调工具），内容去重只认真正说出的正文。
- **审计**：心理活动里能看到 `候选/复核/主动/行动`；
- **follow-up**：主动联系涉及未完话头时，用户回复后把话头标成“待复核”注入上下文，让模型完成/取消/更新；
- **动作选择**：精力太低时优先去休息，而不是硬聊；
- **实验性认知**：`cognitionMode` 默认 off，配置页和记忆面板都标「实验性」，不影响上面的正常主动。

## 记忆面板

World 页新增「记忆」面板（`src/webui/client.js`）：

- **概览**：记录/事件数、kind 与 scope 分布、规则/人物/话头、归档、合并摘要、隔离区、上次巩固/合并/反思；
- **此刻**：心情/精力/正在做什么、今日主动与走神额度；
- **最近记忆**：最近 12 条，分「你的情绪」和「我当时的感受」两列，带类型、重要度；
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
node --test            # 92 个用例：时区/状态/主动/记忆库（损坏恢复、去重、检索、隔离区、导出 scope、裁剪、事件过滤、情绪/复习/合并/musing）
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
