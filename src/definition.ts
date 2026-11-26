import type { EventDescribe, ToolDescribe } from 'cortico/core/types.ts';
import type { WorldDefinition } from 'cortico/world.ts';
import { companionDefaults, type CompanionConfig } from './config.ts';
import { TOOL_SPECS, TOOL_SUMMARIES } from './tools.ts';
import { CompanionWorld } from './world.ts';

const TOOLS: ToolDescribe[] = TOOL_SPECS.map((spec) => ({
  name: spec.name,
  description: spec.description,
  parameters: spec.parameters as Record<string, unknown>,
  tags: spec.tags,
  summary: TOOL_SUMMARIES[spec.name],
}));

const EVENTS: EventDescribe[] = [
  {
    type: 'companion.context',
    description: {
      zh: '陪伴上下文：此刻的状态、今日节目单、关系卡与最近一条日记，每轮随批次投递，唤醒后即见。',
      en: 'Companion context: current state, today agenda, relationship card and the latest journal line, delivered with the next batch.',
    },
    trigger: 'piggyback',
  },
  {
    type: 'companion.proactive',
    description: {
      zh: '主动开口的由头：从生活状态里推出来的一小段理由，立即唤醒一轮，由角色决定说什么。',
      en: 'A reason to speak first, derived from the companion state; wakes a turn immediately and lets the character decide what to say.',
    },
    trigger: 'flush',
  },
  {
    type: 'companion.consolidate',
    description: {
      zh: '夜间整理：过去 24 小时的人话、未完成的话头和复习队列，唤醒一轮让角色写 0-6 条结构化记忆。',
      en: 'Nightly consolidation: last 24h human messages, open threads and the review queue; wakes a turn to write 0-6 structured memories.',
    },
    trigger: 'flush',
  },
  {
    type: 'companion.reflect',
    description: {
      zh: '周反思：一周结束时唤醒一轮，让角色写 1 条 self（topic/belief/evidenceRefs）。',
      en: 'Weekly reflection: wakes a turn at the end of the week to write one self record.',
    },
    trigger: 'flush',
  },

  {
    type: 'qq.message',
    description: {
      zh: 'QQ 私聊或群聊入站消息；私聊/被@直接唤醒，普通群聊进 utility。',
      en: 'Incoming QQ message; direct chats/mentions wake immediately.',
    },
    trigger: 'flush',
  },
  {
    type: 'bili.inbox',
    description: {
      zh: 'B站 @我的/回复我的通知，后台轮询后直接推给模型。',
      en: 'Bilibili @/reply notifications pushed after background polling.',
    },
    trigger: 'debounce',
  },
  {
    type: 'bili.dm',
    description: {
      zh: 'B站私信（含分享视频卡片），后台轮询后直接推给模型。',
      en: 'Bilibili direct messages including shared-video cards.',
    },
    trigger: 'debounce',
  },
  {
    type: 'bili.together.frame',
    description: {
      zh: '一起看自动观察帧：播放中按配置的观察间隔（默认 5 秒）推送最近画面的图集，带标题和进度。',
      en: 'Automatic together-watch frame: a screenshot with title and playback position, pushed while playing.',
    },
    trigger: 'debounce',
  },
  {
    type: 'bili.watch',
    description: {
      zh: 'B站观看观察：字幕、热评和可用画面。自己看之后，角色决定聊天时机并选择是否点赞、投币或评论。',
      en: 'Bilibili watch observation with available subtitles, comments and frames. After solo watching, the character decides whether to share, like, give a coin or comment.',
    },
    trigger: 'debounce',
  },
  {
    type: 'companion.media',
    description: {
      zh: '图片补记提醒：之前随 QQ 看过但还没写含义的图片，隔一段时间再给一次画面，让角色补记。',
      en: 'A reminder with previously seen QQ images that still lack a meaning, so the character can caption them.',
    },
    trigger: 'debounce',
  },
  {
    type: 'companion.muse',
    description: {
      zh: '空闲胡思乱想：没人说话时基于旧记忆联想 1-2 条低权重 episode，不主动发消息。',
      en: 'Idle musing: when nobody is talking, associate 1-2 low-weight episodes from old memories; never messages the user.',
    },
    trigger: 'flush',
  },
];

export const COMPANION_WORLD: WorldDefinition<CompanionConfig> = {
  id: 'companion',
  label: '我会永远陪着你',
  defaults: () => companionDefaults(),
  create: (ctx) => new CompanionWorld(ctx),
  describe: { tools: TOOLS, events: EVENTS },
};
