# Changelog

## 0.8.8 — 2026-11-26

- B站自己看改为空闲时的独立活动。找新片和重看各有一半选片机会，兴趣主题留空时使用热门补充新片。保留已有的观看间隔和每日额度。
- 自动观看把字幕、热评和可用画面交给角色，由她用 `bili_watch_review` 决定现在分享、延后或自己留着。更新后会清除旧版本尚未消费的自动观看开口由头。
- 每次自己看之后请角色选择点赞、投一枚币、评论和是否在评论里 @ 主人。按 B 站账号和视频记录互动，拦下重复点赞、投币和顶层评论。

## 0.8.7 — 2026-11-24

- 试验性功能新增「QQ 表情包和图片优先使用本地视觉模型」，默认关闭。启用后收图、主动看图和旧图补记优先复用本地描述，失败时使用原有流程。兼容已有配置和媒体索引。

- B站面板支持使用哔哩哔哩 App 扫码登录，确认后立即使用账号并在下次启动时恢复。保留手动 Cookie 文件和旧陪看登录态的兼容路径。
- QQ 和 B站通道设置增加首次连接指引。打开未连接的 QQ 面板时优先展示连接设置，定时刷新保留尚未保存的输入。

## 0.8.6 — 2026-11-22

- 新增原生「按需联网」`companion_web`：默认开启，只在需要新信息或确实拿不准时查询一次，返回答案和来源；日常闲聊不联网。
- 联网配置进入设置页：可开关、选模型、限制单次搜索次数和回答长度；复用现有 DeepSeek 密钥。
- 通道改为软约束：默认在当前通道回复，同一轮不要 QQ 和桌面两边都发；不再硬拦截 QQ/桌面，避免合法换台被误伤。
- 新增实验性低优先心跳，默认关闭：闲置很久时按低概率补充一次主动开口，不替代现有由头系统。
- QQ 引用消息支持通过 `get_msg` 反查原消息，超出最近 100 条的引用也能看到原话。
- 修复关闭每日节目单后旧日程仍被带到第二天的问题。
- 8B 本地视觉接入说明（Qwen3-VL-8B + mmproj，单模型 GPU 运行）。
## 0.8.5 — 2026-11-19

- 看屏幕改为默认开启的普通功能：可在设置中关闭，不再放在试验性功能里。
- 新增沉默自动看屏幕：用户超过设定时间未回复时，角色独立检查一次桌面，不需要先有别的主动开口；同一条用户消息只触发一次，避免循环。
- 自动看屏幕前检查键鼠空闲时间（默认 120 秒），空闲过久视为不在电脑前，不截屏；黑屏/纯色画面同样跳过。
- B站自己看/`bili_frames` 增加黑帧过滤：黑屏、纯黑或纯色缩略图会被丢弃并换下一格，避免把无意义画面交给模型。
## 0.8.4 — 2026-11-17

- 本地视觉自动描述增加乱码保护：输出含 ASCII `?` 时直接丢弃，不写入媒体库；避免批量并发时把中文替换成问号。
- 媒体库描述改为可逐条校验、可清除重写；失败图片保持未描述，不再污染已有含义。
## 0.8.3 — 2026-11-17

- 新增本地媒体库导入：`qq_media_import` 可导入单张图片或整个目录，按内容 SHA-256 与 QQ 图片统一去重，媒体库上限提升到 20,000 条。
- 新增媒体库维护：`qq_media_list` 支持全库按含义/文件名/短号搜索，`qq_media_delete` 可删除图片及本地副本，`qq_media_note` 可人工纠正含义。
- 新增可选视觉自动描述：导入时可调用兼容 OpenAI 的本地视觉接口（默认 `http://127.0.0.1:8081/v1`），自动为图片写一句初始含义；纯文字模型会被识别并跳过。
- 本地视觉服务接入 Qwen2.5-VL-3B：支持 WebP/GIF 首帧转换，批量描述使用 GPU，失败图片保留为未描述状态，可人工补。
- B站面板状态和扩展页简介更新为当前实际能力；扩展标签改用市场真实标签。
## 0.8.2 — 2026-11-14

### B站联动

