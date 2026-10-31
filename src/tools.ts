/**
 * 工具声明（只给模型看的 schema）。handler 在 world.ts 里按 name 分发。
 * 单独放一个文件，是为了让 describe（扩展自描述）和运行时工具表共用同一份定义，不会漂。
 */
import type { ToolSpec } from 'cortico/core/types.ts';

const obj = (properties: Record<string, unknown>, required: string[]): Record<string, unknown> => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
});

export const TOOL_SPECS: ToolSpec[] = [
  {
    name: 'companion_state',
    description:
      '查看或修改你自己此刻的状态：精力、心情、正在做什么、在哪。'
      + 'action=get 只读；action=update 只改传入的字段。状态是你自己的，不要把清单念给对方听。',
    parameters: obj(
      {
        action: { type: 'string', enum: ['get', 'update'], description: 'get=读取，update=修改' },
        energy: { type: 'number', minimum: 0, maximum: 100, description: '精力 0-100' },
        mood: { type: 'number', minimum: 0, maximum: 100, description: '心情 0-100' },
        activity: { type: 'string', description: '正在做的事，例如「看窗外」' },
        location: { type: 'string', description: '所在位置，例如「窗台」' },
      },
      ['action'],
    ),
    tags: ['read', 'write'],
    usage: '对方问「你在干嘛」时可以直接用状态回答；一天结束时可以把精力改低一点，让它像个会累的人。',
  },
  {
    name: 'companion_agenda',
    description:
      '查看或安排你今天的节目单。action=get 读取；action=set 整体替换；action=add 追加；action=clear 清空。'
      + '时间是 24 小时制 HH:MM。日程会影响你的状态，也会成为主动开口的由头。',
    parameters: obj(
      {
        action: { type: 'string', enum: ['get', 'set', 'add', 'clear'] },
        items: {
          type: 'array',
          description: '日程项；set 用整表，add 用第一项',
          items: {
            type: 'object',
            properties: {
              time: { type: 'string', description: 'HH:MM' },
              title: { type: 'string', description: '做什么' },
              place: { type: 'string', description: '在哪，可省略' },
            },
            required: ['time', 'title'],
          },
        },
      },
      ['action'],
    ),
    tags: ['read', 'write'],
    usage: '早上可以自己排一份；对方约了具体时间也记进来。不用每天排满，留白才像日子。',
  },
  {
    name: 'companion_profile',
    description:
      '读或写「关系卡」：你怎么称呼对方、是什么关系、生日、要记住的偏好。'
      + 'action=get 读取；action=set 更新传入字段（notes 会合并去重）。key 缺省 main。',
    parameters: obj(
      {
        action: { type: 'string', enum: ['get', 'set', 'list'] },
        key: { type: 'string', description: '关系卡键，缺省 main；action=list 时忽略' },
        name: { type: 'string', description: '称呼' },
        relation: { type: 'string', description: '关系，例如 主人/搭档' },
        birthday: { type: 'string', description: 'MM-DD 或 YYYY-MM-DD' },
        notes: {
          type: 'array',
          items: { type: 'string' },
          description: '要记住的偏好或事实，逐条',
        },
      },
      ['action'],
    ),
    tags: ['read', 'write'],
    usage: '对方说「我叫……」「以后叫我……」时写进去；不要每次都问一遍同样的信息。',
  },
  {
    name: 'companion_journal',
    description:
      '写或读你的日记。action=write 记一条（默认 kind=日记）；action=read 读最近几条。'
      + '日记会在下次对话的陪伴上下文里出现一条，别写成汇报。',
    parameters: obj(
      {
        action: { type: 'string', enum: ['write', 'read'] },
        text: { type: 'string', description: '正文' },
        kind: { type: 'string', description: '日记 / 梦 / 事件，缺省 日记' },
        limit: { type: 'number', minimum: 1, maximum: 20, description: 'read 时读几条，缺省 3' },
      },
      ['action'],
    ),
    tags: ['read', 'write'],
    usage: '一天结束、或白天发生了值得记住的小事时写一条；不必每轮都写。',
  },
  {
    name: 'companion_proactive',
    description:
      '主动开口的开关与自检。action=status 看现在会不会开口、被什么拦着；'
      + 'action=trigger 立刻按当前状态开口一次（测试用，会跳过免打扰与间隔）。',
    parameters: obj(
      { action: { type: 'string', enum: ['status', 'trigger'] } },
      ['action'],
    ),
    tags: ['read', 'flow'],
    usage: '只在对方明确让你试试主动消息时用 trigger；日常不要自己触发。',
  },
  {
    name: 'companion_recall',
    description:
      '在你自己的记忆库里检索（经历/事实/人物/约定/自我/规则 + 最近捕获的对话）。 '
      + '想不起对方说过的某件事、某个约定或某个人的偏好时用它，不要凭空编回忆；查不到就直说想不起来。'
      + '默认不含已归档的合并原文；需要翻旧账时 includeArchived=true。',
    parameters: obj(
      {
        query: { type: 'string', description: '关键词，中文直接写，例如「生日」「水群」' },
        limit: { type: 'number', minimum: 1, maximum: 10, description: '最多几条，缺省 5' },
        includeArchived: { type: 'boolean', description: '是否连已归档的原文一起查' },
        scope: { type: 'string', description: '只查某个记忆域，例如 main 或 qq:<号>；默认当前会话，* 表示全库' },
      },
      ['query'],
    ),
    tags: ['read'],
    usage: '只在需要回忆具体事情时用；查到的内容自然带进对话，不要念成搜索结果列表。',
  },
  {
    name: 'companion_remember',
    description:
      '把值得记住的事写进你自己的记忆库。kind：episode（带视角的经历）/ fact（事实）/ '
      + 'person（对人的认识与关系）/ thread（没做完的约定）/ self（对自己的结论）/ rule（硬约束，pinned）。'
      + '如果对方有明显情绪，episode 带上 userEmotion（label/cause/intensity），以后能触发“情绪回声”。'
      + '同一句话重复写会被去重。',
    parameters: obj(
      {
        kind: {
          type: 'string',
          enum: ['episode', 'fact', 'person', 'thread', 'self', 'rule'],
          description: '记忆类型',
        },
        text: { type: 'string', description: '一条完整、可独立读懂的话' },
        scope: { type: 'string', description: '记忆域，缺省 main；按人分域时用 qq:<号>' },
        confidence: { type: 'number', minimum: 0, maximum: 1, description: '把握多大，缺省 0.75' },
        importance: { type: 'number', minimum: 0, maximum: 1, description: '有多重要，缺省 0.55' },
        tags: { type: 'array', items: { type: 'string' }, description: '可选标签；musing 表示这是自己胡思乱想的' },
        userEmotion: {
          type: 'object',
          description: '对方当时的情绪（可选）：{ label, cause, intensity }',
          properties: {
            label: { type: 'string', description: '疲惫/烦躁/开心/难过/焦虑/孤独' },
            cause: { type: 'string', description: '情绪的原因，例如「连续加班」' },
            intensity: { type: 'number', minimum: 0, maximum: 1 },
          },
        },
      },
      ['kind', 'text'],
    ),
    tags: ['write'],
    usage: '对方明确说「记住」时用 rule 或 fact；日常见闻用 episode，并尽量带 userEmotion；关于人的稳定偏好用 person。别把工具回执、系统通知写进记忆。',
  },
  {
    name: 'companion_memory',
    description:
      '记忆库维护：stats 看统计；export 导出 bundle 到数据目录；import 从 imports/ 目录的文件合并导入（mode=dry 只报告）；'
      + 'prune 裁剪过期原始事件；unmerge 撤销一次合并；forget 按原文精确删除一条。',
    parameters: obj(
      {
        action: {
          type: 'string',
          enum: ['stats', 'export', 'import', 'quarantine', 'prune', 'unmerge', 'forget'],
          description: '要做的维护动作',
        },
        path: { type: 'string', description: 'import 时的文件名（只填 imports/ 下的 .json 文件名，不带路径）' },
        mode: { type: 'string', enum: ['dry', 'merge'], description: 'import 模式，缺省 merge' },
        scopes: { type: 'array', items: { type: 'string' }, description: 'export 时要导出的 scope；省略则导全部' },
        includeRules: { type: 'boolean', description: 'export 是否包含常驻笔记/规则' },
        includeArchived: { type: 'boolean', description: 'export 是否包含已归档的合并原文' },
        scope: { type: 'string', description: 'forget 时只删这个记忆域里的记录' },
        id: { type: 'string', description: 'unmerge 时的合并摘要记录 id' },
        query: { type: 'string', description: 'forget 时要删除的原文' },
      },
      ['action'],
    ),
    tags: ['read', 'write', 'flow'],
    usage: '一般不用主动调；对方要求导入/导出/清理记忆时才用。导入前先用 mode=dry 看一眼。',
  },
  {
    name: 'companion_consolidate',
    description:
      '夜间整理记忆：action=plan 返回过去 24 小时的人话、未完成的约定和整理要求；'
      + 'action=apply 提交 0-6 条结构化记录（episode/fact/person/thread/self）。'
      + '只写有依据的事，不要写工具回执，不要删东西。',
    parameters: obj(
      {
        action: { type: 'string', enum: ['plan', 'apply'] },
        records: {
          type: 'array',
          description: 'apply 时提交的记录；每条含 kind/text，可选 details/importance',
          items: {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: ['episode', 'fact', 'person', 'thread', 'self', 'rule'] },
              text: { type: 'string' },
              details: { type: 'object' },
              importance: { type: 'number', minimum: 0, maximum: 1 },
            },
            required: ['kind', 'text'],
          },
        },
      },
      ['action'],
    ),
    tags: ['read', 'write', 'flow'],
    usage: '通常由夜间提醒触发；对方没要求时不要主动整理。提交前先看 plan。',
  },
];

/** 给人看的一句话（设置页与市场）。 */
export const TOOL_SUMMARIES: Record<string, string> = {
  companion_state: '查看/修改角色自己的精力、心情、在做什么。',
  companion_agenda: '查看/安排今天的节目单。',
  companion_profile: '读写关系卡：称呼、关系、生日、偏好。',
  companion_journal: '写/读角色自己的日记。',
  companion_proactive: '检查或测试主动联系。',
  companion_recall: '在内置记忆里检索笔记、事实、经历与约定。',
  companion_remember: '把值得记住的事写进内置记忆（含常驻笔记）。',
  companion_memory: '记忆库维护：统计、导入、导出、裁剪、精确删除。',
  companion_consolidate: '夜间整理：取材料或提交 0-6 条结构化记忆。',
};
