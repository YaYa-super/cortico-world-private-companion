/**
 * 「我会永远陪着你」的 Coopanion 实现：角色自己的一天 + 主动开口 + 关系卡 + 日记，
 * 以及一组让模型自己维护这些状态的工具。
 *
 * 与 AstrBot 原插件的差别（详见 README）：这里不接管对话、不碰平台、不做 TTS/生图/识屏，
 * 只管“它自己的生活在动”和“什么时候它想开口”。人格仍由 CONSTITUTION.md 提供。
 */
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type {
  OutputTap, ToolDef, ToolOutcome, World, WorldHost, WorldWebUiDecl,
} from 'cortico/core/types.ts';
import type { WorldContext } from 'cortico/world.ts';
import { COMPANION_CONFIG_GROUP, type CompanionConfig } from './config.ts';
import {
  advance, agendaLine, createInitialState, currentItem, generateAgenda, isSleeping, moodLabel,
  upcomingItem, type AgendaItem, type CompanionState, type PendingTrigger,
} from './state.ts';
import { buildContextText, buildProactiveText, contextSignature } from './context.ts';
import { TOOL_SPECS } from './tools.ts';
import { evaluate, reasonFor } from './proactive.ts';
import { SnapshotPusher } from './snapshot.ts';
import { detectEmotion, relatedWords } from './emotion.ts';
import { isDuplicateSent, makeIntention, pickActionable, scoreThought, thinkAll, type Intention, type Thought } from './cognition.ts';
import { MindLog, type MindType } from './mind.ts';
import { MEMORY_KINDS, MemoryStore, scopeKey, type MemoryKind, type MemoryRecord } from './memory-store.ts';
import { isHumanEvent, scopeOfEvent } from './event-filter.ts';
import { fetchWeather, weatherTrigger } from './weather.ts';
import { fetchHolidays, fixedHolidays } from './holidays.ts';
import { searchGitmem, workspaceFor } from './gitmem.ts';
import {
  MAIN_KEY, appendJournal, ensureDir, journalPath, readJournal, readJson, writeJsonAtomic,
  type JournalEntry, type Profile, type ProfileMap,
} from './store.ts';
import { formatLocal, hmToMinutes, humanSpan, inWindow, localParts, startOfLocalDayMs } from './time.ts';

const ENV_PROMPT_FILE = fileURLToPath(new URL('../ENV_PROMPT.md', import.meta.url));
const TICK_MS = 60_000;
/** 两次主动之间的最小间隔（反连续打扰；不是排程计时器）。 */
const CONTACT_GAP_MS = 30 * 60_000;
/** 换行常量：避免补丁脚本把 \n 转义弄丢。 */
const NL = String.fromCharCode(10);
const SAVE_EVERY_MS = 20_000;
const STATE_FILE = 'state.json';
const PROFILES_FILE = 'profiles.json';

function clampNumber(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function trimText(v: unknown, limit = 200): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, limit) : '';
}

/** 免打扰/睡觉窗口结束后再过多久才允许开口。 */
function nextWindowEnd(now: Date, tz: string, start: string, end: string): Date | null {
  const p = localParts(now, tz);
  const endMin = hmToMinutes(end);
  if (endMin === null) return null;
  const delta = (endMin - p.minutes + 1440) % 1440;
  return new Date(now.getTime() + (delta === 0 ? 1440 : delta) * 60_000 + 10 * 60_000);
}

export class CompanionWorld implements World {
  readonly id = 'companion';
  private readonly ctx: WorldContext<CompanionConfig>;
  private host: WorldHost | null = null;
  private state: CompanionState;
  private profiles: ProfileMap = {};
  private dataDir: string;
  private readonly memoryStore: MemoryStore;
  private readonly mindLog: MindLog;
  private lastMindGate = '';
  private timer: ReturnType<typeof setInterval> | null = null;
  private snapshot: SnapshotPusher | null = null;
  private lastSaveAt = 0;
  private lastUserProbe = 0;
  private lastUserAt: number | null = null;
  private stopped = false;
  private proactiveInFlight = false;
  private lastContextDelivered = false;
  private tickRunning = false;
  private tickPromise: Promise<void> | null = null;
  private weatherInFlight = false;
  /** 最近一次 proactive push 的回执跟踪：区分“唤醒”与“真的产出可见正文”。 */
  private wakeTracking: { at: string; lastAt: string; reason: string } | null = null;
  private wakeText = '';
  private wakeHadTool = false;
  /** 本轮 proactive 里的工具调用名与参数，用来识别 pet_say 这类 speak 工具。 */
  private wakeTools: Array<{ id: string; name: string; args: string }> = [];
  private wakeReason = '';
  private pendingReviewIds: string[] = [];

  constructor(ctx: WorldContext<CompanionConfig>) {
    this.ctx = ctx;
    const base = typeof ctx.dataDir === 'string' && ctx.dataDir ? ctx.dataDir : '.';
    this.dataDir = join(base, 'private-companion');
    this.memoryStore = new MemoryStore(join(this.dataDir, 'memory'), undefined, { lock: true });
    this.mindLog = new MindLog(join(this.dataDir, 'mind.jsonl'), 500);
    this.state = createInitialState(new Date(), this.tz(), this.cfg());
    this.load();
  }

  private cfg(): CompanionConfig {
    return this.ctx.cfg;
  }

  private tz(): string {
    return this.ctx.timezone || 'Asia/Shanghai';
  }

  private load(): void {
    try {
      ensureDir(this.dataDir);
      const raw = readJson<Partial<CompanionState> | null>(join(this.dataDir, STATE_FILE), null);
      if (raw && typeof raw === 'object' && typeof raw.day === 'string') {
        this.state = {
          ...createInitialState(new Date(), this.tz(), this.cfg()),
          ...raw,
          agenda: Array.isArray(raw.agenda) ? (raw.agenda as AgendaItem[]) : [],
        };
      }
      this.profiles = readJson<ProfileMap>(join(this.dataDir, PROFILES_FILE), {});
    } catch {
      // 读不出来就用初始状态，不阻止挂载
    }
  }

  private save(force = false): void {
    const now = Date.now();
    if (!force && now - this.lastSaveAt < SAVE_EVERY_MS) return;
    this.lastSaveAt = now;
    try {
      ensureDir(this.dataDir);
      writeJsonAtomic(join(this.dataDir, STATE_FILE), this.state);
      writeJsonAtomic(join(this.dataDir, PROFILES_FILE), this.profiles);
    } catch (error) {
      this.host?.log.warn('[companion] 状态落盘失败', String(error));
    }
  }

  // ---- World 契约 ----

  envPromptVars(): Record<string, string> {
    this.refreshState();
    const cfg = this.cfg();
    const count = this.countToday();
    const gates = cfg.proactiveEnabled
      ? `主动联系：开启。由生活/状态事件触发，同一由头 6 小时内不重复；免打扰 ${cfg.quietStart}-${cfg.quietEnd}；每天最多 ${cfg.proactiveDailyCap || '不限'} 次（今天已 ${count} 次）。`
      : '主动联系：关闭（只在对方开口时回应，不主动找人）。';
    return {
      'companion.gates': gates,
      'companion.workspace': join(this.ctx.botDir, 'workspace'),
      'companion.styleNote': trimText(cfg.styleNote, 600),
    };
  }

  tools(): ToolDef[] {
    return TOOL_SPECS.map((spec) => ({
      name: spec.name,
      description: spec.description,
      parameters: spec.parameters,
      tags: spec.tags,
      handler: async (args: Record<string, unknown>) => {
        try {
          return await this.dispatch(spec.name, args ?? {});
        } catch (error) {
          return {
            text: `⚠ 调用失败：${error instanceof Error ? error.message : String(error)}`,
            failed: true,
          };
        }
      },
    }));
  }

  private dispatch(name: string, args: Record<string, unknown>): Promise<string> {
    switch (name) {
      case 'companion_state':
        return this.toolState(args);
      case 'companion_agenda':
        return this.toolAgenda(args);
      case 'companion_profile':
        return this.toolProfile(args);
      case 'companion_journal':
        return this.toolJournal(args);
      case 'companion_proactive':
        return this.toolProactive(args);
      case 'companion_recall':
        return this.toolRecall(args);
      case 'companion_remember':
        return this.toolRemember(args);
      case 'companion_memory':
        return this.toolMemory(args);
      case 'companion_thread':
        return this.toolThread(args);
      case 'companion_consolidate':
        return this.toolConsolidate(args);
      default:
        return Promise.resolve(`未知工具 ${name}`);
    }
  }

  webUi(): WorldWebUiDecl {
    const cfg = this.cfg();
    const state = this.state;
    const count = this.countToday();
    let stat = '尚未读取';
    try {
      stat = `状态 ${statSync(join(this.dataDir, STATE_FILE)).mtime.toLocaleString('zh-CN')}`;
    } catch {
      // 还没落盘
    }
    return {
      label: '我会永远陪着你',
      lamps: [
        {
          label: '主动联系',
          state: cfg.proactiveEnabled ? 'online' : 'offline',
          hint: cfg.proactiveEnabled ? '等待生活/状态触发' : '已关闭',
        },
        {
          label: '生活',
          state: state.sleeping ? 'loading' : 'online',
          hint: state.sleeping ? '在睡觉' : `正在${state.activity}`,
        },
        {
          label: '记忆',
          state: cfg.memoryEnabled ? 'online' : 'offline',
          hint: cfg.memoryEnabled
            ? `记录 ${this.memoryStore.stats().records} · 事件 ${this.memoryStore.stats().events}`
            : '已关闭',
        },
      ],
      badges: [
        { label: '精力', value: Math.round(state.energy), tone: state.energy < 35 ? 'off' : 'on' },
        { label: '心情', value: moodLabel(state.mood), tone: state.mood < 40 ? 'off' : 'plain' },
        { label: '今日主动', value: `${count}/${cfg.proactiveDailyCap || '∞'}` },
      ],
      promptDocs: [
        {
          key: 'worlds.companion.envPrompt',
          title: '我会永远陪着你 · 环境提示词',
          description: '进 system 前缀的那一段：过日子与说话的分寸。改这里不用改代码。',
          path: ENV_PROMPT_FILE,
          role: 'envPrompt',
          vars: [
            { name: 'companion.gates', description: '当前主动联系的规则摘要（免打扰/间隔/上限）', multiline: false },
            { name: 'companion.styleNote', description: '设置页里的「风格补充」，留空则整段为空', multiline: true },
          ],
        },
      ],
      config: [COMPANION_CONFIG_GROUP],
      panels: [
        {
          id: 'memory',
          title: '记忆',
          description: '只读查看：概览、检索、合并摘要；可以撤销合并。导入审核仍走 CLI。',
        },
      ],
      invoke: (panel, method, args) => this.invokeMemoryPanel(panel, method, args),
      storage: [
        {
          key: 'companion-state',
          label: '状态 / 日程 / 关系卡 / 日记',
          kind: 'disk',
          location: this.dataDir,
          danger: true,
          note: '清空后它今天的生活、关系卡与日记都会重置，不可恢复。',
          stat: () => {
            const journal = readJournal(this.dataDir, 500).length;
            const mem = this.memoryStore.stats();
            return `${stat} · 日程 ${this.state.agenda.length} 项 · 关系卡 ${Object.keys(this.profiles).length} 张 · 日记 ${journal} 条`
              + ` · 记忆 ${mem.records} 条 / 事件 ${mem.events} 条`;
          },
          clear: () => {
            this.state = createInitialState(new Date(), this.tz(), this.cfg());
            this.profiles = {};
            try {
              writeFileSync(journalPath(this.dataDir), '', 'utf8');
            } catch {
              // 文件不存在就算了
            }
            this.save(true);
            this.snapshot?.invalidate();
            return '已重置：状态、日程、关系卡与日记都清空了。';
          },
        },
      ],
    };
  }

