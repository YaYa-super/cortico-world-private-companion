/**
 * 「我会永远陪着你」的 Coopanion 实现：角色自己的一天 + 主动开口 + 关系卡 + 日记，
 * 以及一组让模型自己维护这些状态的工具。
 *
 * 与 AstrBot 原插件的差别（详见 README）：这里不接管对话、不碰平台、不做 TTS/生图/识屏，
 * 只管“它自己的生活在动”和“什么时候它想开口”。人格仍由 CONSTITUTION.md 提供。
 */
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFile, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import type {
  BlobInput, OutputTap, ToolDef, ToolOutcome, World, WorldHost, WorldWebUiDecl,
} from 'cortico/core/types.ts';
import type { WorldContext } from 'cortico/world.ts';
import { COMPANION_CONFIG_GROUPS, type CompanionConfig } from './config.ts';
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
import { computeUtility } from './utility.ts';
import { deriveUserModel, renderUserModel } from './user-model.ts';
import { MindLog, type MindType } from './mind.ts';
import { MEMORY_KINDS, MemoryStore, scopeKey, type MemoryKind, type MemoryRecord } from './memory-store.ts';
import { isHumanEvent, scopeOfEvent } from './event-filter.ts';
import type { MediaRecord } from './channels/media-store.ts';
import { OneBotChannel } from './channels/onebot.ts';
import { BILI_READONLY_DESIGN } from './channels/bili-read.ts';
import { BiliLogin } from './channels/bili-login.ts';
import { BiliReadClient } from './channels/bili.ts';
import { BiliWatchLedger } from './channels/bili-watch.ts';
import { TogetherBrowser } from './channels/together.ts';
import { DeepSeekVoice } from './channels/deepseek-voice.ts';
import { askWithWebSearch, formatWebAnswer } from './channels/web-search.ts';
import { resolveDeepSeekKey } from './channels/web-key.ts';
import { cropSprite, gifFrames, imageForVision, imageHasContent, montageImages } from './channels/image-view.ts';
import { BLOCKED_ACTIONS, findOneBotAction, searchOneBotActions, validateActionParams } from './channels/onebot-catalog.ts';
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