- B站面板新增「一起看观察图集」：显示模型最近收到的那张 2×2 / 3×2 图集，每 5 秒刷新；没有图集时显示空状态。
- 自己看增加每日额度：文字视频每天最多 3 条、带画面每天最多 1 条；额度按本地自然日重置，可在设置页调整。
- 自己看带画面默认每次随机截取 6 张，范围 1–6；使用确定性 PRNG，避开缩略图首尾极端位置，避免真随机抽到全黑/全片头。
- 自动找视频增加时长限制：默认 1–30 分钟，自己看和一起看共用；太短或超过上限的自动跳过。
- B站自己看/手动看会生成主动开口由头（`source: bili`），和 QQ 群聊、记忆话头等一起进入效用判断。
- 修复 `world.ts` 中重复定义的 selfwatch / watch 方法，避免一套逻辑覆盖另一套。
- 扩展页简介和 B站状态文案更新：不再写“只读层设计中”，改为当前实际能力。
- 扩展页标签改用市场真实标签：即时通讯、QQ、联网、浏览器、视频、需额外安装、高消耗、非官方接口。

## 0.8.1 — 2026-11-14

- B站私信推送标明发送者是不是主人本人，并把 `fromOwner` 放进事件 meta；模型不再把主人私信当成系统通知。
- npm 发布 0.8.1，并保留可回退的 0.8.0 安装版本。

## 0.8.0 — 2026-11-14

### 记忆 × QQ × B站

- 把 QQ、B站能力收进 companion，原生实现，不运行时依赖第三方 world。
- QQ 消息、图片含义、文件/语音进入记忆；B站自己看/一起看写观看账和 episode。
- QQ 群聊和 B站观看都能成为主动开口的由头，和记忆、日程、天气、节日共用同一套 utility 判断。

### QQ

- OneBot 原生客户端：连接/长连接重连、echo、状态、事件缓存、接收会话策略、文件/语音/引用、217 个 action 目录与 `qq_actions`/`qq_call`/`qq_receive`。
- 图片/动图/文件/语音：已有含义复用、GIF 抽帧、sha256 去重、媒体索引与补记提醒。
- 群管面板、QQ 面板正式版；隐藏旧 `onebot_*` 别名，避免和旧 OneBot 扩展撞名。
- 修复 QQ 开关热切换不启动/不停止、群号字符串导致群管动作校验失败、媒体下载串行和重定向/DNS 内网校验问题。

### B站

- 登录 Cookie（可继承旧陪看）、搜索、信息、字幕、弹幕、热评、观看记录、@/私信后台直推。
- B站账号动作、评论/私信回复、图片上传、观察帧分享；账号动作默认开启，`bili_act` 不再要求 confirm。
- 一起看改用 Puppeteer 普通 Edge 窗口：复用浏览器、首页保留、视频开新标签；修复关窗后旧进程/旧端口复用和重复窗口问题。
- 播放中每 0.8 秒采样、每 5 秒拼图集；不再自动“提前看”，避免剧透和额外消耗。
- B站面板缩为「浏览」+ 顶部「一起看」入口；通知、账号资料仍由模型工具处理。
- 修复自动观察变量未定义、观察间隔配置不生效、montage 空格行失败、World 停止不关闭浏览器等问题。

### 配置与发布

- 设置页拆成「记忆 / QQ / B站 / 试验性功能」四组。
- 移除旧 OneBot 兼容开关。
- 依赖声明 `ws`、`puppeteer-core`、`@ffmpeg-installer/ffmpeg`；不再从旧扩展目录硬编码加载。
- 测试 129 个：128 通过、1 跳过、0 失败（0.8.0 发布时）。

## 0.7.3 — 2026-11-10（已发布）

- 修复首页心理活动仍显示 thought/candidate 双条的问题：dashboard 的 mind 事件字段是 `at`，合并逻辑之前只读 `ts`，时间解析不到就没有去重。

## 0.7.2 — 2026-11-10

- 修正命名：顶级页签回到「记忆」；「她相信什么」卡片改名「她的记忆」；内部页签保持「记忆」。
- 心理活动里同一次活动的 thought/candidate 双条记录合并显示，不再出现两条一样的话。

## 0.7.1 — 2026-11-10

- 面板改名「她的记忆」，内部「记忆库」页签改回「记忆」。
- 「为什么开口 / 没开口」卡片改名「主动联系」。
- 去掉界面上的英文前缀（NOW / TODAY / WHY / MEMORY / US / MIND / RECENT）。
- 心理活动的类型标签改中文（候选/念头/复盘/跟进/意图/静默…）。

## 0.7.0 — 2026-11-10

