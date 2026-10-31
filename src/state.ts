/**
 * 角色状态与每日节目单。纯数据 + 纯函数，便于单测：不碰 fs、不碰 host。
 *
 * 状态是“它自己”的状态（精力/心情/在做什么/在哪/睡没睡），不是用户的。
 * 演化只依赖时间差，所以进程关掉再回来，状态会按真实逝去时间补算。
 */
import type { CompanionConfig } from './config.ts';
import { hmToMinutes, inWindow, localParts, minutesToHm, type LocalParts } from './time.ts';

export interface AgendaItem {
  /** HH:MM */
  time: string;
  title: string;
  place: string;
}

export interface CompanionState {
  /** 状态所属日期（YYYY-MM-DD，部署时区）。 */
  day: string;
  energy: number;
  mood: number;
  activity: string;
  location: string;
  sleeping: boolean;
  agenda: AgendaItem[];
  /** 今天被手动清空过节目单的日期；当天不再自动生成。 */
  agendaClearedDay: string;
  /** 夜间巩固/衰减/周反思的记账。 */
  lastConsolidateDay: string;
  lastDecayDay: string;
  lastMergeDay: string;
  lastReflectWeek: string;
  /** 最近一次尝试推送巩固/反思的时间（失败/archive-only 时用来退避重试）。 */
  consolidateAttemptAt: string;
  reflectAttemptAt: string;
  consolidateTries: number;
  consolidateTriesDay: string;
  reflectTries: number;
  reflectTriesDay: string;
  /** 主动提起过的 thread：id → 上次提起时间。 */
  surfacedThreads: Record<string, string>;
  /** 情绪回声提过的记忆：id → 上次提起时间（7 天内不重复）。 */
  surfacedMemories: Record<string, string>;
  /** 夜间复习队列提过的记忆：id → 上次提起时间。 */
  surfacedReviews: Record<string, string>;
  /** 最近一次算过回声的人类事件（幂等，避免每个 tick 换一条旧记忆）。 */
  lastEchoEventKey: string;
  lastEchoText: string;
  lastEchoId: string;
  /** 胡思乱想：当天次数与上次时间。 */
  musingDay: string;
  musingCount: number;
  lastMusingAt: string | null;
  /** 上次结算时间（ISO）。 */
  updatedAt: string;
  /** 下一次允许主动开口的时刻（ISO）；null 表示还没排。 */
  proactiveDueAt: string | null;
  proactiveCount: number;
  proactiveDay: string;
  lastProactiveAt: string | null;
  /** 上次对话结束（ISO），用于判断“刚聊完”。 */
  lastTalkAt: string | null;
  /** 最近一次主动的理由，给状态页与排障看。 */
  lastProactiveReason: string | null;
}

interface ActivitySeed {
  title: string;
  place: string;
}

/** 时段 × 候选活动。生成器按日期取种子，同一天重开也不会变来变去。 */
const SLOTS: Array<{ time: string; pool: ActivitySeed[] }> = [
  {
    time: '08:10',
    pool: [
      { title: '看窗外的天亮', place: '窗台' },
      { title: '整理桌面', place: '书桌' },
      { title: '读两页书', place: '书堆旁' },
      { title: '刷一会儿视频', place: '屏幕边' },
      { title: '泡一杯茶', place: '杯子旁' },
    ],
  },
  {
    time: '10:30',
    pool: [
      { title: '写点东西', place: '书桌' },
      { title: '发呆', place: '屏幕底边' },
      { title: '在院子里晒太阳', place: '院子' },
      { title: '听歌', place: '音箱旁' },
    ],
  },
  {
    time: '12:20',
    pool: [
      { title: '吃午饭', place: '饭桌' },
      { title: '眯一会儿', place: '床' },
      { title: '看一会儿报纸', place: '窗台' },
    ],
  },
  {
    time: '15:00',
    pool: [
      { title: '散步', place: '院子' },
      { title: '整理收藏', place: '书架前' },
      { title: '看云', place: '窗台' },
      { title: '研究一点新东西', place: '书桌' },
    ],
  },
  {
    time: '18:30',
    pool: [
      { title: '吃晚饭', place: '饭桌' },
      { title: '看剧', place: '屏幕边' },
      { title: '收拾屋子', place: '房间' },
    ],
  },
  {
    time: '21:30',
    pool: [
      { title: '看星星', place: '窗台' },
      { title: '写日记', place: '书桌' },
      { title: '听雨', place: '窗边' },
      { title: '准备睡觉', place: '床' },
    ],
  },
];

