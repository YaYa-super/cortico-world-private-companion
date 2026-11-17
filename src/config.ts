/**
 * World 配置段 worlds.companion 的形状、默认值与设置页表单声明。
 * 默认 enabled=false：没在部署配置里打开时不会运行。
 */

export interface CompanionConfig {
  enabled: boolean;
  /** 面板里显示的自定义称呼；空 = 默认大肥鱼。 */
  displayName: string;
  /** 可选 QQ（OneBot）通道；默认关闭。 */
  qqChannelEnabled: boolean;
  /** 可选 B站只读通道；默认关闭。 */
  biliChannelEnabled: boolean;
  /** 兼容旧 onebot_* 工具名；默认关闭，避免和已装旧 OneBot 扩展撞名。 */
  qqLegacyTools: boolean;
  /** B站 Cookie 文件；空 = 尝试读旧陪看扩展的 cookies.json。 */
  biliCookieFile: string;
  /** B站通知：把 @我 / 回复 / 私信直接推给主 session，不让模型自己轮询工具。 */
  biliInboxPushEnabled: boolean;
  biliInboxPollMinutes: number;
  /** 一起看使用的 Edge 路径；空用默认 Edge。 */
  biliBrowserPath: string;
  /** 可选：允许角色发 B站评论/私信（默认关闭）。 */
  biliReplyEnabled: boolean;
  /** 可选：允许角色点赞/投币/收藏/关注等账号动作。 */
  biliInteractEnabled: boolean;
  /** 评论时 @ 的主人 UID。 */
  biliOwnerUid: string;
  biliDailyComments: number;
  /** 原生 QQ：自动转写收到的语音。 */
  qqTranscribeVoice: boolean;
  deepseekBaseUrl: string;
  deepseekKeyFile: string;
  /** 可选：允许角色截屏看桌面（默认关闭）。 */
  screenEnabled: boolean;
  /** B站自己看：定时从观看记录/主题里挑一条看并记下。 */
  biliSelfWatchEnabled: boolean;
  biliSelfWatchEveryMinutes: number;
  biliSelfWatchTopics: string;
  /** 自己看每天最多看几条文字视频（0=关闭）。 */
  biliSelfWatchTextDailyLimit: number;
  /** 自己看每天最多看几条带画面视频（0=关闭）。 */
  biliSelfWatchFramesDailyLimit: number;
  /** 自己看带画面时每次抽几帧；0 = 按片长自动。 */
  biliSelfWatchFramesCount: number;
  /** 自己看/自动找视频的最短时长（分钟）。 */
  biliSelfWatchMinMinutes: number;
  /** 自己看/自动找视频的最长时长（分钟）。 */
  biliMaxVideoMinutes: number;
  /** 一起看采样间隔（秒）。 */
  biliCaptureIntervalSec: number;
  /** 一起看观察图集间隔（秒）。 */
  biliObserveIntervalSec: number;
  /** 单张观察图集最多几格。 */
  biliObserveCells: number;
  /** 主动联系总开关。 */
  proactiveEnabled: boolean;
  /** @deprecated 旧计时器参数，保留兼容，不再使用。 */
  proactiveMinGapMin: number;
  /** @deprecated 旧计时器参数，保留兼容，不再使用。 */
  proactiveJitterMin: number;
  /** 每天主动上限（0 = 不限制，不建议）。 */
  proactiveDailyCap: number;
  /** 开口决策：gate 旧闸门；shadow 只记效用不改行为；utility 用效用模型。 */
  proactiveDecision: '综合判断' | '只记录' | '固定阈值' | 'gate' | 'shadow' | 'utility';
  /** 黏人度 0-2：1 中性，越大越愿意开口（只放大由头值，不动打扰成本）。 */
  proactiveClinginess: number;
  /** 对方刚说过话后的静默窗口（分钟），窗口内不主动。 */
  idleGateMin: number;
  /** 免打扰开始（含）。 */
  quietStart: string;
  /** 免打扰结束（不含）。 */
  quietEnd: string;
  /** 睡觉开始（含）。 */
  sleepStart: string;
  /** 睡觉结束（不含）。 */
  sleepEnd: string;
  /** 是否自动生成每日节目单。 */
  agendaEnabled: boolean;
  /** 醒着时每小时掉的精力。 */
  energyDecayPerHour: number;
  /** 陪伴上下文里带几条最近日记（0 = 不带）。 */
  journalInPrompt: number;
  /** 内置记忆库开关。 */
  memoryEnabled: boolean;
  /** 是否自动捕获外部消息进原始事件层。 */
  memoryCapture: boolean;
  /** 原始事件保留天数。 */
  memoryRetentionDays: number;
  /** 常驻笔记进提示词的条数。 */
  memoryNotesInPrompt: number;
  /** 是否把「我对他的理解」注入上下文（有内容时替代 person 摘要）。 */
  userModelInPrompt: boolean;
  /** 是否把“今天聊过什么”放进上下文。 */
  workingMemoryInPrompt: boolean;
  /** 是否在对方有明显情绪时提示“上次同类情绪的原因”。 */
  emotionEchoEnabled: boolean;
  /** 空闲时是否允许胡思乱想（会多一次模型调用）。 */
  musingEnabled: boolean;
  /** 空闲多少小时后允许胡思乱想。 */
  musingIdleHours: number;
  /** 每天最多胡思乱想几次。 */
  musingDailyCap: number;
  /** 夜间是否把相似 episode 合并成摘要。 */
  mergeEnabled: boolean;
  /** 合并的相似度阈值（0.3-0.9，越高越保守）。 */
  mergeSimilarity: number;
  /** 是否启用天气触发（Open-Meteo，免费，无需 key）。 */
  weatherEnabled: boolean;
  /** 天气城市名；空 = 不查询。 */
  weatherCity: string;
  /** 是否启用节日触发（固定公历 + nager.date 中国法定节假日）。 */
  holidayEnabled: boolean;
  /** GitMem 工作区路径；空 = <botDir>/workspace。 */
  gitmemWorkspace: string;
  /** 主记忆没命中时，是否只读检索旧 GitMem 工作区。 */
  gitmemReadThrough: boolean;
  /** 心理活动日志级别：off 关闭，summary 只记决策摘要。 */
  mindLogLevel: 'off' | 'summary';
  /** 实验性：背景念头。off 关闭；shadow 只记念头；act 允许写日记/休息。 */
  cognitionMode: 'off' | 'shadow' | 'act';
  /** 两次背景念头之间的最小间隔（分钟）。 */
  cognitionIntervalMin: number;
  /** 实验性：contact 意图到期后 hold（默认，不发消息）或 send（过复核后发送）。 */
  cognitionContactMode: 'hold' | 'send';
  /** 实验性：导入图片时调用本地描述程序生成初始含义。 */
  mediaAutoCaptionEnabled: boolean;
  /** 本地图片描述程序；图片路径作为最后一个参数，stdout 作为含义。 */
  mediaCaptionCommand: string;
  /** 兼容 OpenAI 的本地视觉接口地址；留空则只用命令。 */
  mediaCaptionBaseUrl: string;
  /** 视觉模型 ID；留空自动找支持图片输入的模型。 */
  mediaCaptionModel: string;
  /** 追加到环境提示词里的个人风格补充。 */
  styleNote: string;
}