- 旧的「记忆」面板下线；只保留「记忆」一个入口（原「她的生活」）。
- 新面板改名「记忆」，内部页签为 此刻 / 记忆库 / 心理 / 关系；导入审核继续走 CLI。
- 移除旧面板的浏览器端代码，client.js 不再带两套 UI。

## 0.6.5 — 2026-11-10

- 时间条标记按「类型 + 分钟」去重，同一时刻的重复日记/记忆不再叠两个标签。

## 0.6.4 — 2026-11-10

- 「此刻」改为：上排 此刻 + 记忆/关系 + 为什么；**她的一天整行横排**在心理活动上方；心理活动改成单列多行。
- 时间条上的事件标记改成**带文字的标签**（主动 12:59 / 被拦 / 日记 07:30 / 记忆 13:13），不再只有小圆点。
- 图例保留为辅助，不再是理解图表的唯一入口。

## 0.6.3 — 2026-11-10

- 记忆页工具栏拆成**搜索 / 视图 / 筛选 / 星图**四行，不再和星图操作混在一起。
- 搬入**概览**：记录/事件/规则/人物/归档/合并/走神/范围统计 + 最近 12 条记忆。
- 搬入**心理活动筛选**：全部/主动/被拦/念头/记忆/触发/候选/复盘/动作/回声。
- 一天时间条的图例改成更大的胶囊标签（日程/主动开口/被拦/日记记忆），不再用看不清的小色块。
- 导入审核继续走 CLI，不搬。

## 0.6.2 — 2026-11-10

- 新面板接入**全库搜索**：输入关键词回车或点「全库搜索」，按 `scope=*` 搜全库；结果表格可点开全文/标签/证据，并可在星图中定位。
- 新面板接入**合并摘要**：工具栏「合并摘要」列出夜间合并；「撤销合并」恢复原文并刷新星图。
- 搜索接口限流从 20 放宽到 50，返回全文、重要度、标签、证据。
- 旧「记忆」面板暂时保留（概览/最近/心理/导入审核还没搬）。

## 0.6.1 — 2026-11-10

- 面板改名「她的生活」（不只是一天）。
- 星图**默认自动旋转**，点击/拖动/滚轮任意位置停下；切回记忆页重新开始转。
- 全屏：右上「全屏」进入，左上工具栏保留自动旋转/重置/退出；右侧详情改成深色，和星图统一。
- 氛围：漂移星云、闪烁星尘、上浮尘埃、中心微光；选中节点的连线金色流动高亮。
- 布局按面板自身宽度单列/两列/三列；星图固定高度，不再向下延伸。

## 0.6.0 — 2026-11-10

- 新增可视化面板「她的生活」（`life`，只读）：此刻、一天时间条、主动决策效用瀑布、3D 记忆星图、关系与用户模型、心理活动。
- 新增面板数据接口 `dashboard` / `constellation`；主动决策现在会记录完整的 `terms`（由头/黏人/各项打扰）到 state，供瀑布展示。
- 星图默认**不自动旋转**，有「自动旋转」开关；点击/拖动/滚轮会停下。点节点有金色选中环、其余节点变暗，**相连的线变金色并带流动虚线**，右侧出详情（含连线数）；缩放范围 0.25–6。
- 星图支持**全屏**（按钮 / Esc 退出），全屏时背景是缓慢漂移的星云、闪烁星尘和上浮尘埃；节点/标签随画布放大。
- 面板按**自身宽度**自适应（<760 单列），星图画布固定高度，不再向下无限延伸。
- 旧的「记忆」面板保留：精确列表、检索、合并摘要与撤销合并仍在那里。
- 测试 119 通过。

## 0.5.1 — 2026-11-08

- 修复设置页数值显示：`proactiveClinginess` 和 `mergeSimilarity` 误用了 `x-scale: 0.05`，被 UI 当成“显示值 = 存储值 / scale”，导致 1.3 显示成 26、0.5 显示成 10。改用 `multipleOf: 0.05`，直接显示原值。

## 0.5.0 — 2026-11-08

