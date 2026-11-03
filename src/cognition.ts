/**
 * 主动认知的第一层：便宜的“背景念头”。
 *
 * 这里刻意不调用模型：每 5–10 分钟用状态/记忆/日程做一次评估，产生一个念头、
 * 动作建议，再决定要不要形成意图。默认只记日志，不改行为；act 模式只执行
 * journal/rest，contact 只形成意图但不自动发消息。
 */

export type ThoughtAction = 'silent' | 'journal' | 'remember' | 'rest' | 'contact';

export interface ThoughtInput {
  now: Date;
  hour: number;
  energy: number;
  mood: number;
  activity: string;
  lastUserAt: number | null;
  journalToday: boolean;
  threads: Array<{ id: string; text: string; what?: string }>;
  episodes?: Array<{ id: string; text: string }>;
  memories?: Array<{ id: string; text: string }>;
  currentAgenda?: string;
  nextAgenda?: string;
}

export interface Thought {
  key: string;
  text: string;
  salience: number;
  action: ThoughtAction;
  source: string;
  refs?: Record<string, string | number>;
}

export interface Intention {
  id: string;
  key: string;
  text: string;
  action: ThoughtAction;
  source: string;
  salience: number;
  score?: number;
  createdAt: string;
  dueAt: string;
  status: 'pending' | 'done' | 'held' | 'expired';
  refs?: Record<string, string | number>;
}

const HOUR_MS = 3_600_000;

/** 从一个最小状态集产生“此刻最明显的一个念头”；没有明显念头时返回 null。 */
export function thinkAll(input: ThoughtInput, avoidKeys: string[] = []): Thought[] {
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

  for (const thread of input.threads.slice(0, 2)) {
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

  for (const episode of (input.episodes ?? []).slice(0, 2)) {
    push({
      key: `memory:${episode.id}`,
      text: `忽然想起：${episode.text.slice(0, 50)}`,
      salience: 0.5,
      action: 'silent',
      source: 'memory',
      refs: { memoryId: episode.id },
    });
  }

  for (const memory of (input.memories ?? []).slice(0, 3)) {
    push({
      key: `memory:${memory.id}`,
      text: `脑子里冒出一句：${memory.text.slice(0, 50)}`,
      salience: 0.36,
      action: 'silent',
      source: 'memory',
      refs: { memoryId: memory.id },
    });
  }

  if (input.hour >= 11 && input.hour < 13) {
    push({
      key: 'meal:lunch',
      text: '到饭点了，有点饿；不一定要跟谁说。',
      salience: 0.38,
      action: 'silent',
      source: 'body',
    });
  } else if (input.hour >= 17 && input.hour < 19) {
    push({
      key: 'meal:dinner',
      text: '该吃晚饭了，先看看有什么。',
      salience: 0.4,
      action: 'silent',
      source: 'body',
    });
  }

  if (input.mood < 40) {
    push({
      key: 'mood:low',
      text: '心里有点闷，说不清为什么。',
      salience: 0.5,
      action: 'silent',
      source: 'body',
    });
  } else if (input.mood > 75) {
    push({
      key: 'mood:high',
      text: '今天心情不错，想把这种感觉记住。',
      salience: 0.4,
      action: 'journal',
      source: 'body',
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
      key: `agenda-now:${input.currentAgenda}`,
      text: `现在该${input.currentAgenda.slice(0, 40)}了。`,
      salience: 0.35,
      action: 'silent',
      source: 'agenda',
    });
  }
  if (input.nextAgenda) {
    push({
      key: `agenda-next:${input.nextAgenda}`,
      text: `待会儿要${input.nextAgenda.slice(0, 40)}。`,
      salience: 0.3,
      action: 'silent',
      source: 'agenda',
    });
  }

  out.sort((a, b) => b.salience - a.salience);
  // 最近已经想过的念头先放一放；全都想过就宁可安静，也不复读。
  return out.filter((thought) => !avoidKeys.includes(thought.key));
}

/** 兼容旧调用：只取最高分念头。 */
export function think(input: ThoughtInput, avoidKeys: string[] = []): Thought | null {
  return thinkAll(input, avoidKeys)[0] ?? null;
}

/**
 * 从候选列表里选出真正要落地的意图：
 * - 有直接可行动候选，选最高分那个；
 * - 没有可行动候选，但最高分 silent 足够显著：晚上转 journal，其他时间转 remember；
 * - 其他情况返回 null（只想想，不行动）。
 */
export function pickActionable(
  thoughts: Thought[],
  input: { hour: number; journalToday: boolean },
): Thought | null {
  const direct = thoughts.find((thought) => thought.action !== 'silent' && thought.salience >= 0.4);
  if (direct) return direct;
  const silent = thoughts.find((thought) => thought.action === 'silent' && thought.salience >= 0.5);
  if (!silent) return null;
  if (!input.journalToday && input.hour >= 20) {
    return { ...silent, action: 'journal' };
  }
  return { ...silent, action: 'remember' };
}

/** 候选评分：念头显著性 + 来源权重 - 未回应/繁忙惩罚。 */
export function scoreThought(
  thought: Thought,
  input: { unanswered?: number; busy?: boolean } = {},
): number {
  const weights: Record<string, number> = { memory: 0.08, social: 0.04, body: 0.06, self: 0.04, agenda: 0.12, weather: 0.05 };
  const base = thought.salience + (weights[thought.source] ?? 0);
  const penalty = Math.min(0.4, Math.max(0, input.unanswered ?? 0) * 0.12)
    + (input.busy ? 0.15 : 0);
  return Math.min(1, Math.max(0, Number((base - penalty).toFixed(2))));
}

/** 粗相似度：用于发送前防重复，不追求语义。 */
export function textSimilarity(a: string, b: string): number {
  const grams = (text: string) => {
    const clean = text.replace(/\s+/g, '').slice(0, 200);
    const out = new Set<string>();
    for (let i = 0; i < clean.length - 1; i += 1) out.add(clean.slice(i, i + 2));
    return out;
  };
  const ga = grams(a);
  const gb = grams(b);
  if (!ga.size || !gb.size) return 0;
  let inter = 0;
  for (const gram of ga) if (gb.has(gram)) inter += 1;
  return inter / (ga.size + gb.size - inter);
}

/** 把念头变成有到期时间的意图；silent 不形成意图。 */
export function makeIntention(thought: Thought, now: Date, score?: number): Intention {
  const delay = thought.action === 'contact' ? 30 * 60_000
    : thought.action === 'journal' ? 5 * 60_000
      : thought.action === 'remember' ? 2 * 60_000
        : 60_000;
  return {
    id: `intent-${now.getTime()}-${Math.random().toString(36).slice(2, 7)}`,
    key: thought.key,
    text: thought.text,
    action: thought.action,
    source: thought.source,
    salience: thought.salience,
    ...(score === undefined ? {} : { score }),
    createdAt: now.toISOString(),
    dueAt: new Date(now.getTime() + delay).toISOString(),
    status: 'pending',
    ...(thought.refs ? { refs: thought.refs } : {}),
  };
}
