# 集成审计：原生 OneBot / B 站只读层（0.8）

**日期**：2026-11-13  
**范围**：把 QQ（OneBot）和 B 站（只读观看）做成 companion 自己的通道，不再依赖第三方 world 插件。  
**本阶段产出**：审计、OneBot 原生客户端骨架、B 站只读层设计、两个独立面板 UI。  
**不做**：B 站真实 API 请求、浏览器一起看、评论/私信写入、旧扩展卸载。

## 1. 现状盘点

### OneBot（`cortico-world-onebot@0.3.1`）

- MIT；依赖只有 `ws`。
- 6 个工具：`onebot_actions / onebot_call / onebot_events / onebot_receive / onebot_view_image / onebot_status`。
- 本机另有媒体记忆补丁：`onebot_media_note / onebot_media_list`，共 8 个工具。
- 配置在 `worlds.onebot`；图片索引在 `data/onebot-media/`；正向 WebSocket 默认 `ws://127.0.0.1:3001`。
- 事件类型：消息/通知/请求/元事件；会话策略、图片下载、action 白名单都在扩展内部。
- 结论：**协议层薄、可原生重写**；真正要保留的是会话策略、图片语义和 action 权限边界。

### B 站（`cortico-world-bili-video-pro@0.2.8`）

- MIT；依赖 `puppeteer-core`、`@ffmpeg-installer/ffmpeg`、`qrcode`。
- **17 个工具**：自看（text/frames）、一起看、浏览器窗口、搜索、详情、评论、私信、回复我的、读网页等。
- 4 个事件：窗口/播放状态、观察帧、自看完成、分享。
- 配置在 `worlds.bili-video-pro`，约十组；有扫码登录、Cookie 回收、浏览器资料目录、抽帧、字幕、弹幕、热评、DM。
- 结论：它是一个**完整的浏览器+媒体产品**，不是简单 API 封装。原样并进 companion 会把依赖、面板、授权和反爬风险全部带进来。

### companion（当前 0.7.3）

- 12 个工具；自有 `MemoryStore`、`state`、`utility`、主动联系、心理日志、可视化面板。
- 已有能力：记忆写入/召回、用户模型、关系卡、日记、夜间整理、全库搜索、3D 星图。
- 结论：QQ/B 站应该围绕这套核心做**事件源和通道**，而不是另建一套状态。

## 2. 决策

**采用原生通道，不再把第三方 world 当运行时依赖。**

- 业务层自己写：连接、协议、会话、工具、事件、配置、面板、记忆/主动整合。
- 底层库可以用：`ws`、原生 `fetch`、弹幕/字幕解码库；不自己重写 WebSocket/protobuf。
- 参考 MIT 代码时保留 LICENSE / THIRD_PARTY_NOTICES；不照搬 UI 和资源。
- 旧扩展在开发期保留但停用，作为回滚；确认新通道稳定后再卸载。

## 3. 架构

```
companion
├─ core             state / memory / utility / proactive / 记忆面板
├─ channels/
│  ├─ onebot       ws、echo、重连、事件、状态（本阶段骨架）
│  └─ bili         只读 API 设计（本阶段只定义）
├─ tools           companion_* + qq_* + bili_*（后续）
├─ webui/
│  ├─ life.js      记忆面板
│  ├─ qq.js        QQ 面板（独立）
│  └─ bili.js      B站面板（独立）
└─ channel-bus     通道事件 -> 记忆/触发/主动（后续）
```

### 通道接口

```ts
interface CompanionChannel {
  id: 'onebot' | 'bili';
  start(): Promise<void>;
  stop(): Promise<void>;
  status(): ChannelStatus;
  tools(): ToolDef[]; // 后续
}
```

事件统一归一化，至少包含：

```ts
interface CompanionEvent {
  channel: 'onebot' | 'bili';
  type: string;          // qq.message / bili.watched ...
  at: string;            // ISO
  dedupeKey: string;     // 防重复投递
  payload: unknown;      // 原始/裁剪后的内容
}
```

## 4. OneBot 骨架（已实现）

文件：`src/channels/onebot.ts`  
配置：`data/private-companion/channels/onebot.json`，首次读取旧 `worlds.onebot` 的 `wsUrl/token` 作为默认。  
面板：`qq`（`src/webui/qq.js`）。

已具备：

- 正向 WebSocket 连接、Bearer Token、8 秒连接超时；
- echo 请求/响应配对，`call(action, params)`；
- 断线指数退避重连（2s 起，上限 30s）；
- 状态：`disabled/connecting/online/offline/error`、selfId、appName、事件数、最近事件、最后错误；
- 最近 100 条事件环形缓存（UI 只看 12 条）；
- 面板：状态、地址、账号、事件计数、连接/断开/刷新、地址/Token 保存、最近事件。

