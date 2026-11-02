/**
 * World 配置段 worlds.companion 的形状、默认值与设置页表单声明。
 * 默认 enabled=false：没在部署配置里打开时不会运行。
 */

export interface CompanionConfig {
  enabled: boolean;
  /** 主动联系总开关。 */
  proactiveEnabled: boolean;
  /** @deprecated 旧计时器参数，保留兼容，不再使用。 */
  proactiveMinGapMin: number;
  /** @deprecated 旧计时器参数，保留兼容，不再使用。 */
  proactiveJitterMin: number;
  /** 每天主动上限（0 = 不限制，不建议）。 */
  proactiveDailyCap: number;
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
  /** 心理活动日志级别：off 关闭，summary 只记决策摘要。 */
  mindLogLevel: 'off' | 'summary';
  /** 实验性：背景念头。off 关闭；shadow 只记念头；act 允许写日记/休息。 */
  cognitionMode: 'off' | 'shadow' | 'act';
  /** 两次背景念头之间的最小间隔（分钟）。 */
  cognitionIntervalMin: number;
  /** 实验性：contact 意图到期后 hold（默认，不发消息）或 send（过复核后发送）。 */
  cognitionContactMode: 'hold' | 'send';
  /** 追加到环境提示词里的个人风格补充。 */
  styleNote: string;
}