export const COMPANION_DEFAULTS: CompanionConfig = {
  enabled: false,
  displayName: '大肥鱼',
  qqChannelEnabled: false,
  biliChannelEnabled: false,
  qqLegacyTools: false,
  biliCookieFile: '',
  biliInboxPushEnabled: true,
  biliInboxPollMinutes: 3,
  biliBrowserPath: '',
  biliReplyEnabled: false,
  biliInteractEnabled: true,
  biliOwnerUid: '',
  biliDailyComments: 3,
  qqTranscribeVoice: true,
  deepseekBaseUrl: 'https://api.deepseek.com',
  deepseekKeyFile: '',
  screenEnabled: false,
  biliSelfWatchEnabled: false,
  biliSelfWatchEveryMinutes: 180,
  biliSelfWatchTopics: '',
  biliSelfWatchTextDailyLimit: 3,
  biliSelfWatchFramesDailyLimit: 1,
  biliSelfWatchFramesCount: 6,
  biliSelfWatchMinMinutes: 1,
  biliMaxVideoMinutes: 30,
  biliCaptureIntervalSec: 0.8,
  biliObserveIntervalSec: 5,
  biliObserveCells: 4,
  proactiveEnabled: true,
  proactiveMinGapMin: 90,
  proactiveJitterMin: 12,
  proactiveDailyCap: 4,
  proactiveDecision: '综合判断',
  proactiveClinginess: 1.3,
  idleGateMin: 15,
  quietStart: '23:00',
  quietEnd: '08:30',
  sleepStart: '00:30',
  sleepEnd: '07:30',
  agendaEnabled: true,
  energyDecayPerHour: 2.5,
  journalInPrompt: 1,
  memoryEnabled: true,
  memoryCapture: true,
  memoryRetentionDays: 45,
  memoryNotesInPrompt: 6,
  userModelInPrompt: true,
  workingMemoryInPrompt: true,
  emotionEchoEnabled: true,
  musingEnabled: true,
  musingIdleHours: 4,
  musingDailyCap: 2,
  mergeEnabled: true,
  mergeSimilarity: 0.5,
  weatherEnabled: false,
  weatherCity: '',
  holidayEnabled: false,
  gitmemWorkspace: '',
  gitmemReadThrough: false,
  mindLogLevel: 'summary',
  cognitionMode: 'off',
  cognitionIntervalMin: 10,
  cognitionContactMode: 'hold',
  mediaAutoCaptionEnabled: false,
  mediaCaptionCommand: '',
  mediaCaptionBaseUrl: 'http://127.0.0.1:8081/v1',
  mediaCaptionModel: '',
  styleNote: '',
};

