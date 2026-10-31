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