**实测**：本机 SnowLuma 2.2.0，状态 `online`，`selfId=3553975852`，`appName=SnowLuma`，`appVersion=2.2.0-node`。端到端：停用旧 OneBot 后，原生通道发出私聊测试消息（message_id 401847639），用户回复「收到」；QQ 面板收到 `私聊 鸭鸭世界第一可爱：收到`，`memory/events.jsonl` 追加 `[QQ 私聊] ...：收到`，`state.lastTalkAt` 更新。测试后恢复旧 OneBot，原生通道 disabled。

暂未接：

- 消息段归一化、私聊/群聊策略、@/引用/图片；
- 图片下载与表情包语义；
- 工具层（`qq_*`）、`pendingTrigger`、记忆写入；
- 与旧 `onebot_*` 工具名的兼容别名。

设计约束：

- 面板默认 `enabled=false`，避免和旧 OneBot 扩展同时连一个账号；
- Token 不回显；面板留空表示不修改；
- 所有 action 后续走白名单，不直接暴露 `onebot_call` 的 200 个 action。

## 5. B 站只读层设计

### 5.1 能力边界

只读：

- 搜索、视频信息、分 P、章节、字幕、弹幕、热评、观看记录；
- 看完后写一条 `episode`，可被主动联系引用；
- 不自动评论、不私信、不点赞、不投币。

### 5.2 数据形态

- `BiliVideo`：bvid/aid/cid/title/owner/duration/pages/desc/chapters；
- `BiliTranscript`：字幕行（from/to/text）+ 弹幕（time/mode/text）+ 热评；
- `BiliWatch`：bvid、从哪秒到哪秒、看了多久、完成度、摘要、记忆 id；
- 观看记录单独 `watch-ledger.jsonl`，按 bvid/标题/Jaccard 去重；不要把每次轮询都写成记忆。

### 5.3 接入顺序

1. 登录态（Cookie/扫码，复用本机浏览器资料或重新登录）；
2. 搜索/信息/字幕/弹幕/评论（只读）——**搜索/信息/热评/弹幕已接公开版**；
3. 观看会话：开始/进度/结束，写 `episode`；
4. 主动联系：用“刚看完的视频”做由头，仍走 utility 成本；
5. 后续再评估抽帧/浏览器一起看。

### 5.4 面板

`bili`（`src/webui/bili.js`）已能**公开只读试读**：关键词搜索、BV 信息、热评、弹幕；同时保留能力/边界/四步流程。  
未接：登录态、字幕、观看记录、抽帧/一起看；这些在同一面板继续长。

## 6. 迁移与兼容

- 配置：新通道配置在 `data/private-companion/channels/*.json`；读取旧 `worlds.onebot` / `worlds.bili-video-pro` 作为默认。正式迁移后再决定是否进入设置页 schema。
- 数据：OneBot 的 `data/onebot-media/` 保留并后续导入统一媒体索引；B 站旧 Cookie/浏览器资料能导入就导入，不能就重新登录。
- 双连接：启用原生 QQ 前先停用旧 OneBot world；B 站只读层不启动浏览器，不会和旧陪看抢窗口。
- 工具名：先 `qq_*` / `bili_*`；旧 `onebot_*` / `bvp_*` 在过渡期保留别名，避免提示词断掉。
- 回滚：旧扩展保留在 `data/extensions`，停止即可；不立即卸载。

## 7. 风险

- OneBot 各实现消息段差异大，原生实现需要长期兼容；先以 SnowLuma 实测，再补 NapCat/Lagrange。
- B 站非官方接口；WBI 签名、Cookie 过期、风控会变；只读层也要限速和失败隔离。
- 浏览器一起看是重依赖+反爬，放到最后，不阻塞核心。
- 集成后单扩展故障面变大：通道启动/网络错误不得影响 companion 主循环；必须懒加载、隔离异常。
- 工具数量膨胀：模型侧只暴露少量高层工具，原始 action 留在面板/调试层。
- 隐私：QQ Token、B 站 Cookie 不能进记忆/日志；面板不回显 Token。

## 8. 里程碑

- **M1（本阶段）**：审计 + OneBot 连接骨架 + QQ/B站独立 UI。
- **M2**：OneBot 消息归一化、图片/表情包、会话策略、进入记忆/pendingTrigger。
- **M3**：B 站只读 API（登录/搜索/信息/字幕/弹幕/评论）。
- **M4**：观看记录 + 记忆 + 主动联系；B 站面板接真实数据。
- **M5**：抽帧/浏览器一起看（可选）；旧扩展下线。

