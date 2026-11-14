/**
 * 主动开口的效用模型（纯函数，无 IO、无随机）。
 *
 * 背景：0.4.x 用 `scoreThought()`（由头显著性 + 来源权重 − 惩罚）和一个固定阈值
 * 0.55 决定说不说。它能用，但几个问题：
 *  - “忙/刚聊完/上次没被回”都只做了硬闸门，无法和“这条由头值不值得”放在一起权衡；
 *  - 说不出为什么被拦（只有一句人话），调参靠试；
 *  - 没有“被忽略之后更贵”的连续反馈。
 *
 * 这里把它拆成可解释的两项：
 *   值 = 由头显著性 × 来源价值 × 黏人度 × 关系系数
 *   打扰成本 = 基础成本 + 忙/夜/刚聊/刚主动/未回应/重复，再按“这个来源历史上被回的比例”缩放
 *   score = 值 − 成本；score ≥ 阈值才放行（阈值默认 0.12）
 *
 * 黏人度（clinginess，0-2）是产品旋钮：1 = 中性，越大越愿意开口；
 * 它只放大“由头值”，不动“打扰成本”——所以黏人不会变成无视边界。
 * 安全闸门（睡觉/免打扰/日上限/未回应≥2/重复）仍由调用方保留；
 * 这个模型只回答“在允许开口的窗口里，这一条值不值得”。
 */

export interface UtilityInput {
  /** 由头来源：thread / memory / social / body / agenda / weather / holiday / contact … */
  source: string;
  /** 由头本身的显著性（0-1），由触发方给出。 */
  salience: number;
  /** 当前日程是否繁忙（会议/上课/考试…）。只加成本，不硬拦。 */
  busy?: boolean;
  /** 是否在免打扰窗口；调用方通常已经拦掉，这里保留给离线评分。 */
  quiet?: boolean;
  /** 是否在睡觉；同上。 */
  sleeping?: boolean;
  /** 距对方上一次说话多少分钟；未知为 null。 */
  minutesSinceUser?: number | null;
  /** 距上一次主动开口多少小时；未知为 null。 */
  hoursSinceProactive?: number | null;
  /** 连续未回应次数（0-3）。 */
  unanswered?: number;
  /** 最近是否说过相似的话（由 isDuplicateSent 判定）。 */
  repeated?: boolean;
  /** 记忆类由头（thread/memory/promise）绕过“刚聊过”成本：想起来的事值得打断。 */
  bypassRecentChat?: boolean;
  /** 关系亲密度 0-1，默认 0.6。 */
  closeness?: number;
  /** 这个来源历史上被回复的比例 0-1，默认 0.5。 */
  replyRate?: number;
  /** 黏人度 0-2：1 = 中性，越大越愿意开口（只放大由头值，不动打扰成本）。 */
  clinginess?: number;
  /** 放行阈值，默认 0.12。 */
  threshold?: number;
}

export interface UtilityTerm {
  label: string;
  /** 对 score 的贡献，正为值、负为成本。 */
  value: number;
}

export type UtilityCode = 'send' | 'busy' | 'quiet' | 'unanswered' | 'duplicate' | 'low-value';

export interface UtilityResult {
  ok: boolean;
  /** 值 − 成本，范围约 -1..1。 */
  score: number;
  benefit: number;
  cost: number;
  threshold: number;
  terms: UtilityTerm[];
  code: UtilityCode;
  /** 给心理活动日志/面板看的一句人话。 */
  reason: string;
}

export const SOURCE_VALUE: Record<string, number> = {
  thread: 0.95,
  promise: 0.95,
  anniversary: 0.9,
  milestone: 0.9,
  memory: 0.8,
  emotion: 0.75,
  body: 0.7,
  social: 0.6,
  qq: 0.68,
  bili: 0.62,
  contact: 0.5,
  holiday: 0.5,
  agenda: 0.45,
  weather: 0.35,
};