export function companionDefaults(): CompanionConfig {
  return { ...COMPANION_DEFAULTS };
}

export interface ConfigGroupSchema {
  type: 'object';
  title: string;
  description?: string;
  properties: Record<string, Record<string, unknown>>;
}

export interface CompanionConfigGroup {
  id: string;
  owner: string;
  schema: ConfigGroupSchema;
}

/** 设置页表单：键是 cfg 里的点分路径。 */
export const COMPANION_CONFIG_GROUP: CompanionConfigGroup = {
  id: 'world:companion',
  owner: 'world:companion',
  schema: {
    type: 'object',
    title: '我会永远陪着你',
    description: '为角色提供生活节奏、长期记忆与主动联系。配置大多即时生效；世界启停需要重启应用。',
    properties: {
      'worlds.companion.displayName': {
        type: 'string',
        title: '角色称呼',
        description: '角色在面板标题和互动中的显示称呼。默认「大肥鱼」，可按自己的设定修改。',
        'x-hot': true,
      },
      'worlds.companion.qqChannelEnabled': {
        type: 'boolean',
        title: 'QQ 通道（可选）',
        description: '启用后显示 QQ 面板，并由本扩展直接连接 OneBot。默认关闭，避免与已安装的 QQ 扩展重复连接。',
        'x-hot': true,
      },
      'worlds.companion.biliChannelEnabled': {
        type: 'boolean',
        title: 'B站通道（可选）',
        description: '启用后显示 B站面板，包含浏览、通知、账号与一起看。默认关闭，避免与已有的 B站扩展冲突。',
        'x-hot': true,
      },
      'worlds.companion.biliCookieFile': {
        type: 'string',
        title: 'B站 Cookie 文件',
        description: 'B站登录态文件路径。留空时读取旧陪看扩展的 cookies.json，也可指向自己的 Cookie 文件。',
        'x-path': { kind: 'file', extensions: ['json'] },
      },
      'worlds.companion.biliInboxPushEnabled': {
        type: 'boolean',
        title: 'B站 @/私信直接推送',
        description: '后台定时读取 B站 @、回复和私信，新消息直接交给角色；角色可直接回复评论楼中楼或私信。',
      },
      'worlds.companion.biliBrowserPath': {
        type: 'string',
        title: '一起看浏览器路径',
        description: '一起看使用的浏览器程序。留空使用系统 Edge；使用普通窗口，不另起 app 窗口。',
        'x-path': { kind: 'file', extensions: ['exe'] },
      },
      'worlds.companion.biliInboxPollMinutes': {
        type: 'integer',
        title: 'B站通知轮询间隔（分钟）',
        minimum: 1,
        maximum: 60,
        description: '后台检查 B站通知的频率。默认 3 分钟；过短会增加请求次数。',
      },
      'worlds.companion.biliReplyEnabled': {
        type: 'boolean',
        title: '允许 B站评论/私信回复',
        description: '允许角色发 B站评论和私信。默认关闭；每次发送仍需要明确确认。',
      },
      'worlds.companion.biliInteractEnabled': {
        type: 'boolean',
        title: '允许 B站账号动作',
        description: '允许角色执行点赞、投币、收藏、关注等账号动作。默认开启。',
      },
      'worlds.companion.biliOwnerUid': {
        type: 'string',
        title: 'B站主人 UID',
        description: '评论时 @ 的账号 UID。留空时尝试从旧陪看配置读取。',
      },
      'worlds.companion.biliDailyComments': {
        type: 'integer',
        title: 'B站每天评论上限',
        minimum: 1,
        maximum: 20,
        description: '每天最多发几条 B站评论，成功发送才计数。',
      },
      'worlds.companion.qqTranscribeVoice': {
        type: 'boolean',
        title: '自动转写 QQ 语音',
        description: '收到 QQ 语音时自动转成文字再交给角色。使用 DeepSeek ASR；关闭后只保留音频文件。',
      },
      'worlds.companion.screenEnabled': {
        type: 'boolean',
        title: '允许看屏幕（可选）',
        description: '允许角色截取当前桌面。默认关闭；只应在明确需要时开启。',
      },
      'worlds.companion.biliSelfWatchEnabled': {
        type: 'boolean',
        title: 'B站自己看',
        description: '按设定间隔从观看记录或兴趣主题中挑视频，读取信息、字幕和评论后记录观看账。',
      },
      'worlds.companion.biliSelfWatchEveryMinutes': {
        type: 'integer',
        title: '自己看间隔（分钟）',
        minimum: 30,
        maximum: 1440,
        description: '两次自己看之间的最短间隔；过短会频繁请求 B站并增加消耗。',
      },
      'worlds.companion.biliSelfWatchTopics': {
        type: 'string',
        title: '自己看主题',
        description: '观看记录为空时按这些关键词找视频；留空则不自动开始自己看。',
      },
      'worlds.companion.biliSelfWatchTextDailyLimit': {
        type: 'integer',
        title: '自己看文字视频每天上限',
        minimum: 0,
        maximum: 12,
        'x-suffix': '条',
        description: '每天最多看几条只看文字/字幕/评论的视频；0 表示不自动看文字视频。默认 3 条。',
      },
      'worlds.companion.biliSelfWatchFramesDailyLimit': {
        type: 'integer',
        title: '自己看带画面每天上限',
        minimum: 0,
        maximum: 6,
        'x-suffix': '条',
        description: '每天最多看几条带画面的视频；0 表示不自动看图。默认 1 条，避免每天消耗太多画面。',
      },
      'worlds.companion.biliSelfWatchFramesCount': {
        type: 'integer',
        title: '带画面每次随机抽几帧',
        minimum: 1,
        maximum: 6,
        'x-suffix': '帧',
        description: '自己看带画面时，每条视频默认随机截取 6 张，避开首尾极端位置；可调低到 1 张。',
      },
      'worlds.companion.biliSelfWatchMinMinutes': {
        type: 'integer',
        title: '自动找视频最短时长',
        minimum: 0,
        maximum: 120,
        'x-suffix': '分钟',
        description: '自己看/一起看自动挑视频时，太短的跳过。默认 1 分钟。',
      },
      'worlds.companion.biliMaxVideoMinutes': {
        type: 'integer',
        title: '自动找视频最长时长',
        minimum: 1,
        maximum: 240,
        'x-suffix': '分钟',
        description: '自己看/一起看自动挑视频时，超过这个时长的跳过。默认 30 分钟。',
      },
      'worlds.companion.biliCaptureIntervalSec': {
        type: 'number',
        title: '一起看采样间隔',
        minimum: 0.2,
        maximum: 5,
        multipleOf: 0.1,
        'x-suffix': '秒',
        description: '播放中每隔多久抽一张画面。默认 0.8 秒；太小会增加 CPU 和截图开销。',
      },
      'worlds.companion.biliObserveIntervalSec': {
        type: 'number',
        title: '观察图集间隔',
        minimum: 2,
        maximum: 120,
        multipleOf: 1,
        'x-suffix': '秒',
        description: '每隔多久把最近几张画面拼成图集交给角色。默认 5 秒。',
      },
      'worlds.companion.biliObserveCells': {
        type: 'integer',
        title: '每张图集最多几格',
        minimum: 2,
        maximum: 9,
        'x-suffix': '格',
        description: '图集包含的最近画面数，默认 4 格。格数越多，单次观察消耗越大。',
      },
      'worlds.companion.proactiveEnabled': {
        type: 'boolean',
        title: '主动联系',
        description: '开启后角色会依据自己的状态和日程主动开口；关闭后只回应，不主动发起。',
        'x-hot': true,
      },
      'worlds.companion.proactiveDailyCap': {
        type: 'integer',
        title: '每天主动上限',
        description: '每天最多主动联系几次；0 表示不限制，建议按角色关系设为 2-6 次。',
        minimum: 0,
        maximum: 24,
        'x-suffix': '次',
        'x-hot': true,
      },
      'worlds.companion.proactiveDecision': {
        type: 'string',
        title: '开口决策',
        description: '主动开口的决策方式：综合判断会权衡由头价值和打扰成本；只记录只观察不改变行为；固定阈值沿用旧版。默认综合判断。',
        enum: ['综合判断', '只记录', '固定阈值'],
        'x-hot': true,
      },
      'worlds.companion.proactiveClinginess': {
        type: 'number',
        title: '黏人度',
        description: '角色主动开口的积极程度：数值越高越愿意开口，但不会忽略忙碌、刚聊过和被忽略的成本。',
        minimum: 0,
        maximum: 2,
        multipleOf: 0.05,
        'x-hot': true,
      },
      'worlds.companion.idleGateMin': {
        type: 'integer',
        title: '刚聊完的静默窗口（分钟）',
        description: '对方刚说完话后的一段时间内不主动打扰。',
        minimum: 0,
        maximum: 240,
        'x-suffix': '分钟',
        'x-hot': true,
      },
      'worlds.companion.quietStart': {
        type: 'string',
        title: '免打扰开始',
        description: '免打扰开始时点（HH:MM）；与结束时间相同表示关闭。',
        'x-hot': true,
      },
      'worlds.companion.quietEnd': {
        type: 'string',
        title: '免打扰结束',
        description: '免打扰结束时点（HH:MM）。',
        'x-hot': true,
      },
      'worlds.companion.sleepStart': {
        type: 'string',
        title: '睡觉开始',
        description: '角色进入睡眠的时点；睡眠时精力恢复，也不会主动联系。',
        'x-hot': true,
      },
      'worlds.companion.sleepEnd': {
        type: 'string',
        title: '睡觉结束',
        description: '角色醒来的时点。',
        'x-hot': true,
      },
      'worlds.companion.agendaEnabled': {
        type: 'boolean',
        title: '每日节目单',
        description: '每天为角色自动安排几件小事；日程会参与状态和主动开口的判断。',
        'x-hot': true,
      },
      'worlds.companion.energyDecayPerHour': {
        type: 'number',
        title: '醒着时精力消耗（每小时）',
        description: '醒着时每小时减少的精力值；0 表示不消耗。',
        minimum: 0,
        maximum: 20,
        'x-scale': 1,
      },
      'worlds.companion.journalInPrompt': {
        type: 'integer',
        title: '上下文里带几条最近日记',
        description: '每轮放入上下文的最近日记条数；0 表示不带。',
        minimum: 0,
        maximum: 5,
        'x-suffix': '条',
        'x-hot': true,
      },
      'worlds.companion.memoryEnabled': {
        type: 'boolean',
        title: '内置记忆',
        description: '关闭后不再写入或召回记忆；已有记录仍保留在数据目录。',
        'x-hot': true,
      },
      'worlds.companion.memoryCapture': {
        type: 'boolean',
        title: '自动捕获对话',
        description: '把外部消息写入原始事件层，作为长期记忆的原料；可设置保留天数。',
        'x-hot': true,
      },
      'worlds.companion.memoryRetentionDays': {
        type: 'integer',
        title: '原始事件保留天数',
        description: '原始对话事件在磁盘上的保留天数；过期自动裁剪。',
        minimum: 3,
        maximum: 365,
        'x-suffix': '天',
        'x-hot': true,
      },
      'worlds.companion.memoryNotesInPrompt': {
        type: 'integer',
        title: '常驻笔记进提示词条数',
        description: '常驻笔记进入上下文的条数；0 表示不带。',
        minimum: 0,
        maximum: 12,
        'x-suffix': '条',
        'x-hot': true,
      },
      'worlds.companion.userModelInPrompt': {
        type: 'boolean',
        title: '用户模型',
        description: '从记忆中归纳用户的身份、近况和关注点，作为角色理解对方的参考；推测会以不确定语气表达。',
        'x-hot': true,
      },
      'worlds.companion.workingMemoryInPrompt': {
        type: 'boolean',
        title: '工作记忆（今天聊过什么）',
        description: '把最近 24 小时最值得记住的 1-3 件事写进上下文，减少重复询问。',
        'x-hot': true,
      },
      'worlds.companion.emotionEchoEnabled': {
        type: 'boolean',
        title: '情绪回声',
        description: '用户表达疲惫、烦躁或开心时，提示角色回忆类似情绪的经历；是否提起由角色决定。',
        'x-hot': true,
      },
      'worlds.companion.musingEnabled': {
        type: 'boolean',
        title: '胡思乱想',
        description: '角色空闲时基于旧记忆做一次低权重联想；会额外消耗一次模型调用。',
        'x-hot': true,
      },
      'worlds.companion.musingIdleHours': {
        type: 'integer',
        title: '空闲多少小时后开始胡思乱想',
        description: '角色空闲达到多少小时后开始胡思乱想。',
        minimum: 1,
        maximum: 48,
        'x-suffix': '小时',
        'x-hot': true,
      },
      'worlds.companion.musingDailyCap': {
        type: 'integer',
        title: '每天胡思乱想上限',
        description: '每天最多进行几次空闲联想；0 表示关闭。',
        minimum: 0,
        maximum: 6,
        'x-suffix': '次',
        'x-hot': true,
      },
      'worlds.companion.mergeEnabled': {
        type: 'boolean',
        title: '合并式遗忘',
        description: '夜间把相似经历合并为摘要，原文保留可查；高权重记录不参与合并。',
        'x-hot': true,
      },
      'worlds.companion.mergeSimilarity': {
        type: 'number',
        title: '合并相似度阈值',
        description: '合并相似度阈值：越低越容易合并，越高越保守。',
        minimum: 0.3,
        maximum: 0.9,
        multipleOf: 0.05,
        'x-hot': true,
      },
      'worlds.companion.mindLogLevel': {
        type: 'string',
        title: '心理活动日志',
        description: '记录主动开口、记忆写入和夜间整理等决策，仅供面板查看，不进入模型上下文。',
        enum: ['off', 'summary'],
        'x-hot': true,
      },
      'worlds.companion.weatherEnabled': {
        type: 'boolean',
        title: '天气触发',
        description: '按城市查询天气，在降雨、降温或高温时产生主动开口的由头。默认关闭；未填城市不会请求。',
        'x-hot': true,
      },
      'worlds.companion.weatherCity': {
        type: 'string',
        title: '天气城市',
        description: '用于天气查询的城市名；留空则关闭天气触发。',
      },
      'worlds.companion.gitmemWorkspace': {
        type: 'string',
        title: 'GitMem 工作区',
        description: '旧 GitMem 工作区路径；留空使用角色数据目录下的 workspace。',
      },
      'worlds.companion.gitmemReadThrough': {
        type: 'boolean',
        title: '旧 GitMem 读穿',
        description: '主记忆没有命中时，只读查询旧 GitMem 笔记；不会写入主记忆。默认关闭。',
      },
      'worlds.companion.holidayEnabled': {
        type: 'boolean',
        title: '节日触发',
        description: '每天查询中国法定节假日并产生由头；失败时使用固定公历节日。默认关闭。',
        'x-hot': true,
      },
      'worlds.companion.mediaAutoCaptionEnabled': {
        type: 'boolean',
        title: '导入图片时自动描述',
        description: '开启后，图片导入时可调用本机的图片描述程序，先写一句初始含义，之后仍可用 qq_media_note 人工纠正。默认关闭。',
        'x-hot': true,
      },
      'worlds.companion.mediaCaptionBaseUrl': {
        type: 'string',
        title: '本地视觉接口地址',
        description: '兼容 OpenAI 的本地视觉服务地址，默认 http://127.0.0.1:8081/v1。模型必须支持图片输入；纯文字模型会跳过自动描述。',
      },
      'worlds.companion.mediaCaptionModel': {
        type: 'string',
        title: '本地视觉模型',
        description: '视觉模型 ID；留空时自动从 /v1/models 里找支持图片输入的模型。',
      },
      'worlds.companion.mediaCaptionCommand': {
        type: 'string',
        title: '本地图片描述程序',
        description: '本机可执行文件路径；导入图片时会以图片路径作为最后一个参数调用它，取 stdout 第一行作为含义。留空则只导入、不自动描述。',
      },
      'worlds.companion.cognitionMode': {
        type: 'string',
        title: '背景念头 → 意图',
        description: '实验性背景念头；记录模式只观察，行动模式会按念头写日记或休息，行为尚不稳定。',
        enum: ['off', 'shadow', 'act'],
        'x-hot': true,
      },
      'worlds.companion.cognitionIntervalMin': {
        type: 'number',
        title: '念头间隔（分钟）',
        description: '两次背景念头之间的最短间隔，默认 10 分钟。',
        minimum: 1,
        maximum: 60,
        'x-hot': true,
      },
      'worlds.companion.cognitionContactMode': {
        type: 'string',
        title: '意图联系',
        description: '实验性意图联系；hold 只保留想法，send 才会经过免打扰、额度和未回应检查后发送。',
        enum: ['hold', 'send'],
        'x-hot': true,
      },
      'worlds.companion.styleNote': {
        type: 'string',
        title: '风格补充',
        description: '追加到角色环境提示词末尾的写作风格、称呼和忌讳；留空不追加。',
      },
    },
  },
};