## 9. 参考

- [bilibili-API-collect](https://github.com/SocialSisterYi/bilibili-API-collect)
- [isomorphic-danmaku](https://github.com/3Shain/isomorphic-danmaku)
- [BiliSum](https://github.com/lycohana/BiliSum)
- [bilibili-video-mcp](https://pypi.org/project/bilibili-video-mcp/)
- [ZViewer](https://github.com/Zero-wyc/ZViewer) / [SyncTV](https://github.com/synctv-org/synctv)

## 10. 相对原插件的缺口（2026-11-13）

### OneBot

原插件：`onebot_actions` / `onebot_call` / `onebot_events` / `onebot_receive` / `onebot_view_image` / `onebot_status`，加本机媒体补丁 `onebot_media_note` / `onebot_media_list`。

原生目前：连接/重连/状态、消息段（文本/@/图片）、图片落盘、消息写原始记忆事件、`qq_status` / `qq_recent` / `qq_send`、独立 QQ 面板。

还缺：

- `onebot_actions` / `onebot_call`：200+ action 目录、白名单、群管/撤回/文件等；
- `onebot_events`：历史事件、通知、请求；
- `onebot_receive`：会话接收策略、群/人白名单；
- ~~`onebot_view_image`：图片直接给模型看~~（已接）；
- ~~`onebot_media_note/list`：表情包/图片语义、去重复用~~（已接：`qq_media_note/list`）；
- 文件读取策略、语音/引用/戳一戳、多个 OneBot 实现的差异；
- 消息进 `pendingTrigger` / 主动联系由头（目前是 host event 唤醒，尚未做 utility 由头）；
- 真实语音转写模型/服务；群管参数表单细化；文件内容预览/大文件分页。

### B站

B站已接：公开搜索/信息/热评/弹幕；Cookie 登录（可读旧陪看 cookies.json）、字幕、观看记录；面板可试读历史/字幕；`bili_watch` 写观看账和记忆 episode；`bili_frames` 用 videoshot 网格抽帧；`biliSelfWatch` 按间隔从观看记录/主题自己看（默认关闭）；@/回复/私信后台直推；一起看 Edge/CDP 播放控制与观察帧；显式 `bili_comment_reply`（可带图、可选 @ 主人）/`bili_dm_reply` 回复，`bili_act` 账号动作（赞/币/收藏/关注/分享/稍后再看/弹幕/评论操作/私信主人，默认开启，写操作仍需 confirm）、`bili_profile`/`bili_update_profile`（签名/头像；昵称暂不改），通知/私信 UI，一起看「分享这一帧」闭环；需开启 + confirm。
- issue-2026-11-09 已修：统一观看账本 + 旧 watched 导入 + 重复硬拦；私信分享卡解析 aid→BV；/x/msgfeed/at 合并去重。

原插件 17 个工具：`bvp_watch_now` / `bvp_share` / `bvp_browser` / `bvp_open` / `bvp_play` / `bvp_pause` / `bvp_seek` / `bvp_look` / `bvp_quality` / `bvp_exit` / `bvp_search` / `bvp_related` / `bvp_comments` / `bvp_scroll` / `bvp_snapshot` / `bvp_read_page` / `bvp_inbox`，加自看排期、扫码登录、Cookie 回收、抽帧、浏览器窗口和一整套面板。

原生目前：公开只读的搜索 / 信息 / 热评 / 弹幕客户端；`bili_search` / `bili_info` / `bili_comments`；B站面板可公开试读。

还缺：

- 登录/扫码/Cookie 回收，字幕（登录后）；
- 自己看：文字/抽帧、排期、每日次数、方向偏好、看过的 BV 去重；
- 一起看：浏览器窗口、播放/暂停/跳转/画质/退出、观察帧、状态事件；
- 相关推荐、评论分页、弹幕过滤、网页正文读取；
- 评论/分享/私信/「回复我的」；
- 观看记录 ledger、写 `episode`、主动联系由头；
- 原三套面板（自己看/授权/一起看）的完整复刻。


## 11. 七项能力的取舍

- Together：已接 Edge/CDP 一起看、播放控制、观察帧。
- Screen：已接可选 `companion_screen`，默认关闭，开启后截当前桌面。
- Content/Image/Reality/Game/Live：不塞空壳。Content 先复用日记/内容记忆；Image 需要图像 provider；Reality 需要设备/传感器边界；Game/Live 需要明确玩法和直播权限，后续单独设计。