export const COMPANION_DEFAULTS: CompanionConfig = {
  enabled: false,
  proactiveEnabled: true,
  proactiveMinGapMin: 90,
  proactiveJitterMin: 12,
  proactiveDailyCap: 4,
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
  workingMemoryInPrompt: true,
  emotionEchoEnabled: true,
  musingEnabled: true,
  musingIdleHours: 4,
  musingDailyCap: 2,
  mergeEnabled: true,
  mergeSimilarity: 0.5,
  mindLogLevel: 'summary',
  cognitionMode: 'off',
  cognitionIntervalMin: 10,
  cognitionContactMode: 'hold',
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
    description: '生活感与主动联系的分寸。内置可迁移记忆（companion-memory/2，支持导入导出与隔离审核）。设计参考 menglimi 的 AstrBot 插件 astrbot_plugin_private_companion（同名「我会永远陪着你」）。改完即时生效（世界启停本身需要重启进程）。',
    properties: {
      'worlds.companion.proactiveEnabled': {
        type: 'boolean',
        title: '主动联系',
        description: '开启后，它会按自己的生活和时间找你说一句；关掉后只回应，不主动开口。',
        'x-hot': true,
      },
      'worlds.companion.proactiveDailyCap': {
        type: 'integer',
        title: '每天主动上限',
        description: '0 表示不限制；建议 2-6。',
        minimum: 0,
        maximum: 24,
        'x-suffix': '次',
        'x-hot': true,
      },
      'worlds.companion.idleGateMin': {
        type: 'integer',
        title: '刚聊完的静默窗口（分钟）',
        description: '对方刚说过话的这段时间里不主动打扰。',
        minimum: 0,
        maximum: 240,
        'x-suffix': '分钟',
        'x-hot': true,
      },
      'worlds.companion.quietStart': {
        type: 'string',
        title: '免打扰开始',
        description: 'HH:MM；与结束时间相同视为关闭免打扰。',
        'x-hot': true,
      },
      'worlds.companion.quietEnd': {
        type: 'string',
        title: '免打扰结束',
        'x-hot': true,
      },
      'worlds.companion.sleepStart': {
        type: 'string',
        title: '睡觉开始',
        description: '睡觉时段精力回升，且不会主动联系。',
        'x-hot': true,
      },
      'worlds.companion.sleepEnd': {
        type: 'string',
        title: '睡觉结束',
        'x-hot': true,
      },
      'worlds.companion.agendaEnabled': {
        type: 'boolean',
        title: '每日节目单',
        description: '每天自动安排几件小事，状态与主动联系会引用它。',
        'x-hot': true,
      },
      'worlds.companion.energyDecayPerHour': {
        type: 'number',
        title: '醒着时精力消耗（每小时）',
        minimum: 0,
        maximum: 20,
        'x-scale': 1,
      },
      'worlds.companion.journalInPrompt': {
        type: 'integer',
        title: '上下文里带几条最近日记',
        minimum: 0,
        maximum: 5,
        'x-suffix': '条',
        'x-hot': true,
      },
      'worlds.companion.memoryEnabled': {
        type: 'boolean',
        title: '内置记忆',
        description: '关掉后不再写入/召回；已有记录仍留在数据目录。',
        'x-hot': true,
      },
      'worlds.companion.memoryCapture': {
        type: 'boolean',
        title: '自动捕获对话',
        description: '把外部消息追加进原始事件层（可裁剪），是“记得你说过什么”的原料。',
        'x-hot': true,
      },
      'worlds.companion.memoryRetentionDays': {
        type: 'integer',
        title: '原始事件保留天数',
        minimum: 3,
        maximum: 365,
        'x-suffix': '天',
        'x-hot': true,
      },
      'worlds.companion.memoryNotesInPrompt': {
        type: 'integer',
        title: '常驻笔记进提示词条数',
        minimum: 0,
        maximum: 12,
        'x-suffix': '条',
        'x-hot': true,
      },
      'worlds.companion.workingMemoryInPrompt': {
        type: 'boolean',
        title: '工作记忆（今天聊过什么）',
        description: '把近 24 小时最值得记的 1-3 件事压成一行放进上下文，减少“今天说过啥”的失忆。',
        'x-hot': true,
      },
      'worlds.companion.emotionEchoEnabled': {
        type: 'boolean',
        title: '情绪回声',
        description: '对方说“累/烦/开心”时，提示模型“上次同类情绪是因为什么”，由模型决定提不提。',
        'x-hot': true,
      },
      'worlds.companion.musingEnabled': {
        type: 'boolean',
        title: '胡思乱想',
        description: '空闲时让它基于旧记忆自己联想 1-2 条（低权重、默认不进上下文，可被检索）。会多一次模型调用。',
        'x-hot': true,
      },
      'worlds.companion.musingIdleHours': {
        type: 'integer',
        title: '空闲多少小时后开始胡思乱想',
        minimum: 1,
        maximum: 48,
        'x-suffix': '小时',
        'x-hot': true,
      },
      'worlds.companion.musingDailyCap': {
        type: 'integer',
        title: '每天胡思乱想上限',
        minimum: 0,
        maximum: 6,
        'x-suffix': '次',
        'x-hot': true,
      },
      'worlds.companion.mergeEnabled': {
        type: 'boolean',
        title: '合并式遗忘',
        description: '夜间把相似经历合并成一条摘要，原文归档可查；高权重记录不合并。',
        'x-hot': true,
      },
      'worlds.companion.mergeSimilarity': {
        type: 'number',
        title: '合并相似度阈值',
        description: '0.3 更激进、0.9 更保守；越高越不容易把不同的事并在一起。',
        minimum: 0.3,
        maximum: 0.9,
        'x-scale': 0.05,
        'x-hot': true,
      },
      'worlds.companion.mindLogLevel': {
        type: 'string',
        title: '心理活动日志',
        description: '记录主动开口/回声/记忆写入/夜间整理等决策，只给面板看，不进模型上下文；off 关闭。',
        enum: ['off', 'summary'],
        'x-hot': true,
      },
      'worlds.companion.cognitionMode': {
        type: 'string',
        title: '背景念头 → 意图',
        description: '实验性功能，默认 off。shadow 只记录“她此刻想到了什么”；act 会按意图写日记/休息，行为还不稳定。',
        enum: ['off', 'shadow', 'act'],
        'x-hot': true,
      },
      'worlds.companion.cognitionIntervalMin': {
        type: 'number',
        title: '念头间隔（分钟）',
        description: '实验性功能：两次背景念头之间至少隔多久；默认 10 分钟。',
        minimum: 1,
        maximum: 60,
        'x-hot': true,
      },
      'worlds.companion.cognitionContactMode': {
        type: 'string',
        title: '意图联系',
        description: '实验性功能：hold 只把“想找他”放在心里（默认）；send 才会过免打扰/额度/未回应/发送前复核后真的推送。',
        enum: ['hold', 'send'],
        'x-hot': true,
      },
      'worlds.companion.styleNote': {
        type: 'string',
        title: '风格补充',
        description: '追加到环境提示词末尾。写口癖、称呼、忌讳都行；留空则不加。',
      },
    },
  },
};