/** 分类后的设置页表单：记忆 / QQ / B站 / 试验性功能。 */
const FLAT_PROPERTIES = COMPANION_CONFIG_GROUP.schema.properties;
const property = (name: string): [string, Record<string, unknown>] => {
  const path = `worlds.companion.${name}`;
  const value = FLAT_PROPERTIES[path];
  if (!value) throw new Error(`配置项不存在：${path}`);
  return [path, value];
};
const pick = (names: string[]): Record<string, Record<string, unknown>> => Object.fromEntries(names.map(property));

const MEMORY_KEYS = [
  'displayName',
  'proactiveEnabled', 'proactiveDailyCap', 'proactiveDecision', 'proactiveClinginess',
  'idleGateMin', 'quietStart', 'quietEnd', 'sleepStart', 'sleepEnd',
  'agendaEnabled', 'energyDecayPerHour', 'journalInPrompt',
  'memoryEnabled', 'memoryCapture', 'memoryRetentionDays', 'memoryNotesInPrompt',
  'userModelInPrompt', 'workingMemoryInPrompt', 'emotionEchoEnabled',
  'musingEnabled', 'musingIdleHours', 'musingDailyCap',
  'mergeEnabled', 'mergeSimilarity', 'mindLogLevel',
  'weatherEnabled', 'weatherCity', 'holidayEnabled',
  'gitmemWorkspace', 'gitmemReadThrough', 'styleNote',
];
const QQ_KEYS = ['qqChannelEnabled', 'qqTranscribeVoice'];
const BILI_KEYS = [
  'biliChannelEnabled', 'biliCookieFile', 'biliInboxPushEnabled', 'biliInboxPollMinutes',
  'biliBrowserPath', 'biliReplyEnabled', 'biliInteractEnabled', 'biliOwnerUid', 'biliDailyComments',
  'biliSelfWatchEnabled', 'biliSelfWatchEveryMinutes', 'biliSelfWatchTopics',
  'biliSelfWatchTextDailyLimit', 'biliSelfWatchFramesDailyLimit', 'biliSelfWatchFramesCount',
  'biliSelfWatchMinMinutes', 'biliMaxVideoMinutes',
  'biliCaptureIntervalSec', 'biliObserveIntervalSec', 'biliObserveCells',
];
const EXPERIMENTAL_KEYS = ['screenEnabled', 'cognitionMode', 'cognitionIntervalMin', 'cognitionContactMode', 'mediaAutoCaptionEnabled', 'mediaCaptionCommand', 'mediaCaptionBaseUrl', 'mediaCaptionModel'];

export const COMPANION_CONFIG_GROUPS: CompanionConfigGroup[] = [
  {
    id: 'world:companion:memory',
    owner: 'world:companion',
    schema: {
      type: 'object',
      title: '记忆',
      description: '长期记忆、生活节奏、主动联系与角色风格。',
      properties: pick(MEMORY_KEYS),
    },
  },
  {
    id: 'world:companion:qq',
    owner: 'world:companion',
    schema: {
      type: 'object',
      title: 'QQ',
      description: '可选的原生 OneBot 通道；关闭时不连接、不显示面板，也不注册通道工具。',
      properties: pick(QQ_KEYS),
    },
  },
  {
    id: 'world:companion:bili',
    owner: 'world:companion',
    schema: {
      type: 'object',
      title: 'B站',
      description: '可选的 B站 通道、通知、账号动作、自己看与一起看观察。',
      properties: pick(BILI_KEYS),
    },
  },
  {
    id: 'world:companion:experimental',
    owner: 'world:companion',
    schema: {
      type: 'object',
      title: '试验性功能',
      description: '尚未稳定的实验能力，默认关闭或只记录，不建议一开始全开。',
      properties: pick(EXPERIMENTAL_KEYS),
    },
  },
];
