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
        subjectKey: { type: 'string', description: '同一件事实/话头的稳定主语，例如 video-plugin；同主语会更新版本而不是新增一条' },
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
    name: 'companion_thread',
    description:
      '收尾或更新一条未完成的话头。action=done 标记完成；cancel 标记取消；update 改 what/due。'
      + '用户回复了上次主动追问时，用它判断并收尾，避免反复追问。',
    parameters: obj(
      {
        action: { type: 'string', enum: ['done', 'cancel', 'update'] },
        id: { type: 'string', description: 'thread 记录 id' },
        what: { type: 'string', description: 'update 时新的内容摘要' },
        due: { type: 'string', description: 'update 时的新的约定时间' },
      },
      ['action', 'id'],
    ),
    tags: ['write', 'flow'],
    usage: '只在用户已经回应、或话头明确结束/取消时用；不要凭空关闭未确认的话头。',
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
  {
    name: 'companion_memory_read',
    description: '按 id 读一条完整记忆：当前正文、类型、版本历史、来源信息。用在 recall 只给片段、需要核对原文时。',
    parameters: obj({ id: { type: 'string', description: '记忆 id；recall 结果会带 id' } }, ['id']),
    tags: ['read'],
    usage: '只在需要核对细节/版本时用；不要把整段原文念给对方听。',
  },
  {
    name: 'companion_memory_timeline',
    description: '按 subjectKey 看同一件事的时间线：每次更新、状态变化和当时正文。',
    parameters: obj(
      {
        subjectKey: { type: 'string', description: '稳定主语，例如 video-plugin' },
        scope: { type: 'string', description: '可选记忆域，缺省当前会话，* 表示全库' },
      },
      ['subjectKey'],
    ),
    tags: ['read'],
    usage: '查“这件事之前是什么状态”时用；时间线不等于事实，注意版本时间。',
  },

  {
    name: 'qq_status',
    description: '查看原生 QQ 通道的连接状态、账号、最近错误和事件数；只读。',
    parameters: obj({}, []),
    tags: ['read'],
    usage: '用户问「QQ 连上了吗」时用；连接/断开由面板负责，不在工具里改。',
  },
  {
    name: 'qq_recent',
    description: '读取最近收到的 QQ 消息（昵称、私聊/群、文本、图片地址），只读。',
    parameters: obj({ limit: { type: 'integer', minimum: 1, maximum: 20, description: '返回几条，默认 8' } }, []),
    tags: ['read'],
    usage: '用户问「刚才谁找我」「QQ 上说了什么」时用；不要把整段聊天念出来。',
  },
  {
    name: 'qq_send',
    description: '通过原生 QQ 通道发一条文本消息。target_type=private 用 QQ 号，group 用群号。',
    parameters: obj(
      {
        target_type: { type: 'string', enum: ['private', 'group'], description: '私聊或群聊' },
        target_id: { type: 'string', description: 'QQ 号或群号' },
        text: { type: 'string', description: '要发的内容' },
      },
      ['target_type', 'target_id', 'text'],
    ),
    tags: ['speak'],
    usage: '只有确实要主动联系/回复时才发；同一轮不要同时在桌面和 QQ 两边回。通道未启用或未连接会返回失败。',
  },

  {
    name: 'bili_search',
    description: '在 B 站搜索视频，返回 BV 号、标题、UP 主和时长；只读。',
    parameters: obj(
      {
        keyword: { type: 'string', description: '搜索词' },
        limit: { type: 'integer', minimum: 1, maximum: 10, description: '返回几条，默认 5' },
      },
      ['keyword'],
    ),
    tags: ['read'],
    usage: '用户说「B站上有没有…」时用；只给结果，不自动打开浏览器。',
  },
  {
    name: 'bili_info',
    description: '读取 B 站视频的标题、UP 主、时长、简介和播放量；只读。',
    parameters: obj({ bvid: { type: 'string', description: 'BV 号' } }, ['bvid']),
    tags: ['read'],
    usage: '用户提到某条 B 站视频时用；不要凭空编造 BV 号。',
  },
  {
    name: 'bili_comments',
    description: '读取 B 站视频的热评（只读，不回复）。',
    parameters: obj(
      {
        bvid: { type: 'string', description: 'BV 号' },
        limit: { type: 'integer', minimum: 1, maximum: 20, description: '返回几条，默认 8' },
      },
      ['bvid'],
    ),
    tags: ['read'],
    usage: '想知道视频下面大家在说什么时用；不要自动评论。',
  },

  {
    name: 'qq_media_list',
    description: '列出最近下载/导入的图片和表情包（sha256 短号、路径、已有含义），可按含义/文件名搜索。',
    parameters: obj({
      limit: { type: 'integer', minimum: 1, maximum: 100, description: '默认 20' },
      query: { type: 'string', description: '可选：按已有含义、文件名或短号筛选' },
    }, []),
    tags: ['read'],
    usage: '想知道她存过哪些图/表情时用；不要逐条念给用户。',
  },
  {
    name: 'qq_media_import',
    description: '把本地图片或整个目录导入媒体库，按内容 hash 与 QQ 图片自动去重；可选调用本机图片描述程序写初始含义。',
    parameters: obj({
      path: { type: 'string', description: '图片文件或目录的本地路径' },
      recursive: { type: 'boolean', description: '目录是否递归，默认 true' },
      limit: { type: 'integer', minimum: 1, maximum: 2000, description: '本次最多导入多少个文件，默认 200' },
      caption: { type: 'boolean', description: '是否调用本地描述程序；省略时按配置' },
      caption_limit: { type: 'integer', minimum: 1, maximum: 200, description: '本次最多自动描述几张，默认 20' },
    }, ['path']),
    tags: ['write'],
    usage: '用户让你收下表情包/图片时用；导入后可以用 qq_media_list 查看，用 qq_view_image 看画面，用 qq_media_note 改含义。',
  },
  {
    name: 'qq_media_delete',
    description: '从媒体库删除一张图片/表情包，同时删除本地文件。只删除媒体库记录，不影响原始导入目录。',
    parameters: obj({ key: { type: 'string', description: 'sha256、短号、路径或 URL' } }, ['key']),
    tags: ['write'],
    usage: '用户让你删图，或你确认这张图重复/不需要时用；删之前尽量确认短号。',
  },
  {
    name: 'qq_media_note',
    description: '给一张已下载的 QQ 图片/表情包写含义，下次看到同一张图可以直接复用。',
    parameters: obj(
      {
        key: { type: 'string', description: 'sha256、短号或本地路径' },
        meaning: { type: 'string', description: '这张图/表情的意思，例如「贴贴/撒娇」' },
      },
      ['key', 'meaning'],
    ),
    tags: ['write'],
    usage: '看懂了表情包再写；同一张图不要反复改。',
  },

  {
    name: 'qq_view_image',
    description: '查看一条已下载的 QQ 图片/动图。若库里已有含义，不再返回图片，只返回那句含义。',
    parameters: obj({ key: { type: 'string', description: 'qq_recent 里的图片短号、sha256、路径或 URL' } }, ['key']),
    tags: ['read'],
    usage: '只在需要确认画面时用；看完立刻用 qq_media_note 写一句含义，下次不再看。',
  },

  {
    name: 'qq_actions',
    description: '搜索 OneBot action 目录（217 个），返回名称、用途、参数和是否只读；不执行。',
    parameters: obj(
      {
        query: { type: 'string', description: '关键词，例如 群、撤回、文件、管理' },
        limit: { type: 'integer', minimum: 1, maximum: 30, description: '返回几条，默认 12' },
      },
      [],
    ),
    tags: ['read'],
    usage: '调用 qq_call 前先用它确认 action 名和参数。',
  },
  {
    name: 'qq_call',
    description: '调用 OneBot action。写操作必须 confirm=true；目录里没有或高风险 action 会被拒绝。',
    parameters: obj(
      {
        action: { type: 'string', description: 'qq_actions 里的 action 名' },
        params: { type: 'object', description: 'action 参数对象' },
        confirm: { type: 'boolean', description: '写操作必须为 true' },
      },
      ['action'],
    ),
    tags: ['write'],
    usage: '只在没有专用工具时用；群管/撤回/文件等写操作要说清楚再调。',
  },
  {
    name: 'qq_receive',
    description: '查看或修改 QQ 接收策略。值如 private:* / group:123456 / *。',
    parameters: obj({ receive: { type: 'string', description: '省略=查看；给了就保存' } }, []),
    tags: ['read', 'write'],
    usage: '只接收需要的私聊/群时改这里。',
  },
  {
    name: 'onebot_actions',
    description: '搜索 OneBot action 目录（约 200 个），返回名称、用途、参数和是否只读；不执行。',
    parameters: obj(
      {
        query: { type: 'string', description: '关键词，例如 群、撤回、文件、管理' },
        limit: { type: 'integer', minimum: 1, maximum: 30, description: '返回几条，默认 12' },
      },
      [],
    ),
    tags: ['read'],
    usage: '调用 onebot_call 前先用它确认 action 名和参数；别猜不存在的 action。',
  },
  {
    name: 'onebot_call',
    description: '调用 OneBot action。写操作必须 confirm=true；目录里没有或高风险 action 会被拒绝。',
    parameters: obj(
      {
        action: { type: 'string', description: 'onebot_actions 里的 action 名' },
        params: { type: 'object', description: 'action 参数对象' },
        confirm: { type: 'boolean', description: '写操作必须为 true' },
      },
      ['action'],
    ),
    tags: ['write'],
    usage: '只在 onebot_actions 找不到专用工具时用；群管/撤回/文件等写操作要说清楚再调。',
  },
  {
    name: 'onebot_receive',
    description: '查看或修改 QQ 接收策略。值如 private:* / group:123456 / *，逗号或空格分隔。',
    parameters: obj({ receive: { type: 'string', description: '省略=查看；给了就保存' } }, []),
    tags: ['read', 'write'],
    usage: '只接收需要的私聊/群时改这里；改完立即生效。',
  },

  {
    name: 'onebot_status',
    description: '旧名别名：查看原生 QQ 通道状态（等同 qq_status）。',
    parameters: obj({}, []),
    tags: ['read'],
    usage: '兼容旧提示词。',
  },
  {
    name: 'onebot_events',
    description: '旧名别名：读取最近 QQ 消息（等同 qq_recent）。',
    parameters: obj({ limit: { type: 'integer', minimum: 1, maximum: 20, description: '默认 8' } }, []),
    tags: ['read'],
    usage: '兼容旧提示词。',
  },
  {
    name: 'onebot_view_image',
    description: '旧名别名：看 QQ 图片/动图（有含义时不再给图）。',
    parameters: obj({ key: { type: 'string', description: '图片短号/sha256/路径' } }, ['key']),
    tags: ['read'],
    usage: '兼容旧提示词。',
  },
  {
    name: 'onebot_media_note',
    description: '旧名别名：给 QQ 图片/表情写含义。',
    parameters: obj({ key: { type: 'string', description: '图片短号/sha256/路径' }, meaning: { type: 'string', description: '含义' } }, ['key', 'meaning']),
    tags: ['write'],
    usage: '兼容旧提示词。',
  },
  {
    name: 'onebot_media_list',
    description: '旧名别名：列出已存的 QQ 图片/表情。',
    parameters: obj({ limit: { type: 'integer', minimum: 1, maximum: 30, description: '默认 10' } }, []),
    tags: ['read'],
    usage: '兼容旧提示词。',
  },

  {
    name: 'qq_view_file',
    description: '查看已下载的 QQ 文件/语音：文本直接读，音频能听就附音频，否则返回本地路径和类型。',
    parameters: obj({ key: { type: 'string', description: '文件 sha256/短号/路径' } }, ['key']),
    tags: ['read'],
    usage: '需要对文件内容下判断时用；大文件只读摘要，不整份塞进上下文。',
  },
  {
    name: 'qq_transcribe_voice',
    description: '用本机配置的语音转写命令把一条 QQ 语音转成文字；未配置命令会明确报错。',
    parameters: obj({ key: { type: 'string', description: '语音文件 sha256/短号/路径' } }, ['key']),
    tags: ['read'],
    usage: '用户发了语音时用；转写结果只当参考，别把错字当事实。',
  },

  {
    name: 'qq_reply',
    description: '引用一条最近收到的 QQ 消息回复，自动带回原会话（私聊/群）。',
    parameters: obj(
      {
        message_id: { type: 'string', description: 'qq_recent 里的 message_id' },
        text: { type: 'string', description: '回复内容' },
      },
      ['message_id', 'text'],
    ),
    tags: ['speak'],
    usage: '用户引用了某条消息、或需要明确接哪一句时用；普通回复用 qq_send 即可。',
  },

  {
    name: 'bili_subtitles',
    description: '读取 B 站视频字幕（需要登录 Cookie）；返回带时间轴的字幕行。',
    parameters: obj({ bvid: { type: 'string', description: 'BV 号' } }, ['bvid']),
    tags: ['read'],
    usage: '需要理解视频内容时用；字幕可能为空。',
  },
  {
    name: 'bili_history',
    description: '读取当前 B 站账号的观看记录（需要登录 Cookie）；只读。',
    parameters: obj({ limit: { type: 'integer', minimum: 1, maximum: 30, description: '默认 20' } }, []),
    tags: ['read'],
    usage: '用户问「最近看了什么」时用；不要把整段历史念出来。',
  },

  {
    name: 'bili_watch',
    description: '记一次 B 站观看：读信息/字幕/热评，写观看记录和一条记忆 episode；不评论、不点赞。',
    parameters: obj(
      {
        bvid: { type: 'string', description: 'BV 号' },
        note: { type: 'string', description: '她看完的感受，可选' },
        force: { type: 'boolean', description: '明确要求重看时才传 true' },
      },
      ['bvid'],
    ),
    tags: ['read', 'write'],
    usage: '用户让她看视频、或她自己刷到一条想记下来的视频时用；重复内容默认硬拦，force 才重看。',
  },

  {
    name: 'bili_frames',
    description: '下载 B 站视频并用 ffmpeg 抽最多 4 帧，给模型看画面；只读，不保留视频。',
    parameters: obj(
      {
        bvid: { type: 'string', description: 'BV 号' },
        count: { type: 'integer', minimum: 1, maximum: 4, description: '抽几帧，默认 3' },
      },
      ['bvid'],
    ),
    tags: ['read'],
    usage: '需要判断画面、封面之外的视频内容时用；抽帧会消耗图片 token。',
  },

  {
    name: 'bili_together_open',
    description: '打开 B站一起看浏览器窗口。给 bvid/url 就进视频，留空进 B站首页；只控制独立 Edge，不碰用户正在用的窗口。',
    parameters: obj(
      {
        bvid: { type: 'string', description: 'BV 号' },
        url: { type: 'string', description: '完整 B站视频 URL（与 bvid 二选一）' },
      },
      [],
    ),
    tags: ['write'],
    usage: '用户说「一起看」时用；打开后需要播放再调 control。',
  },
  {
    name: 'bili_together_control',
    description: '一起看播放控制：play / pause / seek / status。',
    parameters: obj(
      {
        action: { type: 'string', enum: ['play', 'pause', 'seek', 'status'], description: '控制动作' },
        seconds: { type: 'number', description: 'seek 的目标秒数' },
      },
      ['action'],
    ),
    tags: ['write'],
    usage: '一起看时用；播放会写观看账本。',
  },
  {
    name: 'bili_together_frame',
    description: '截取一起看浏览器当前画面，作为观察帧。',
    parameters: obj({}, []),
    tags: ['read'],
    usage: '用户问「现在画面是什么」或需要一起看当前帧时用。',
  },
  {
    name: 'bili_together_close',
    description: '关闭一起看浏览器窗口。',
    parameters: obj({}, []),
    tags: ['write'],
    usage: '看完后关掉，释放 Edge 进程。',
  },

  {
    name: 'companion_screen',
    description: '截取当前桌面屏幕，给模型看用户正在做什么；需要 worlds.companion.screenEnabled。',
    parameters: obj({}, []),
    tags: ['read'],
    usage: '只在用户明确让你看屏幕/桌面时用；不要频繁截屏。',
  },

  {
    name: 'companion_web',
    description: '联网查一件可能过时或你不知道的事，返回「答案 + 来源」。只在新消息、政策、价格、版本号、某机构最近规定这类问题上用；常识、闲聊、对话里已有的信息不要用。查完用你自己的话简短说，不要念网址列表。',
    parameters: obj(
      {
        question: { type: 'string', description: '要查的问题，用完整的一句话，不要只给关键词' },
      },
      ['question'],
    ),
    tags: ['read'],
    usage: '只在真的需要新信息时查一次；日常聊天别用，别为了显得聪明每句都查。',
  },

  {
    name: 'bili_comment_reply',
    description: '在 B站视频下发评论或回复某条评论；会自动 @ 主人账号。需要 biliReplyEnabled + confirm。',
    parameters: obj(
      {
        bvid: { type: 'string', description: 'BV 号' },
        text: { type: 'string', description: '评论内容' },
        image: { type: 'string', description: '本地图片路径（可选，评论带图）' },
        mention_owner: { type: 'boolean', description: '是否在评论里 @ 主人；由你判断，默认否' },
        root: { type: 'integer', description: '被回复的根评论 rpid（可选）' },
        parent: { type: 'integer', description: '父评论 rpid（可选，默认 root）' },
        confirm: { type: 'boolean', description: '必须为 true' },
      },
      ['bvid', 'text', 'confirm'],
    ),
    tags: ['write'],
    usage: '明确要评论/回复时才用；是否 @ 主人你自己判断，受每天评论上限限制。',
  },
  {
    name: 'bili_dm_reply',
    description: '回复一条 B站私信；需要 biliReplyEnabled + confirm。talker_id 在私信推送里。',
    parameters: obj(
      {
        talker_id: { type: 'integer', description: '私信会话 talker_id' },
        text: { type: 'string', description: '回复内容' },
        confirm: { type: 'boolean', description: '必须为 true' },
      },
      ['talker_id', 'text', 'confirm'],
    ),
    tags: ['write'],
    usage: '收到私信后明确要回才用；不要自动回复陌生人。',
  },

  {
    name: 'bili_together_share',
    description: '把一起看当前画面截图，作为评论发到正在看的视频并 @ 主人。',
    parameters: obj({ text: { type: 'string', description: '配文，默认「这一帧给你看。」' } }, []),
    tags: ['write'],
    usage: '一起看时想主动分享当前画面才用；mention_owner 由你判断。',
  },

  {
    name: 'bili_act',
    description: '以她自己的 B站账号执行动作：like/unlike、coin、favorite/unfavorite、follow/unfollow、share、watch_later、danmaku、comment_like/unlike、comment_delete、dm_owner。',
    parameters: obj(
      {
        action: { type: 'string', enum: ['like', 'unlike', 'coin', 'favorite', 'unfavorite', 'follow', 'unfollow', 'share', 'watch_later', 'danmaku', 'comment_like', 'comment_unlike', 'comment_delete', 'dm_owner'], description: '动作' },
        bvid: { type: 'string', description: 'BV 号（dm_owner 可选）' },
        text: { type: 'string', description: '弹幕/私信内容' },
        count: { type: 'integer', minimum: 1, maximum: 2, description: '投币数' },
        seconds: { type: 'number', description: '弹幕时间点（秒）' },
        rpid: { type: 'integer', description: '评论 rpid' },
      },
      ['action'],
    ),
    tags: ['write'],
    usage: '看完一条视频后自己决定要不要点赞/投币/收藏/关注/分享/发弹幕；不要默认全做。评论/私信是否 @ 主人或私信主人也由你判断。',
  },

  {
    name: 'bili_profile',
    description: '读取当前 B站账号资料：昵称、签名、头像 URL、性别/生日。只读。',
    parameters: obj({}, []),
    tags: ['read'],
    usage: '需要确认账号当前资料时用；不要把生日等隐私随意复述。',
  },
  {
    name: 'bili_update_profile',
    description: '修改当前 B站账号的签名和/或头像；昵称暂不改（会扣币）。需要 biliInteractEnabled + confirm。',
    parameters: obj(
      {
        signature: { type: 'string', description: '新签名，最多 70 字' },
        avatar: { type: 'string', description: '本地 png/jpg 头像路径' },
        confirm: { type: 'boolean', description: '必须为 true' },
      },
      ['confirm'],
    ),
    tags: ['write'],
    usage: '只有本人明确要改资料时才用；改完签名可能进审核。',
  },


  {
    name: 'bili_together_auto',
    description: '一起看自己找视频：给关键词就搜第一条，不给就从观看记录/热门里挑一条；打开并播放。',
    parameters: obj({ query: { type: 'string', description: '想看什么；留空随便挑' } }, []),
    tags: ['write'],
    usage: '用户说“一起看点什么都行/你挑一个”时用，不需要用户提供 BV。',
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
  companion_thread: '收尾/更新未完成话头，避免反复追问。',
  companion_memory_read: '按 id 读完整记忆与版本历史。',
  companion_memory_timeline: '按 subjectKey 看同一件事的时间线。',
  companion_consolidate: '夜间整理：取材料或提交 0-6 条结构化记忆。',
  qq_status: '查看原生 QQ 通道状态。',
  qq_recent: '读取最近 QQ 消息。',
  qq_send: '通过原生 QQ 通道发文本。',
  bili_search: '搜索 B 站视频（只读）。',
  bili_info: '读取 B 站视频信息（只读）。',
  bili_comments: '读取 B 站热评（只读）。',
  qq_media_list: '列出已下载/导入的图片和表情。',
  qq_media_note: '给图片/表情写含义或人工纠错。',
  qq_media_import: '导入本地图片/表情包目录。',
  qq_media_delete: '从媒体库删除一张图片。',
  qq_view_image: '看 QQ 图片/动图（有含义时不再给图）。',
  qq_actions: '搜索 OneBot action 目录。',
  qq_call: '调用 OneBot action（写操作需确认）。',
  qq_receive: '查看/修改 QQ 接收策略。',
  onebot_actions: '旧名：搜索 OneBot action 目录。',
  onebot_call: '旧名：调用 OneBot action。',
  onebot_receive: '旧名：QQ 接收策略。',
  onebot_status: '旧名：QQ 通道状态。',
  onebot_events: '旧名：最近 QQ 消息。',
  onebot_view_image: '旧名：看 QQ 图片/动图。',
  onebot_media_note: '旧名：写图片含义。',
  onebot_media_list: '旧名：列出图片。',
  qq_view_file: '查看 QQ 文件/语音。',
  qq_transcribe_voice: '转写 QQ 语音（需本机命令）。',
  qq_reply: '引用回复 QQ 消息。',
};