- 主动开口改用**效用模型**：`由头值 − 打扰成本 ≥ 阈值`。新增 `proactiveDecision`（`utility` 默认 / `shadow` 只记 / `gate` 旧阈值）与 `proactiveClinginess`（0–2，默认 1.3）。忙碌只加成本，睡眠/免打扰/日上限/未回应≥2/重复仍是硬闸门；心理活动记录 `benefit/cost/code`。
- **记忆类由头（memory/thread/promise）绕过“刚聊过”成本**：想起来的事值得打断，但“刚主动过/未回应/重复”仍然计成本。
- 主动回执把 `onebot_call` 的 `send_private_msg` / `send_group_msg` / `send_msg` 文本也算“真正说出的内容”，不再误记为 silent。
- 新增**用户模型**：从记忆确定性推导「我对他的理解」（身份/偏好/边界/作息/近况/心情/假设），有内容时替代 `他：…` 摘要，无内容回退；假设带「也许」且最多 1 条。新增 `userModelInPrompt`（默认 true），10 分钟或记录数变化时重算。
- 新增只读预览脚本：`tools/preview-utility.mjs`、`tools/preview-model.mjs`（不写线上数据）。
- 测试 92 → 112（新增效用、用户模型、世界层决策模式与注入/回退）。

## 0.4.5 — 2026-11-05

- 修复「今天」按最近 24h 串前一天：`todayEpisodes/todayDigest` 改为本地自然日 00:00 起；「最近」加日期并标明可能跨天。
- 「今天」没有 episode 时只报对话条数与时间，不再把私聊原文整条带进提示。
- 记忆增加 `subjectKey` + 版本历史：同主语的事实/话头/人物更新为当前版本，旧版本保留；thread 自动从正文/`what` 推断主语，fact/person 只认结构化 `details.subject`/`personId`，避免误合并；新增 `companion_memory_read` 与 `companion_memory_timeline`。

## 0.4.4 — 2026-11-04

- 主动回执识别 `pet_say` / `pet_ask` / `console_send` / `sovits_speak` 的参数为真正说出的内容；不再把“通过 speak 工具说话”误记成 silent。
- 今日测试数据：15 次主动里 13 次实际走了 pet_say，旧回执误判为 silent、sentTexts 为空；修复后内容去重和面板回执才准确。
- 新增可选 GitMem 读穿：主库仍是 companion-memory/2；`companion_recall` 主库没命中时只读检索旧 notes/handoffs；不投影、不写回、不做双向同步。

## 0.4.3 — 2026-11-03

- 最近记忆拆成「你的情绪」和「我当时的感受」两列：前者来自 userEmotion，后者来自 howIFelt；没有则显示未标注/未记录。
- 面板「此刻」移除已无意义的「下次主动」；日上限 0 显示「不限」而不是 6/0。
- 实验认知：`thinkAll` 返回全部候选，最高分 silent 照记；意图从最高分可行动候选选；高显著 silent 晚上转 journal、其他时间转 remember，不再吞掉可行动候选。
- 主动去重：同一 thread 每天最多触发/联系一次；最近 24h 说过相似内容（按正文相似度）不再推送，正常 proactive 与实验 contact 共用。
- 主动回执：接主 session 输出流，唤醒后实际有正文记 `spoken`、无正文记 `silent`；`sentTexts` 改为只记录真正说出的正文，不再把“唤醒成功”当成“说过”。
- 回执只在 `onEventsSettled(delivered)` 后开始，discarded/onAbort/超时不计 spoken；内容去重同时比对由头与实际正文。
- 同一 thread 每天一次改为“投递成功后才占用”；held 联系意图 15 分钟后最多重试 3 次，12 小时过期。
- 修复源码中的裸 NUL/控制字节；认知记忆候选先取 recent(20) 再筛 episode。

## 0.4.2 — 2026-11-02

- 主动不再使用 90 分钟 + 抖动计时器：改为日程节点、醒来、低精力/低心情、到期/临近话头、去年今天、生日、饭点、晚间锚点、长时间没说话等事件/状态触发；P0 候选评分/复核继续生效。
- 配置页移除最小间隔/抖动；`proactiveDueAt` 仅保留兼容字段，界面显示“等待生活/状态触发”。
- 新增天气触发：Open-Meteo 免费接口，按城市查询，下雨/降温/高温/低温产生候选；默认关闭，无城市不请求。
- 新增节日触发（固定公历 + nager.date 中国法定节假日，失败回退）、搁置 3 天以上的话头、状态好（精力/心情高）、明天转雨/降温；
- 新增候选触发/天气/节日测试；77 用例。

## 0.4.1 — 2026-11-02