  /** 记忆面板的服务端方法：只读为主，唯一写操作是撤销合并。 */
  private async invokeMemoryPanel(panel: string, method: string, args: unknown[]): Promise<unknown> {
    if (panel !== 'memory') throw new Error(`未知面板：${panel}`);
    const list = Array.isArray(args) ? args : [];
    const store = this.memoryStore;
    if (method === 'overview') {
      const stats = store.stats();
      const records = store.entries();
      return {
        records: stats.records,
        events: stats.events,
        byKind: stats.byKind,
        byScope: stats.byScope,
        archived: records.filter((record) => record.archived).length,
        merged: records.filter((record) => record.details?.merged === true).length,
        musing: records.filter((record) => record.tags.includes('musing')).length,
        rules: records.filter((record) => record.kind === 'rule' && !record.archived).length,
        people: records.filter((record) => record.kind === 'person' && !record.archived).length,
        threads: records.filter((record) => record.kind === 'thread' && !record.archived).length,
        quarantine: store.listQuarantine().length,
        lastConsolidateDay: this.state.lastConsolidateDay,
        lastMergeDay: this.state.lastMergeDay,
        lastReflectWeek: this.state.lastReflectWeek,
        surfacedMemories: Object.keys(this.state.surfacedMemories ?? {}).length,
        surfacedReviews: Object.keys(this.state.surfacedReviews ?? {}).length,
        bytes: store.fileInfo().bytes,
        error: store.error ? this.safeError(store.error) : null,
        mood: Math.round(this.state.mood),
        energy: Math.round(this.state.energy),
        activity: this.state.activity,
        sleeping: this.state.sleeping,
        proactiveToday: this.countToday(),
        proactiveCap: this.cfg().proactiveDailyCap,
        musingToday: this.state.musingDay === localParts(new Date(), this.tz()).date ? this.state.musingCount : 0,
        musingCap: Number.isFinite(this.cfg().musingDailyCap) ? this.cfg().musingDailyCap : 2,
        nextProactiveDue: this.state.proactiveDueAt,
        nextProactiveDueText: '等待触发',
        cognitionMode: this.cfg().cognitionMode,
        cognitionIntervalMin: this.cfg().cognitionIntervalMin,
        cognitionContactMode: this.cfg().cognitionContactMode ?? 'hold',
        cognitionUnanswered: this.state.cognitionUnanswered ?? 0,
        pendingIntentions: (this.state.intentions ?? []).filter((intention) => intention.status === 'pending').length,
        mindLogLevel: this.cfg().mindLogLevel ?? 'summary',
      };
    }
    if (method === 'search') {
      const query = typeof list[0] === 'string' ? list[0].trim() : '';
      if (!query) throw new Error('search 需要关键词');
      const scope = typeof list[1] === 'string' ? list[1].trim() : '';
      const limit = Math.min(20, Math.max(1, Number(list[2]) || 8));
      const hits = store.search(query, {
        limit,
        scope: scope === '*' ? undefined : (scope || this.activeScope()),
        includeArchived: false,
        kinds: MEMORY_KINDS,
      });
      return {
        hits: hits.map((hit) => ({
          id: hit.id,
          kind: hit.kind,
          scope: hit.scope,
          ts: hit.ts,
          date: formatLocal(hit.ts, this.tz()).slice(0, 10),
          score: hit.score,
          snippet: hit.snippet,
        })),
      };
    }
    if (method === 'merges') {
      const rows = store.entries()
        .filter((record) => record.details?.merged === true)
        .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))
        .slice(0, 50)
        .map((record) => ({
          id: record.id,
          text: record.text.slice(0, 220),
          ts: record.ts,
          date: formatLocal(record.ts, this.tz()).slice(0, 10),
          scope: record.scope,
          count: record.details?.mergedCount ?? 0,
          from: record.details?.mergedFrom ?? [],
        }));
      return { merges: rows };
    }
    if (method === 'recent') {
      const rows = store.entries()
        .filter((record) => record.reviewStatus === 'approved' && !record.archived
          && !record.tags.includes('legacy-chat') && !record.tags.includes('recap'))
        .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))
        .slice(0, 12)
        .map((record) => {
          const userEmotion = record.details?.userEmotion?.label
            ?? (record.kind === 'episode' ? detectEmotion(record.text)?.label : undefined)
            ?? (record.tags.includes('musing') ? '走神' : '未标注');
          const howIFelt = record.details?.howIFelt?.slice(0, 30) || '未记录';
          return {
            id: record.id,
            kind: record.kind,
            scope: record.scope,
            ts: record.ts,
            date: formatLocal(record.ts, this.tz()).slice(0, 10),
            importance: record.importance,
            text: record.text.slice(0, 160),
            // 兼容旧客户端：emotion 现在专指“对方（用户）的情绪”。
            emotion: userEmotion,
            userEmotion,
            howIFelt,
            musing: record.tags.includes('musing'),
          };
        });
      return { recent: rows };
    }
    if (method === 'mind') {
      const limit = Math.min(200, Math.max(1, Number(list[0]) || 80));
      const type = typeof list[1] === 'string' && list[1] ? list[1] : undefined;
      // 兼容 0.4.0 把“没开口”也记成 proactive 的旧日志：按 summary 归到 gate 筛选。
      const events = type === 'gate'
        ? [...this.mindLog.tail(limit, 'gate'), ...this.mindLog.tail(limit, 'proactive')
          .filter((event) => event.summary.startsWith('没开口：'))]
          .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))
          .slice(0, limit)
        : this.mindLog.tail(limit, type);
      return {
        events: events.map((event) => ({
          ...event,
          time: formatLocal(event.ts, this.tz()).slice(11, 19),
        })),
      };
    }
    if (method === 'unmerge') {
      const id = typeof list[0] === 'string' ? list[0].trim() : '';
      if (!id) throw new Error('unmerge 需要 id');
      const found = store.entries().some((record) => record.id === id && record.details?.merged === true);
      const restored = store.unmerge(id);
      if (restored) {
        this.snapshot?.invalidate();
        this.mind('memory', `撤销合并，恢复 ${restored} 条原文`, { memoryId: id });
      }
      return { found, restored, overview: await this.invokeMemoryPanel('memory', 'overview', []) };
    }
    throw new Error(`未知方法：${method}`);
  }

  async start(host: WorldHost): Promise<void> {
    this.host = host;
    this.stopped = false;
    ensureDir(this.dataDir);
    host.log.info('[companion] 启动', { dataDir: this.dataDir, tz: this.tz() });
    this.snapshot = new SnapshotPusher({
      push: async (text) => {
        const pushed = await this.push('companion.context', text, 'piggyback');
        this.lastContextDelivered = pushed?.delivered === true;
        // archive-only 也返回 cursor，避免隐藏世界里每 60s 重推同一条 context。
        return pushed ? pushed.cursor : null;
      },
      withdraw: async (cursor) => {
        try {
          return (await host.withdrawPending?.(cursor)) === true;
        } catch {
          return false;
        }
      },
    });
    this.tickPromise = this.tick(true);
    await this.tickPromise;
    this.tickPromise = null;
    this.save(true);
    this.timer = setInterval(() => {
      this.tickPromise = this.tick(false);
      void this.tickPromise.finally(() => { this.tickPromise = null; });
    }, TICK_MS);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.tickPromise) await this.tickPromise;
    await this.snapshot?.close();
    this.snapshot = null;
    this.save(true);
    this.memoryStore.close();
    this.host = null;
  }

  /** 接收主 session 的输出增量，用回执区分“唤醒”与“真的说了”。 */
  outputTap(): OutputTap {
    return {
      onEvent: (event) => {
        if (!this.wakeTracking) return;
        this.wakeTracking.lastAt = new Date().toISOString();
        if (event.type === 'response.output_text.delta') {
          const delta = (event as { delta?: string }).delta;
          if (delta) this.wakeText += delta;
        } else if (event.type === 'response.output_item.added') {
          const item = (event as { item?: { id?: string; type?: string; name?: string } }).item;
          if (item?.type === 'function_call') {
            this.wakeHadTool = true;
            this.wakeTools.push({ id: String(item.id ?? ''), name: String(item.name ?? ''), args: '' });
          }
        } else if (event.type === 'response.function_call_arguments.delta') {
          const e = event as { item_id?: string; delta?: string };
          const tool = this.wakeTools.find((item) => item.id === e.item_id)
            ?? this.wakeTools[this.wakeTools.length - 1];
          if (tool && e.delta) tool.args += e.delta;
        } else if (event.type === 'response.function_call_arguments.done') {
          const e = event as { item_id?: string; arguments?: string };
          const tool = this.wakeTools.find((item) => item.id === e.item_id)
            ?? this.wakeTools[this.wakeTools.length - 1];
          if (tool && typeof e.arguments === 'string') tool.args = e.arguments;
        }
      },
      onAbort: (reason) => {
        if (!this.wakeTracking) return;
        this.mind('silent', '主动轮中止，未拿到完整回执', {
          reason: this.wakeTracking.reason.slice(0, 80),
          abort: reason.slice(0, 60),
        });
        this.clearWake();
      },
    };
  }

  /** 事件真正写入主 session 后才开始回执跟踪，避免把普通对话算成主动。 */
  onEventsSettled(
    events: ReadonlyArray<{ type: string; source: string; meta?: Record<string, unknown> }>,
    outcome: 'delivered' | 'discarded',
  ): void {
    const wake = events.find((event) => event.type === 'companion.proactive' && event.source === this.id);
    if (!wake) return;
    if (outcome === 'discarded') {
      this.clearWake();
      return;
    }
    const now = new Date().toISOString();
    this.wakeTracking = {
      at: now,
      lastAt: now,
      reason: String(wake.meta?.companionWake ?? ''),
    };
    this.wakeText = '';
    this.wakeHadTool = false;
    this.wakeTools = [];
  }

  /** 一轮对话结束：先结算 proactive 回执，再记“刚说过话”。 */
  onTurnEnded(): void {
    const now = new Date();
    const settledWake = this.finalizeWake(now);
    if (settledWake) this.save(true);
    this.lastUserProbe = 0;
    const lastUser = this.probeLastUser(now.getTime());
    // musing/consolidate 这类内部 turn 不代表“刚聊完”，不能把主动开口一直往后推。
    if (!lastUser || now.getTime() - lastUser > 10 * 60_000) return;
    this.state.lastTalkAt = now.toISOString();
    this.state.proactiveDueAt = null;
    this.save(true);
  }

  // ---- 内部 ----

  /** 心理活动：只记决策，不记基础设施；off 时完全跳过。 */
  private mind(type: MindType, summary: string, refs?: Record<string, string | number>): void {
    if (this.cfg().mindLogLevel === 'off') return;
    this.mindLog.append({ type, summary, refs });
  }

  private async push(
    type: string,
    text: string,
    trigger: 'piggyback' | 'flush',
  ): Promise<{ cursor: number; delivered: boolean } | null> {
    if (!this.host) return null;
    try {
      const env = await this.host.pushEvent({
        type,
        ts: new Date().toISOString(),
        source: this.id,
        origin: 'internal',
        text,
        ...(type === 'companion.proactive' ? { meta: { companionWake: this.wakeReason } } : {}),
      }, { trigger });
      const delivery = (env as { contextDelivery?: string }).contextDelivery;
      const delivered = !delivery || delivery === 'deliver';
      return { cursor: env.cursor, delivered };
    } catch (error) {
      this.host.log.warn('[companion] 推送失败', String(error));
      this.mind('error', `推送失败：${type}`, { event: type });
      return null;
    }
  }

  /** 只推进状态，不推送任何事件（前缀组装会调用它）。 */
  private refreshState(): void {
    const now = new Date();
    advance(this.state, now, this.tz(), this.cfg());
    // 精力/心情是连续量，changed 只看 tick 级差值会永远为 false；按 20s 节流照常落盘。
    this.save(false);
  }

  private async tick(force: boolean): Promise<void> {
    if (this.stopped && !force) return;
    if (this.tickRunning) return;
    this.tickRunning = true;
    try {
      this.refreshState();
      this.captureIncoming();
      if (this.cfg().memoryEnabled) this.memoryStore.maybePrune(this.cfg().memoryRetentionDays);
      this.scheduleNightly(new Date(), localParts(new Date(), this.tz()));
      const now = new Date();
      // 先处理用户回复/未回应，再生成上下文，follow-up 才能赶上这一轮。
      this.refreshCognitionFeedback(now);
      if (this.wakeTracking && now.getTime() - Date.parse(this.wakeTracking.lastAt) > 10 * 60_000) {
        this.mind('error', '主动回执超时，未拿到完整输出', {
          reason: this.wakeTracking.reason.slice(0, 80),
        });
        this.clearWake();
        this.save(true);
      }
      await this.refreshWeather(now);
      await this.refreshHolidays(now);
      this.scheduleProactiveTriggers(now);
      await this.pushContext();
      const woke = await this.maybeProactive(now);
      if (!woke) await this.maybeMuse(now);
      this.scheduleCognition(now);
      await this.processIntentions(now);
    } catch (error) {
      this.host?.log.warn('[companion] tick 失败', String(error));
    } finally {
      this.tickRunning = false;
    }
  }

  private profileKey(): string {
    return MAIN_KEY;
  }

  private currentProfile(): Profile | undefined {
    return this.profiles[this.profileKey()];
  }

  private journalEntries(): JournalEntry[] {
    const limit = Math.max(0, Number(this.cfg().journalInPrompt) || 0);
    return limit > 0 ? readJournal(this.dataDir, limit) : [];
  }

  private async pushContext(force = false): Promise<void> {
    if (!this.snapshot) return;
    const memory = this.memoryDigest();
    const input = {
      state: this.state,
      profile: this.currentProfile(),
      profileKey: this.profileKey(),
      journal: this.journalEntries(),
      cfg: this.cfg(),
      tz: this.tz(),
      now: new Date(),
      memory,
    };
    const pushed = await this.snapshot.maybePush(contextSignature(input), buildContextText(input), force);
    if (pushed && this.lastContextDelivered && memory.echoId && memory.echoEventId) {
      const at = new Date().toISOString();
      const kept = Object.entries({ ...(this.state.surfacedMemories ?? {}), [memory.echoId]: at })
        .filter(([, ts]) => Date.now() - Date.parse(ts) < 30 * 86_400_000)
        .slice(-200);
      this.state.surfacedMemories = Object.fromEntries(kept);
      this.state.lastEchoEventKey = memory.echoEventId;
      this.state.lastEchoText = memory.echo ?? '';
      this.state.lastEchoId = memory.echoId;
      this.memoryStore.markUsed([memory.echoId]);
      this.mind('echo', memory.echo ?? '情绪回声', { memoryId: memory.echoId });
      this.save(true);
    }
  }

  /** 节日：每天一次；失败回退固定公历节日。 */
  private async refreshHolidays(now: Date): Promise<void> {
    if (!this.cfg().proactiveEnabled || !this.cfg().holidayEnabled) return;
    const p = localParts(now, this.tz());
    if (this.state.lastHolidayAt && formatLocal(this.state.lastHolidayAt, this.tz()).slice(0, 10) === p.date) return;
    this.state.lastHolidayAt = now.toISOString();
    const year = Number(p.date.slice(0, 4));
    try {
      this.state.holidays = await fetchHolidays(year);
      this.save(true);
    } catch (error) {
      this.state.holidays = { ...fixedHolidays(year), ...(this.state.holidays ?? {}) };
      this.host?.log.warn('[companion] 节日查询失败，保留旧表并补固定节日', String(error));
      this.save(true);
    }
  }

  /** 天气：Open-Meteo，30 分钟一次；失败只记日志，不影响主动。 */
  private async refreshWeather(now: Date): Promise<void> {
    const cfg = this.cfg();
    const city = (cfg.weatherCity ?? '').trim();
    if (!cfg.proactiveEnabled || !cfg.weatherEnabled || !city || this.weatherInFlight) return;
    const last = Date.parse(this.state.lastWeatherAt ?? '');
    if (Number.isFinite(last) && now.getTime() - last < 30 * 60_000) return;
    this.weatherInFlight = true;
    this.state.lastWeatherAt = now.toISOString();
    this.save(true);
    try {
      const current = await fetchWeather(city, now);
      const previousAt = Date.parse(this.state.weather?.at ?? '');
      const sameCity = this.state.weather?.city === current.city;
      const previous = sameCity && Number.isFinite(previousAt)
        && now.getTime() - previousAt <= 2 * 3_600_000
        ? this.state.weather
        : null;
      this.state.weather = current;
      this.save(true);
      if (this.state.pendingTrigger) return;
      const date = formatLocal(current.at, this.tz()).slice(0, 10);
      const trigger = weatherTrigger(previous, current, date, localParts(now, this.tz()).hour);
      if (!trigger) return;
      const seen = this.state.triggerSeen ?? {};
      const lastTrigger = Date.parse(seen[trigger.key] ?? '');
      const cooldown = /:(heat|cold):/.test(trigger.key) ? 20 * 3_600_000 : 6 * 3_600_000;
      if (Number.isFinite(lastTrigger) && now.getTime() - lastTrigger < cooldown) return;
      this.state.pendingTrigger = {
        ...trigger,
        at: now.toISOString(),
      };
      this.state.triggerSeen = Object.fromEntries(
        Object.entries({ ...seen, [trigger.key]: now.toISOString() })
          .filter(([, ts]) => Date.parse(ts) > now.getTime() - 7 * 86_400_000)
          .slice(-100),
      );
      this.state.proactiveDueAt = null;
      this.mind('trigger', `天气触发：${trigger.reason}`, {
        trigger: trigger.key,
        source: 'weather',
        salience: trigger.salience,
      });
      this.save(true);
    } catch (error) {
      this.host?.log.warn('[companion] 天气查询失败', String(error));
    } finally {
      this.weatherInFlight = false;
    }
  }

  /**
   * 事件/状态触发：主动不再靠计时器，由生活/身体/话头变化驱动。
   * 由正常 proactive 的候选评分/复核决定说不说。
   */
  private scheduleProactiveTriggers(now: Date): void {
    const cfg = this.cfg();
    const p = localParts(now, this.tz());
    const cur = currentItem(this.state.agenda, p.minutes);
    const agendaKey = cur ? `${cur.time}:${cur.title}` : '';
    const prevAgenda = this.state.lastAgendaKey;
    const prevSleeping = this.state.lastSleeping;
    // 先推进基线，即使关闭/有 pending trigger 也不能漏掉日程/睡眠变化。
    this.state.lastAgendaKey = agendaKey;
    this.state.lastSleeping = this.state.sleeping;
    if (!cfg.proactiveEnabled) {
      this.state.pendingTrigger = null;
      return;
    }
    const pending = this.state.pendingTrigger;
    if (pending) {
      const at = Date.parse(pending.at);
      if (!Number.isFinite(at) || now.getTime() - at > 2 * 3_600_000) {
        this.state.pendingTrigger = null;
      } else {
        return;
      }
    }
    const seen = this.state.triggerSeen ?? {};
    const canUse = (key: string) => {
      const at = Date.parse(seen[key] ?? '');
      return !Number.isFinite(at) || now.getTime() - at > 6 * 3_600_000;
    };
    const out: PendingTrigger[] = [];
    const push = (key: string, reason: string, source: string, salience: number, threadId?: string) => {
      if (!canUse(key)) return;
      out.push({ key, reason, source, salience, at: now.toISOString(), ...(threadId ? { threadId } : {}) });
    };

    if (agendaKey && prevAgenda && agendaKey !== prevAgenda && cur) {
      const meal = /早|午|晚|饭/.test(cur.title);
      push(`agenda:${agendaKey}`, `现在该${cur.title}了。`, 'agenda', meal ? 0.65 : 0.45);
    }
    if (prevSleeping && !this.state.sleeping) {
      push('wake', '刚醒过来，还有点没缓过来。', 'body', 0.7);
    }
    if (this.state.energy < 25) {
      push('body:low-energy', '有点撑不住了，想缩一会儿。', 'body', 0.8);
    }
    if (this.state.mood < 35) {
      push('body:low-mood', '心里有点闷。', 'body', 0.68);
    }
    const threadDay = this.state.threadDay ?? {};
    for (const thread of this.memoryStore.openThreads(3)) {
      if (threadDay[thread.id] === p.date) continue;
      const due = Date.parse(thread.details?.due ?? '');
      const what = (thread.details?.what ?? thread.text).slice(0, 70);
      if (Number.isFinite(due) && due <= now.getTime()) {
        push(`thread-due:${thread.id}`, `上次说好的事到期了：${what}`, 'memory', 0.9, thread.id);
      } else if (Number.isFinite(due) && due - now.getTime() <= 24 * 3_600_000) {
        push(`thread-soon:${thread.id}`, `约好的事快到了：${what}`, 'memory', 0.8, thread.id);
      } else {
        const touched = Date.parse(thread.details?.lastTouchedAt ?? thread.ts);
        if (Number.isFinite(touched) && now.getTime() - touched > 3 * 86_400_000) {
          push(`thread-stale:${thread.id}`, `有件事一直没下文：${what}`, 'memory', 0.7, thread.id);
        }
      }
    }
    if (this.state.energy >= 80 && this.state.mood >= 75) {
      push('body:high', '今天状态很好，想把这点好心情分他一点。', 'body', 0.55);
    }
    const holiday = cfg.holidayEnabled ? this.state.holidays?.[p.date] : undefined;
    if (holiday) {
      const safe = String(holiday).replace(/[\u0000-\u001f]/g, '').slice(0, 20);
      if (safe) push(`holiday:${p.date}`, `今天是${safe}。`, 'social', 0.82);
    }
    const todayMonthDay = p.date.slice(5);
    const year = Number(p.date.slice(0, 4));
    const anniversaries = this.memoryStore.entries()
      .filter((record) => record.kind === 'episode' && !record.archived
        && record.importance >= 0.6
        && !record.tags.includes('legacy-chat') && !record.tags.includes('recap')
        && formatLocal(record.ts, this.tz()).slice(5, 10) === todayMonthDay
        && Number(formatLocal(record.ts, this.tz()).slice(0, 4)) < year)
      .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))
      .slice(0, 2);
    for (const record of anniversaries) {
      push(`anniversary:${record.id}:${p.date}`, `去年的今天：${record.text.slice(0, 60)}`, 'memory', 0.85, undefined);
    }
    const lastUser = this.probeLastUser(now.getTime());
    if (lastUser !== null && now.getTime() - lastUser > 6 * 3_600_000
      && p.hour >= 9 && p.hour < 22) {
      push('social:long-silence', '他好像很久没出声了，有点想他。', 'social', 0.55);
    }
    const birthday = (this.currentProfile()?.birthday ?? '').trim();
    const monthDay = birthday.slice(-5);
    if (monthDay && monthDay === p.date.slice(5)) {
      const name = this.currentProfile()?.name || '他';
      push(`birthday:${p.date}`, `今天是${name}的生日。`, 'social', 0.95);
    }
    const mealTitle = cur?.title ?? '';
    if (!/饭|吃|餐/.test(mealTitle)
      && ((p.hour === 11 && p.minute >= 30) || (p.hour === 12 && p.minute < 30))) {
      push(`meal:lunch:${p.date}`, '到午饭点了，想问问吃了没有。', 'body', 0.55);
    } else if (!/饭|吃|餐/.test(mealTitle)
      && ((p.hour === 17 && p.minute >= 30) || (p.hour === 18 && p.minute < 30))) {
      push(`meal:dinner:${p.date}`, '到晚饭点了，先看看有什么。', 'body', 0.55);
    }
    if (p.hour === 21) {
      push(`time:evening:${p.date}`, '天黑了，想在睡之前跟他说句话。', 'social', 0.6);
    }

    if (!out.length) return;
    out.sort((a, b) => b.salience - a.salience);
    const chosen = out[0];
    this.state.pendingTrigger = chosen;
    this.state.triggerSeen = Object.fromEntries(
      Object.entries({ ...seen, [chosen.key]: now.toISOString() })
        .filter(([, ts]) => Date.parse(ts) > now.getTime() - 7 * 86_400_000)
        .slice(-100),
    );
    this.state.proactiveDueAt = null;
    this.mind('trigger', `触发：${chosen.reason}`, {
      trigger: chosen.key,
      source: chosen.source,
      salience: chosen.salience,
    });
    this.save(true);
  }

  /** 背景念头：便宜的评估，不调用模型；shadow 只记，act 允许写日记/休息。 */
  private scheduleCognition(now: Date): void {
    const cfg = this.cfg();
    const mode = cfg.cognitionMode;
    if (!mode || mode === 'off') return;
    const interval = Math.min(60, Math.max(1, Number(cfg.cognitionIntervalMin) || 10)) * 60_000;
    const last = Date.parse(this.state.lastCognitionAt);
    if (Number.isFinite(last) && now.getTime() - last < interval) return;
    this.state.lastCognitionAt = now.toISOString();
    this.save(true);
    if (this.state.sleeping) return;

    const p = localParts(now, this.tz());
    const threadDay = this.state.threadDay ?? {};
    const threads = this.memoryStore.openThreads(0)
      .filter((thread) => threadDay[thread.id] !== p.date)
      .slice(0, 2)
      .map((thread) => ({ id: thread.id, text: thread.text, what: thread.details?.what }));
    const episodes = this.memoryStore.highIntensityEpisodes(7, 2)
      .map((episode) => ({ id: episode.id, text: episode.text }));
    const episodeIds = new Set(episodes.map((episode) => episode.id));
    const memories = this.memoryStore.recent(20, this.activeScope())
      .filter((record) => record.kind === 'episode' && !episodeIds.has(record.id))
      .slice(0, 3)
      .map((record) => ({ id: record.id, text: record.text }));
    const journalToday = readJournal(this.dataDir, 200)
      .some((entry) => formatLocal(entry.ts, this.tz()).slice(0, 10) === p.date);
    const cur = currentItem(this.state.agenda, p.minutes);
    const next = upcomingItem(this.state.agenda, p.minutes);
    const seen = this.state.thoughtSeen ?? {};
    const cutoff = now.getTime() - 6 * 3_600_000;
    const recentKeys = Object.entries(seen)
      .filter(([, ts]) => Date.parse(ts) > cutoff)
      .map(([key]) => key);
    const thoughts = thinkAll({
      now,
      hour: p.hour,
      energy: this.state.energy,
      mood: this.state.mood,
      activity: this.state.activity,
      lastUserAt: this.probeLastUser(now.getTime()),
      journalToday,
      threads,
      episodes,
      memories,
      ...(cur ? { currentAgenda: cur.title } : {}),
      ...(next ? { nextAgenda: next.title } : {}),
    }, recentKeys);
    if (!thoughts.length) return;
    const top = thoughts[0];
    const chosen = pickActionable(thoughts, { hour: p.hour, journalToday });
    const busy = /开会|上课|工作|忙|面试|考试/.test(cur?.title ?? '');
    const topScore = scoreThought(top, {
      unanswered: this.state.cognitionUnanswered ?? 0,
      busy,
    });
    const chosenScore = chosen
      ? (chosen.key === top.key && chosen.action === top.action
        ? topScore
        : scoreThought(chosen, { unanswered: this.state.cognitionUnanswered ?? 0, busy }))
      : topScore;
    this.state.lastThoughtKey = top.key;
    this.state.thoughtSeen = Object.fromEntries(
      Object.entries({
        ...seen,
        [top.key]: now.toISOString(),
        ...(chosen && chosen.key !== top.key ? { [chosen.key]: now.toISOString() } : {}),
      }).filter(([, ts]) => Date.parse(ts) > now.getTime() - 7 * 86_400_000),
    );
    this.mind('thought', top.text, {
      action: top.action,
      salience: top.salience,
      score: topScore,
      source: top.source,
      ...top.refs,
    });
    this.mind('candidate', `${topScore >= 0.45 ? '保留' : '丢弃'}：${top.text}`, {
      score: topScore,
      action: top.action,
      source: top.source,
      ...(busy ? { gate: 'busy' } : {}),
    });
    if (chosen && (chosen.key !== top.key || chosen.action !== top.action)) {
      this.mind('candidate', `可行动：${chosen.text}`, {
        score: chosenScore,
        action: chosen.action,
        source: chosen.source,
        from: top.key,
        ...(busy ? { gate: 'busy' } : {}),
      });
    }
    if (mode === 'act' && chosen && chosenScore >= 0.45) {
      const intentions = this.state.intentions ?? [];
      if (!intentions.some((intention) => intention.key === chosen.key && intention.status === 'pending')) {
        const intention = makeIntention(chosen, now, chosenScore);
        this.state.intentions = [...intentions, intention].slice(-20);
        const verb = intention.action === 'contact' ? '找他'
          : intention.action === 'journal' ? '写下来'
            : intention.action === 'remember' ? '记下来' : '去休息';
        this.mind('intention', `想${verb}：${intention.text}`, {
          intentionId: intention.id,
          dueAt: intention.dueAt,
          action: intention.action,
          score: chosenScore,
        });
      }
    }
    this.save(true);
  }

  /** 处理到期的意图；contact 只 hold，不自动发消息。 */
  private async processIntentions(now: Date): Promise<void> {
    const intentions = this.state.intentions ?? [];
    if (!intentions.length) return;
    const p = localParts(now, this.tz());
    let changed = false;
    // 过期清理与实验开关无关，关掉实验后 pending 也不能永远挂着。
    for (const intention of intentions) {
      if ((intention.status === 'pending' || intention.status === 'held')
        && now.getTime() - Date.parse(intention.createdAt) > 12 * 3_600_000) {
        intention.status = 'expired';
        changed = true;
      } else if (intention.status === 'held' && intention.retryAt
        && now.getTime() >= Date.parse(intention.retryAt)
        && (intention.tries ?? 0) < 3) {
        intention.status = 'pending';
        changed = true;
      }
    }
    if (this.cfg().cognitionMode !== 'act') {
      if (changed) {
        this.state.intentions = intentions.slice(-20);
        this.save(true);
      }
      return;
    }
    for (const intention of intentions) {
      if (intention.status !== 'pending') continue;
      const retry = Date.parse(intention.retryAt ?? '');
      if (Number.isFinite(retry) && retry > now.getTime()) continue;
      const due = Date.parse(intention.dueAt);
      if (!Number.isFinite(due) || due > now.getTime()) continue;
      if (intention.action === 'journal') {
        const hasJournal = readJournal(this.dataDir, 500)
          .some((entry) => formatLocal(entry.ts, this.tz()).slice(0, 10) === p.date);
        if (!hasJournal) {
          const digest = this.memoryStore.todayDigest(3, this.activeScope(), startOfLocalDayMs(now, this.tz()), this.tz()).slice(0, 300);
          appendJournal(this.dataDir, {
            ts: now.toISOString(),
            kind: 'thought',
            text: `【自己想的】${digest || intention.text}`,
          });
          this.mind('action', '按意图写了一笔日记', { intentionId: intention.id });
        } else {
          this.mind('action', '想写日记，但今天已经写过了', { intentionId: intention.id });
        }
        intention.status = 'done';
        changed = true;
      } else if (intention.action === 'rest') {
        this.state.activity = '打盹';
        this.state.location = '床';
        this.state.restUntil = new Date(now.getTime() + 30 * 60_000).toISOString();
        this.snapshot?.invalidate();
        this.mind('action', '按意图去休息了', { intentionId: intention.id });
        intention.status = 'done';
        changed = true;
      } else if (intention.action === 'remember') {
        const added = this.memoryStore.add({
          kind: 'self',
          text: `（自己想到的）${intention.text}`,
          scope: this.activeScope(),
          importance: 0.35,
          source: 'cognition',
          tags: ['thought'],
          details: { topic: '念头' },
        });
        if (added.added) this.mind('action', '按意图记下一个念头', { intentionId: intention.id });
        intention.status = 'done';
        changed = true;
      } else if (intention.action === 'contact') {
        const review = await this.reviewAndSendContact(intention, now, p);
        if (review.ok) {
          intention.status = 'done';
        } else {
          intention.tries = (intention.tries ?? 0) + 1;
          const retryable = this.cfg().cognitionContactMode === 'send' && intention.tries < 3;
          intention.status = 'held';
          if (retryable) intention.retryAt = new Date(now.getTime() + 15 * 60_000).toISOString();
        }
        this.mind('review', `${review.ok ? '联系放行' : '联系暂缓'}：${review.reason}`, {
          intentionId: intention.id,
          action: intention.action,
          ok: review.ok ? 1 : 0,
          ...(review.reason ? { reason: review.reason } : {}),
        });
        changed = true;
      }
    }
    if (changed) {
      this.state.intentions = intentions.slice(-20);
      this.save(true);
    }
  }

  /** 未回应降速 / 用户回复后的 follow-up 审计（正常主动与实验共用）。 */
  private refreshCognitionFeedback(now: Date): void {
    // follow-up 复核只保留 24h，超期清掉，避免永久注入。
    const reviewAt = Date.parse(this.state.followupReviewAt ?? '');
    if (this.state.followupReviewThreadId && Number.isFinite(reviewAt)
      && now.getTime() - reviewAt > 24 * 3_600_000) {
      this.state.followupReviewThreadId = '';
      this.state.followupReviewAt = '';
      this.save(true);
    }
    const last = Date.parse(this.state.lastCognitionContactAt);
    if (!Number.isFinite(last)) return;
    // 已经处理过的老回复不重复 save；只有仍在等待、还有未回应计数或 pending
    // 话头时才需要再看一次用户是否回复。
    // 24 小时没有新联系也没有回复：未回应计数自然衰减，不能永久停摆。
    if ((this.state.cognitionUnanswered ?? 0) > 0 && now.getTime() - last > 24 * 3_600_000) {
      this.state.cognitionUnanswered = 0;
      this.save(true);
    }
    if (!this.state.cognitionAwaitingReply && !this.state.cognitionUnanswered
      && !this.state.pendingFollowupThreadId) return;
    const lastUser = this.probeLastUser(now.getTime());
    // 用户回复必须无条件清零，即使上一轮已经超时把 awaiting 置 false；
    // 否则 unanswered 会卡在 2，两条主动路径一起永久停摆。
    if (lastUser && lastUser > last) {
      const wasAwaiting = this.state.cognitionAwaitingReply;
      this.state.cognitionAwaitingReply = false;
      this.state.cognitionUnanswered = 0;
      if (wasAwaiting && this.state.pendingFollowupThreadId) {
        this.state.followupReviewThreadId = this.state.pendingFollowupThreadId;
        this.state.followupReviewAt = now.toISOString();
        this.mind('followup', '用户回复了，待复核话头', {
          threadId: this.state.pendingFollowupThreadId,
          since: this.state.pendingFollowupAt,
        });
      }
      this.state.pendingFollowupThreadId = '';
      this.state.pendingFollowupAt = '';
      this.save(true);
      return;
    }
    if (!this.state.cognitionAwaitingReply) return;
    if (now.getTime() - last > 3 * 3_600_000) {
      this.state.cognitionAwaitingReply = false;
      this.state.cognitionUnanswered = Math.min(3, (this.state.cognitionUnanswered ?? 0) + 1);
      // 超时后旧 pending 已失去归属，不能等下一次回复时张冠李戴。
      this.state.pendingFollowupThreadId = '';
      this.state.pendingFollowupAt = '';
      this.mind('review', `上次联系后 ${Math.round((now.getTime() - last) / 3_600_000)} 小时没回复，降速`, {
        unanswered: this.state.cognitionUnanswered,
      });
      this.save(true);
    }
  }

  /** 实验性：发送前复核；默认 hold，不发送。 */
  private async reviewAndSendContact(
    intention: Intention,
    now: Date,
    p: LocalParts,
  ): Promise<{ ok: boolean; reason: string }> {
    const cfg = this.cfg();
    if (cfg.cognitionContactMode !== 'send') return { ok: false, reason: 'hold 模式，只放在心里' };
    if (!cfg.proactiveEnabled) return { ok: false, reason: '主动联系已关闭' };
    // 认知 contact 不应被旧 proactiveDueAt 的“还没到下一次”卡住；只保留
    // 免打扰/睡眠/额度/刚聊完这些真正的发送前闸门。
    const gate = evaluate({
      cfg,
      state: { ...this.state, proactiveDueAt: null },
      now,
      tz: this.tz(),
      lastUserAt: this.probeLastUser(now.getTime()),
      countToday: this.countToday(),
    });
    if (!gate.ok) return { ok: false, reason: gate.blockedBy };
    const lastSent = Date.parse(this.state.lastProactiveAt ?? '');
    if (Number.isFinite(lastSent) && now.getTime() - lastSent < CONTACT_GAP_MS) {
      return { ok: false, reason: '刚联系过，先隔一会儿' };
    }
    if ((this.state.cognitionUnanswered ?? 0) >= 2) return { ok: false, reason: '连续未回应，先降速' };
    const cur = currentItem(this.state.agenda, p.minutes);
    if (cur && /开会|上课|工作|忙|面试|考试/.test(cur.title)) return { ok: false, reason: '当前日程繁忙' };

    if (isDuplicateSent(intention.text, this.state.sentTexts ?? [], now.getTime())) {
      return { ok: false, reason: '最近说过相似的话' };
    }
    const text = `【自己的念头】${intention.text}
这是你自己想到的，可以自然地说一句，也可以不说。`;
    this.wakeReason = intention.text;
    const pushed = await this.push('companion.proactive', text, 'flush');
    if (!pushed?.delivered) return { ok: false, reason: '未投递，稍后再说' };
    if (intention.refs?.threadId) this.markThreadDay(String(intention.refs.threadId), now);
    this.state.pendingTrigger = null;
    this.state.proactiveCount += 1;
    this.state.proactiveDay = p.date;
    this.state.lastProactiveAt = now.toISOString();
    this.state.lastProactiveReason = `认知念头：${intention.text.slice(0, 40)}`;
    this.state.lastCognitionContactAt = now.toISOString();
    this.state.lastCognitionContactText = intention.text;
    this.state.cognitionAwaitingReply = true;
    this.state.proactiveDueAt = null;
    if (intention.refs?.threadId) {
      this.state.pendingFollowupThreadId = String(intention.refs.threadId);
      this.state.pendingFollowupAt = now.toISOString();
    }
    this.snapshot?.invalidate();
    this.save(true);
    return { ok: true, reason: '已放行' };
  }

  /** 结算一次 proactive 的模型输出回执：有可见正文才算“说了”。 */
  private finalizeWake(now: Date): boolean {
    if (!this.wakeTracking) return false;
    const direct = this.wakeText.trim();
    const toolSpeech = this.wakeToolSpeech();
    const text = [...new Set([direct, ...toolSpeech].filter(Boolean))].join(' / ');
    if (text) {
      this.noteSent(text, now, this.wakeTracking.reason);
      this.mind('spoken', `真的说了：${text.slice(0, 80)}`, {
        chars: text.length,
        reason: this.wakeTracking.reason.slice(0, 80),
        ...(toolSpeech.length ? { via: 'pet_say' } : {}),
      });
    } else if (this.wakeHadTool) {
      this.mind('silent', '唤醒了，但只调用了工具，没有可见正文', {
        reason: this.wakeTracking.reason.slice(0, 80),
      });
    } else {
      this.mind('silent', '唤醒了，但这一轮没有可见输出', {
        reason: this.wakeTracking.reason.slice(0, 80),
      });
    }
    this.clearWake();
    return true;
  }

  /** 从 pet_say / pet_ask / console_send / sovits_speak 的参数里取出真正说出的文本。 */
  private wakeToolSpeech(): string[] {
    const out: string[] = [];
    for (const tool of this.wakeTools) {
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(tool.args || '{}') as Record<string, unknown>;
      } catch {
        continue;
      }
      const text = tool.name === 'pet_say' ? args.script
        : tool.name === 'pet_ask' ? args.question
          : tool.name === 'console_send' || tool.name === 'sovits_speak' ? (args.text ?? args.script)
            : undefined;
      if (typeof text === 'string' && text.trim()) out.push(text.trim());
    }
    return out;
  }

  private clearWake(): void {
    this.wakeTracking = null;
    this.wakeText = '';
    this.wakeHadTool = false;
    this.wakeTools = [];
  }

  /** 同一 thread 每天最多真正联系一次（投递成功后才写）。 */
  private markThreadDay(threadId: string, now: Date): void {
    const day = localParts(now, this.tz()).date;
    this.state.threadDay = Object.fromEntries(
      Object.entries({ ...(this.state.threadDay ?? {}), [threadId]: day })
        .filter(([, date]) => date === day || Date.parse(date) > now.getTime() - 7 * 86_400_000),
    );
  }

  /** 记录真正推送过的主动正文；用于 24h 内容级去重。 */
  private noteSent(text: string, now: Date, reason = ''): void {
    const kept = [
      ...(this.state.sentTexts ?? []),
      { text: text.slice(0, 200), reason: reason.slice(0, 200), at: now.toISOString() },
    ].filter((item) => Date.parse(item.at) > now.getTime() - 48 * 3_600_000).slice(-20);
    this.state.sentTexts = kept;
  }

  private countToday(): number {
    const p = localParts(new Date(), this.tz());
    return this.state.proactiveDay === p.date ? this.state.proactiveCount : 0;
  }

  /** 最近一次外部事件（有人说话）的时间；30s 缓存，避免每拍都扫事件库。 */
  private probeLastUser(now: number): number | null {
    if (now - this.lastUserProbe < 30_000) return this.lastUserAt;
    this.lastUserProbe = now;
    try {
      const events = this.host?.store?.range({ origin: 'external', limit: 50 }) ?? [];
      let best = 0;
      for (const e of events) {
        if (!isHumanEvent(e as never)) continue;
        const t = Date.parse(e.ts);
        if (Number.isFinite(t) && t > best) best = t;
      }
      this.lastUserAt = best ? best : null;
    } catch {
      this.lastUserAt = null;
    }
    return this.lastUserAt;
  }

  /** proactive 的“记忆由头”：未完成的话头优先，其次近期高情绪 episode。 */
  private memoryReason(now: Date): { text: string; evidence: string; threadId?: string; episodeId?: string } | null {
    if (!this.cfg().memoryEnabled) return null;
    for (const thread of this.memoryStore.openThreads(3)) {
      const last = this.state.surfacedThreads?.[thread.id];
      if (last && now.getTime() - Date.parse(last) < 7 * 86_400_000) continue;
      const what = thread.details?.what ?? thread.text;
      const quote = thread.details?.evidence?.[0] ?? thread.text;
      return { text: `上次没说完的事：${what.slice(0, 80)}`, evidence: quote.slice(0, 80), threadId: thread.id };
    }
    const surfaced = this.state.surfacedMemories ?? {};
    const episodes = this.memoryStore.highIntensityEpisodes(7, 3)
      .filter((episode) => {
        const last = surfaced[episode.id];
        return !last || now.getTime() - Date.parse(last) >= 7 * 86_400_000;
      });
    if (episodes.length) {
      const episode = episodes[0];
      const quote = episode.details?.howIFelt ?? episode.text;
      return { text: `忽然想起：${episode.text.slice(0, 80)}`, evidence: quote.slice(0, 80), episodeId: episode.id };
    }
    return null;
  }

  /** 夜间巩固/衰减/合并/周反思的调度（本地时间）。 */
  private scheduleNightly(now: Date, p: LocalParts): void {
    if (!this.cfg().memoryEnabled) return;
    if (this.state.lastDecayDay !== p.date) {
      this.state.lastDecayDay = p.date;
      const archived = this.memoryStore.decaySweep();
      if (archived) {
        this.host?.log.info('[companion] 衰减归档', archived);
        this.mind('memory', `衰减归档 ${archived} 条`);
      }
    }
    const stats = this.memoryStore.stats();
    if (stats.records === 0 && stats.events === 0) return;
    if (p.hour === 3 && p.minute >= 30 && this.state.lastConsolidateDay !== p.date
      && this.canAttempt(this.state.consolidateAttemptAt)) {
      void this.runConsolidation(p).catch((error) => this.nightlyFailed('巩固', error));
      return;
    }
    // 03:30 失败后 04:00–07:59 继续退避重试；真正错过则在 08:00 后补跑。
    if (p.hour >= 4 && p.hour < 8 && this.state.lastConsolidateDay !== p.date
      && this.state.consolidateAttemptAt && this.canAttempt(this.state.consolidateAttemptAt)) {
      void this.runConsolidation(p).catch((error) => this.nightlyFailed('巩固', error));
      return;
    }
    if (p.hour >= 8 && this.state.lastConsolidateDay !== p.date
      && this.canAttempt(this.state.consolidateAttemptAt)) {
      this.host?.log.info('[companion] 补跑夜间整理', { day: p.date });
      void this.runConsolidation(p).catch((error) => this.nightlyFailed('巩固', error));
      return;
    }
    // 周反思：周日 04:00 正常触发；失败后 04:00–07:59 重试，错过则在之后每天 08:00 补跑。
    const week = this.weekKey(p.date);
    if (p.weekday === '周日' && p.hour === 4 && this.state.lastReflectWeek !== week
      && this.canAttempt(this.state.reflectAttemptAt)) {
      void this.runReflection(week, p).catch((error) => this.nightlyFailed('周反思', error));
      return;
    }
    const sunday = this.lastSundayKey(p);
    if (p.hour >= 4 && p.hour < 8 && this.state.lastReflectWeek !== sunday
      && this.state.reflectAttemptAt && this.canAttempt(this.state.reflectAttemptAt)) {
      void this.runReflection(sunday, p).catch((error) => this.nightlyFailed('周反思', error));
      return;
    }
    if (p.hour >= 8 && this.state.lastReflectWeek !== sunday && this.canAttempt(this.state.reflectAttemptAt)) {
      this.host?.log.info('[companion] 补跑周反思', { week: sunday });
      void this.runReflection(sunday, p).catch((error) => this.nightlyFailed('周反思', error));
    }
  }

  /** 失败/archive-only 后退避 30 分钟，避免每个 tick 反复推。 */
  private canAttempt(at: string | undefined): boolean {
    if (!at) return true;
    const t = Date.parse(at);
    return !Number.isFinite(t) || Date.now() - t >= 30 * 60_000;
  }

  private weekKey(date: string): string {
    const year = date.slice(0, 4);
    const base = Date.parse(`${year}-01-01`);
    const t = Date.parse(date);
    return `${year}-${Math.ceil((Number.isFinite(t) && Number.isFinite(base) ? (t - base) / 604_800_000 : 0) + 1)}`;
  }

  /** 最近一个周日的周 key：周日当天就是今天，其余日期往回数。 */
  private lastSundayKey(p: LocalParts): string {
    const index = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'].indexOf(p.weekday);
    const back = p.weekday === '周日' ? 0 : index + 1;
    const [y, m, d] = p.date.split('-').map(Number);
    const date = new Date(Date.UTC(y, (m || 1) - 1, (d || 1) - back)).toISOString().slice(0, 10);
    return this.weekKey(date);
  }

  private async runConsolidation(p: LocalParts): Promise<void> {
    if (this.state.consolidateTriesDay !== p.date) {
      this.state.consolidateTriesDay = p.date;
      this.state.consolidateTries = 0;
    }
    this.state.consolidateAttemptAt = new Date().toISOString();
    this.state.consolidateTries += 1;
    this.save(true);
    if (this.state.consolidateTries > 4) {
      this.state.lastConsolidateDay = p.date;
      this.save(true);
      this.mind('nightly', '今日巩固重试已达上限（4 次），明天再试', { day: p.date });
      return;
    }
    if (this.cfg().mergeEnabled !== false && this.state.lastMergeDay !== p.date) {
      this.state.lastMergeDay = p.date;
      const threshold = Number.isFinite(this.cfg().mergeSimilarity) ? this.cfg().mergeSimilarity : 0.5;
      const merged = this.memoryStore.mergeSimilarEpisodes(2, 3, threshold);
      if (merged) {
        this.host?.log.info('[companion] 合并相似经历', merged);
        this.mind('memory', `合并 ${merged} 簇相似经历`);
      }
    }
    const plan = this.consolidatePlanText();
    const reviewIds = this.pendingReviewIds;
    const pushed = await this.push('companion.consolidate', plan, 'flush');
    if (!pushed?.delivered) {
      this.host?.log.warn('[companion] 夜间整理未投递，30 分钟后重试', { day: p.date });
      this.mind('nightly', '夜间整理未投递，稍后重试', { day: p.date });
      return;
    }
    this.state.lastConsolidateDay = p.date;
    this.state.consolidateTries = 0;
    this.save(true);
    this.mind('nightly', '夜间整理已投递', { day: p.date });
    if (!reviewIds.length) return;
    const now = new Date();
    const kept = Object.entries({ ...(this.state.surfacedReviews ?? {}) })
      .filter(([, ts]) => now.getTime() - Date.parse(ts) < 30 * 86_400_000)
      .slice(-200);
    for (const id of reviewIds) kept.push([id, now.toISOString()]);
    this.state.surfacedReviews = Object.fromEntries(kept.slice(-200));
    this.save(true);
  }

  private async runReflection(week: string, p: LocalParts): Promise<void> {
    if (this.state.reflectTriesDay !== p.date) {
      this.state.reflectTriesDay = p.date;
      this.state.reflectTries = 0;
    }
    this.state.reflectAttemptAt = new Date().toISOString();
    this.state.reflectTries += 1;
    this.save(true);
    if (this.state.reflectTries > 4) {
      this.state.lastReflectWeek = week;
      this.save(true);
      this.mind('nightly', '今日周反思重试已达上限（4 次），下周再试', { week });
      return;
    }
    const pushed = await this.push('companion.reflect',
      '[周反思] 这一周快过去了。挑 1-3 件这周的事，用 companion_remember 写 1 条 self'
      + '（details.topic/belief/evidenceRefs）；不要写流水账，也不要重复旧结论。', 'flush');
    if (!pushed?.delivered) {
      this.host?.log.warn('[companion] 周反思未投递，之后每天 08:00 重试', { week, day: p.date });
      this.mind('nightly', '周反思未投递，稍后重试', { week });
      return;
    }
    this.state.lastReflectWeek = week;
    this.state.reflectTries = 0;
    this.save(true);
    this.mind('nightly', '周反思已投递', { week });
  }

  private safeError(text: string): string {
    return String(text).replace(/[A-Za-z]:\[^\s，。]+/g, '…').slice(0, 120);
  }

  private nightlyFailed(stage: string, error: unknown): void {
    this.host?.log.warn(`[companion] ${stage}失败`, String(error));
    this.mind('error', `${stage}失败：${this.safeError(error instanceof Error ? error.message : String(error))}`);
  }

  private consolidatePlanText(): string {
    const events = this.memoryStore.recentEvents(24, 30)
      .map((event) => `- ${formatLocal(event.ts, this.tz()).slice(11, 16)} ${event.text.slice(0, 120)}`)
      .join(NL);
    const threads = this.memoryStore.openThreads(0).slice(0, 5)
      .map((thread) => `- ${(thread.details?.what ?? thread.text).slice(0, 120)}`)
      .join(NL);
    const surfacedReviews = this.state.surfacedReviews ?? {};
    const reviewRecords = this.memoryStore.fadingImportant(4)
      .filter((record) => {
        const last = surfacedReviews[record.id];
        return !last || Date.now() - Date.parse(last) >= 7 * 86_400_000;
      })
      .slice(0, 2);
    this.pendingReviewIds = reviewRecords.map((record) => record.id);
    const review = reviewRecords
      .map((record) => `- ${record.text.slice(0, 120)}（${record.kind}）`)
      .join(NL);
    return [
      '【夜间整理】',
      '过去 24 小时的人话：',
      events || '（没有）',
      '未完成的约定/话头：',
      threads || '（没有）',
      '快忘的重要记忆（可以自然复习/确认，也可以忽略）：',
      review || '（没有）',
      '请用 companion_consolidate action=apply 提交 0-6 条记录：episode（带 howIFelt/intensity/userEmotion）、fact、person 更新、thread（status/what/due）。',
      '只写有依据的事；不要写工具回执；不要删任何东西；没有值得记的就提交空数组。',
    ].join(NL);
  }

  private async toolConsolidate(args: Record<string, unknown>): Promise<string | ToolOutcome> {
    if (!this.cfg().memoryEnabled) return '内置记忆已关闭（设置 → 我会永远陪着你 → 内置记忆）。';
    const action = String(args.action ?? 'plan');
    if (action === 'plan') return this.consolidatePlanText();
    if (action !== 'apply') return this.fail('action 只有 plan / apply。');
    const raw = Array.isArray(args.records) ? args.records : [];
    if (!raw.length) return '没有提交记录；这次整理不写入。';
    if (raw.length > 6) return this.fail('一次最多提交 6 条。');
    const prepared: Array<{ kind: MemoryKind; text: string; details?: Record<string, unknown>; importance?: number }> = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      const kind = String(record.kind ?? 'episode') as MemoryKind;
      if (!MEMORY_KINDS.includes(kind)) return this.fail(`未知 kind：${kind}`);
      const text = trimText(record.text, 600);
      if (!text) continue;
      prepared.push({
        kind,
        text,
        details: this.withInferredEmotion(kind, text,
          record.details && typeof record.details === 'object'
            ? record.details as Record<string, unknown>
            : undefined),
        importance: typeof record.importance === 'number' ? record.importance : 0.6,
      });
    }
    let added = 0;
    for (const record of prepared) {
      const result = this.memoryStore.add({
        kind: record.kind,
        text: record.text,
        scope: this.activeScope(),
        details: record.details as never,
        importance: record.importance,
        source: 'consolidate',
      });
      if (result.added) added += 1;
    }
    this.snapshot?.invalidate();
    if (added) this.mind('memory', `夜间整理写入 ${added} 条`);
    return `整理完成：提交 ${prepared.length} 条，新增 ${added} 条。`;
  }

  private async maybeProactive(now: Date): Promise<boolean> {
    if (this.proactiveInFlight) return false;
    this.proactiveInFlight = true;
    try {
      return await this.maybeProactiveInner(now);
    } finally {
      this.proactiveInFlight = false;
    }
  }

  private async maybeProactiveInner(now: Date): Promise<boolean> {
    const cfg = this.cfg();
    if (!this.host || !cfg.proactiveEnabled) return false;
    const p = localParts(now, this.tz());
    if (this.state.proactiveDay !== p.date) {
      this.state.proactiveDay = p.date;
      this.state.proactiveCount = 0;
      this.state.proactiveDueAt = null;
    }
    // 不再用计时器：只有事件/状态触发才进入主动路径。
    const trigger = this.state.pendingTrigger;
    if (!trigger) return false;
    const at = Date.parse(trigger.at);
    if (!Number.isFinite(at) || now.getTime() - at > 2 * 3_600_000) {
      this.state.pendingTrigger = null;
      this.state.proactiveDueAt = null;
      this.save(true);
      return false;
    }
    const lastUserAt = this.probeLastUser(now.getTime());
    // 触发不受旧计时器 dueAt 影响；仍保留睡眠/免打扰/额度/刚聊完这些闸门。
    const gate = evaluate({
      cfg,
      state: { ...this.state, proactiveDueAt: null },
      now,
      tz: this.tz(),
      lastUserAt,
      countToday: this.state.proactiveCount,
    });
    if (!gate.ok) {
      if (this.lastMindGate !== gate.code) {
        this.lastMindGate = gate.code;
        this.mind('gate', `没开口：${gate.blockedBy}`, { code: gate.code });
      }
      if (gate.code === 'sleep' || gate.code === 'quiet' || gate.code === 'cap') {
        // 保留 triggerSeen 冷却，避免同一事件下一拍又生成、再被同一闸门挡住。
        this.state.pendingTrigger = null;
        this.save(true);
      }
      return false;
    }
    const lastSent = Date.parse(this.state.lastProactiveAt ?? '');
    if (Number.isFinite(lastSent) && now.getTime() - lastSent < CONTACT_GAP_MS) return false;
    const sinceTalkMs = lastUserAt ? now.getTime() - lastUserAt : null;
    const reason = trigger.reason;
    const text = buildProactiveText({
      state: this.state,
      reason,
      now,
      tz: this.tz(),
      quiet: `${cfg.quietStart}-${cfg.quietEnd}`,
      sinceTalk: sinceTalkMs === null ? '记不清了' : humanSpan(sinceTalkMs),
    });
    const cur = currentItem(this.state.agenda, p.minutes);
    const busy = /开会|上课|工作|忙|面试|考试/.test(cur?.title ?? '');
    const candidate = {
      key: trigger.key,
      text: reason,
      salience: trigger.salience,
      action: 'contact' as const,
      source: trigger.source,
    };
    const score = scoreThought(candidate, { busy });
    this.mind('candidate', `${score >= 0.55 ? '保留' : '暂缓'}：${reason}`, {
      score,
      action: 'contact',
      source: candidate.source,
      ...(busy ? { gate: 'busy' } : {}),
    });
    const clear = () => {
      this.state.pendingTrigger = null;
      this.state.proactiveDueAt = null;
    };
    if (busy) {
      this.mind('review', '当前日程繁忙，暂缓联系', { score, gate: 'busy' });
      clear();
      this.save(true);
      return false;
    }
    if ((this.state.cognitionUnanswered ?? 0) >= 2) {
      this.mind('review', '连续未回应，先不打扰；24 小时后再评估', { score, unanswered: this.state.cognitionUnanswered });
      // 不丢 pending，也不清 triggerSeen；等用户回复或 24h 自动恢复。
      return false;
    }
    if (score < 0.55) {
      this.mind('review', `候选价值不足（${score}），先不联系`, { score });
      clear();
      this.save(true);
      return false;
    }
    // 低精力/身体触发优先做自己的事，而不是硬聊。
    if (trigger.key === 'body:low-energy') {
      this.state.activity = '打盹';
      this.state.location = '床';
      this.state.restUntil = new Date(now.getTime() + 30 * 60_000).toISOString();
      this.mind('action', '精力太低，先去休息而不是找人', { score, action: 'rest' });
      this.snapshot?.invalidate();
      clear();
      this.save(true);
      return true;
    }

    if (isDuplicateSent(reason, this.state.sentTexts ?? [], now.getTime())) {
      this.mind('review', '最近说过相似的话，暂缓', { score });
      clear();
      this.save(true);
      return false;
    }
    this.wakeReason = reason;
    const pushed = await this.push('companion.proactive', text, 'flush');
    if (!pushed?.delivered) {
      clear();
      this.save(true);
      return false;
    }
    this.lastMindGate = '';
    if (trigger.threadId) this.markThreadDay(trigger.threadId, now);
    this.mind('proactive', `唤醒：${reason}`, {
      ...(trigger.threadId ? { threadId: trigger.threadId } : {}),
    });
    this.mind('action', '按触发候选唤醒', { score, action: 'contact', trigger: trigger.key });
    if (trigger.threadId) {
      this.state.surfacedThreads = { ...(this.state.surfacedThreads ?? {}), [trigger.threadId]: now.toISOString() };
      this.state.pendingFollowupThreadId = trigger.threadId;
      this.state.pendingFollowupAt = now.toISOString();
    }
    this.state.proactiveCount += 1;
    this.state.proactiveDay = p.date;
    this.state.lastProactiveAt = now.toISOString();
    this.state.lastProactiveReason = reason;
    this.state.lastCognitionContactAt = now.toISOString();
    this.state.lastCognitionContactText = reason;
    this.state.cognitionAwaitingReply = true;
    clear();
    this.save(true);
    return true;
  }

  private stateSummary(): string {
    const p = localParts(new Date(), this.tz());
    const cur = currentItem(this.state.agenda, p.minutes);
    const next = upcomingItem(this.state.agenda, p.minutes);
    const bits = [
      `现在 ${p.date} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')} ${p.weekday}`,
      `精力 ${Math.round(this.state.energy)}/100，心情${moodLabel(this.state.mood)}，在${this.state.location}，正在${this.state.activity}`,
    ];
    if (cur) bits.push(`当前日程：${agendaLine(cur)}`);
    if (next) bits.push(`下一件：${agendaLine(next)}`);
    return `${bits.join('；')}。`;
  }

  private async toolState(args: Record<string, unknown>): Promise<string> {
    const action = String(args.action ?? 'get');
    if (action === 'update') {
      if (typeof args.energy === 'number') this.state.energy = clampNumber(args.energy, 0, 100);
      if (typeof args.mood === 'number') this.state.mood = clampNumber(args.mood, 0, 100);
      const activity = trimText(args.activity, 40);
      const location = trimText(args.location, 40);
      if (activity) this.state.activity = activity;
      if (location) this.state.location = location;
      this.state.updatedAt = new Date().toISOString();
      this.save(true);
      this.snapshot?.invalidate();
      return `已更新。${this.stateSummary()}`;
    }
    return this.stateSummary();
  }

  private parseItems(raw: unknown): AgendaItem[] {
    if (!Array.isArray(raw)) return [];
    const out: AgendaItem[] = [];
    for (const entry of raw.slice(0, 24)) {
      if (!entry || typeof entry !== 'object') continue;
      const item = entry as Record<string, unknown>;
      const time = trimText(item.time, 5);
      const title = trimText(item.title, 40);
      if (!time || !title || hmToMinutes(time) === null) continue;
      out.push({ time, title, place: trimText(item.place, 20) || '屏幕边' });
    }
    return out.sort((a, b) => (hmToMinutes(a.time) ?? 0) - (hmToMinutes(b.time) ?? 0));
  }

  private agendaReport(): string {
    if (!this.state.agenda.length) return '今天还没有安排。';
    const p = localParts(new Date(), this.tz());
    const cur = currentItem(this.state.agenda, p.minutes);
    return this.state.agenda
      .map((i) => `${agendaLine(i)}${cur && cur.time === i.time ? ' ← 现在' : ''}`)
      .join('\n');
  }

  private async toolAgenda(args: Record<string, unknown>): Promise<string> {
    const action = String(args.action ?? 'get');
    if (action === 'set') {
      const items = this.parseItems(args.items);
      if (!items.length) return '没有可用的日程项：每项至少要 time（HH:MM）和 title。';
      this.state.agenda = items;
      this.save(true);
      this.snapshot?.invalidate();
      return `今天改成这样了：\n${this.agendaReport()}`;
    }
    if (action === 'add') {
      const items = this.parseItems(args.items);
      if (!items.length) return '没加进去：需要 time（HH:MM）和 title。';
      this.state.agenda = [...this.state.agenda, ...items].sort(
        (a, b) => (hmToMinutes(a.time) ?? 0) - (hmToMinutes(b.time) ?? 0),
      );
      this.save(true);
      this.snapshot?.invalidate();
      return `加好了：\n${this.agendaReport()}`;
    }
    if (action === 'clear') {
      this.state.agenda = [];
      this.state.agendaClearedDay = localParts(new Date(), this.tz()).date;
      this.save(true);
      this.snapshot?.invalidate();
      return '日程清空了，今天剩下的时间自己安排。';
    }
    return this.agendaReport();
  }

  private async toolProfile(args: Record<string, unknown>): Promise<string> {
    const key = trimText(args.key, 40) || MAIN_KEY;
    const action = String(args.action ?? 'get');
    if (action === 'list') {
      const keys = Object.keys(this.profiles);
      if (!keys.length) return '还没有任何关系卡。';
      return keys.map((k) => `${k}: ${[this.profiles[k].name, this.profiles[k].relation].filter(Boolean).join(' / ') || '（空）'}`).join('\n');
    }
    const current = this.profiles[key] ?? { name: '', relation: '', birthday: '', notes: [], updatedAt: '' };
    if (action === 'set') {
      const next: Profile = {
        name: trimText(args.name, 30) || current.name,
        relation: trimText(args.relation, 30) || current.relation,
        birthday: trimText(args.birthday, 10) || current.birthday,
        notes: current.notes,
        updatedAt: new Date().toISOString(),
      };
      if (Array.isArray(args.notes)) {
        const merged = new Set(current.notes);
        for (const n of args.notes.slice(0, 20)) {
          const text = trimText(n, 80);
          if (text) merged.add(text);
        }
        next.notes = [...merged].slice(0, 30);
      }
      this.profiles[key] = next;
      this.save(true);
      this.snapshot?.invalidate();
      return `关系卡已更新：${[next.name && `称呼 ${next.name}`, next.relation && `关系 ${next.relation}`,
        next.birthday && `生日 ${next.birthday}`, next.notes.length && `备注 ${next.notes.length} 条`]
        .filter(Boolean).join('，') || '（还是空的）'}。`;
    }
    const bits = [current.name && `称呼 ${current.name}`, current.relation && `关系 ${current.relation}`,
      current.birthday && `生日 ${current.birthday}`].filter(Boolean);
    const notes = current.notes.length ? `\n备注：${current.notes.map((n) => `- ${n}`).join('\n')}` : '';
    return `${key}：${bits.length ? bits.join('，') : '还没有资料'}${notes}`;
  }

  private async toolJournal(args: Record<string, unknown>): Promise<string> {
    const action = String(args.action ?? 'read');
    if (action === 'write') {
      const text = trimText(args.text, 400);
      if (!text) return '写日记需要 text。';
      const kind = trimText(args.kind, 10) || '日记';
      appendJournal(this.dataDir, { ts: new Date().toISOString(), kind, text });
      this.snapshot?.invalidate();
      return `记下了（${kind}，${text.length} 字）。`;
    }
    const limit = Math.min(20, Math.max(1, Number(args.limit) || 3));
    const rows = readJournal(this.dataDir, limit);
    if (!rows.length) return '还没有日记。';
    return rows.map((r) => `${formatLocal(r.ts, this.tz())} [${r.kind}] ${r.text}`).join('\n');
  }


  private async toolRecall(args: Record<string, unknown>): Promise<string> {
    if (!this.cfg().memoryEnabled) return '内置记忆已关闭（设置 → 我会永远陪着你 → 内置记忆）。';
    const query = trimText(args.query, 80);
    if (!query) return '要查什么？给一个关键词。';
    const limit = Math.min(10, Math.max(1, Number(args.limit) || 5));
    const scopeArg = trimText(args.scope, 40);
    const hits = this.memoryStore.search(query, {
      limit,
      // 默认只查当前会话，避免群聊/私聊串域；scope:"*" 才查全库。
      scope: scopeArg === '*' ? undefined : (scopeArg || this.activeScope()),
      retentionDays: this.cfg().memoryRetentionDays,
      includeArchived: args.includeArchived === true,
      kinds: MEMORY_KINDS,
    });
    if (!hits.length) {
      if (this.cfg().gitmemReadThrough) {
        const legacy = searchGitmem(
          workspaceFor(this.ctx.botDir, this.cfg().gitmemWorkspace),
          query,
          Math.min(5, limit),
        );
        if (legacy.length) {
          this.mind('memory', `主库没命中，GitMem 旧档案命中 ${legacy.length} 条`, { query });
          return ['主记忆没命中；以下是 GitMem 旧档案（只读，不是主库）：']
            .concat(legacy.map((hit) => `[GitMem/${hit.path}:${hit.line}] ${hit.text}`))
            .join('\n');
        }
      }
      return `记忆里没找到「${query}」。可以换个说法，或者直接问对方。`;
    }
    this.memoryStore.markUsed(hits.flatMap((hit) => (hit.id ? [hit.id] : [])));
    this.mind('memory', `检索「${query}」命中 ${hits.length} 条`, { query });
    const label: Record<string, string> = {
      episode: '经历', fact: '事实', person: '人物', thread: '约定', self: '自我', rule: '规则',
    };
    return hits
      .map((hit) => `[${label[hit.kind] ?? hit.kind}/${hit.scope}] ${hit.ts.slice(0, 10)} ${hit.snippet}`)
      .join('\n');
  }

  private async toolThread(args: Record<string, unknown>): Promise<string | ToolOutcome> {
    const action = String(args.action ?? 'update');
    const id = trimText(args.id, 64);
    if (!id) return this.fail('要更新哪条话头？id 不能为空。');
    if (!['done', 'cancel', 'update'].includes(action)) return this.fail('action 只有 done / cancel / update。');
    const patch = action === 'done' ? { status: 'done' as const }
      : action === 'cancel' ? { status: 'dropped' as const }
        : {
          status: 'open' as const,
          ...(trimText(args.what, 160) ? { what: trimText(args.what, 160) } : {}),
          ...(trimText(args.due, 40) ? { due: trimText(args.due, 40) } : {}),
        };
    if (!this.memoryStore.updateThread(id, patch)) return this.fail(`没找到话头 ${id.slice(0, 8)}。`);
    this.snapshot?.invalidate();
    if (this.state.pendingFollowupThreadId === id) {
      this.state.pendingFollowupThreadId = '';
      this.state.pendingFollowupAt = '';
    }
    if (this.state.followupReviewThreadId === id) {
      this.state.followupReviewThreadId = '';
      this.state.followupReviewAt = '';
    }
    this.mind('memory', `话头${action === 'done' ? '完成' : action === 'cancel' ? '取消' : '更新'}：${id.slice(0, 8)}`);
    this.save(true);
    return action === 'done' ? '这条话头已收尾。' : action === 'cancel' ? '这条话头已取消。' : '话头已更新。';
  }

  private async toolRemember(args: Record<string, unknown>): Promise<string> {
    if (!this.cfg().memoryEnabled) return '内置记忆已关闭（设置 → 我会永远陪着你 → 内置记忆）。';
    const text = trimText(args.text, 600);
    if (!text) return '要记什么？text 不能为空。';
    const kind = String(args.kind ?? 'fact') as MemoryKind;
    if (!MEMORY_KINDS.includes(kind)) {
      return this.fail(`kind 只能是 ${MEMORY_KINDS.join(' / ')}；没有 note/profile/relationship 这些旧写法。`);
    }
    const tags = Array.isArray(args.tags) ? args.tags.map((t) => trimText(t, 20)).filter(Boolean) : [];
    const musing = tags.includes('musing');
    const details = args.details && typeof args.details === 'object'
      ? { ...(args.details as Record<string, unknown>) }
      : {};
    if (args.userEmotion && typeof args.userEmotion === 'object') {
      details.userEmotion = args.userEmotion;
    }
    const enriched = this.withInferredEmotion(kind, text, details);
    const result = this.memoryStore.add({
      kind,
      text,
      scope: trimText(args.scope, 40) || this.activeScope(),
      confidence: typeof args.confidence === 'number' ? args.confidence : 0.75,
      importance: typeof args.importance === 'number'
        ? args.importance
        : (musing ? 0.25 : 0.55),
      source: musing ? 'muse' : 'tool',
      tags,
      details: enriched as never,
    });
    if (!result.added) return `这条已经记过了（${kind}，id ${result.id.slice(0, 8)}），没有重复写入。`;
    this.snapshot?.invalidate();
    this.mind('memory', `${musing ? '胡思乱想' : '记住'} ${kind}：${text.slice(0, 40)}`, {
      memoryId: result.id,
      kind,
    });
    return `记下了（${kind}）。`;
  }

  /** episode 没显式写 userEmotion 时，按文本做一次保守识别；只补空，不覆盖模型/手工标签。 */
  private withInferredEmotion(
    kind: MemoryKind,
    text: string,
    details?: Record<string, unknown>,
  ): Record<string, unknown> | undefined {
    if (kind !== 'episode') return details;
    const out = details ? { ...details } : {};
    if (!out.userEmotion) {
      const signal = detectEmotion(text);
      if (signal) out.userEmotion = { label: signal.label, intensity: signal.intensity };
    }
    return Object.keys(out).length ? out : undefined;
  }

  private fail(text: string): ToolOutcome {
    return { text, failed: true };
  }

  private async toolMemory(args: Record<string, unknown>): Promise<string | ToolOutcome> {
    const action = String(args.action ?? 'stats');
    if (!this.cfg().memoryEnabled && action !== 'stats') return '内置记忆已关闭。';
    if (action === 'stats') {
      const stats = this.memoryStore.stats();
      const kinds = Object.entries(stats.byKind).map(([k, n]) => `${k} ${n}`).join(' · ') || '空';
      const error = stats.error ? ` · ⚠ ${stats.error}` : '';
      return `记录 ${stats.records} 条（${kinds}）· 原始事件 ${stats.events} 条 · `
        + `文件 ${(this.memoryStore.fileInfo().bytes / 1024).toFixed(0)} KB${error}`;
    }
    if (action === 'export') {
      const version = (() => {
        try {
          return String((JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: string }).version ?? '0.0.0');
        } catch {
          return '0.0.0';
        }
      })();
      const scopes = Array.isArray(args.scopes)
        ? args.scopes.map((s) => trimText(s, 64)).filter(Boolean)
        : undefined;
      const bundle = this.memoryStore.exportBundle(
        { system: 'cortico-world-private-companion', version },
        { scopes, includeRules: args.includeRules === true, includeArchived: args.includeArchived === true },
      );
      const dir = join(this.dataDir, 'exports');
      ensureDir(dir);
      const name = `companion-memory-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      writeFileSync(join(dir, name), JSON.stringify(bundle, null, 2), 'utf8');
      return `已导出 ${bundle.records.length} 条到 data/private-companion/exports/${name}`;
    }
    if (action === 'import') {
      const raw = trimText(args.path, 200);
      if (!raw) return this.fail('import 需要 path：把 bundle 放进 data/private-companion/imports/ 后填文件名。');
      if (/[\\/]/.test(raw) || !/^[A-Za-z0-9._-]+\.json$/.test(raw)) {
        return this.fail('只接受 imports/ 目录下的 .json 文件名（不要带路径）。');
      }
      const dir = join(this.dataDir, 'imports');
      const target = join(dir, raw);
      if (!existsSync(target)) return this.fail('imports/ 里没有这个文件。');
      let size = 0;
      try {
        size = statSync(target).size;
      } catch {
        return this.fail('读不了 imports/ 里的文件。');
      }
      if (size > 8 * 1024 * 1024) return this.fail('文件超过 8MB，拒绝导入。');
      let bundle: unknown;
      try {
        bundle = JSON.parse(readFileSync(target, 'utf8'));
      } catch {
        return this.fail('这个文件不是合法 JSON。');
      }
      const records = (bundle as { records?: unknown[] })?.records;
      if (!Array.isArray(records)) return this.fail('不是 companion-memory bundle（缺 records 数组）。');
      if (String(args.mode ?? 'merge') === 'dry') {
        const schema = (bundle as { schema?: unknown })?.schema;
        return `dry-run：schema=${String(schema)}，文件里 ${records.length} 条；当前库 ${this.memoryStore.stats().records} 条。`;
      }
      const staged = this.memoryStore.stageImport(bundle);
      if (staged.error) return this.fail(`导入失败：${staged.error}`);
      return `已放进隔离区：${staged.staged} 条（无效 ${staged.invalid}），bundleId=${staged.bundleId}。`
        + ' 需要人工用 CLI 批准后才会进入记忆。';
    }
    if (action === 'quarantine') {
      const list = this.memoryStore.listQuarantine();
      if (!list.length) return '隔离区是空的。';
      return list.map((item) => `${item.bundleId} · ${item.records} 条 · ${item.stagedAt}`).join('\n');
    }
    if (action === 'prune') {
      const removed = this.memoryStore.prune(this.cfg().memoryRetentionDays);
      return removed ? `已裁剪 ${removed} 条过期原始事件。` : '没有需要裁剪的原始事件。';
    }
    if (action === 'unmerge') {
      const id = trimText(args.id, 128);
      if (!id) return this.fail('unmerge 需要 id（合并摘要的记录 id）。');
      const restored = this.memoryStore.unmerge(id);
      if (restored) this.mind('memory', `撤销合并，恢复 ${restored} 条原文`, { memoryId: id });
      return restored ? `已撤销合并，恢复 ${restored} 条原文。` : '没有找到这条合并摘要，或没有可恢复的原文。';
    }
    if (action === 'forget') {
      const query = trimText(args.query, 200);
      if (!query) return 'forget 需要 query（要删的原文）。';
      const removed = this.memoryStore.remove(query, trimText(args.scope, 40) || this.activeScope());
      return removed ? `删掉了 ${removed} 条。` : '没找到完全匹配的一条；为避免误删，forget 只删原文完全相同的记录。';
    }
    return '未知 action（stats/export/import/prune/forget）。';
  }

  private activeScope(): string {
    return this.memoryStore.lastHumanEvent(120)?.scope ?? MAIN_KEY;
  }

  /** 进上下文的记忆摘要：规则 + 人物 + 今天 + 情绪回声 + 最近几条。 */
  private memoryDigest(): {
    rules: string[]; person?: string; working?: string; echo?: string;
    echoId?: string; echoEventId?: string; recent: string[];
    followup?: string;
  } {
    if (!this.cfg().memoryEnabled) return { rules: [], recent: [] };
    const cfg = this.cfg();
    const scope = this.activeScope();
    const now = new Date();
    const todayStart = startOfLocalDayMs(now, this.tz());
    const rules = this.memoryStore.rules(cfg.memoryNotesInPrompt);
    const person = this.memoryStore.people()[0];
    const workingRecords = cfg.workingMemoryInPrompt !== false
      ? this.memoryStore.todayEpisodes(3, scope, todayStart) : [];
    const workingIds = new Set(workingRecords.map((record) => record.id));
    const working = cfg.workingMemoryInPrompt !== false
      ? (workingRecords.length
        ? workingRecords.map((record) => record.text.slice(0, 60)).join('；')
        : this.memoryStore.todayDigest(3, scope, todayStart, this.tz()))
      : '';
    const recent = this.memoryStore.recent(6, scope)
      .filter((record) => !workingIds.has(record.id))
      .slice(0, 3);
    this.memoryStore.markUsed(recent.map((record) => record.id));
    const echo = cfg.emotionEchoEnabled !== false ? this.emotionEcho(scope) : null;
    let followup: string | undefined;
    const reviewAt = Date.parse(this.state.followupReviewAt ?? '');
    if (this.state.followupReviewThreadId && Number.isFinite(reviewAt)
      && Date.now() - reviewAt < 24 * 3_600_000) {
      const thread = this.memoryStore.entries()
        .find((record) => record.id === this.state.followupReviewThreadId);
      if (thread) followup = (thread.details?.what ?? thread.text).slice(0, 120);
    }
    return {
      // 规则是硬约束，不截断；单条超过 400 字才做保护性截断。
      rules: rules.map((record) => (record.text.length > 400 ? `${record.text.slice(0, 400)}…` : record.text)),
      person: person ? `他：${person.text.slice(0, 180)}` : undefined,
      working: working || undefined,
      echo: echo?.text,
      echoId: echo?.id,
      echoEventId: echo?.eventId,
      ...(followup ? { followup } : {}),
      recent: recent.map((record) => `${formatLocal(record.ts, this.tz()).slice(0, 10)} ${record.text.slice(0, 120)}`),
    };
  }

  /** 情绪回声：只看最近 30 分钟最后一条人话，同一事件只算一次；标记在推送成功后做。 */
  private emotionEcho(scope: string): { text: string; id: string; eventId: string } | null {
    const event = this.memoryStore.lastHumanEvent(30);
    if (!event) return null;
    if (this.state.lastEchoEventKey === event.id) {
      return this.state.lastEchoText && this.state.lastEchoId
        ? { text: this.state.lastEchoText, id: this.state.lastEchoId, eventId: event.id }
        : null;
    }
    const signal = detectEmotion(event.text);
    if (!signal) return null;
    const surfaced = this.state.surfacedMemories ?? {};
    const exclude = new Set(Object.entries(surfaced)
      .filter(([, ts]) => Date.now() - Date.parse(ts) < 7 * 86_400_000)
      .map(([id]) => id));
    let past: MemoryRecord | undefined = this.memoryStore.emotionEcho(signal.label, event.scope, { exclude })[0];
    if (!past) {
      const words = relatedWords(signal.label);
      past = this.memoryStore.entries()
        .filter((record) => record.kind === 'episode' && record.reviewStatus === 'approved'
          && !record.archived && scopeKey(record.scope) === scopeKey(event.scope) && !exclude.has(record.id)
          && !record.tags.includes('legacy-chat') && !record.tags.includes('recap')
          && !record.tags.includes('musing')
          && Date.now() - Date.parse(record.ts) >= 86_400_000
          && words.some((word) => record.text.includes(word)))
        .sort((a, b) => (b.details?.intensity ?? 0) - (a.details?.intensity ?? 0))[0];
    }
    if (!past) return null;
    const cause = past.details?.userEmotion?.cause
      ?? past.details?.userEmotion?.label
      ?? past.text.slice(0, 60).replace(/\s+/g, ' ');
    const when = past.ts.slice(5, 10);
    return {
      id: past.id,
      eventId: event.id,
      text: `他这次说「${signal.matched}」；上次（${when}）是因为「${cause.slice(0, 60)}」。可以自然问一句，也可以不提。`,
    };
  }

  /** 空闲胡思乱想：每天有限次数，写低权重 episode（tag musing），不主动发消息。 */
  private async maybeMuse(now: Date): Promise<void> {
    const cfg = this.cfg();
    const enabled = cfg.musingEnabled !== false;
    const cap = Number.isFinite(cfg.musingDailyCap) ? cfg.musingDailyCap : 2;
    const idleNeed = Number.isFinite(cfg.musingIdleHours) ? cfg.musingIdleHours : 4;
    if (!this.host || !enabled || !cfg.memoryEnabled || cap <= 0) return;
    const p = localParts(now, this.tz());
    if (this.state.musingDay !== p.date) {
      this.state.musingDay = p.date;
      this.state.musingCount = 0;
    }
    if (this.state.musingCount >= cap) return;
    if (p.hour < 8 || p.hour >= 23) return;
    if (this.state.sleeping || inWindow(p.minutes, cfg.quietStart, cfg.quietEnd)) return;
    const lastUserAt = this.probeLastUser(now.getTime());
    if (!lastUserAt) return;
    const idleHours = (now.getTime() - lastUserAt) / 3_600_000;
    if (idleHours < idleNeed) return;
    if (this.state.lastMusingAt && now.getTime() - Date.parse(this.state.lastMusingAt) < idleNeed * 3_600_000) return;
    const seeds = this.musingSeeds();
    const pushed = await this.push('companion.muse', [
      '【胡思乱想】',
      `他已经 ${Math.round(idleHours)} 小时没说话了，你一个人待着。`,
      '可以随便想起 1-2 件没头没尾的事，用 companion_remember kind=episode tags=["musing"] importance=0.25 记下。',
      '不要发消息，不要写工具回执，不要总结成日记；想不起来就不写。',
      '素材：',
      ...seeds,
    ].join(NL), 'flush');
    if (!pushed?.delivered) {
      // 未投递不扣次数，但按 idleNeed 退避，避免每分钟重试。
      this.state.lastMusingAt = now.toISOString();
      this.save(true);
      return;
    }
    this.state.musingCount += 1;
    this.state.lastMusingAt = now.toISOString();
    this.save(true);
  }

  private musingSeeds(): string[] {
    const seeds: string[] = [];
    const person = this.memoryStore.people()[0];
    if (person) seeds.push(`- 他：${person.text.slice(0, 100)}`);
    const thread = this.memoryStore.openThreads(1)[0];
    if (thread) seeds.push(`- 没做完的事：${(thread.details?.what ?? thread.text).slice(0, 100)}`);
    for (const record of this.memoryStore.recent(2, this.activeScope())) seeds.push(`- 最近：${record.text.slice(0, 100)}`);
    return seeds.slice(0, 4);
  }

  /** 把新的外部事件追加进原始事件层；只记人说的话，不记各世界自己的遥测。 */
  private captureIncoming(): void {
    if (!this.host || !this.cfg().memoryEnabled || !this.cfg().memoryCapture) return;
    const latest = this.host.store.latestCursor();
    if (latest < this.memoryStore.eventCursor) {
      // 宿主事件库回退（清库/恢复备份）：游标跟着回退，否则捕获永久停摆。
      this.memoryStore.resetCursor(latest);
      return;
    }
    const from = this.memoryStore.eventCursor + 1;
    if (latest < from) return;
    // 落后时不跳段：每拍最多追 200 条，慢慢补齐。
    const upTo = Math.min(latest, from + 199);
    const batch: Array<{ text: string; ts: string; source: string; scope: string; cursor: number }> = [];
    for (let c = from; c <= upTo; c += 1) {
      const event = this.host.store.get(c);
      if (!event || !isHumanEvent(event)) continue;
      batch.push({
        text: event.text,
        ts: event.ts,
        source: event.source,
        scope: scopeOfEvent(event),
        cursor: c,
      });
    }
    this.memoryStore.appendEvents(batch);
    this.memoryStore.eventCursor = upTo;
    if (batch.length) this.lastUserProbe = 0;
  }



  private async toolProactive(args: Record<string, unknown>): Promise<string> {
    const action = String(args.action ?? 'status');
    const now = new Date();
    if (action === 'trigger') {
      const lastUserAt = this.probeLastUser(now.getTime());
      const since = lastUserAt ? now.getTime() - lastUserAt : null;
      const reason = reasonFor({
        state: this.state, now, tz: this.tz(), sinceTalkMs: since, seed: now.getTime(),
      });
      const text = buildProactiveText({
        state: this.state,
        reason,
        now,
        tz: this.tz(),
        quiet: `${this.cfg().quietStart}-${this.cfg().quietEnd}`,
        sinceTalk: since === null ? '记不清了' : humanSpan(since),
      });
      this.wakeReason = reason;
      const pushed = await this.push('companion.proactive', text, 'flush');
      if (!pushed?.delivered) return '推送失败：World 未连接或当前不可投递。';
      this.mind('proactive', `手动触发：${reason}`);
      this.state.proactiveCount += 1;
      this.state.proactiveDay = localParts(now, this.tz()).date;
      this.state.lastProactiveAt = now.toISOString();
      this.state.lastProactiveReason = reason;
      this.state.proactiveDueAt = null;
      this.save(true);
      return `已按当前状态唤醒一次（由头：${reason}）。`;
    }
    const gate = evaluate({
      cfg: this.cfg(),
      state: { ...this.state, proactiveDueAt: null },
      now,
      tz: this.tz(),
      lastUserAt: this.probeLastUser(now.getTime()),
      countToday: this.countToday(),
    });
    return [
      `主动联系：${this.cfg().proactiveEnabled ? '开' : '关'}`,
      '下一次：等待生活/状态触发',
      `今天已主动：${this.countToday()} 次（上限 ${this.cfg().proactiveDailyCap || '不限'}）`,
      `上一次由头：${this.state.lastProactiveReason ?? '无'}`,
      gate.ok ? '现在可以开口。' : `现在不会开口：${gate.blockedBy}。`,
    ].join('\n');
  }

  /** 供排障用的只读快照（不进模型）。 */
  debugSnapshot(): Record<string, unknown> {
    const p = localParts(new Date(), this.tz());
    return {
      state: this.state,
      sleeping: isSleeping(p, this.cfg()),
      quiet: inWindow(p.minutes, this.cfg().quietStart, this.cfg().quietEnd),
      countToday: this.countToday(),
      agenda: this.state.agenda,
      profiles: Object.keys(this.profiles),
      memory: this.memoryStore.stats(),
      files: {
        state: existsSync(join(this.dataDir, STATE_FILE)),
        journal: existsSync(journalPath(this.dataDir)),
      },
      envPrompt: readFileSync(ENV_PROMPT_FILE, 'utf8').length,
      generatedAt: new Date().toISOString(),
    };
  }
}