export const UTILITY_DEFAULTS = {
  threshold: 0.12,
  clinginess: 1.3,
  baseCost: 0.16,
  busyCost: 0.4,
  quietCost: 0.5,
  recentChatCost: 0.28,
  recentChatMin: 30,
  recentChatHalfMin: 120,
  recentProactiveCost: 0.25,
  recentProactiveHours: 6,
  unansweredCost: 0.18,
  repeatCost: 0.5,
  closenessBase: 0.85,
  closenessSpan: 0.15,
} as const;

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function clamp(value: number, lo: number, hi: number): number {
  return Number.isFinite(value) ? Math.min(hi, Math.max(lo, value)) : lo;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function isQuietOrSleeping(input: UtilityInput): boolean {
  return Boolean(input.quiet || input.sleeping);
}

/**
 * 计算一条候选的开口效用。
 *
 * 注意：`busy` 只加成本，不在这里硬拦；调用方若仍想硬拦，自行判断 `result.code`。
 */
export function computeUtility(input: UtilityInput): UtilityResult {
  const d = UTILITY_DEFAULTS;
  const threshold = Number.isFinite(input.threshold) ? Number(input.threshold) : d.threshold;
  const salience = clamp01(input.salience);
  const closeness = clamp01(input.closeness ?? 0.6);
  const sourceValue = SOURCE_VALUE[input.source] ?? 0.5;
  const replyRate = clamp01(input.replyRate ?? 0.5);
  const cling = clamp(input.clinginess ?? d.clinginess, 0, 2);

  const rawBase = salience * sourceValue;
  const base = rawBase * (0.7 + 0.3 * cling);
  const relationFactor = d.closenessBase + d.closenessSpan * closeness;
  const benefit = base * relationFactor;

  const terms: UtilityTerm[] = [{ label: '由头', value: round3(rawBase) }];
  if (Math.abs(base - rawBase) > 0.001) {
    terms.push({ label: '黏人度', value: round3(base - rawBase) });
  }
  terms.push({ label: '关系', value: round3(benefit - base) });

  const costParts: Array<{ label: string; amount: number }> = [{ label: '基础打扰', amount: d.baseCost }];
  if (input.busy) costParts.push({ label: '日程繁忙', amount: d.busyCost });
  if (isQuietOrSleeping(input)) costParts.push({ label: '休息时段', amount: d.quietCost });
  if (!input.bypassRecentChat
    && typeof input.minutesSinceUser === 'number' && Number.isFinite(input.minutesSinceUser)) {
    if (input.minutesSinceUser <= d.recentChatMin) {
      costParts.push({ label: '刚聊过', amount: d.recentChatCost });
    } else if (input.minutesSinceUser <= d.recentChatHalfMin) {
      costParts.push({ label: '刚聊过', amount: d.recentChatCost / 2 });
    }
  }
  if (typeof input.hoursSinceProactive === 'number' && Number.isFinite(input.hoursSinceProactive)
    && input.hoursSinceProactive < d.recentProactiveHours) {
    costParts.push({ label: '刚主动过', amount: d.recentProactiveCost });
  }
  const unanswered = Math.max(0, Math.min(3, Math.floor(input.unanswered ?? 0)));
  if (unanswered > 0) costParts.push({ label: '上次没回', amount: d.unansweredCost * unanswered });
  if (input.repeated) costParts.push({ label: '最近说过', amount: d.repeatCost });

  // 回复率高 → 打扰更便宜；总被忽略 → 更贵。replyRate=0.5 时系数正好 1。
  const factor = Math.min(1.25, Math.max(0.75, 1 + (0.5 - replyRate) * 0.5));
  const rawCost = costParts.reduce((sum, part) => sum + part.amount, 0);
  const cost = rawCost * factor;
  for (const part of costParts) {
    terms.push({ label: part.label, value: -round3(part.amount * factor) });
  }

  const score = round3(benefit - cost);
  const ok = !input.repeated && unanswered < 2 && !isQuietOrSleeping(input) && score >= threshold;
  const code: UtilityCode = ok
    ? 'send'
    : input.repeated
      ? 'duplicate'
      : unanswered >= 2
        ? 'unanswered'
        : isQuietOrSleeping(input)
          ? 'quiet'
          : input.busy
            ? 'busy'
            : 'low-value';

  const topCost = [...terms].filter((term) => term.value < 0).sort((a, b) => a.value - b.value)[0];
  const tail = ok
    ? ''
    : topCost ? `，主要打扰：${topCost.label} ${Math.abs(topCost.value).toFixed(2)}` : '';
  const reason = `值 ${score.toFixed(2)} = 由头 ${benefit.toFixed(2)} − 打扰 ${cost.toFixed(2)}`
    + `${ok ? ' ≥ ' : ' < '}${threshold}${tail}`;

  return {
    ok,
    score,
    benefit: round3(benefit),
    cost: round3(cost),
    threshold,
    terms,
    code,
    reason,
  };
}

export interface UtilityCandidate {
  key?: string;
  source: string;
  salience: number;
  reason?: string;
}

export interface RankedCandidate<T extends UtilityCandidate> {
  candidate: T;
  result: UtilityResult;
}

/** 多条候选一起打分，按分数从高到低；同分时保留原顺序。 */
export function rankCandidates<T extends UtilityCandidate>(
  candidates: readonly T[],
  base: Omit<UtilityInput, 'source' | 'salience'> = {},
): Array<RankedCandidate<T>> {
  return candidates
    .map((candidate) => ({
      candidate,
      result: computeUtility({ ...base, source: candidate.source, salience: candidate.salience }),
    }))
    .sort((a, b) => (b.result.ok ? 1 : 0) - (a.result.ok ? 1 : 0) || b.result.score - a.result.score);
}

export type ProactiveOutcome = 'silent' | 'pending' | 'replied' | 'ignored';

/**
 * 把一次主动的结果归成四类，喂给回复率学习。
 * - 没投递 → silent；
 * - 投递后对方在窗口内说话 → replied；
 * - 超过 ignoreAfterMin 仍没说话 → ignored；
 * - 其余（还没到判定时间）→ pending。
 */
export function outcomeOf(input: {
  delivered: boolean;
  replied?: boolean;
  minutesSinceSend: number;
  ignoreAfterMin?: number;
}): ProactiveOutcome {
  if (!input.delivered) return 'silent';
  if (input.replied) return 'replied';
  if (input.minutesSinceSend >= (input.ignoreAfterMin ?? 180)) return 'ignored';
  return 'pending';
}

/**
 * 指数滑动更新回复率（0-1）；silent/pending 不更新。
 * 默认 alpha=0.25，大约 4 次同来源样本就能把估计拉到新水平。
 */
export function updateReplyRate(
  previous: number | undefined,
  outcome: ProactiveOutcome,
  alpha = 0.25,
): number {
  const current = clamp01(previous ?? 0.5);
  if (outcome === 'replied') return round3(current + alpha * (1 - current));
  if (outcome === 'ignored') return round3(current + alpha * (0 - current));
  return round3(current);
}