- 情绪标签：episode 未显式写 `userEmotion` 时按文本保守识别；记忆面板对旧记录也做读取兜底，识别不到显示「未标注」，不再一律「平淡」。
- 心理活动：主动被拦不再记成「主动」，单独标 `gate/未开口`；面板每 20 秒自动刷新最近记忆/心理活动，并同步顶部「今日主动」徽标（页面隐藏时暂停）。
- 兼容 0.4.0 旧日志：`gate` 筛选会把旧的“没开口”proactive 记录也包含进来，面板按 summary 标成「未开口」。
- 背景念头（Phase 0）：`cognitionMode=off/shadow/act`，每 N 分钟用状态/记忆/日程做一次便宜评估，写 `thought` 日志；shadow 不改行为，act 只允许写日记/休息，contact 仍走原主动闸门；同一条念头 6 小时内不重复。
- 念头 → 意图：高显著性念头形成带到期时间的 intention；`act` 下 journal/rest 会真正执行，contact 只 hold（记「想找他但先放在心里」），不自动发消息；面板新增 `意图/行动` 筛选。
- 自动日记正文改为当天 episode/事件摘要（`todayDigest`），不再只写“今天还没写日记”这句自指念头。
- 念头去重：episode 与近期记忆共用 `memory:<id>` key，同一段记忆不会换种说法再次出现。
- P0（直接启用）：正常主动加入候选评分、繁忙/重复/连续未回应发送前复核、候选/复核审计；未回应 3 小时降速。
- P1（直接启用）：主动联系涉及话头时，用户回复后生成 `followup` 待复核并注入上下文；低精力优先休息；实验性认知保留 journal/rest 动作。
- 实验性认知：`cognitionMode` 默认 off，配置页与面板标「实验性」；`cognitionContactMode=hold` 默认不发送。

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
- 测试 57 → 69：P0/P1 候选评分、未回应、follow-up、线程工具、实验认知；
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

- 不接管对话、平台发送、生图、识屏；这些在 Coopanion 里各有世界。
- 关系卡的上下文只展示 `main`（或唯一一张卡）；其余卡可读写、可在 `action=list` 里看到。
- 记忆桥依赖 `cortico-world-memory` 的 JSON 落盘格式；对方改格式时退化为「查不到」而不是报错。

- 新增可选 `companion_screen`：显式开启后截当前桌面；默认关闭。七项能力先落地 Screen 与 Together，其余按依赖分阶段。

- B站评论/私信回复：bili_comment_reply（自动 @ 主人，root/parent 回复，日上限）、bili_dm_reply（talker_id）；默认关闭，需 biliReplyEnabled + confirm。

- B站回复补图片：评论上传 BFS 图片并带 pictures；通知/私信 UI 支持选择 @/私信、填配文、可选本地图片路径；一起看新增「分享这一帧」闭环（截图→评论配图→@主人）。

- B站账号动作：新增 `bili_act`（like/unlike、coin、favorite/unfavorite、follow/unfollow、share、watch_later、danmaku、comment_like/unlike、comment_delete、dm_owner）；写操作需 confirm。
- 是否 @ 主人或私信主人改由模型判断：`bili_comment_reply`/`bili_together_share` 增加 `mention_owner`，默认 false；UI 增加可选勾选。

- B站账号资料：bili_profile 读取昵称/签名/头像；bili_update_profile 改签名/头像（昵称暂不改，避免扣币），默认需确认；B站面板增加账号资料卡。

- QQ 语音：仅接 DeepSeek 官方 ASR 自动转写（qqTranscribeVoice）。

- 一起看：复用同一 Edge 窗口，窗口 1160×800 居中；播放中每 0.8 秒采样、每 5 秒把最近 4 帧拼成 2×2 图集发 bili.together.frame；UI 精简为一起看/打开B站/暂停播放/关闭。
- 配置页：开口决策改为「综合判断/只记录/固定阈值」，移除旧 OneBot 兼容开关；bili_act 默认开启且不再要求 confirm。

- B站面板只保留「浏览」：通知/私信、账号资料和一起看表单都不再显示；顶部保留一个「一起看」按钮作为手动入口，其余交给模型工具。

- 一起看窗口改用 `--remote-debugging-port=0` + DevToolsActivePort，避免 9333 被旧进程占用后每次新开窗口；旧 B站陪看世界已停用。

- 一起看浏览器层改为 Puppeteer（照陪看插件）：普通 Edge 窗口 + 新标签保留首页；关闭窗口由 disconnected 清理；动态调试端口；解决 CDP 手写连接在关窗/多标签下的旧连接问题。

- 设置页拆成「记忆 / QQ / B站 / 试验性功能」四组；B站补上采样间隔、图集间隔、图集格数、浏览器/Cookie 路径选择，并保留原作的观察配置语义。