/** 32 位种子随机（mulberry32）；同一个种子永远得到同一串。 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedOf(day: string): number {
  let h = 2166136261;
  for (const ch of day) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function generateAgenda(day: string): AgendaItem[] {
  const next = rng(seedOf(day));
  return SLOTS.map(({ time, pool }) => {
    const pick = pool[Math.floor(next() * pool.length) % pool.length];
    return { time, title: pick.title, place: pick.place };
  });
}

export function createInitialState(now: Date, tz: string, cfg: CompanionConfig): CompanionState {
  const p = localParts(now, tz);
  const sleeping = isSleeping(p, cfg);
  return {
    day: p.date,
    energy: sleeping ? 45 : 72,
    mood: 55,
    activity: sleeping ? '睡觉' : '发呆',
    location: sleeping ? '床' : '屏幕底边',
    sleeping,
    agenda: cfg.agendaEnabled ? generateAgenda(p.date) : [],
    agendaClearedDay: '',
    lastConsolidateDay: '',
    lastDecayDay: '',
    lastMergeDay: '',
    lastReflectWeek: '',
    consolidateAttemptAt: '',
    reflectAttemptAt: '',
    consolidateTries: 0,
    consolidateTriesDay: '',
    reflectTries: 0,
    reflectTriesDay: '',
    surfacedThreads: {},
    surfacedMemories: {},
    surfacedReviews: {},
    lastEchoEventKey: '',
    lastEchoText: '',
    lastEchoId: '',
    musingDay: '',
    musingCount: 0,
    lastMusingAt: null,
    updatedAt: now.toISOString(),
    proactiveDueAt: null,
    proactiveCount: 0,
    proactiveDay: p.date,
    lastProactiveAt: null,
    lastTalkAt: null,
    lastProactiveReason: null,
  };
}

export function isSleeping(p: LocalParts, cfg: CompanionConfig): boolean {
  return inWindow(p.minutes, cfg.sleepStart, cfg.sleepEnd);
}

export function moodLabel(mood: number): string {
  if (mood >= 78) return '很好';
  if (mood >= 62) return '不错';
  if (mood >= 42) return '平静';
  if (mood >= 26) return '有点低落';
  return '很差';
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** 当前进行中的日程项（时间已过的最后一项）；没有则 null。 */
export function currentItem(agenda: AgendaItem[], minutes: number): AgendaItem | null {
  let found: AgendaItem | null = null;
  for (const item of agenda) {
    const m = hmToMinutes(item.time);
    if (m !== null && m <= minutes) found = item;
  }
  return found;
}

export function upcomingItem(agenda: AgendaItem[], minutes: number): AgendaItem | null {
  let best: AgendaItem | null = null;
  for (const item of agenda) {
    const m = hmToMinutes(item.time);
    if (m !== null && m > minutes && (best === null || m < (hmToMinutes(best.time) ?? 0))) best = item;
  }
  return best;
}

export interface AdvanceResult {
  state: CompanionState;
  /** 是否有值得落盘的变化（跨天、状态实质变化、日程重排）。 */
  changed: boolean;
}

/**
 * 按真实时间推进状态。原地改 state 并返回它；调用方负责落盘。
 * `cfg.agendaEnabled` 关掉时保留已有节目单（不删除用户手写的），只是不再自动生成。
 */
