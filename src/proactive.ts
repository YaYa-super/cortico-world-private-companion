/**
 * 主动联系的判定。分两步：
 *  1) evaluate()：现在到底该不该开口（要么给放行，要么给一句人话说明被什么拦住）；
 *  2) reasonFor()：放行时给一个“由头”，必须能从生活状态里推出来，不能是随机问候。
 *
 * 这里不碰时间以外的外部世界，便于单测；宿主只负责把 lastUserAt 与 dueAt 喂进来。
 */
import type { CompanionConfig } from './config.ts';
import type { CompanionState } from './state.ts';
import { moodLabel } from './state.ts';
import { inWindow, localParts, humanSpan } from './time.ts';

export interface GateInput {
  cfg: CompanionConfig;
  state: CompanionState;
  now: Date;
  tz: string;
  /** 最近一次“别人说话”的毫秒时间戳；未知为 null。 */
  lastUserAt: number | null;
  /** 今天已经主动过几次。 */
  countToday: number;
}

export interface GateResult {
  ok: boolean;
  /** 不放行的原因（人话，给状态页/日志用）。 */
  blockedBy?: string;
  /** 机器可读的原因代码，供调用方决定怎么改 dueAt。 */
  code?: 'off' | 'sleep' | 'quiet' | 'cap' | 'idle' | 'due';
}

export function evaluate(input: GateInput): GateResult {
  const { cfg, state, now, tz } = input;
  if (!cfg.proactiveEnabled) return { ok: false, blockedBy: '主动联系已关闭', code: 'off' };
  if (state.sleeping) return { ok: false, blockedBy: '在睡觉', code: 'sleep' };
  const p = localParts(now, tz);
  if (inWindow(p.minutes, cfg.quietStart, cfg.quietEnd)) return { ok: false, blockedBy: '免打扰时段', code: 'quiet' };
  const cap = Math.max(0, Number(cfg.proactiveDailyCap) || 0);
  if (cap > 0 && input.countToday >= cap) return { ok: false, blockedBy: `今天已主动 ${input.countToday}/${cap} 次`, code: 'cap' };
  if (state.proactiveDueAt) {
    const due = new Date(state.proactiveDueAt).getTime();
    if (Number.isFinite(due) && now.getTime() < due) {
      return { ok: false, blockedBy: `还没到下一次（${new Date(due).toISOString()}）`, code: 'due' };
    }
  }
  const gate = Math.max(0, Number(cfg.idleGateMin) || 0);
  if (input.lastUserAt && gate > 0 && now.getTime() - input.lastUserAt < gate * 60_000) {
    return { ok: false, blockedBy: '对方刚说过话', code: 'idle' };
  }
  return { ok: true };
}

export interface ReasonInput {
  state: CompanionState;
  now: Date;
  tz: string;
  /** 与上一次说话的间隔（毫秒）；未知为 null。 */
  sinceTalkMs: number | null;
  seed: number;
}

function pick<T>(items: T[], seed: number): T {
  return items[Math.abs(seed) % items.length];
}

/** 由头必须落在“它自己的生活”上：状态、时段、刚做完的事。 */
export function reasonFor(input: ReasonInput): string {
  const { state, now, tz } = input;
  const p = localParts(now, tz);
  const candidates: string[] = [];

  if (/早|午|晚/.test(state.activity) && /饭/.test(state.activity)) {
    candidates.push(`你正在${state.activity}，想问问对方吃了没有`);
  }
  if (state.energy < 35) candidates.push('你有点累了，想找个人说说话缓缓');
  if (state.mood < 38) candidates.push(`你现在心情${moodLabel(state.mood)}，想被陪一会儿`);
  if (p.hour >= 21) candidates.push('天黑了，你想在睡之前跟对方说一句话');
  if (p.hour >= 12 && p.hour <= 14) candidates.push('午后有点困，你想闲聊两句提提神');
  if (p.hour >= 6 && p.hour < 9) candidates.push('刚醒不久，你想看看对方起了没有');
  if (state.activity && !state.sleeping) candidates.push(`你刚忙完「${state.activity}」，想把这点小事讲给对方听`);

  if (input.sinceTalkMs !== null && input.sinceTalkMs > 3 * 3_600_000) {
    candidates.push(`已经 ${humanSpan(input.sinceTalkMs)} 没怎么说话了，你有点想他`);
  }
  if (!candidates.length) candidates.push('你闲下来，忽然想到对方');
  return pick(candidates, input.seed);
}
