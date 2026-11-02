/**
 * 主动认知的第一层：便宜的“背景念头”。
 *
 * 这里刻意不调用模型：每 5–10 分钟用状态/记忆/日程做一次评估，产生一个念头和
 * 一个动作建议（silent/journal/rest/contact）。默认只记日志，不改行为；用来观察
 * “她自己的念头”是否成立，再决定要不要接更贵的 deliberation。
 */

export type ThoughtAction = 'silent' | 'journal' | 'rest' | 'contact';

export interface ThoughtInput {
  now: Date;
  hour: number;
  energy: number;
  mood: number;
  activity: string;
  lastUserAt: number | null;
  journalToday: boolean;
  threads: Array<{ id: string; text: string; what?: string }>;
  episode?: { id: string; text: string };
  currentAgenda?: string;
}

export interface Thought {
  key: string;
  text: string;
  salience: number;
  action: ThoughtAction;
  source: string;
  refs?: Record<string, string | number>;
}

const HOUR_MS = 3_600_000;

/** 从一个最小状态集产生“此刻最明显的一个念头”；没有明显念头时返回 null。 */
export function think(input: ThoughtInput, avoidKeys: string[] = []): Thought | null {
  const out: Thought[] = [];
  const push = (t: Thought) => {
    if (t.text.trim()) out.push(t);
  };

  if (input.energy < 25) {
    push({
      key: 'rest:low-energy',
      text: '有点撑不住了，想缩一会儿，不想说话。',
      salience: 0.85,
      action: 'rest',
      source: 'body',
    });
  }

  const thread = input.threads[0];
  if (thread) {
    const what = (thread.what ?? thread.text).slice(0, 60);
    push({
      key: `thread:${thread.id}`,
      text: `上次没说完的事：${what}`,
      salience: 0.8,
      action: 'contact',
      source: 'memory',
      refs: { threadId: thread.id },
    });
  }

  const sinceTalk = input.lastUserAt === null ? null : input.now.getTime() - input.lastUserAt;
  if (sinceTalk !== null && sinceTalk > 6 * HOUR_MS && input.hour >= 9 && input.hour < 22) {
    push({
      key: 'social:long-silence',
      text: '他好像很久没出声了。不一定要问，只是想到了。',
      salience: 0.55,
      action: 'contact',
      source: 'social',
    });
  }

  if (input.episode && input.episode.text) {
    push({
      key: `recall:${input.episode.id}`,
      text: `忽然想起：${input.episode.text.slice(0, 50)}`,
      salience: 0.5,
      action: 'silent',
      source: 'memory',
      refs: { memoryId: input.episode.id },
    });
  }

  if (!input.journalToday && input.hour >= 20) {
    push({
      key: 'journal:today',
      text: '今天还没写日记。可以记一句，不用给谁看。',
      salience: 0.45,
      action: 'journal',
      source: 'self',
    });
  }

  if (input.currentAgenda) {
    push({
      key: `agenda:${input.currentAgenda}`,
      text: `现在该${input.currentAgenda.slice(0, 40)}了。`,
      salience: 0.35,
      action: 'silent',
      source: 'agenda',
    });
  }

  if (!out.length) return null;
  out.sort((a, b) => b.salience - a.salience);
  // 最近已经想过的念头先放一放；全都想过就宁可安静，也不复读。
  return out.find((thought) => !avoidKeys.includes(thought.key)) ?? null;
}