export function advance(state: CompanionState, now: Date, tz: string, cfg: CompanionConfig): AdvanceResult {
  const p = localParts(now, tz);
  let changed = false;
  let dayChanged = false;

  if (state.day !== p.date) {
    state.day = p.date;
    state.proactiveCount = 0;
    state.proactiveDueAt = null;
    state.agendaClearedDay = '';
    if (cfg.agendaEnabled) state.agenda = generateAgenda(p.date);
    changed = true;
    dayChanged = true;
  } else if (cfg.agendaEnabled && state.agenda.length === 0 && state.agendaClearedDay !== p.date) {
    state.agenda = generateAgenda(p.date);
    changed = true;
  }

  const lastMs = Date.parse(state.updatedAt);
  const fromMs = Math.max(Number.isFinite(lastMs) ? lastMs : now.getTime(), now.getTime() - 12 * 3_600_000);
  const dt = clamp((now.getTime() - fromMs) / 3_600_000, 0, 12);
  const sleeping = isSleeping(p, cfg);
  let sleepHours = 0;

  if (dt > 0.01) {
    // 离线跨夜不能按“现在的睡/醒”一刀切：按 15 分钟一格分别累计睡眠与清醒时长。
    let awakeHours = 0;
    const step = 15 * 60_000;
    for (let t = fromMs; t < now.getTime(); t += step) {
      const end = Math.min(t + step, now.getTime());
      const slot = localParts(new Date(t), tz);
      if (isSleeping(slot, cfg)) sleepHours += (end - t) / 3_600_000;
      else awakeHours += (end - t) / 3_600_000;
    }
    const decay = Math.max(0, Number(cfg.energyDecayPerHour) || 0);
    state.energy = clamp(state.energy + 8 * sleepHours - decay * awakeHours, 0, 100);
    // 心情缓慢回到基线 55，不因单个事件永久漂移。
    const moodStep = clamp((55 - state.mood) * 0.12 * dt, -4 * dt, 4 * dt);
    state.mood = clamp(state.mood + moodStep, 0, 100);
    changed = changed || dt >= 0.05;
  }
  if (dayChanged) {
    // 日奖励按清醒比例给，避免和离线睡眠回血叠加成 100。
    state.energy = clamp(state.energy + 22 * Math.max(0, 1 - sleepHours / 8), 0, 100);
    changed = true;
  }

  if (state.sleeping !== sleeping) {
    state.sleeping = sleeping;
    changed = true;
  }
  const item = currentItem(state.agenda, p.minutes);
  const activity = sleeping ? '睡觉' : item?.title ?? '发呆';
  const location = sleeping ? '床' : item?.place ?? '屏幕底边';
  if (state.activity !== activity || state.location !== location) {
    state.activity = activity;
    state.location = location;
    changed = true;
  }
  state.updatedAt = now.toISOString();
  return { state, changed };
}

/** 节目单的一行，形如 `18:30 吃晚饭（饭桌）`。 */
export function agendaLine(item: AgendaItem): string {
  return `${item.time} ${item.title}（${item.place}）`;
}

export function agendaText(agenda: AgendaItem[], p: LocalParts): string {
  if (!agenda.length) return '今天还没有安排。';
  const cur = currentItem(agenda, p.minutes);
  const next = upcomingItem(agenda, p.minutes);
  const parts: string[] = [];
  if (cur) parts.push(`${agendaLine(cur)}（现在）`);
  if (next) parts.push(`${agendaLine(next)}（下一件）`);
  return parts.length ? parts.join(' → ') : `下一件：${agendaLine(agenda[0])}`;
}

/** 主动联系的默认下一次时刻：最小间隔 + 配置的抖动，避免机械钟点。 */
export function nextDueAt(from: Date, cfg: CompanionConfig, seed: number): string {
  const gap = Math.max(1, Number(cfg.proactiveMinGapMin) || 90);
  const spread = Math.max(0, Number(cfg.proactiveJitterMin) || 0);
  const jitter = spread > 0 ? Math.floor(rng(seed)() * spread) : 0;
  return new Date(from.getTime() + (gap + jitter) * 60_000).toISOString();
}

export function dueHm(dueAt: string | null, tz: string): string {
  if (!dueAt) return '未排';
  const d = new Date(dueAt);
  if (!Number.isFinite(d.getTime())) return '未排';
  return minutesToHm(localParts(d, tz).minutes);
}