/** 从 onebot_call 的参数里取出“真的发出去的文本”（send_private_msg / send_group_msg / send_msg）。 */
function onebotSendText(args: Record<string, unknown>): string {
  const action = String(args.action ?? '');
  if (!['send_private_msg', 'send_group_msg', 'send_msg'].includes(action)) return '';
  const params = args.params && typeof args.params === 'object'
    ? args.params as Record<string, unknown>
    : {};
  const message = params.message ?? args.message;
  if (typeof message === 'string') return message.trim();
  if (!Array.isArray(message)) return '';
  const parts: string[] = [];
  for (const segment of message) {
    if (!segment || typeof segment !== 'object') continue;
    const seg = segment as Record<string, unknown>;
    if (seg.type !== 'text') continue;
    const data = seg.data && typeof seg.data === 'object'
      ? seg.data as Record<string, unknown>
      : {};
    if (typeof data.text === 'string' && data.text.trim()) parts.push(data.text.trim());
  }
  return parts.join(' ');
}

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
  private readonly oneBot: OneBotChannel;
  private bili: BiliReadClient;
  private readonly biliLogin = new BiliLogin();
  private readonly biliLoginFile: string;
  private readonly biliWatch: BiliWatchLedger;
  private readonly together: TogetherBrowser;
  private readonly voice: DeepSeekVoice;
  private readonly biliOwnerUid: string;
  private togetherBvid = '';
  private lastTogetherFrame = '';
  private lastTogetherMontage = '';
  private lastTogetherMontageAt = '';
  private lastTogetherMontageTitle = '';
  private lastTogetherMontageCells = 0;
  private togetherObserveTimer: ReturnType<typeof setInterval> | null = null;
  private togetherObserveInFlight = false;
  private qqChannelRunning = false;
  private lastTogetherObserveAt = 0;
  private togetherSamples: string[] = [];
  private lastTogetherPreviewBvid = '';
  private lastTogetherPreviewAt = 0;
  private togetherAutoBusy = false;
  private biliSelfWatchInFlight = false;
  private biliNoticeInFlight = false;
  private lastMediaReminderAt = 0;
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
  /** 用户模型渲染缓存：10 分钟或记录数变化时重算。 */
  private userModelCache: { at: number; records: number; text: string } | null = null;

  constructor(ctx: WorldContext<CompanionConfig>) {
    this.ctx = ctx;
    const base = typeof ctx.dataDir === 'string' && ctx.dataDir ? ctx.dataDir : '.';
    this.dataDir = join(base, 'private-companion');
    this.oneBot = new OneBotChannel({ dataDir: this.dataDir, botDir: ctx.botDir });
    this.biliLoginFile = join(this.dataDir, 'bili', 'cookies.json');
    const biliCookie = this.cfg().biliCookieFile || (existsSync(this.biliLoginFile)
      ? this.biliLoginFile : join(ctx.botDir, 'data', 'bili-video-pro', 'cookies.json'));
    this.bili = new BiliReadClient({ cookieFile: biliCookie });
    this.biliWatch = new BiliWatchLedger(join(this.dataDir, 'bili', 'watch-ledger.jsonl'));
    try {
      const oldState = join(ctx.botDir, 'data', 'bili-video-pro', 'selfwatch.json');
      if (existsSync(oldState)) {
        const parsed = JSON.parse(readFileSync(oldState, 'utf8')) as Record<string, unknown>;
        const watched = Array.isArray(parsed.watched) ? parsed.watched.map(String) : [];
        const fingerprints = parsed.fingerprints && typeof parsed.fingerprints === 'object'
          ? Object.values(parsed.fingerprints as Record<string, unknown>).map(String) : [];
        this.biliWatch.importLegacy(watched, fingerprints);
      }
    } catch { /* 旧状态坏了不影响新账本 */ }
    this.together = new TogetherBrowser({ dataDir: this.dataDir, edgePath: this.cfg().biliBrowserPath || '' });
    this.voice = new DeepSeekVoice({
      botDir: ctx.botDir,
      baseUrl: this.cfg().deepseekBaseUrl || 'https://api.deepseek.com',
      keyFile: this.cfg().deepseekKeyFile || undefined,
    });
    let ownerUid = String(this.cfg().biliOwnerUid || '').trim();
    if (!ownerUid) {
      try {
        const configPath = join(ctx.botDir, 'config.json');
        if (existsSync(configPath)) {
          const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
          const worlds = config.worlds && typeof config.worlds === 'object' ? config.worlds as Record<string, unknown> : {};
          const bili = worlds['bili-video-pro'] && typeof worlds['bili-video-pro'] === 'object' ? worlds['bili-video-pro'] as Record<string, unknown> : {};
          const owner = bili.owner && typeof bili.owner === 'object' ? bili.owner as Record<string, unknown> : {};
          ownerUid = String(owner.uid || '').trim();
        }
      } catch { /* ignore */ }
    }
    this.biliOwnerUid = ownerUid;
    this.oneBot.onMessage = (message) => this.handleQqMessage(message);
    this.oneBot.loadConfig();
    this.memoryStore = new MemoryStore(join(this.dataDir, 'memory'), undefined, { lock: true });
    this.mindLog = new MindLog(join(this.dataDir, 'mind.jsonl'), 500);
    this.state = createInitialState(new Date(), this.tz(), this.cfg());
    this.load();
  }

  private cfg(): CompanionConfig {
    // 旧版 onebot_* 别名已从正式 UI 移除；强制关闭，避免和旧 OneBot 扩展撞名。
    return { ...this.ctx.cfg, qqLegacyTools: false };
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
      'companion.styleNote': trimText(cfg.styleNote, 600),
    };
  }

  tools(): ToolDef[] {
    const specs = TOOL_SPECS.filter((spec) => {
      if (spec.name.startsWith('onebot_') && !this.cfg().qqLegacyTools) return false;
      if ((spec.name.startsWith('qq_') || spec.name.startsWith('onebot_')) && !this.cfg().qqChannelEnabled) return false;
      if (spec.name.startsWith('bili_') && !this.cfg().biliChannelEnabled) return false;
      if (spec.name === 'companion_screen' && !this.cfg().screenEnabled) return false;
      if (spec.name === 'companion_web' && !this.cfg().webSearchEnabled) return false;
      return true;
    });
    return specs.map((spec) => ({
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

  private dispatch(name: string, args: Record<string, unknown>): Promise<string | ToolOutcome> {
    switch (name) {
      case 'companion_screen':
        return this.toolCompanionScreen();
      case 'companion_web':
        return this.toolCompanionWeb(args);
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
      case 'companion_memory_read':
        return this.toolMemoryRead(args);
      case 'companion_memory_timeline':
        return this.toolMemoryTimeline(args);
      case 'qq_status':
        return this.toolQqStatus();
      case 'qq_recent':
        return this.toolQqRecent(args);
      case 'qq_send':
        return this.toolQqSend(args);
      case 'qq_media_list':
        return this.toolQqMediaList(args);
      case 'qq_media_import':
        return this.toolQqMediaImport(args);
      case 'qq_media_delete':
        return this.toolQqMediaDelete(args);
      case 'qq_media_note':
        return this.toolQqMediaNote(args);
      case 'qq_reply':
        return this.toolQqReply(args);
      case 'qq_view_file':
        return this.toolQqViewFile(args);
      case 'qq_transcribe_voice':
        return this.toolQqTranscribeVoice(args);
      case 'qq_view_image':
      case 'onebot_view_image':
        return this.toolQqViewImage(args);
      case 'qq_actions':
      case 'onebot_actions':
        return this.toolOneBotActions(args);
      case 'qq_call':
      case 'onebot_call':
        return this.toolOneBotCall(args);
      case 'qq_receive':
      case 'onebot_receive':
        return this.toolOneBotReceive(args);
      case 'onebot_status':
        return this.toolQqStatus();
      case 'onebot_events':
        return this.toolQqRecent(args);
      case 'onebot_media_note':
        return this.toolQqMediaNote(args);
      case 'onebot_media_list':
        return this.toolQqMediaList(args);
      case 'bili_search':
        return this.toolBiliSearch(args);
      case 'bili_info':
        return this.toolBiliInfo(args);
      case 'bili_comments':
        return this.toolBiliComments(args);
      case 'bili_subtitles':
        return this.toolBiliSubtitles(args);
      case 'bili_history':
        return this.toolBiliHistory(args);
      case 'bili_watch':
        return this.toolBiliWatch(args);
      case 'bili_frames':
        return this.toolBiliFrames(args);
      case 'bili_together_open':
        return this.toolBiliTogetherOpen(args);
      case 'bili_together_auto':
        return this.toolBiliTogetherAuto(args);
      case 'bili_together_control':
        return this.toolBiliTogetherControl(args);
      case 'bili_together_frame':
        return this.toolBiliTogetherFrame();
      case 'bili_together_close':
        return this.toolBiliTogetherClose();
      case 'bili_comment_reply':
        return this.toolBiliCommentReply(args);
      case 'bili_dm_reply':
        return this.toolBiliDmReply(args);
      case 'bili_act':
        return this.toolBiliAct(args);
      case 'bili_profile':
        return this.toolBiliProfile();
      case 'bili_update_profile':
        return this.toolBiliUpdateProfile(args);
      case 'bili_together_share':
        return this.toolBiliTogetherShare(args);
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
        ...(cfg.webSearchEnabled ? [{
          label: '联网',
          state: 'online' as const,
          hint: '按需查询，不每句都联网',
        }] : []),
        ...(cfg.qqChannelEnabled ? [{
          label: 'QQ',
          state: this.oneBot.status().state === 'online' ? 'online'
            : this.oneBot.status().enabled ? 'loading' : 'offline',
          hint: this.oneBot.status().state === 'online'
            ? (this.oneBot.status().selfId ? `已连接 · ${this.oneBot.status().selfId}` : '已连接')
            : this.oneBot.status().enabled ? '连接中 / 等待重连' : '未启用',
        }] : []),
        ...(cfg.biliChannelEnabled ? [{
          label: 'B站',
          state: 'offline',
          hint: '浏览 / 通知 / 一起看已接入',
        }] : []),
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
      config: COMPANION_CONFIG_GROUPS,
      panels: [
        {
          id: 'life',
          title: '记忆',
          description: '记忆的可视化观察窗：此刻、星图、概览/最近、全库搜索、合并摘要、关系。只读。',
        },
        ...(cfg.qqChannelEnabled ? [{
          id: 'qq',
          title: 'QQ',
          description: '原生 OneBot 通道：连接状态、地址与事件计数；消息入记忆和工具在后续接入。',
        }] : []),
        ...(cfg.biliChannelEnabled ? [{
          id: 'bili',
          title: 'B站',
          description: 'B站面板：搜索、视频信息、字幕、弹幕、热评、观看记录与一起看。',
        }] : []),
      ],
      invoke: (panel, method, args) => {
        if (panel === 'qq') {
          if (!this.cfg().qqChannelEnabled) throw new Error('QQ 通道未启用');
          return this.invokeQqPanel(method, args);
        }
        if (panel === 'bili') {
          if (!this.cfg().biliChannelEnabled) throw new Error('B站通道未启用');
          return this.invokeBiliPanel(method, args);
        }
        return this.invokeMemoryPanel(panel, method, args);
      },
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
  private qqSnapshot(): Record<string, unknown> {
    const config = this.oneBot.loadConfig();
    return {
      status: this.oneBot.status(),
      recent: this.oneBot.recent(12),
      eventHistory: this.oneBot.recent(100),
      messages: this.oneBot.recentMessages(8),
      config: { enabled: config.enabled, wsUrl: config.wsUrl, receive: config.receive, sttCommand: config.sttCommand },
      configPath: this.oneBot.configPath,
    };
  }

  private async invokeQqPanel(method: string, args: unknown[]): Promise<unknown> {
    const list = Array.isArray(args) ? args : [];
    if (method === 'status') return this.qqSnapshot();
    if (method === 'recent') return { recent: this.oneBot.recent(Number(list[0]) || 12) };
    if (method === 'save') {
      const patch = list[0] && typeof list[0] === 'object' ? list[0] as Record<string, unknown> : {};
      const next: { enabled?: boolean; wsUrl?: string; token?: string; receive?: string; sttCommand?: string } = {};
      if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled;
      if (typeof patch.wsUrl === 'string') next.wsUrl = patch.wsUrl;
      if (typeof patch.receive === 'string') next.receive = patch.receive;
      if (typeof patch.sttCommand === 'string') next.sttCommand = patch.sttCommand;
      if (typeof patch.token === 'string' && patch.token) next.token = patch.token;
      const saved = this.oneBot.saveConfig(next);
      if (saved.enabled) {
        await this.oneBot.restart();
        await this.oneBot.waitReady();
      } else {
        await this.oneBot.stop();
      }
      return this.qqSnapshot();
    }
    if (method === 'connect') {
      this.oneBot.saveConfig({ enabled: true });
      await this.oneBot.restart();
      await this.oneBot.waitReady();
      return this.qqSnapshot();
    }
    if (method === 'disconnect') {
      this.oneBot.saveConfig({ enabled: false });
      await this.oneBot.stop();
      return this.qqSnapshot();
    }
    if (method === 'group') {
      const patch = list[0] && typeof list[0] === 'object' ? list[0] as Record<string, unknown> : {};
      const action = trimText(patch.action, 80);
      if (!/^(set_group_|get_group_)/.test(action)) throw new Error('只允许群管 action');
      const params = patch.params && typeof patch.params === 'object' && !Array.isArray(patch.params)
        ? { ...(patch.params as Record<string, unknown>) } : {};
      if (patch.group_id !== undefined) {
        const groupId = String(patch.group_id).trim();
        params.group_id = /^\d+$/.test(groupId) ? Number(groupId) : groupId;
      }
      for (const key of ['group_id', 'user_id', 'duration']) {
        if (typeof params[key] === 'string' && /^\d+$/.test(String(params[key]).trim())) params[key] = Number(params[key]);
      }
      const result = await this.toolOneBotCall({ action, params, confirm: true });
      return { ...this.qqSnapshot(), result };
    }
    throw new Error(`未知 QQ 面板方法：${method}`);
  }

  private async invokeBiliPanel(method: string, args: unknown[]): Promise<unknown> {
    const list = Array.isArray(args) ? args : [];
    if (!this.cfg().biliChannelEnabled) throw new Error('B站通道未启用');
    if (method === 'login_start' || method === 'login_poll') {
      if (this.cfg().biliCookieFile) throw new Error('当前使用设置中指定的 Cookie 文件。要扫码登录，请先清空该路径。');
      if (method === 'login_start') return this.biliLogin.start();
      const result = await this.biliLogin.poll(list[0], this.biliLoginFile);
      if (result.state === 'done') this.bili = new BiliReadClient({ cookieFile: this.biliLoginFile });
      return result;
    }
    if (method === 'status' || method === 'refresh' || method === 'design') {
      let nav = { loggedIn: false, name: '', mid: '' };
      try { nav = await this.bili.nav(); } catch { /* 未登录/风控时保留匿名状态 */ }
      return { design: BILI_READONLY_DESIGN, total: BILI_READONLY_DESIGN.capabilities.length, manualCookie: Boolean(this.cfg().biliCookieFile), nav };
    }
    if (method === 'history') {
      return { history: await this.bili.history(Number(list[0]) || 20) };
    }
    if (method === 'subtitles') {
      return { subtitles: await this.bili.subtitles(trimText(list[0], 30)) };
    }
    if (method === 'search') {
      const query = trimText(list[0], 100);
      if (!query) return { query, hits: [] };
      return { query, hits: await this.bili.search(query, 8) };
    }
    if (method === 'info') {
      return { info: await this.bili.info(trimText(list[0], 30)) };
    }
    if (method === 'comments') {
      return { comments: await this.bili.comments(trimText(list[0], 30), Number(list[1]) || 8) };
    }
    if (method === 'danmaku') {
      return { danmaku: await this.bili.danmaku(trimText(list[0], 30), Number(list[1]) || 80) };
    }
    if (method === 'profile') {
      const [account, nav] = await Promise.all([
        this.bili.memberAccount().catch(() => null),
        this.bili.nav().catch(() => null),
      ]);
      return { profile: { ...(account || {}), face: account?.face || nav?.face || '' } };
    }
    if (method === 'update_profile') {
      const patch = list[0] && typeof list[0] === 'object' ? list[0] as Record<string, unknown> : {};
      const result = await this.toolBiliUpdateProfile({ ...patch, confirm: true });
      return { result };
    }
    if (method === 'notices') {
      const [inbox, dms] = await Promise.all([
        this.bili.inbox(12).catch(() => []),
        this.bili.dmSessions(10).then((sessions) => sessions.filter((session) => session.talkerId !== 844424930131964)).catch(() => []),
      ]);
      return { inbox, dms };
    }
    if (method === 'reply_comment') {
      const patch = list[0] && typeof list[0] === 'object' ? list[0] as Record<string, unknown> : {};
      const result = await this.toolBiliCommentReply({
        bvid: patch.bvid, text: patch.text, root: patch.root, parent: patch.parent,
        image: patch.image, mention_owner: patch.mention_owner === true, confirm: true,
      });
      return { result };
    }
    if (method === 'reply_dm') {
      const patch = list[0] && typeof list[0] === 'object' ? list[0] as Record<string, unknown> : {};
      const result = await this.toolBiliDmReply({ talker_id: patch.talker_id, text: patch.text, confirm: true });
      return { result };
    }
    if (method === 'last_frame') {
      if (!this.lastTogetherMontage || !existsSync(this.lastTogetherMontage)) {
        return { image: '', at: '', title: '', cells: 0 };
      }
      try {
        const bytes = readFileSync(this.lastTogetherMontage);
        return {
          image: `data:image/jpeg;base64,${bytes.toString('base64')}`,
          at: this.lastTogetherMontageAt,
          title: this.lastTogetherMontageTitle,
          cells: this.lastTogetherMontageCells,
        };
      } catch {
        return { image: '', at: '', title: '', cells: 0 };
      }
    }
    if (method === 'share_frame') {
      const patch = list[0] && typeof list[0] === 'object' ? list[0] as Record<string, unknown> : { text: list[0] };
      const text = trimText(patch.text, 300) || '这一帧给你看。';
      if (!this.togetherBvid) return { result: '还没有一起看的视频' };
      if (!this.lastTogetherFrame) await this.togetherFrame();
      const result = await this.toolBiliCommentReply({
        bvid: this.togetherBvid, text, image: this.lastTogetherFrame,
        mention_owner: patch.mention_owner === true, confirm: true,
      });
      return { result };
    }
    if (method === 'selfwatch') {
      const patch = list[0] && typeof list[0] === 'object' ? list[0] as Record<string, unknown> : null;
      if (patch) {
        const file = join(this.dataDir, 'bili', 'selfwatch-config.json');
        mkdirSync(join(this.dataDir, 'bili'), { recursive: true });
        writeFileSync(file, JSON.stringify({
          enabled: patch.enabled === true,
          everyMinutes: Math.max(30, Math.min(1440, Number(patch.everyMinutes) || 180)),
          topics: trimText(patch.topics, 200),
        }), 'utf8');
      }
      return { selfwatch: this.biliSelfWatchConfig() };
    }
    if (method === 'together_open') {
      const input = trimText(list[0], 300);
      return { together: await this.togetherOpen(input) };
    }
    if (method === 'together_auto') {
      return { together: await this.togetherAuto(trimText(list[0], 100)) };
    }
    if (method === 'together_control') {
      return { together: await this.togetherControl(trimText(list[0], 20), Number(list[1]) || 0) };
    }
    if (method === 'together_frame') {
      const frame = await this.togetherFrame();
      return { together: frame.status, path: frame.path };
    }
    if (method === 'together_close') {
      this.stopTogetherObserver();
      await this.together.close();
      return { together: await this.together.status() };
    }
    throw new Error(`未知 B站面板方法：${method}`);
  }

  private async invokeMemoryPanel(panel: string, method: string, args: unknown[]): Promise<unknown> {
    if (panel !== 'memory' && panel !== 'life') throw new Error(`未知面板：${panel}`);
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
    if (method === 'rename') {
      const raw = typeof list[0] === 'string' ? list[0].replace(/\s+/g, ' ').trim().slice(0, 20) : '';
      const name = raw || '大肥鱼';
      this.ctx.persist({ displayName: name });
      this.save(true);
      return { name };
    }
    if (method === 'dashboard') {
      const now = new Date();
      const p = localParts(now, this.tz());
      const dayStart = startOfLocalDayMs(now, this.tz());
      const stats = store.stats();
      const records = store.entries();
      const person = store.people()[0];
      const profile = this.currentProfile();
      const journal = readJournal(this.dataDir, 5);
      const mind = this.mindLog.tail(80)
        .filter((event) => Date.parse(event.ts) >= dayStart)
        .map((event) => ({ at: event.ts, type: event.type, text: event.summary, refs: event.refs ?? {} }));
      const timeline = [
        ...this.state.agenda.map((item) => ({
          at: `${p.date}T${item.time}:00`, kind: 'agenda', text: `${item.title} · ${item.place}`,
        })),
        ...mind.map((event) => ({ at: event.at, kind: event.type, text: event.text })),
        ...journal.map((entry) => ({
          at: entry.ts, kind: 'journal', text: `${entry.kind}：${entry.text.slice(0, 120)}`,
        })),
      ]
        .filter((item) => Number.isFinite(Date.parse(item.at)))
        .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
        .slice(-120);

      const earliest = records.reduce((min, record) => {
        const t = Date.parse(record.createdAt || record.ts);
        return Number.isFinite(t) && t < min ? t : min;
      }, Number.POSITIVE_INFINITY);
      const daysTogether = Number.isFinite(earliest)
        ? Math.max(1, Math.ceil((now.getTime() - earliest) / 86_400_000))
        : null;
      const model = deriveUserModel({ records, now, tz: this.tz(), maxItems: 8 });
      const musingToday = this.state.musingDay === p.date ? this.state.musingCount : 0;

      return {
        name: this.cfg().displayName || '大肥鱼',
        now: {
          date: p.date, weekday: p.weekday, time: `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`,
          mood: Math.round(this.state.mood), energy: Math.round(this.state.energy),
          activity: this.state.activity, location: this.state.location, sleeping: this.state.sleeping,
        },
        agenda: this.state.agenda.map((item) => ({ ...item })),
        profile: profile ? {
          name: profile.name, relation: profile.relation, birthday: profile.birthday, notes: profile.notes.slice(0, 3),
        } : null,
        counts: {
          proactiveToday: this.countToday(), proactiveCap: this.cfg().proactiveDailyCap,
          musingToday, musingCap: Number.isFinite(this.cfg().musingDailyCap) ? this.cfg().musingDailyCap : 2,
          unanswered: this.state.cognitionUnanswered ?? 0,
        },
        relationship: {
          name: profile?.name || person?.details?.aliases?.[0] || '',
          relation: profile?.relation || person?.details?.relationLabel || '',
          birthday: profile?.birthday || '',
          closeness: typeof person?.details?.closeness === 'number' ? person.details.closeness : 0.5,
          daysTogether,
          memories: stats.records,
          promises: store.openThreads(0).length,
          surfaced: Object.keys(this.state.surfacedMemories ?? {}).length,
          latestJournal: journal[0]?.text.slice(0, 160) ?? '',
        },
        model: model.items.map((item) => ({
          key: item.key, kind: item.kind, text: item.text, confidence: item.confidence,
          evidence: item.evidenceRefs.length,
        })),
        decision: this.state.lastProactiveDecision ?? null,
        timeline,
        mind: mind.slice(-8),
        memory: {
          records: stats.records, events: stats.events, threads: store.openThreads(0).length,
          rules: store.rules(100).length, people: store.people().length,
          archived: records.filter((record) => record.archived).length,
          merged: records.filter((record) => record.details?.merged === true).length,
          bytes: store.fileInfo().bytes,
        },
      };
    }
    if (method === 'constellation') {
      const now = Date.now();
      const all = store.entries().filter((record) => record.reviewStatus === 'approved' && !record.archived);
      const coreKinds = new Set(['rule', 'person', 'self', 'thread']);
      const core = all.filter((record) => coreKinds.has(record.kind));
      const rest = all
        .filter((record) => !coreKinds.has(record.kind))
        .sort((a, b) => {
          const score = (record: MemoryRecord) => record.importance * 2
            + Math.max(0, 1 - (now - Date.parse(record.ts)) / (30 * 86_400_000));
          return score(b) - score(a);
        });
      const picked = [...core, ...rest].slice(0, 260);
      const nodes = picked.map((record) => ({
        id: record.id,
        kind: record.kind,
        text: record.text.slice(0, 120),
        ts: record.ts,
        date: formatLocal(record.ts, this.tz()).slice(0, 10),
        importance: record.importance,
        confidence: record.confidence,
        scope: record.scope,
        tags: record.tags.slice(0, 4),
        evidence: (record.details?.evidence ?? record.details?.evidenceRefs ?? []).slice(0, 3),
        subjectKey: record.subjectKey ?? '',
      }));
      const byId = new Map(nodes.map((node) => [node.id, node]));
      const edges: Array<{ a: string; b: string; type: string }> = [];
      const seen = new Set<string>();
      const addEdge = (a: string, b: string, type: string) => {
        if (a === b || !byId.has(a) || !byId.has(b)) return;
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        if (seen.has(key)) return;
        seen.add(key);
        if (edges.length < 700) edges.push({ a, b, type });
      };
      const bySubject = new Map<string, string[]>();
      const byTag = new Map<string, string[]>();
      for (const node of nodes) {
        if (node.subjectKey) bySubject.set(node.subjectKey, [...(bySubject.get(node.subjectKey) ?? []), node.id]);
        for (const tag of node.tags) {
          if (['legacy-chat', 'recap', 'musing', 'thought', 'handoff-summary'].includes(tag)) continue;
          byTag.set(tag, [...(byTag.get(tag) ?? []), node.id]);
        }
      }
      for (const ids of bySubject.values()) {
        for (let index = 1; index < ids.length; index += 1) addEdge(ids[0], ids[index], 'subject');
      }
      for (const ids of byTag.values()) {
        if (ids.length < 2 || ids.length > 6) continue;
        for (let index = 1; index < ids.length; index += 1) addEdge(ids[0], ids[index], 'tag');
      }
      // 同一天、同一会话里的记忆本来就是一段经历：给星图一层淡淡的“同日”连线。
      const byDay = new Map<string, string[]>();
      for (const node of nodes) {
        const key = `${node.scope}|${node.date}`;
        byDay.set(key, [...(byDay.get(key) ?? []), node.id]);
      }
      for (const ids of byDay.values()) {
        if (ids.length < 2 || ids.length > 8) continue;
        for (let index = 1; index < ids.length; index += 1) addEdge(ids[0], ids[index], 'day');
      }
      for (const record of picked) {
        const threadId = typeof record.details?.threadId === 'string' ? record.details.threadId : '';
        if (threadId) addEdge(record.id, threadId, 'thread');
        const personId = typeof record.details?.personId === 'string' ? record.details.personId : '';
        if (personId) addEdge(record.id, personId, 'person');
      }
      return { nodes, edges, total: all.length, shown: nodes.length, generatedAt: new Date().toISOString() };
    }
    if (method === 'search') {
      const query = typeof list[0] === 'string' ? list[0].trim() : '';
      if (!query) throw new Error('search 需要关键词');
      const scope = typeof list[1] === 'string' ? list[1].trim() : '';
      const limit = Math.min(50, Math.max(1, Number(list[2]) || 20));
      const records = new Map(store.entries().map((record) => [record.id, record]));
      const hits = store.search(query, {
        limit,
        scope: scope === '*' ? undefined : (scope || this.activeScope()),
        includeArchived: false,
        kinds: MEMORY_KINDS,
      });
      return {
        hits: hits.map((hit) => {
          const record = hit.id ? records.get(hit.id) : undefined;
          return {
            id: hit.id,
            kind: hit.kind,
            scope: hit.scope,
            ts: hit.ts,
            date: formatLocal(hit.ts, this.tz()).slice(0, 10),
            score: hit.score,
            text: hit.text.slice(0, 400),
            snippet: hit.snippet,
            importance: record?.importance ?? 0.45,
            tags: (record?.tags ?? []).slice(0, 5),
            evidence: (record?.details?.evidence ?? []).slice(0, 3),
          };
        }),
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
    this.qqChannelRunning = this.cfg().qqChannelEnabled;
    if (this.qqChannelRunning) void this.oneBot.start(true).catch(() => {});
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
    this.biliLogin.cancel();
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.tickPromise) await this.tickPromise;
    await this.snapshot?.close();
    this.snapshot = null;
    this.save(true);
    await this.oneBot.stop();
    this.qqChannelRunning = false;
    this.stopTogetherObserver();
    await this.together.close().catch((error) => this.host?.log.warn('[companion] 一起看关闭失败', String(error)));
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
    blobs?: BlobInput[],
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
        ...(blobs?.length ? { blobs } : {}),
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

  private async syncQqChannel(): Promise<void> {
    const wanted = this.cfg().qqChannelEnabled;
    if (wanted === this.qqChannelRunning) return;
    this.qqChannelRunning = wanted;
    if (wanted) {
      await this.oneBot.start(true).catch((error) => this.host?.log.warn('[companion] QQ 启动失败', String(error)));
    } else {
      await this.oneBot.stop().catch((error) => this.host?.log.warn('[companion] QQ 停止失败', String(error)));
    }
  }

  private async tick(force: boolean): Promise<void> {
    if (this.stopped && !force) return;
    if (this.tickRunning) return;
    this.tickRunning = true;
    try {
      await this.syncQqChannel();
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
      void this.maybeBiliSelfWatch(now);
      void this.pollBiliNotices(now);
      void this.remindPendingQqMedia(now);
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
    if (this.proactiveMode() === 'utility') {
      const decision = this.decideProactive(
        { key: `intent:${intention.key}`, text: intention.text, salience: intention.salience, source: 'contact' },
        now,
        { busy: false, minutesSinceUser: null },
      );
      if (!decision.ok) {
        this.mind('review', `念头暂缓：${decision.reason}`, {
          score: decision.score,
          code: decision.code,
          ...(decision.benefit !== undefined ? { benefit: decision.benefit } : {}),
          ...(decision.cost !== undefined ? { cost: decision.cost } : {}),
        });
        return { ok: false, reason: decision.reason };
      }
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
      if (tool.name === 'onebot_call') {
        const sent = onebotSendText(args);
        if (sent) out.push(sent);
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
      if (await this.maybeIdleScreenProbe(now)) return true;
      if (!this.state.pendingTrigger && await this.maybeHeartbeat(now)) return true;
      return await this.maybeProactiveInner(now);
    } finally {
      this.proactiveInFlight = false;
    }
  }

  /** 实验性低优先心跳：没有明确由头时，按小时级概率补一次；默认关闭。 */
  private async maybeHeartbeat(now: Date): Promise<boolean> {
    const cfg = this.cfg();
    if (!cfg.heartbeatEnabled || !cfg.proactiveEnabled || !this.host) return false;
    if (this.state.pendingTrigger) return false;
    const lastUserAt = this.probeLastUser(now.getTime());
    if (lastUserAt === null) return false;
    const minIdle = Math.max(30, Math.min(1440, Number(cfg.heartbeatMinIdleMinutes) || 120));
    if (now.getTime() - lastUserAt < minIdle * 60_000) return false;
    const p = localParts(now, this.tz());
    if (this.state.sleeping || inWindow(p.minutes, cfg.quietStart, cfg.quietEnd)) return false;
    const cap = Number(cfg.proactiveDailyCap) || 0;
    if (cap > 0 && this.countToday() >= cap) return false;
    const last = Date.parse(this.state.lastHeartbeatAt ?? '');
    // 一小时最多掷一次骰子；失败也落时间，避免每个 tick 反复随机。
    if (Number.isFinite(last) && now.getTime() - last < 3_600_000) return false;
    this.state.lastHeartbeatAt = now.toISOString();
    this.save(true);
    const chance = Math.max(1, Math.min(50, Number(cfg.heartbeatChancePercent) || 8));
    if (Math.random() * 100 >= chance) return false;
    this.wakeReason = '忽然想看看你在不在';
    const pushed = await this.push('companion.proactive', '忽然想看看你在不在。', 'flush');
    if (!pushed?.delivered) return false;
    this.state.proactiveCount += 1;
    this.state.proactiveDay = p.date;
    this.state.lastProactiveAt = now.toISOString();
    this.state.lastProactiveReason = '低优先心跳';
    this.state.proactiveDueAt = null;
    this.save(true);
    this.mind('proactive', '低优先心跳：忽然想看看你在不在', {
      source: 'heartbeat',
      chance,
      idleMinutes: Math.round((now.getTime() - lastUserAt) / 60_000),
    });
    return true;
  }

  /** 用户持续沉默时独立看一次桌面；同一轮用户消息只触发一次，失败也不重试，避免循环。 */
  private async maybeIdleScreenProbe(now: Date): Promise<boolean> {
    const cfg = this.cfg();
    if (!cfg.screenEnabled || !cfg.proactiveEnabled) return false;
    const lastUserAt = this.probeLastUser(now.getTime());
    if (lastUserAt === null) return false;
    const afterMinutes = Math.max(1, Math.min(240, Number(cfg.screenProbeAfterMinutes) || 10));
    if (now.getTime() - lastUserAt < afterMinutes * 60_000) return false;
    const p = localParts(now, this.tz());
    if (this.state.sleeping || inWindow(p.minutes, cfg.quietStart, cfg.quietEnd)) return false;
    const userIso = new Date(lastUserAt).toISOString();
    if (this.state.lastScreenProbeUserAt === userIso) return false;
    // 先落状态再截屏：即使截屏失败或模型不支持图片，也不会在同一段沉默里反复尝试。
    this.state.lastScreenProbeAt = now.toISOString();
    this.state.lastScreenProbeUserAt = userIso;
    this.save(true);
    let accepts = false;
    try { accepts = this.host?.modelFacts.accepts('image/png') === true; } catch { accepts = false; }
    if (!accepts) return false;
    const idleLimit = Math.max(30, Number(cfg.screenProbeIdleLimitSeconds) || 120);
    const idleSeconds = this.screenIdleSeconds();
    if (idleSeconds !== null && idleSeconds > idleLimit) return false;
    const path = this.captureScreenFile();
    if (!path || !imageHasContent(path)) return false;
    let bytes: Uint8Array;
    try { bytes = readFileSync(path); } catch { return false; }
    this.wakeReason = '看看他有没有在电脑前';
    this.mind('trigger', '用户很久没回，自动看一次桌面', {
      source: 'screen',
      salience: Number(cfg.screenProbeSalience) || 0.7,
      afterMinutes,
    });
    const pushed = await this.push(
      'companion.proactive',
      '他没有回你的消息。这是现在的电脑桌面，先看看他在不在。',
      'flush',
      [{ bytes, mime: 'image/png', name: 'desktop.png', fallbackText: '[当前电脑桌面]' }],
    );
    if (!pushed?.delivered) return false;
    this.state.proactiveCount += 1;
    this.state.proactiveDay = p.date;
    this.state.lastProactiveAt = now.toISOString();
    this.state.lastProactiveReason = '自动查看桌面：他很久没回消息';
    this.state.proactiveDueAt = null;
    this.save(true);
    return true;
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
    // 身体触发是“她自己的事”，不该被社交打扰成本拦住：低精力直接去休息。
    if (trigger.key === 'body:low-energy') {
      this.state.activity = '打盹';
      this.state.location = '床';
      this.state.restUntil = new Date(now.getTime() + 30 * 60_000).toISOString();
      this.mind('action', '精力太低，先去休息而不是找人', { action: 'rest', trigger: trigger.key });
      this.snapshot?.invalidate();
      this.state.pendingTrigger = null;
      this.state.proactiveDueAt = null;
      this.save(true);
      return true;
    }
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
    const decision = this.decideProactive(candidate, now, {
      busy,
      minutesSinceUser: sinceTalkMs === null ? null : sinceTalkMs / 60_000,
    });
    const score = decision.score;
    this.state.lastProactiveDecision = {
      at: now.toISOString(),
      mode: decision.mode,
      code: decision.code,
      score: decision.score,
      benefit: decision.benefit ?? 0,
      cost: decision.cost ?? 0,
      threshold: decision.threshold ?? (decision.mode === 'gate' ? 0.55 : 0.12),
      source: candidate.source,
      reason: decision.reason,
      terms: decision.terms ?? [],
    };
    this.mind('candidate', `${decision.ok ? '保留' : '暂缓'}：${reason}`, {
      score,
      action: 'contact',
      source: candidate.source,
      mode: decision.mode,
      code: decision.code,
      ...(decision.benefit !== undefined ? { benefit: decision.benefit } : {}),
      ...(decision.cost !== undefined ? { cost: decision.cost } : {}),
      ...(busy ? { gate: 'busy' } : {}),
    });
    const clear = () => {
      this.state.pendingTrigger = null;
      this.state.proactiveDueAt = null;
    };
    if (!decision.ok) {
      this.mind('review', decision.reason, {
        score,
        code: decision.code,
        ...(decision.benefit !== undefined ? { benefit: decision.benefit } : {}),
        ...(decision.cost !== undefined ? { cost: decision.cost } : {}),
        ...(decision.code === 'unanswered' ? { unanswered: this.state.cognitionUnanswered } : {}),
      });
      // 未回应是“等她回来再评估”，不清 pending；其余暂缓直接清掉，等下一个触发。
      if (decision.code !== 'unanswered') {
        clear();
        this.save(true);
      }
      return false;
    }
    // 低精力分支已提前到决策之前，避免“刚聊完”的打扰成本阻止她休息。

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

  /**
   * 开口决策的唯一入口：
   * - gate：0.4.x 旧闸门（显著性 + 来源权重 − 惩罚，阈值 0.55，忙/未回应/重复硬拦）；
   * - shadow：照旧行为，只把效用模型的结果写进日志，用来对照；
   * - utility：由头值 − 打扰成本 ≥ 阈值（默认 0.12，黏人度 1.3），忙只加成本。
   */
  private proactiveMode(): 'gate' | 'shadow' | 'utility' {
    const raw = this.cfg().proactiveDecision;
    if (raw === '固定阈值' || raw === 'gate') return 'gate';
    if (raw === '只记录' || raw === 'shadow') return 'shadow';
    return 'utility';
  }

  private decideProactive(
    candidate: { key: string; text: string; salience: number; source: string },
    now: Date,
    input: { busy: boolean; minutesSinceUser: number | null },
  ): {
    ok: boolean; score: number; reason: string; code: string;
    mode: 'gate' | 'shadow' | 'utility'; benefit?: number; cost?: number;
    threshold?: number; terms?: Array<{ label: string; value: number }>;
  } {
    const cfg = this.cfg();
    const mode = this.proactiveMode();
    const unanswered = this.state.cognitionUnanswered ?? 0;
    const repeated = isDuplicateSent(candidate.text, this.state.sentTexts ?? [], now.getTime());
    const lastProactive = Date.parse(this.state.lastProactiveAt ?? '');
    const hoursSinceProactive = Number.isFinite(lastProactive)
      ? (now.getTime() - lastProactive) / 3_600_000
      : null;
    const closeness = this.memoryStore.people()[0]?.details?.closeness;
    // 记忆类由头（话头 / 旧事 / 承诺）值得打断：绕过“刚聊过”的成本。
    const bypassRecentChat = ['memory', 'thread', 'promise'].includes(candidate.source);
    const utility = computeUtility({
      source: candidate.source,
      salience: candidate.salience,
      busy: input.busy,
      minutesSinceUser: input.minutesSinceUser,
      hoursSinceProactive,
      unanswered,
      repeated,
      closeness: typeof closeness === 'number' ? closeness : 0.7,
      clinginess: cfg.proactiveClinginess,
      bypassRecentChat,
    });
    const gateScore = scoreThought(candidate, { unanswered, busy: input.busy });
    const gateOk = !input.busy && !repeated && unanswered < 2 && gateScore >= 0.55;
    const gateReason = input.busy ? '当前日程繁忙'
      : repeated ? '最近说过相似的话'
        : unanswered >= 2 ? '连续未回应，先不打扰；24 小时后再评估'
          : `候选价值不足（${gateScore}），先不联系`;

    if (mode === 'gate') {
      return {
        ok: gateOk,
        score: gateScore,
        reason: gateOk ? '旧闸门放行' : gateReason,
        code: gateOk ? 'send' : input.busy ? 'busy' : repeated ? 'duplicate' : unanswered >= 2 ? 'unanswered' : 'low-value',
        mode,
        threshold: 0.55,
        terms: [],
      };
    }
    if (mode === 'shadow') {
      return {
        ok: gateOk,
        score: utility.score,
        reason: `[shadow] 效用${utility.ok ? '会放行' : '会拦住'}（${utility.reason}）；${gateOk ? '旧闸门放行' : `旧闸门拦住：${gateReason}`}`,
        code: utility.code,
        mode,
        benefit: utility.benefit,
        cost: utility.cost,
        threshold: utility.threshold,
        terms: utility.terms,
      };
    }
    return {
      ok: utility.ok,
      score: utility.score,
      reason: utility.reason,
      code: utility.code,
      mode,
      benefit: utility.benefit,
      cost: utility.cost,
      threshold: utility.threshold,
      terms: utility.terms,
    };
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

  private readonly localMediaCaptions = new Map<string, Promise<string>>();

  private async localMediaMeaning(record: MediaRecord): Promise<string> {
    if (record.meaning) return record.meaning;
    if (!this.cfg().preferLocalMediaVision) return '';
    const pending = this.localMediaCaptions.get(record.hash);
    if (pending) return pending;
    const caption = this.captionMediaFile(record.path, record.mime === 'image/gif').then(({ text }) => {
      const current = this.oneBot.mediaGet(record.hash);
      if (!current || current.meaning) return current?.meaning || '';
      return text ? this.oneBot.mediaNote(record.hash, text)?.meaning || '' : '';
    }).finally(() => this.localMediaCaptions.delete(record.hash));
    this.localMediaCaptions.set(record.hash, caption);
    return caption;
  }

  private async remindPendingQqMedia(now: Date): Promise<void> {
    if (!this.host || !this.cfg().qqChannelEnabled) return;
    if (now.getTime() - this.lastMediaReminderAt < 30 * 60_000) return;
    const pending = this.oneBot.mediaPendingMeaning(3);
    if (!pending.length) return;
    this.lastMediaReminderAt = now.getTime();
    const blobs: Array<{ bytes: Uint8Array; mime: string; name: string; fallbackText: string }> = [];
    const keys: string[] = [];
    for (const record of pending) {
      if (await this.localMediaMeaning(record)) continue;
      const bytes = this.oneBot.mediaRead(record);
      if (!bytes) continue;
      const ext = record.mime.split('/')[1] || 'img';
      blobs.push({ bytes, mime: record.mime, name: `qq-image-${record.hash.slice(0, 8)}.${ext}`, fallbackText: `[待记含义的图片 ${record.hash.slice(0, 8)}]` });
      keys.push(record.hash.slice(0, 8));
      this.oneBot.mediaMarkReminded(record);
    }
    if (!blobs.length) return;
    void this.host.pushEvent({
      type: 'companion.media', ts: now.toISOString(), source: this.id, origin: 'internal',
      senderKey: 'companion.media',
      text: `[图片补记] 这几张图之前看过但还没记含义：${keys.join('、')}。看完直接用 qq_media_note 补一句；记不得就说记不得，不要猜。`,
      blobs,
      meta: { kind: 'companion.media', keys },
    }, { trigger: 'debounce' }).catch((error) => {
      this.host?.log.warn('[companion] 图片补记提醒投递失败', String(error));
    });
  }

  private async handleQqMessage(message: {
    at: string; nickname: string; text: string; messageType: 'private' | 'group';
    userId: string; groupId: string; messageId: string; imageFiles: string[]; imageKeys: string[];
    files: string[]; voices: string[]; filePaths: string[]; voicePaths: string[]; quote: string; voiceText?: string;
  }): Promise<void> {
    if (!this.cfg().qqChannelEnabled) return;
    if (message.voicePaths?.length && this.cfg().qqTranscribeVoice) {
      const heard = await this.voice.transcribe(message.voicePaths[0]!);
      message.voiceText = heard.text || '';
      if (heard.error) this.mind('error', `语音转写失败：${heard.error}`, { kind: 'stt' });
    }
    const selfId = this.oneBot.status().selfId;
    const mentioned = Boolean(selfId && message.text.includes(`@${selfId}`));
    const wake = message.messageType === 'private' || mentioned;
    if (wake) {
      this.lastUserAt = Date.now();
      this.lastUserProbe = 0;
    }
    this.state.lastTalkAt = message.at;
    const kind = message.messageType === 'group' ? '群' : '私聊';
    const peer = message.messageType === 'group' ? message.groupId : message.userId;
    const imageNotes: string[] = [];
    const imageBlobs: Array<{ bytes: Uint8Array; mime: string; name: string; fallbackText: string }> = [];
    for (const key of message.imageKeys) {
      const record = this.oneBot.mediaGet(key);
      if (!record) { imageNotes.push(key.slice(0, 8)); continue; }
      const meaning = await this.localMediaMeaning(record);
      if (meaning) { imageNotes.push(`${key.slice(0, 8)}=${meaning}`); continue; }
      if (record.viewedAt) { imageNotes.push(`${key.slice(0, 8)}（看过未记含义）`); continue; }
      const bytes = this.oneBot.mediaRead(record);
      if (!bytes) { imageNotes.push(key.slice(0, 8)); continue; }
      const ext = record.mime.split('/')[1] || 'img';
      imageBlobs.push({ bytes, mime: record.mime, name: `qq-image-${key.slice(0, 8)}.${ext}`, fallbackText: `[图片 ${key.slice(0, 8)}]` });
      this.oneBot.mediaMarkSeen(record);
      imageNotes.push(`${key.slice(0, 8)}（看完先 qq_media_note 记含义）`);
    }
    const imageInfo = imageNotes.join(', ');
    const extras = [
      message.quote ? `[引用 ${message.quote}]` : '',
      imageInfo ? `（图 ${imageInfo}）` : '',
      message.filePaths?.length ? `（文件 ${message.filePaths.length}）` : '',
      message.voicePaths?.length ? `（语音 ${message.voicePaths.length}${message.voiceText ? `，转写：${message.voiceText}` : '，未识别'}）` : '',
    ].filter(Boolean).join('');
    const spoken = message.text || message.voiceText || '';
    const text = `[QQ ${kind}] ${message.nickname}：${spoken || '[空消息]'}${extras}`;
    if (message.messageType === 'group' && !mentioned && !this.state.pendingTrigger) {
      // 群里没有点她：不直接唤醒主 session，交给 utility 决定要不要接一句。
      const at = message.at;
      const key = `qq:group:${message.groupId}:${message.messageId}`;
      this.state.pendingTrigger = {
        key,
        reason: `QQ 群里 ${message.nickname} 说：${(spoken || '[空消息]').slice(0, 80)}`,
        source: 'qq',
        salience: 0.55,
        at,
      };
      this.state.triggerSeen = Object.fromEntries(
        Object.entries({ ...(this.state.triggerSeen ?? {}), [key]: at })
          .filter(([, ts]) => Date.parse(ts) > Date.now() - 7 * 86_400_000)
          .slice(-100),
      );
      this.state.proactiveDueAt = null;
      this.mind('trigger', `QQ 群触发：${message.nickname}`, { trigger: key, source: 'qq', salience: 0.55 });
    }
    if (this.host) {
      // 私聊/被 @：直接交给主 session；普通群聊只归档，由 utility 的 pendingTrigger 决定。
      void this.host.pushEvent({
        type: 'qq.message',
        ts: message.at,
        source: 'qq',
        origin: 'external',
        senderKey: message.userId,
        text,
        meta: {
          kind: 'qq.message', messageType: message.messageType, groupId: message.groupId,
          userId: message.userId, messageId: message.messageId, imageKeys: message.imageKeys,
          quote: message.quote,
        },
        ...(imageBlobs.length ? { blobs: imageBlobs } : {}),
      }, { trigger: wake ? 'flush' : 'piggyback', deliver: wake }).catch((error) => {
        this.host?.log.warn('[companion] QQ 事件投递失败', String(error));
      });
    } else if (this.cfg().memoryEnabled && this.cfg().memoryCapture) {
      // 没有 host（单测/离线）时至少保留原始事件；有 host 时 captureIncoming 会统一写入，避免重复。
      this.memoryStore.appendEvent({ text, ts: message.at, source: 'qq', scope: `qq:${message.messageType}:${peer}` });
    }
    this.save(false);
  }

  private async toolBiliSearch(args: Record<string, unknown>): Promise<string> {
    if (!this.cfg().biliChannelEnabled) return 'B站通道未启用（可选功能，默认关闭）。';
    const keyword = trimText(args.keyword, 100);
    if (!keyword) return 'bili_search 需要 keyword。';
    const hits = await this.bili.search(keyword, Number(args.limit) || 5);
    if (!hits.length) return `B站没有搜到「${keyword}」。`;
    return hits.map((hit, index) => `${index + 1}. ${hit.bvid}｜${hit.title}｜${hit.author}｜${hit.duration}`).join('\n');
  }

  private async toolBiliInfo(args: Record<string, unknown>): Promise<string> {
    if (!this.cfg().biliChannelEnabled) return 'B站通道未启用（可选功能，默认关闭）。';
    const bvid = trimText(args.bvid, 30);
    if (!bvid) return 'bili_info 需要 bvid。';
    const info = await this.bili.info(bvid);
    return [
      `${info.title}（${info.bvid}）`,
      `UP：${info.owner}`,
      `时长：${Math.floor(info.duration / 60)}:${String(info.duration % 60).padStart(2, '0')}`,
      `播放：${info.play}`,
      info.desc ? `简介：${info.desc.slice(0, 300)}` : '',
    ].filter(Boolean).join('\n');
  }

  private async togetherOpen(input: string): Promise<Record<string, unknown>> {
    const value = input.trim();
    let url = value || 'https://www.bilibili.com/';
    let bvid = '';
    const bv = value.match(/(BV[0-9A-Za-z]{10})/);
    if (bv) bvid = bv[1];
    if (value && !/^https?:\/\//i.test(value)) {
      if (!bvid) throw new Error('需要合法的 BV 号');
      url = `https://www.bilibili.com/video/${bvid}`;
    }
    const parsed = new URL(url);
    if (!/(^|\.)bilibili\.com$/i.test(parsed.hostname)) throw new Error('一起看只允许 B站链接');
    this.togetherBvid = bvid;
    await this.together.open(url);
    this.startTogetherObserver();
    return { ...(await this.together.status()), bvid } as unknown as Record<string, unknown>;
  }

  private async togetherAuto(query = ''): Promise<Record<string, unknown>> {
    if (this.togetherAutoBusy) throw new Error('一起看正在打开，请稍等');
    this.togetherAutoBusy = true;
    try {
    const wanted = query.trim();
    const maxSec = Math.max(1, Number(this.cfg().biliMaxVideoMinutes) || 30) * 60;
    const minSec = Math.max(0, Number(this.cfg().biliSelfWatchMinMinutes) || 0) * 60;
    const fits = (duration: number): boolean => !duration || (duration >= minSec && duration <= maxSec);
    let candidate: { bvid: string; title: string } | null = null;
    if (wanted) {
      const hits = await this.bili.search(wanted, 8).catch(() => []);
      const first = hits.find((item) => fits(item.duration));
      if (first) candidate = { bvid: first.bvid, title: first.title };
    } else {
      const history = await this.bili.history(8).catch(() => []);
      const first = history.find((item) => item.bvid && fits(item.duration));
      if (first) candidate = { bvid: first.bvid, title: first.title };
      if (!candidate) {
        const popular = await this.bili.popular(8).catch(() => []);
        const firstPopular = popular.find((item) => fits(item.duration));
        if (firstPopular) candidate = { bvid: firstPopular.bvid, title: firstPopular.title };
      }
    }
    if (!candidate) throw new Error(wanted ? `没有搜到「${wanted}」的合适视频` : '没有合适的视频');
    await this.togetherOpen(candidate.bvid);
    const status = await this.togetherControl('play');
    return { ...status, bvid: candidate.bvid, title: candidate.title };
    } finally {
      this.togetherAutoBusy = false;
    }
  }

  private async togetherControl(action: string, seconds = 0): Promise<Record<string, unknown>> {
    const status = await this.together.control(action, seconds);
    if (action === 'play' && this.togetherBvid) {
      const seen = this.biliWatch.find({ bvid: this.togetherBvid, title: status.title });
      if (!seen) this.biliWatch.record({ at: new Date().toISOString(), bvid: this.togetherBvid, title: status.title || this.togetherBvid, via: 'browser' });
      this.startTogetherObserver();
    }
    return status as unknown as Record<string, unknown>;
  }

  private clearTogetherSamples(): void {
    for (const path of this.togetherSamples) {
      if (path !== this.lastTogetherFrame) {
        try { unlinkSync(path); } catch { /* ignore */ }
      }
    }
    this.togetherSamples = [];
  }

  private startTogetherObserver(): void {
    if (!this.cfg().biliChannelEnabled) return;
    if (this.togetherObserveTimer) clearInterval(this.togetherObserveTimer);
    this.togetherObserveInFlight = false;
    this.lastTogetherObserveAt = 0;
    this.togetherSamples = [];
    const captureMs = Math.max(300, Math.round((Number(this.cfg().biliCaptureIntervalSec) || 0.8) * 1000));
    this.togetherObserveTimer = setInterval(() => { void this.captureTogetherObservation(); }, captureMs);
    this.togetherObserveTimer.unref?.();
  }

  private stopTogetherObserver(): void {
    if (this.togetherObserveTimer) clearInterval(this.togetherObserveTimer);
    this.togetherObserveTimer = null;
    this.togetherObserveInFlight = false;
    this.clearTogetherSamples();
  }

  private async captureTogetherObservation(): Promise<void> {
    if (!this.host || this.togetherObserveInFlight) return;
    this.togetherObserveInFlight = true;
    try {
      const status = await this.together.status();
      if (!status.open || status.paused) {
        this.clearTogetherSamples();
        return;
      }
      const frame = await this.togetherFrame();
      const every = Math.max(2_000, Math.round((Number(this.cfg().biliObserveIntervalSec) || 5) * 1000));
      this.togetherSamples.push(frame.path);
      if (this.togetherSamples.length > 9) {
        for (const old of this.togetherSamples.slice(0, -9)) { try { unlinkSync(old); } catch { /* ignore */ } }
        this.togetherSamples = this.togetherSamples.slice(-9);
      }
      if (Date.now() - this.lastTogetherObserveAt < every) return;
      const cells = Math.max(2, Math.min(9, Math.floor(Number(this.cfg().biliObserveCells) || 4)));
      let chosen = this.togetherSamples.slice(-cells);
      if (chosen.length < 2) return;
      // montage 的每一行必须等宽：奇数张时丢掉最早的一张，3 张用一行。
      if (chosen.length > 3) chosen = chosen.slice(-(chosen.length - (chosen.length % 2)));
      const cols = chosen.length === 3 ? 3 : chosen.length <= 2 ? chosen.length : 2;
      const rows = Math.ceil(chosen.length / cols);
      const dir = join(this.dataDir, 'bili', 'together', 'observations');
      mkdirSync(dir, { recursive: true });
      const montage = join(dir, `observe-${Date.now()}.jpg`);
      if (!montageImages(chosen, montage, cols, rows)) { this.clearTogetherSamples(); return; }
      const bytes = readFileSync(montage);
      this.lastTogetherMontage = montage;
      this.lastTogetherMontageAt = new Date().toISOString();
      this.lastTogetherMontageTitle = status.title || this.togetherBvid || 'B站视频';
      this.lastTogetherMontageCells = chosen.length;
      this.lastTogetherObserveAt = Date.now();
      for (const old of this.togetherSamples) {
        if (old !== this.lastTogetherFrame) { try { unlinkSync(old); } catch { /* ignore */ } }
      }
      this.togetherSamples = [];
      let accepts = false;
      try { accepts = this.host.modelFacts.accepts('image/jpeg') === true; } catch { accepts = false; }
      void this.host.pushEvent({
        type: 'bili.together.frame', ts: new Date().toISOString(), source: 'bilibili', origin: 'external', senderKey: 'bili.together',
        text: `[一起看 · 观察] ${status.title || this.togetherBvid || 'B站视频'} ${Math.floor(status.time)}/${Math.floor(status.duration)} 秒；${Math.round(every / 1000)} 秒图集（每 ${Number(this.cfg().biliCaptureIntervalSec) || 0.8} 秒采样，${chosen.length} 格）。`,
        meta: { kind: 'bili.together.frame', bvid: this.togetherBvid, title: status.title, time: status.time, path: montage, cells: chosen.length },
        ...(accepts ? { blobs: [{ bytes, mime: 'image/jpeg', name: 'together-observation.jpg', fallbackText: '[一起看观察图集]' }] } : {}),
      }, { trigger: 'debounce' }).catch((error) => {
        this.host?.log.warn('[companion] 一起看观察帧投递失败', String(error));
      });
    } catch (error) {
      this.host?.log.warn('[companion] 一起看自动截图失败', String(error));
    } finally {
      this.togetherObserveInFlight = false;
    }
  }

  private async togetherFrame(): Promise<{ path: string; status: TogetherStatus; bytes: Uint8Array }> {
    const dir = join(this.dataDir, 'bili', 'together', 'frames');
    const path = join(dir, `frame-${Date.now()}.jpg`);
    const shot = await this.together.frame(path);
    this.lastTogetherFrame = shot.path;
    return { ...shot, status: await this.together.status() };
  }

  private biliShareFile(): string {
    return join(this.dataDir, 'bili', 'share-state.json');
  }

  private biliShareCount(): { day: string; count: number } {
    const day = new Date().toISOString().slice(0, 10);
    try {
      const saved = JSON.parse(readFileSync(this.biliShareFile(), 'utf8')) as Record<string, unknown>;
      return saved.day === day ? { day, count: Number(saved.count || 0) } : { day, count: 0 };
    } catch {
      return { day, count: 0 };
    }
  }

  private async toolBiliCommentReply(args: Record<string, unknown>): Promise<string> {
    if (!this.cfg().biliChannelEnabled) return 'B站通道未启用（可选功能，默认关闭）。';
    if (!this.cfg().biliReplyEnabled) return 'B站评论回复未开启（worlds.companion.biliReplyEnabled=false）。';
    if (args.confirm !== true) return '发评论会改外部状态，需要 confirm=true。';
    const bvid = trimText(args.bvid, 30);
    const text = trimText(args.text, 500);
    if (!bvid || !text) return 'bili_comment_reply 需要 bvid 和 text。';
    const mentionOwner = args.mention_owner === true;
    if (mentionOwner && !this.biliOwnerUid) return '没有主人 UID，不能保证 @；先填 worlds.companion.biliOwnerUid。';
    const state = this.biliShareCount();
    const limit = Math.max(1, Math.min(20, Number(this.cfg().biliDailyComments) || 3));
    if (state.count >= limit) return `今天评论额度用完了（${limit} 次）。`;
    try {
      const result = await this.bili.comment(bvid, text, {
        root: Number(args.root) || undefined,
        parent: Number(args.parent) || undefined,
        mentionUid: this.biliOwnerUid,
        mentionOwner,
        imagePath: trimText(args.image, 500) || undefined,
      });
      if (!result.ok) return `评论失败：${result.message}`;
      mkdirSync(join(this.dataDir, 'bili'), { recursive: true });
      writeFileSync(this.biliShareFile(), JSON.stringify({ day: state.day, count: state.count + 1 }), 'utf8');
      return `${result.message}${result.rpid ? `（rpid ${result.rpid}）` : ''}${result.imageUploaded ? '（带图）' : result.imageError ? `（图片没传上去：${result.imageError}）` : ''}${result.mentioned === false ? '；@ 没被服务端识别' : ''}`;
    } catch (error) {
      return `评论失败：${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async toolBiliProfile(): Promise<string> {
    if (!this.cfg().biliChannelEnabled) return 'B站通道未启用（可选功能，默认关闭）。';
    const [account, nav] = await Promise.all([this.bili.memberAccount(), this.bili.nav().catch(() => null)]);
    return `昵称：${account.uname}；签名：${account.sign || '（空）'}；头像：${account.face || nav?.face || '未知'}`;
  }

  private async toolBiliUpdateProfile(args: Record<string, unknown>): Promise<string> {
    if (!this.cfg().biliChannelEnabled) return 'B站通道未启用（可选功能，默认关闭）。';
    if (!this.cfg().biliInteractEnabled) return 'B站账号动作未开启（worlds.companion.biliInteractEnabled=false）。';
    if (args.confirm !== true) return '改资料会写外部状态，需要 confirm=true。';
    const signature = typeof args.signature === 'string' ? args.signature : '';
    const avatar = trimText(args.avatar, 500);
    if (!signature && !avatar) return '至少给 signature 或 avatar。';
    const results: string[] = [];
    if (signature) {
      const r = await this.bili.updateSignature(signature);
      results.push(r.ok ? r.message : `签名失败：${r.message}`);
    }
    if (avatar) {
      const r = await this.bili.updateFace(avatar);
      results.push(r.ok ? r.message : `头像失败：${r.message}`);
    }
    return results.join('；');
  }

  private async toolBiliAct(args: Record<string, unknown>): Promise<string> {
    if (!this.cfg().biliChannelEnabled) return 'B站通道未启用（可选功能，默认关闭）。';
    if (!this.cfg().biliInteractEnabled) return 'B站账号动作未开启（worlds.companion.biliInteractEnabled=false）。';
    const action = trimText(args.action, 30);
    const bvid = trimText(args.bvid, 30);
    const text = trimText(args.text, 300);
    try {
      if (action === 'like' || action === 'unlike') {
        if (!bvid) return 'like 需要 bvid。';
        const r = await this.bili.like(bvid, action === 'like');
        return r.ok ? r.message : `失败：${r.message}`;
      }
      if (action === 'coin') {
        if (!bvid) return 'coin 需要 bvid。';
        const r = await this.bili.coin(bvid, Number(args.count) || 1);
        return r.ok ? r.message : `失败：${r.message}`;
      }
      if (action === 'favorite' || action === 'unfavorite') {
        if (!bvid) return 'favorite 需要 bvid。';
        const r = await this.bili.favorite(bvid, action === 'favorite');
        return r.ok ? r.message : `失败：${r.message}`;
      }
      if (action === 'follow' || action === 'unfollow') {
        if (!bvid) return 'follow 需要 bvid。';
        const r = await this.bili.follow(bvid, action === 'follow');
        return r.ok ? r.message : `失败：${r.message}`;
      }
      if (action === 'share') {
        if (!bvid) return 'share 需要 bvid。';
        const r = await this.bili.share(bvid);
        return r.ok ? r.message : `失败：${r.message}`;
      }
      if (action === 'watch_later') {
        if (!bvid) return 'watch_later 需要 bvid。';
        const r = await this.bili.watchLater(bvid);
        return r.ok ? r.message : `失败：${r.message}`;
      }
      if (action === 'danmaku') {
        if (!bvid || !text) return 'danmaku 需要 bvid 和 text。';
        const r = await this.bili.danmaku(bvid, text, Number(args.seconds) || 1);
        return r.ok ? r.message : `失败：${r.message}`;
      }
      if (action === 'comment_like' || action === 'comment_unlike') {
        if (!bvid || !Number(args.rpid)) return '需要 bvid 和 rpid。';
        const r = await this.bili.commentAction(bvid, Number(args.rpid), action === 'comment_like');
        return r.ok ? r.message : `失败：${r.message}`;
      }
      if (action === 'comment_delete') {
        if (!bvid || !Number(args.rpid)) return '需要 bvid 和 rpid。';
        const r = await this.bili.deleteComment(bvid, Number(args.rpid));
        return r.ok ? r.message : `失败：${r.message}`;
      }
      if (action === 'dm_owner') {
        if (!this.biliOwnerUid) return '没有主人 UID，不能私信主人。';
        const payload = `${text}${bvid ? `${text ? ' ' : ''}https://www.bilibili.com/video/${bvid}` : ''}`.trim();
        if (!payload) return 'dm_owner 需要 text 或 bvid。';
        const r = await this.bili.dmSend(Number(this.biliOwnerUid), payload);
        return r.ok ? r.message : `失败：${r.message}`;
      }
      return `未知动作：${action}`;
    } catch (error) {
      return `动作失败：${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async toolBiliDmReply(args: Record<string, unknown>): Promise<string> {
    if (!this.cfg().biliChannelEnabled) return 'B站通道未启用（可选功能，默认关闭）。';
    if (!this.cfg().biliReplyEnabled) return 'B站私信回复未开启（worlds.companion.biliReplyEnabled=false）。';
    if (args.confirm !== true) return '发私信会改外部状态，需要 confirm=true。';
    const talkerId = Number(args.talker_id) || 0;
    const text = trimText(args.text, 300);
    if (!talkerId || !text) return 'bili_dm_reply 需要 talker_id 和 text。';
    try {
      const result = await this.bili.dmSend(talkerId, text);
      return result.ok ? result.message : `私信失败：${result.message}`;
    } catch (error) {
      return `私信失败：${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async toolBiliTogetherShare(args: Record<string, unknown>): Promise<string> {
    if (!this.cfg().biliChannelEnabled) return 'B站通道未启用（可选功能，默认关闭）。';
    if (!this.togetherBvid) return '还没有一起看的视频。';
    if (!this.lastTogetherFrame) {
      try { await this.togetherFrame(); } catch (error) { return `截帧失败：${error instanceof Error ? error.message : String(error)}`; }
    }
    return this.toolBiliCommentReply({
      bvid: this.togetherBvid,
      text: trimText(args.text, 300) || '这一帧给你看。',
      image: this.lastTogetherFrame,
      mention_owner: args.mention_owner === true,
      confirm: true,
    });
  }

  private async toolBiliTogetherOpen(args: Record<string, unknown>): Promise<string> {
    if (!this.cfg().biliChannelEnabled) return 'B站通道未启用（可选功能，默认关闭）。';
    try {
      const input = trimText(args.bvid, 30) || trimText(args.url, 300);
      const status = await this.togetherOpen(input);
      return `一起看已打开：${status.title || status.url || input}。`;
    } catch (error) {
      return `打开失败：${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async toolBiliTogetherAuto(args: Record<string, unknown>): Promise<string> {
    if (!this.cfg().biliChannelEnabled) return 'B站通道未启用（可选功能，默认关闭）。';
    try {
      const status = await this.togetherAuto(trimText(args.query, 100));
      return `一起看：${status.title || status.bvid || '已打开'}，正在播放。`;
    } catch (error) {
      return `自动找视频失败：${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async toolBiliTogetherControl(args: Record<string, unknown>): Promise<string> {
    if (!this.cfg().biliChannelEnabled) return 'B站通道未启用（可选功能，默认关闭）。';
    const action = trimText(args.action, 20);
    if (!['play', 'pause', 'seek', 'status'].includes(action)) return 'action 只能是 play/pause/seek/status。';
    try {
      const status = await this.togetherControl(action, Number(args.seconds) || 0);
      return `一起看：${action}；${status.title || ''} ${Math.floor(Number(status.time) || 0)}/${Math.floor(Number(status.duration) || 0)} 秒${status.paused ? '（暂停）' : '（播放中）'}`;
    } catch (error) {
      return `控制失败：${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async toolBiliTogetherFrame(): Promise<string | ToolOutcome> {
    if (!this.cfg().biliChannelEnabled) return 'B站通道未启用（可选功能，默认关闭）。';
    try {
      const frame = await this.togetherFrame();
      let accepts = false;
      try { accepts = this.host?.modelFacts.accepts('image/png') === true; } catch { accepts = false; }
      if (accepts) return { text: `[一起看当前画面] ${frame.status.title || ''}`, blobs: [{ bytes: frame.bytes, mime: 'image/png', name: 'together-frame.png', fallbackText: '[一起看画面]' }] };
      return `已截图：${frame.path}`;
    } catch (error) {
      return `截图失败：${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async toolBiliTogetherClose(): Promise<string> {
    this.stopTogetherObserver();
    await this.together.close();
    return '一起看已关闭。';
  }

  private async toolBiliFrames(args: Record<string, unknown>): Promise<string | ToolOutcome> {
    if (!this.cfg().biliChannelEnabled) return 'B站通道未启用（可选功能，默认关闭）。';
    const bvid = trimText(args.bvid, 30);
    if (!bvid) return 'bili_frames 需要 bvid。';
    const count = Math.max(1, Math.min(6, Number(args.count) || 3));
    const tmp = mkdtempSync(join(tmpdir(), 'coo-bili-'));
    try {
      const shots = await this.bili.videoShots(bvid);
      const response = await fetch(shots.imageUrl, { headers: { 'user-agent': 'Mozilla/5.0', referer: 'https://www.bilibili.com/' } });
      if (!response.ok) return `缩略图网格下载失败：HTTP ${response.status}`;
      const input = join(tmp, `${bvid}-sprite.jpg`);
      writeFileSync(input, new Uint8Array(await response.arrayBuffer()));
      const frames = cropSprite(input, shots.cols, shots.rows, shots.cellW, shots.cellH, count, `${bvid}:${Date.now()}`);
      if (!frames.length) return '没有抽到帧（ffmpeg 不可用，或缩略图网格尺寸异常）。';
      const dir = join(this.dataDir, 'bili', 'frames');
      mkdirSync(dir, { recursive: true });
      const stamp = Date.now();
      frames.forEach((frame, index) => writeFileSync(join(dir, `${bvid}-${stamp}-${index + 1}.jpg`), frame.bytes));
      let accepts = false;
      try { accepts = this.host?.modelFacts.accepts('image/jpeg') === true; } catch { accepts = false; }
      if (accepts) return { text: `[B站视频 ${bvid}，抽了 ${frames.length} 帧]`, blobs: frames };
      return `已抽 ${frames.length} 帧，保存到 ${dir}/${bvid}-${stamp}-*.jpg（当前模型不吃图）。`;
    } catch (error) {
      return `抽帧失败：${error instanceof Error ? error.message : String(error)}`;
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }

  private async pollBiliNotices(now: Date): Promise<void> {
    const cfg = this.cfg();
    if (!this.host || !cfg.biliChannelEnabled || !cfg.biliInboxPushEnabled || this.biliNoticeInFlight) return;
    const every = Math.max(1, Math.min(60, Number(cfg.biliInboxPollMinutes) || 3)) * 60_000;
    const stateFile = join(this.dataDir, 'bili', 'notices-state.json');
    let state: { at?: string; inboxSeen?: string[]; dmSeen?: Record<string, number> } = {};
    try { if (existsSync(stateFile)) state = JSON.parse(readFileSync(stateFile, 'utf8')) as typeof state; } catch { /* ignore */ }
    const lastAt = Date.parse(String(state.at || '')) || 0;
    if (Number.isFinite(lastAt) && now.getTime() - lastAt < every) return;
    this.biliNoticeInFlight = true;
    const seenInbox = new Set(Array.isArray(state.inboxSeen) ? state.inboxSeen : []);
    const dmSeen = { ...(state.dmSeen || {}) };
    try {
      const push = (type: string, text: string, meta: Record<string, unknown>) => {
        void this.host?.pushEvent({
          type, ts: new Date().toISOString(), source: 'bilibili', origin: 'external', senderKey: 'bili.inbox',
          text, meta: { ...meta, kind: 'bili.notice' },
        }, { trigger: 'debounce' }).catch((error) => {
          this.host?.log.warn('[companion] B站通知投递失败', String(error));
        });
      };
      const inbox = await this.bili.inbox(20).catch(() => []);
      for (const item of inbox) {
        const key = `${item.kind}:${item.when}:${item.text}:${item.title || ''}`;
        if (seenInbox.has(key)) continue;
        const watched = item.bvid || item.title ? this.biliWatch.find({ bvid: item.bvid, title: item.title }) : null;
        const label = item.kind === 'at' ? '@了我' : '回复了我';
        const link = item.link || (item.bvid ? `https://www.bilibili.com/video/${item.bvid}` : '');
        const text = `[B站${label}] ${item.who}${item.title ? `《${item.title}》` : ''}\n${item.text}${link ? `\n${link}` : ''}${item.rpid ? `\n（评论 rpid=${item.rpid}，root=${item.root || item.rpid}，parent=${item.parent || item.rpid}；直接回复用 bili_comment_reply bvid=${item.bvid || ''} root=${item.root || item.rpid} parent=${item.parent || item.rpid}）` : ''}${watched ? `\n（看过：${watched.at.slice(0, 10)} ${watched.bvid}《${watched.title}》）` : ''}`;
        push('bili.inbox', text, { itemKind: item.kind, bvid: item.bvid || '', title: item.title || '', who: item.who });
        seenInbox.add(key);
      }
      const sessions = await this.bili.dmSessions(10).catch(() => []);
      for (const session of sessions) {
        const previous = Number(dmSeen[String(session.talkerId)] || 0);
        if (session.unread <= 0 && session.lastAt <= previous) continue;
        const messages = await this.bili.dmMessages(session.talkerId, 20).catch(() => []);
        const incoming = messages.filter((message) => !message.mine && message.at > previous).slice(-Math.max(1, Math.min(5, session.unread || 3)));
        for (const message of incoming) {
          const watched = message.bvid || message.title ? this.biliWatch.find({ bvid: message.bvid, title: message.title }) : null;
          let text: string;
          const fromOwner = Boolean(this.biliOwnerUid && String(session.talkerId) === this.biliOwnerUid);
          const ownerLabel = fromOwner ? '主人本人' : `来访用户 ${session.name}`;
          if (message.kind === 'share-video') {
            const link = message.bvid ? `https://www.bilibili.com/video/${message.bvid}` : '';
            text = `[B站私信 · ${ownerLabel}分享 · talker_id=${session.talkerId}] ${session.name} 分享了视频《${message.title || message.text}》${message.author ? `（UP：${message.author}）` : ''}${link ? `\n${link}` : ''}${watched ? `\n（看过：${watched.at.slice(0, 10)} ${watched.bvid}《${watched.title}》；要重看带 force:true）` : ''}`;
          } else {
            text = `[B站私信 · ${ownerLabel} · talker_id=${session.talkerId}] ${session.name}：${message.text}`;
          }
          push('bili.dm', text, { talkerId: session.talkerId, at: message.at, kind: message.kind, bvid: message.bvid || '', fromOwner });
          dmSeen[String(session.talkerId)] = Math.max(previous, message.at);
        }
      }
      try {
        mkdirSync(join(this.dataDir, 'bili'), { recursive: true });
        writeFileSync(stateFile, JSON.stringify({ at: now.toISOString(), inboxSeen: [...seenInbox].slice(-300), dmSeen }), 'utf8');
      } catch { /* ignore */ }
      this.save(false);
    } catch (error) {
      this.host?.log.warn('[companion] B站通知轮询失败', String(error));
    } finally {
      this.biliNoticeInFlight = false;
    }
  }

  private biliSelfWatchConfig(): {
    enabled: boolean; everyMinutes: number; topics: string;
    textLimit: number; framesLimit: number; framesCount: number;
    minMinutes: number; maxMinutes: number;
  } {
    const cfg = this.cfg();
    const file = join(this.dataDir, 'bili', 'selfwatch-config.json');
    let local: Record<string, unknown> = {};
    try {
      if (existsSync(file)) local = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    } catch { /* fall through */ }
    const number = (value: unknown, fallback: number, min: number, max: number): number => {
      const parsed = Number(value);
      return Math.max(min, Math.min(max, Number.isFinite(parsed) ? parsed : fallback));
    };
    return {
      enabled: local.enabled === undefined ? cfg.biliSelfWatchEnabled === true : local.enabled === true,
      everyMinutes: number(local.everyMinutes ?? cfg.biliSelfWatchEveryMinutes, 180, 30, 1440),
      topics: String(local.topics ?? cfg.biliSelfWatchTopics ?? ''),
      textLimit: number(cfg.biliSelfWatchTextDailyLimit, 3, 0, 12),
      framesLimit: number(cfg.biliSelfWatchFramesDailyLimit, 1, 0, 6),
      framesCount: number(cfg.biliSelfWatchFramesCount, 6, 1, 6),
      minMinutes: number(cfg.biliSelfWatchMinMinutes, 1, 0, 120),
      maxMinutes: number(cfg.biliMaxVideoMinutes, 30, 1, 240),
    };
  }

  private async maybeBiliSelfWatch(now: Date): Promise<void> {
    const cfg = this.cfg();
    const selfWatch = this.biliSelfWatchConfig();
    if (!this.host || !cfg.biliChannelEnabled || !selfWatch.enabled || this.biliSelfWatchInFlight) return;
    if (this.state.sleeping) return;
    const every = selfWatch.everyMinutes * 60_000;
    const stateFile = join(this.dataDir, 'bili', 'self-watch-state.json');
    const day = localParts(now, this.tz()).date;
    const state: { day: string; lastAt: number; lastBvid: string; textCount: number; framesCount: number } = {
      day, lastAt: 0, lastBvid: '', textCount: 0, framesCount: 0,
    };
    try {
      if (existsSync(stateFile)) {
        const saved = JSON.parse(readFileSync(stateFile, 'utf8')) as Record<string, unknown>;
        if (String(saved.day || '') === day) {
          state.textCount = Math.max(0, Number(saved.textCount) || 0);
          state.framesCount = Math.max(0, Number(saved.framesCount) || 0);
          state.lastAt = Date.parse(String(saved.lastAt || '')) || 0;
          state.lastBvid = String(saved.bvid || '');
        }
      }
    } catch { /* ignore */ }
    if (Number.isFinite(state.lastAt) && now.getTime() - state.lastAt < every) return;
    const canSee = (() => {
      try { return this.host?.modelFacts.accepts('image/jpeg') === true; } catch { return false; }
    })();
    const textLeft = selfWatch.textLimit > 0 && state.textCount < selfWatch.textLimit;
    const framesLeft = canSee && selfWatch.framesLimit > 0 && state.framesCount < selfWatch.framesLimit;
    if (!textLeft && !framesLeft) return;
    this.biliSelfWatchInFlight = true;
    try {
      const minSec = selfWatch.minMinutes * 60;
      const maxSec = selfWatch.maxMinutes * 60;
      const fits = (duration: number): boolean => !duration || (duration >= minSec && duration <= maxSec);
      const history = await this.bili.history(10).catch(() => []);
      let candidate = history.find((item) => item.bvid !== state.lastBvid
        && fits(item.duration)
        && !this.biliWatch.find({ bvid: item.bvid, title: item.title })) || null;
      if (!candidate && selfWatch.topics.trim()) {
        const hits = await this.bili.search(selfWatch.topics.trim(), 8).catch(() => []);
        const hit = hits.find((item) => item.bvid !== state.lastBvid
          && fits(item.duration)
          && !this.biliWatch.find({ bvid: item.bvid, title: item.title }));
        if (hit) candidate = { bvid: hit.bvid, title: hit.title, author: hit.owner, progress: 0, duration: hit.duration, at: now.toISOString() };
      }
      if (!candidate) return;
      const total = state.textCount + state.framesCount;
      const useFrames = framesLeft && (!textLeft || total % 2 === 1);
      const result = await this.toolBiliWatch({ bvid: candidate.bvid, note: '', silent: useFrames });
      if (useFrames) {
        const frames = await this.toolBiliFrames({ bvid: candidate.bvid, count: selfWatch.framesCount });
        if (typeof frames === 'object' && Array.isArray(frames.blobs) && frames.blobs.length) {
          void this.host.pushEvent({
            type: 'bili.watch', ts: new Date().toISOString(), source: 'bilibili', origin: 'external', senderKey: 'bili.self',
            text: `[B站自己看 · 带画面] ${candidate.title} 的画面，和上一条文字一起看。`,
            meta: { kind: 'bili.watch', bvid: candidate.bvid, title: candidate.title, via: 'selfwatch-frames' },
            blobs: frames.blobs,
          }, { trigger: 'debounce' }).catch((error) => {
            this.host?.log.warn('[companion] B站自己看画面投递失败', String(error));
          });
        }
      }
      state.lastAt = Date.now();
      state.lastBvid = candidate.bvid;
      if (useFrames) state.framesCount += 1;
      else state.textCount += 1;
      try {
        mkdirSync(join(this.dataDir, 'bili'), { recursive: true });
        writeFileSync(stateFile, JSON.stringify({
          day, lastAt: new Date(state.lastAt).toISOString(), bvid: candidate.bvid, title: candidate.title,
          textCount: state.textCount, framesCount: state.framesCount,
        }), 'utf8');
      } catch { /* ignore */ }
      this.mind('action', `自己看：${candidate.title}`, { bvid: candidate.bvid, result: String(result).slice(0, 120), frames: useFrames });
      this.save(false);
    } catch (error) {
      this.host?.log.warn('[companion] B站自己看失败', String(error));
    } finally {
      this.biliSelfWatchInFlight = false;
    }
  }

  private noteBiliWatchTrigger(title: string, bvid: string): void {
    const at = new Date().toISOString();
    const key = `bili:watch:${bvid}:${at}`;
    this.state.pendingTrigger = {
      key,
      reason: `刚看了 B站视频《${title}》，有点想讲讲`,
      source: 'bili',
      salience: 0.6,
      at,
    };
    this.state.triggerSeen = Object.fromEntries(
      Object.entries({ ...(this.state.triggerSeen ?? {}), [key]: at })
        .filter(([, ts]) => Date.parse(ts) > Date.now() - 7 * 86_400_000)
        .slice(-100),
    );
    this.state.proactiveDueAt = null;
    this.mind('trigger', `B站观看触发：${title}`, { trigger: key, source: 'bili', salience: 0.6 });
  }

  private async toolBiliWatch(args: Record<string, unknown>): Promise<string> {
    if (!this.cfg().biliChannelEnabled) return 'B站通道未启用（可选功能，默认关闭）。';
    const bvid = trimText(args.bvid, 30);
    if (!bvid) return 'bili_watch 需要 bvid。';
    const info = await this.bili.info(bvid);
    const previous = this.biliWatch.find({ bvid, title: info.title });
    if (previous && args.force !== true) {
      return `这条看过了：${previous.at.slice(0, 10)} 看过 ${previous.bvid}《${previous.title}》；要看就带 force:true。`;
    }
    const subtitles = await this.bili.subtitles(bvid).catch(() => []);
    const comments = await this.bili.comments(bvid, 5).catch(() => []);
    const note = trimText(args.note, 300);
    const excerpt = subtitles.slice(0, 80).map((line) => line.text).join(' ').slice(0, 1200);
    const hot = comments.slice(0, 3).map((comment) => `${comment.user}：${comment.message}`).join(' / ');
    const summary = `看了 ${info.title}（UP：${info.owner}）。${excerpt ? `字幕摘录：${excerpt}` : ''}${hot ? `热评：${hot}` : ''}${note ? ` 她的感受：${note}` : ''}`;
    this.biliWatch.record({ at: new Date().toISOString(), bvid, title: info.title, owner: info.owner, duration: info.duration, via: 'tool' });
    this.noteBiliWatchTrigger(info.title, bvid);
    if (this.cfg().memoryEnabled && this.cfg().memoryCapture) {
      this.memoryStore.add({ text: summary, kind: 'episode', scope: `bili:${bvid}`, source: 'bili', tags: ['bili', 'watch'], importance: 0.55 });
    }
    if (args.silent !== true) void this.host?.pushEvent({
      type: 'bili.watch', ts: new Date().toISOString(), source: 'bilibili', origin: 'external', senderKey: 'bili.self',
      text: `[B站自己看] ${summary}`,
      meta: { kind: 'bili.watch', bvid, title: info.title, via: 'tool' },
    }, { trigger: 'debounce' }).catch((error) => {
      this.host?.log.warn('[companion] B站观看事件投递失败', String(error));
    });
    return `已记下这次观看：${info.title}。${note ? `感受：${note}` : ''}`;
  }

  private async toolBiliSubtitles(args: Record<string, unknown>): Promise<string> {
    if (!this.cfg().biliChannelEnabled) return 'B站通道未启用（可选功能，默认关闭）。';
    const bvid = trimText(args.bvid, 30);
    if (!bvid) return 'bili_subtitles 需要 bvid。';
    const lines = await this.bili.subtitles(bvid);
    if (!lines.length) return '没有读到字幕（可能需要登录，或这条视频没有 CC/AI 字幕）。';
    return lines.slice(0, 200).map((line) => `[${Math.floor(line.from)}s] ${line.text}`).join('\n');
  }

  private async toolBiliHistory(args: Record<string, unknown>): Promise<string> {
    if (!this.cfg().biliChannelEnabled) return 'B站通道未启用（可选功能，默认关闭）。';
    const rows = await this.bili.history(Number(args.limit) || 20);
    if (!rows.length) return '没有读到观看记录（可能需要登录）。';
    return rows.map((row) => `${row.bvid}｜${row.title}｜${row.author}｜${Math.floor(row.progress / 60)}/${Math.floor(row.duration / 60)} 分钟`).join('\n');
  }

  private async toolBiliComments(args: Record<string, unknown>): Promise<string> {
    if (!this.cfg().biliChannelEnabled) return 'B站通道未启用（可选功能，默认关闭）。';
    const bvid = trimText(args.bvid, 30);
    if (!bvid) return 'bili_comments 需要 bvid。';
    const comments = await this.bili.comments(bvid, Number(args.limit) || 8);
    if (!comments.length) return '没有读到评论。';
    return comments.map((comment) => `${comment.user}（rpid=${comment.rpid}，${comment.like}赞）：${comment.message.slice(0, 160)}`).join('\n');
  }

  private async toolQqStatus(): Promise<string> {
    const s = this.oneBot.status();
    if (!this.cfg().qqChannelEnabled) return 'QQ 通道未启用（可选功能，默认关闭）。';
    const state = s.state === 'online' ? '已连接' : s.state === 'disabled' ? '未启用' : s.state === 'connecting' ? '连接中' : s.state === 'error' ? '出错' : '未连接';
    return [
      `QQ：${state}`,
      `地址：${s.wsUrl}`,
      s.selfId ? `账号：${s.selfId}` : '',
      s.appName ? `实现：${s.appName}${s.appVersion ? ` ${s.appVersion}` : ''}` : '',
      `事件：${s.eventCount}`,
      s.lastError ? `错误：${s.lastError}` : '',
    ].filter(Boolean).join('；');
  }

  private async toolQqRecent(args: Record<string, unknown>): Promise<string> {
    const limit = Math.max(1, Math.min(20, Number(args.limit) || 8));
    const messages = this.oneBot.recentMessages(limit);
    if (!messages.length) return '最近没有收到 QQ 消息。';
    return messages.map((message) => {
      const kind = message.messageType === 'group' ? '群' : '私聊';
      const imageInfo = message.imageKeys.map((key) => {
        const record = this.oneBot.mediaGet(key);
        return record?.meaning ? `${key.slice(0, 8)}=${record.meaning}` : key.slice(0, 8);
      }).join(', ');
      const images = imageInfo ? `（图 ${imageInfo}）` : '';
      const quote = message.quote ? `[引用 ${message.quote}] ` : '';
      const files = message.filePaths?.length ? `（文件 ${message.filePaths.length}）` : '';
      const voices = message.voicePaths?.length ? `（语音 ${message.voicePaths.length}）` : '';
      return `[${formatLocal(message.at, this.tz()).slice(5, 16)}] [${message.messageId}] ${kind} ${message.nickname}：${quote}${message.text || '[空消息]'}${images}${files}${voices}`;
    }).join('\n');
  }

  private async toolCompanionWeb(args: Record<string, unknown>): Promise<string> {
    const cfg = this.cfg();
    if (!cfg.webSearchEnabled) return '按需联网已关闭。';
    const question = trimText(args.question, 300);
    if (!question) return '没给要查的问题。';
    const { key } = resolveDeepSeekKey(this.ctx.botDir, (name) => this.ctx.secret(name));
    if (!key) return '联网没配好：没找到 DEEPSEEK_API_KEY。先确认 Coopanion 的 DeepSeek 连接是好的，不要编造答案。';
    try {
      const result = await askWithWebSearch(question, {
        apiKey: key,
        model: cfg.webSearchModel || 'deepseek-flash',
        maxSearches: Math.max(1, Math.min(10, Number(cfg.webSearchMaxSearches) || 3)),
        maxTokens: Math.max(200, Math.min(4000, Number(cfg.webSearchMaxTokens) || 800)),
        timeoutMs: 120_000,
      });
      return formatWebAnswer(result);
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      return `联网没查成：${why}。照实告诉用户，不要凭记忆编一个答案。`;
    }
  }

  private screenIdleSeconds(): number | null {
    const script = `Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class IdleCheck {
  [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
  public static uint Seconds() { var info = new LASTINPUTINFO(); info.cbSize=(uint)Marshal.SizeOf(info); if (!GetLastInputInfo(ref info)) return 0; return ((uint)Environment.TickCount - info.dwTime)/1000; }
}
"@
[IdleCheck]::Seconds()`;
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 10_000, windowsHide: true });
    if (result.status !== 0) return null;
    const value = Number(String(result.stdout ?? '').trim());
    return Number.isFinite(value) ? value : null;
  }

  private captureScreenFile(): string | null {
    const dir = join(this.dataDir, 'screen');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `screen-${Date.now()}.png`);
    const escaped = path.replace(/'/g, "''");
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms,System.Drawing',
      '$b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds',
      '$bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height',
      '$g=[System.Drawing.Graphics]::FromImage($bmp)',
      '$g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size)',
      `$bmp.Save('${escaped}',[System.Drawing.Imaging.ImageFormat]::Png)`,
      '$g.Dispose(); $bmp.Dispose()',
    ].join('; ');
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 20_000, windowsHide: true });
    return result.status === 0 && existsSync(path) ? path : null;
  }

  private async toolCompanionScreen(): Promise<string | ToolOutcome> {
    if (!this.cfg().screenEnabled) return '看屏幕没有开启（worlds.companion.screenEnabled=false）。';
    const path = this.captureScreenFile();
    if (!path) return '截屏失败（PowerShell 不可用或桌面会话受限）。';
    const bytes = readFileSync(path);
    let accepts = false;
    try { accepts = this.host?.modelFacts.accepts('image/png') === true; } catch { accepts = false; }
    if (accepts) return { text: `[当前屏幕] ${path}`, blobs: [{ bytes, mime: 'image/png', name: 'screen.png', fallbackText: '[屏幕截图]' }] };
    return `已截屏：${path}`;
  }

  private async toolOneBotActions(args: Record<string, unknown>): Promise<string> {
    const actions = searchOneBotActions(trimText(args.query, 80), Number(args.limit) || 12);
    if (!actions.length) return '目录里没有匹配的 action。';
    return actions.map((action) => {
      const params = (action.params ?? []).map((param) => `${param.name}${param.required ? '*' : ''}`).join(', ');
      return `${action.name}${action.readOnly ? ' [只读]' : ''}：${action.summary || ''}${params ? `；参数：${params}` : ''}`;
    }).join('\n');
  }

  private async toolOneBotCall(args: Record<string, unknown>): Promise<string> {
    if (!this.cfg().qqChannelEnabled) return 'QQ 通道未启用（可选功能，默认关闭）。';
    const name = trimText(args.action, 80);
    if (!name) return 'onebot_call 需要 action。';
    if (BLOCKED_ACTIONS.has(name)) return `action ${name} 被安全策略禁用。`;
    const action = findOneBotAction(name);
    if (!action) return `目录里没有 action ${name}；先 onebot_actions 搜一下。`;
    if (!action.readOnly && args.confirm !== true) {
      return `action ${action.name} 会改外部状态，需要 confirm=true 才执行。`;
    }
    const params = args.params && typeof args.params === 'object' && !Array.isArray(args.params)
      ? args.params as Record<string, unknown> : {};
    const errors = validateActionParams(action, params);
    if (errors.length) return `参数不对：${errors.join('；')}`;
    try {
      const result = await this.oneBot.call(action.name, params);
      return `action ${action.name} 成功：${JSON.stringify(result).slice(0, 4000)}`;
    } catch (error) {
      return `action ${action.name} 失败：${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async toolOneBotReceive(args: Record<string, unknown>): Promise<string> {
    if (typeof args.receive === 'string') {
      const receive = args.receive.trim() || 'private:*';
      this.oneBot.saveConfig({ receive });
      return `QQ 接收策略已改为：${receive}`;
    }
    return `当前接收策略：${this.oneBot.receiveText()}`;
  }

  private async toolQqReply(args: Record<string, unknown>): Promise<string> {
    if (!this.cfg().qqChannelEnabled) return 'QQ 通道未启用（可选功能，默认关闭）。';
    const messageId = trimText(args.message_id, 80);
    const text = trimText(args.text, 1000);
    if (!messageId || !text) return 'qq_reply 需要 message_id 和 text。';
    try {
      await this.oneBot.reply(messageId, text);
      return `已引用回复 ${messageId}。`;
    } catch (error) {
      return `回复失败：${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async toolQqViewFile(args: Record<string, unknown>): Promise<string | ToolOutcome> {
    const key = trimText(args.key, 300);
    if (!key) return 'qq_view_file 需要 key。';
    const record = this.oneBot.mediaGet(key);
    if (!record) return '没有找到这个文件。';
    const bytes = this.oneBot.mediaRead(record);
    if (!bytes) return '文件不在了。';
    if (record.mime.startsWith('text/')) {
      return `文件 ${record.hash.slice(0, 8)}（${record.mime}）：\n${Buffer.from(bytes).toString('utf8').slice(0, 4000)}`;
    }
    if (record.mime.startsWith('audio/')) {
      let accepts = false;
      try { accepts = this.host?.modelFacts.accepts(record.mime) === true; } catch { accepts = false; }
      if (accepts) {
        return { text: `[语音 ${record.hash.slice(0, 8)}]`, blobs: [{ bytes, mime: record.mime, name: `qq-audio-${record.hash.slice(0, 8)}.audio`, fallbackText: '[语音]' }] };
      }
      return `语音已保存：${record.path}（${record.mime}，${record.size} 字节）。可以用 qq_transcribe_voice 转写。`;
    }
    return `文件已保存：${record.path}（${record.mime}，${record.size} 字节）。`;
  }

  private async toolQqTranscribeVoice(args: Record<string, unknown>): Promise<string> {
    const key = trimText(args.key, 300);
    if (!key) return 'qq_transcribe_voice 需要 key。';
    const record = this.oneBot.mediaGet(key);
    if (!record) return '没有找到这条语音。';
    if (!record.mime.startsWith('audio/')) return '这不是 audio 文件。';
    const template = this.oneBot.sttCommand();
    if (!template) {
      const local = await this.voice.transcribe(record.path);
      if (local.error) return `本机转写失败：${local.error}`;
      return local.text ? `转写：${local.text}` : '没有识别出文字。';
    }
    const quoted = `"${record.path.replace(/"/g, '\\"')}"`;
    const command = template.includes('{file}') ? template.replaceAll('{file}', quoted) : `${template} ${quoted}`;
    const result = spawnSync(command, { shell: true, timeout: 120_000, encoding: 'utf8', windowsHide: true });
    if (result.error) return `转写失败：${result.error.message}`;
    const stdout = String(result.stdout || '').trim();
    const stderr = String(result.stderr || '').trim();
    if (result.status !== 0) return `转写失败（${result.status}）：${(stderr || stdout).slice(0, 1000)}`;
    return stdout ? `转写：${stdout.slice(0, 4000)}` : '转写命令没有输出。';
  }

  private async toolQqViewImage(args: Record<string, unknown>): Promise<string | ToolOutcome> {
    if (!this.cfg().qqChannelEnabled) return 'QQ 通道未启用（可选功能，默认关闭）。';
    const key = trimText(args.key, 300);
    if (!key) return 'qq_view_image 需要 key。';
    const record = this.oneBot.mediaGet(key);
    if (!record) return '没有找到这张图；先用 qq_recent 看图片短号。';
    const meaning = await this.localMediaMeaning(record);
    if (meaning) return `这张图已经有含义：${meaning}。不再返回图片，直接按这个意思用。`;
    if (record.viewedAt) return '这张图之前已经看过但还没记含义；不再重复给图，请用 qq_media_note 补一句，或者跳过。';
    const bytes = this.oneBot.mediaRead(record);
    if (!bytes) return '图片文件不在了；可以重新下载后再看。';
    this.oneBot.mediaMarkViewed(record);
    this.oneBot.mediaMarkSeen(record);
    const fallback = `[图片 ${record.hash.slice(0, 8)}]`;
    if (record.mime === 'image/gif') {
      const frames = gifFrames(record.path, 4);
      if (frames.length) {
        return {
          text: `[动图 ${record.hash.slice(0, 8)}，已抽 ${frames.length} 帧。看完用 qq_media_note 记一句含义，下次不再看。]`,
          blobs: frames,
        };
      }
    }
    return {
      text: `${fallback} 看完用 qq_media_note 记一句含义，下次不再看。`,
      blobs: [{ bytes, mime: record.mime, name: `qq-image-${record.hash.slice(0, 8)}.${record.mime.split('/')[1] || 'img'}`, fallbackText: fallback }],
    };
  }

  private async toolQqMediaList(args: Record<string, unknown>): Promise<string> {
    const limit = Math.max(1, Math.min(100, Number(args.limit) || 20));
    const query = trimText(args.query, 80);
    const list = query ? this.oneBot.mediaSearch(query, limit) : this.oneBot.mediaList(limit);
    if (!list.length) return query ? `没有找到含「${query}」的图片。` : '媒体库里还没有图片。';
    return list.map((item) => `${item.hash.slice(0, 8)}${item.meaning ? `｜${item.meaning}` : '｜未描述'}｜${item.path}`).join('\n');
  }

  private async captionMediaFile(path: string, sampleAnimation = false): Promise<{ text: string; error: string }> {
    const command = String(this.cfg().mediaCaptionCommand || '').trim();
    if (command) {
      return await new Promise((resolve) => {
        execFile(command, [path], { timeout: 30_000, maxBuffer: 1_000_000, windowsHide: true }, (error, stdout) => {
          if (error) return resolve({ text: '', error: '本地描述命令失败' });
          resolve({ text: String(stdout || '').trim().split(/\r?\n/)[0]?.slice(0, 200) || '', error: '' });
        });
      });
    }
    const base = String(this.cfg().mediaCaptionBaseUrl || '').trim().replace(/\/+$/, '');
    if (!base) return { text: '', error: '没有配置本地视觉接口' };
    try {
      let model = String(this.cfg().mediaCaptionModel || '').trim();
      if (!model) {
        const models = await fetch(`${base}/models`, { signal: AbortSignal.timeout(5_000) }).then((r) => r.json()) as {
          data?: Array<{ id?: string; architecture?: { input_modalities?: string[] } }>;
          models?: Array<{ name?: string; model?: string }>;
        };
        const rows = Array.isArray(models.data) ? models.data : [];
        const vision = rows.find((row) => row.architecture?.input_modalities?.includes('image'));
        model = String(vision?.id || '');
        // 没有声明模态的简单 OpenAI 兼容服务，只有唯一模型时才尝试它。
        if (!model && rows.length === 1 && !rows[0]?.architecture) model = String(rows[0].id || '');
      }
      if (!model) return { text: '', error: '本地服务没有支持图片输入的模型（需要 VL/mmproj）' };
      const lower = path.toLowerCase();
      const direct = /\.(png|jpe?g)$/.test(lower);
      const frames = sampleAnimation ? gifFrames(path, 4) : [];
      const prepared = direct || frames.length ? null : imageForVision(path);
      const mime = prepared?.mime || (lower.endsWith('.png') ? 'image/png'
        : /\.gif$/i.test(lower) ? 'image/gif' : /\.webp$/i.test(lower) ? 'image/webp'
          : /\.bmp$/i.test(lower) ? 'image/bmp' : /\.avif$/i.test(lower) ? 'image/avif' : 'image/jpeg');
      const images = frames.length ? frames : [{ mime, bytes: prepared?.bytes || readFileSync(path) }];
      const body = {
        model,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: '用一句中文描述这张图或表情包表达的意思，不超过 40 个字，不要解释。' },
            ...images.map(image => ({ type: 'image_url', image_url: { url: `data:${image.mime};base64,${Buffer.from(image.bytes).toString('base64')}` } })),
          ],
        }],
        max_tokens: 80,
        temperature: 0.2,
        stream: false,
      };
      const response = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45_000),
      });
      if (!response.ok) return { text: '', error: `本地视觉接口 HTTP ${response.status}` };
      const payload = await response.json() as { choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }> };
      const content = payload.choices?.[0]?.message?.content;
      const text = (typeof content === 'string' ? content : content?.map((part) => part.text || '').join('') || '').trim().slice(0, 200);
      if (!text) return { text: '', error: '本地视觉模型没有返回描述' };
      if (text.includes('?')) return { text: '', error: '本地视觉输出乱码（问号），已跳过' };
      return { text, error: '' };
    } catch (error) {
      return { text: '', error: `本地视觉接口不可用：${error instanceof Error ? error.message : String(error)}` };
    }
  }

  private async toolQqMediaImport(args: Record<string, unknown>): Promise<string> {
    const input = trimText(args.path, 1_000);
    if (!input) return 'qq_media_import 需要 path。';
    const root = resolve(input);
    let rootStat;
    try { rootStat = statSync(root); } catch { return `找不到路径：${root}`; }
    const recursive = args.recursive !== false;
    const limit = Math.max(1, Math.min(2_000, Number(args.limit) || 200));
    const captionLimit = Math.max(1, Math.min(200, Number(args.caption_limit) || 20));
    const caption = args.caption === undefined ? this.cfg().mediaAutoCaptionEnabled === true : args.caption === true;
    const canCaption = caption && Boolean(String(this.cfg().mediaCaptionCommand || '').trim() || String(this.cfg().mediaCaptionBaseUrl || '').trim());
    const image = /\.(png|jpe?g|jfif|gif|webp|bmp|avif)$/i;
    const files: string[] = [];
    const visit = (path: string): void => {
      if (files.length >= limit) return;
      const stat = statSync(path);
      if (stat.isFile()) {
        if (image.test(path)) files.push(path);
        return;
      }
      if (!stat.isDirectory()) return;
      let entries;
      try { entries = readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)); } catch { return; }
      for (const entry of entries) {
        if (files.length >= limit) return;
        const child = join(path, entry.name);
        if (entry.isDirectory()) { if (recursive) visit(child); }
        else if (entry.isFile() && image.test(entry.name)) files.push(child);
      }
    };
    try { visit(root); } catch (error) { return `读取目录失败：${error instanceof Error ? error.message : String(error)}`; }
    if (!files.length) return '没有找到可导入的图片（支持 png/jpg/gif/webp/bmp/avif）。';
    let imported = 0;
    let duplicates = 0;
    let skipped = 0;
    let captioned = 0;
    let captionFailed = 0;
    let captionError = '';
    const keys: string[] = [];
    for (const file of files) {
      const result = this.oneBot.mediaImportFile(file);
      if (!result) { skipped += 1; continue; }
      if (result.duplicate) duplicates += 1;
      else { imported += 1; if (keys.length < 10) keys.push(result.record.hash.slice(0, 8)); }
      if (canCaption && !result.record.meaning && captioned < captionLimit) {
        const described = await this.captionMediaFile(result.record.path);
        if (described.text) {
          this.oneBot.mediaNote(result.record.hash, described.text);
          captioned += 1;
        } else {
          captionFailed += 1;
          if (!captionError) captionError = described.error;
        }
      }
    }
    const lines = [
      `导入完成：新增 ${imported}，库内已有 ${duplicates}，跳过 ${skipped}。`,
      canCaption
        ? `自动描述 ${captioned} 张${captionFailed ? `，失败 ${captionFailed} 张` : ''}；之后可用 qq_media_note 人工纠错。`
        : (caption && !canCaption ? '未配置本地图片描述程序或视觉接口，本次只导入不自动描述。' : '本次未自动描述。'),
      captioned === 0 && captionFailed > 0 && captionError ? `自动描述未成功：${captionError}` : '',
      keys.length ? `新图片短号：${keys.join('、')}` : '',
    ].filter(Boolean);
    return lines.join('\n');
  }

  private async toolQqMediaDelete(args: Record<string, unknown>): Promise<string> {
    const key = trimText(args.key, 300);
    if (!key) return 'qq_media_delete 需要 key。';
    const record = this.oneBot.mediaRemove(key);
    if (!record) return '没有找到这张图。';
    return `已删除 ${record.hash.slice(0, 8)}${record.meaning ? `（${record.meaning}）` : ''}。`;
  }

  private async toolQqMediaNote(args: Record<string, unknown>): Promise<string> {
    const key = trimText(args.key, 200);
    const meaning = trimText(args.meaning, 200);
    if (!key || !meaning) return 'qq_media_note 需要 key 和 meaning。';
    const record = this.oneBot.mediaNote(key, meaning);
    return record ? `已记下 ${record.hash.slice(0, 8)}：${record.meaning}` : '没有找到这张图。';
  }

  private async toolQqSend(args: Record<string, unknown>): Promise<string> {
    if (!this.cfg().qqChannelEnabled) return 'QQ 通道未启用（可选功能，默认关闭）。';
    const targetType = args.target_type === 'group' ? 'group' : 'private';
    const targetId = trimText(args.target_id, 30);
    const text = trimText(args.text, 1000);
    if (!targetId || !text) return 'qq_send 需要 target_id 和 text。';
    try {
      if (targetType === 'group') await this.oneBot.sendGroup(targetId, text);
      else await this.oneBot.sendPrivate(targetId, text);
      return `已发送到${targetType === 'group' ? '群' : 'QQ'} ${targetId}。`;
    } catch (error) {
      return `发送失败：${error instanceof Error ? error.message : String(error)}`;
    }
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
      .map((hit) => `[${label[hit.kind] ?? hit.kind}/${hit.scope}] ${hit.ts.slice(0, 10)}${hit.id ? ` (${hit.id})` : ''} ${hit.snippet}`)
      .join('\n');
  }

  private async toolMemoryRead(args: Record<string, unknown>): Promise<string | ToolOutcome> {
    if (!this.cfg().memoryEnabled) return '内置记忆已关闭（设置 → 我会永远陪着你 → 内置记忆）。';
    const id = trimText(args.id, 128);
    if (!id) return this.fail('要读哪条？id 不能为空。');
    const record = this.memoryStore.read(id);
    if (!record) return this.fail(`没找到记忆 ${id.slice(0, 12)}。`);
    const versions = record.versions?.length
      ? record.versions
      : [{ version: record.version ?? 1, text: record.text, observedAt: record.ts, status: record.details?.status }];
    const lines = [
      `记忆 ${record.id}`,
      `类型：${record.kind} · 域：${record.scope} · 版本：${record.version ?? 1} · 时间：${formatLocal(record.ts, this.tz())}`,
      `当前：${record.text}`,
    ];
    if (record.details?.status) lines.push(`状态：${record.details.status}`);
    if (record.details?.what) lines.push(`话头：${record.details.what}`);
    lines.push('版本历史：');
    for (const version of versions) {
      lines.push(`- v${version.version} ${version.observedAt.slice(0, 16)}${version.status ? ` [${version.status}]` : ''} ${version.text.slice(0, 220)}`);
    }
    return lines.join('\n');
  }

  private toolMemoryTimeline(args: Record<string, unknown>): string {
    if (!this.cfg().memoryEnabled) return '内置记忆已关闭（设置 → 我会永远陪着你 → 内置记忆）。';
    const subjectKey = trimText(args.subjectKey, 120);
    if (!subjectKey) return this.fail('要查哪个主语？subjectKey 不能为空。');
    const scopeArg = trimText(args.scope, 40);
    const rows = this.memoryStore.timeline(subjectKey, scopeArg === '*' ? undefined : (scopeArg || this.activeScope()));
    if (!rows.length) return `没有找到主语「${subjectKey}」的时间线。`;
    this.mind('memory', `时间线「${subjectKey}」${rows.length} 个版本`, { subjectKey });
    return rows
      .map((row) => `${row.observedAt.slice(0, 16)} [${row.kind}${row.status ? `/${row.status}` : ''} v${row.version}] ${row.text}`)
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
      ...(trimText(args.subjectKey, 120) ? { subjectKey: trimText(args.subjectKey, 120) } : {}),
    });
    if (!result.added) return `这条已经记过了（${kind}，id ${result.id.slice(0, 8)}），没有重复写入。`;
    if (result.updated) {
      this.snapshot?.invalidate();
      this.mind('memory', `更新 ${kind}（同主语）：${text.slice(0, 40)}`, { memoryId: result.id, kind });
      return `这条已有同主语的旧版本，已更新为当前版本（${kind}，id ${result.id.slice(0, 8)}）；旧版本保留。`;
    }
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
    rules: string[]; person?: string; model?: string; working?: string; echo?: string;
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
    // 用户模型：有内容时替代 person 摘要（避免两份画像打架），没有就回退。
    const model = cfg.userModelInPrompt !== false ? this.userModelText() : '';
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
      person: model ? undefined : (person ? `他：${person.text.slice(0, 180)}` : undefined),
      model: model || undefined,
      working: working || undefined,
      echo: echo?.text,
      echoId: echo?.id,
      echoEventId: echo?.eventId,
      ...(followup ? { followup } : {}),
      recent: recent.map((record) => `${formatLocal(record.ts, this.tz()).slice(0, 10)} ${record.text.slice(0, 120)}`),
    };
  }

  /** 「我对他的理解」：10 分钟或记录数变化时重算；推导失败不阻塞上下文。 */
  private userModelText(): string {
    const now = Date.now();
    const count = this.memoryStore.stats().records;
    if (this.userModelCache && now - this.userModelCache.at < 10 * 60_000
      && this.userModelCache.records === count) {
      return this.userModelCache.text;
    }
    let text = '';
    try {
      text = renderUserModel(deriveUserModel({
        records: this.memoryStore.entries(),
        now: new Date(now),
        tz: this.tz(),
      }));
    } catch {
      text = '';
    }
    this.userModelCache = { at: now, records: count, text };
    return text;
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
