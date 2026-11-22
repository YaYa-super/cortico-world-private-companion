/**
 * 原生 OneBot v11 通道（骨架）。
 *
 * 不依赖 cortico-world-onebot：自己维护连接、echo、重连和状态。
 * 目标是给 companion 的 QQ 通道打底；消息入记忆、工具、面板在后续提交接入。
 */
import { WebSocket } from 'ws';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ChannelMediaStore } from './media-store.ts';

export type OneBotState = 'disabled' | 'connecting' | 'online' | 'offline' | 'error';

export interface OneBotChannelConfig {
  enabled: boolean;
  wsUrl: string;
  /** 空 = 不发送 Authorization。 */
  token: string;
  /** 接收哪些会话：* / private:* / group:* / private:<QQ> / group:<群号>，逗号或空格分隔。 */
  receive: string;
  /** 可选：语音转写命令模板，{file} 会被替换成音频路径。 */
  sttCommand: string;
}

export interface OneBotStatus {
  state: OneBotState;
  enabled: boolean;
  wsUrl: string;
  hasToken: boolean;
  selfId: string;
  appName: string;
  appVersion: string;
  eventCount: number;
  lastEventAt: string | null;
  connectedAt: string | null;
  lastError: string;
  reconnects: number;
}

export interface OneBotEvent {
  at: string;
  type: string;
  detail: string;
}

export interface OneBotMessage {
  at: string;
  messageType: 'private' | 'group';
  userId: string;
  groupId: string;
  nickname: string;
  messageId: string;
  text: string;
  images: string[];
  imageFiles: string[];
  imageKeys: string[];
  files: string[];
  voices: string[];
  filePaths: string[];
  voicePaths: string[];
  replyTo: string;
  quote: string;
}

function textOfSegments(raw: unknown): { text: string; images: string[]; files: string[]; voices: string[]; replyTo: string } {
  if (typeof raw === 'string') return { text: raw.trim(), images: [], files: [], voices: [], replyTo: '' };
  if (!Array.isArray(raw)) return { text: '', images: [], files: [], voices: [], replyTo: '' };
  const parts: string[] = [];
  const images: string[] = [];
  const files: string[] = [];
  const voices: string[] = [];
  let replyTo = '';
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const segment = item as Record<string, unknown>;
    const data = segment.data && typeof segment.data === 'object' ? segment.data as Record<string, unknown> : {};
    if (segment.type === 'text') {
      const text = asString(data.text);
      if (text) parts.push(text);
    } else if (segment.type === 'image') {
      const url = asString(data.url) || asString(data.file);
      if (url) images.push(url);
      parts.push('[图片]');
    } else if (segment.type === 'file') {
      const name = asString(data.name) || asString(data.file) || '文件';
      const url = asString(data.url);
      files.push(url || name);
      parts.push(`[文件 ${name}]`);
    } else if (segment.type === 'record') {
      const url = asString(data.url) || asString(data.file);
      if (url) voices.push(url);
      parts.push('[语音]');
    } else if (segment.type === 'reply') {
      replyTo = asString(data.id);
      parts.push('[引用]');
    } else if (segment.type === 'at') {
      const qq = asString(data.qq);
      if (qq) parts.push(`@${qq}`);
    } else if (segment.type === 'face') {
      parts.push('[表情]');
    }
  }
  return { text: parts.join(' ').trim(), images, files, voices, replyTo };
}

export function parseMessagePayload(payload: Record<string, unknown>): OneBotMessage {
  const sender = payload.sender && typeof payload.sender === 'object' ? payload.sender as Record<string, unknown> : {};
  const parsed = textOfSegments(payload.message);
  return {
    at: new Date().toISOString(),
    messageType: payload.message_type === 'group' ? 'group' : 'private',
    userId: String(payload.user_id ?? ''),
    groupId: String(payload.group_id ?? ''),
    nickname: asString(sender.card) || asString(sender.nickname) || String(payload.user_id ?? ''),
    messageId: String(payload.message_id ?? ''),
    text: parsed.text,
    images: parsed.images,
    imageFiles: [],
    imageKeys: [],
    files: parsed.files,
    voices: parsed.voices,
    filePaths: [],
    voicePaths: [],
    replyTo: parsed.replyTo,
    quote: '',
  };
}

const DEFAULT_CONFIG: OneBotChannelConfig = {
  enabled: false,
  wsUrl: 'ws://127.0.0.1:3001',
  token: '',
  receive: 'private:*',
  sttCommand: '',
};

function readJson(path: string): Record<string, unknown> | null {
  try {
    if (!existsSync(path)) return null;
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export class OneBotChannel {
  private readonly dir: string;
  private readonly legacyConfig: string;
  private readonly media: ChannelMediaStore;
  private config: OneBotChannelConfig = { ...DEFAULT_CONFIG };
  private socket: WebSocket | null = null;
  private stopped = true;
  private events: OneBotEvent[] = [];
  private messages: OneBotMessage[] = [];
  onMessage: ((message: OneBotMessage) => void | Promise<void>) | null = null;
  private echoSeq = 0;
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectCount = 0;
  private statusExtra: Pick<OneBotStatus, 'selfId' | 'appName' | 'appVersion' | 'lastError' | 'connectedAt'> = {
    selfId: '', appName: '', appVersion: '', lastError: '', connectedAt: null,
  };
  private state: OneBotState = 'disabled';
  private lastEventAt: string | null = null;
  private eventCount = 0;

  constructor(opts: { dataDir: string; botDir: string }) {
    this.dir = join(opts.dataDir, 'channels');
    this.legacyConfig = join(opts.botDir, 'config.json');
    this.media = new ChannelMediaStore(join(opts.dataDir, 'media', 'onebot'));
  }

  get configPath(): string {
    return join(this.dir, 'onebot.json');
  }

  private legacy(): Partial<OneBotChannelConfig> {
    const parsed = readJson(this.legacyConfig);
    const worlds = parsed?.worlds;
    const onebot = worlds && typeof worlds === 'object' ? (worlds as Record<string, unknown>).onebot : null;
    if (!onebot || typeof onebot !== 'object') return {};
    const section = onebot as Record<string, unknown>;
    const conversations = section.conversations && typeof section.conversations === 'object'
      ? section.conversations as Record<string, unknown> : {};
    return {
      wsUrl: asString(section.wsUrl),
      token: asString(section.token) || process.env.ONEBOT_TOKEN || '',
      receive: asString(conversations.receive),
    };
  }

  loadConfig(): OneBotChannelConfig {
    const saved = readJson(this.configPath);
    const legacy = this.legacy();
    const merged: OneBotChannelConfig = {
      ...DEFAULT_CONFIG,
      ...(legacy.wsUrl ? { wsUrl: legacy.wsUrl } : {}),
      ...(legacy.token ? { token: legacy.token } : {}),
      ...(legacy.receive ? { receive: legacy.receive } : {}),
      ...(saved ? {
        enabled: saved.enabled === true,
        wsUrl: asString(saved.wsUrl, DEFAULT_CONFIG.wsUrl),
        token: asString(saved.token) || asString(legacy.token),
        receive: asString(saved.receive) || asString(legacy.receive) || DEFAULT_CONFIG.receive,
        sttCommand: asString(saved.sttCommand),
      } : {}),
    };
    this.config = merged;
    return merged;
  }

  saveConfig(patch: Partial<OneBotChannelConfig>): OneBotChannelConfig {
    this.loadConfig();
    this.config = {
      ...this.config,
      ...(typeof patch.enabled === 'boolean' ? { enabled: patch.enabled } : {}),
      ...(typeof patch.wsUrl === 'string' ? { wsUrl: patch.wsUrl.trim() || DEFAULT_CONFIG.wsUrl } : {}),
      ...(typeof patch.token === 'string' ? { token: patch.token.trim() } : {}),
      ...(typeof patch.receive === 'string' ? { receive: patch.receive.trim() || DEFAULT_CONFIG.receive } : {}),
      ...(typeof patch.sttCommand === 'string' ? { sttCommand: patch.sttCommand.trim() } : {}),
    };
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.configPath, `${JSON.stringify(this.config, null, 2)}\n`, 'utf8');
    return { ...this.config };
  }

  status(): OneBotStatus {
    return {
      state: this.state,
      enabled: this.config.enabled,
      wsUrl: this.config.wsUrl,
      hasToken: Boolean(this.config.token || process.env.ONEBOT_TOKEN),
      ...this.statusExtra,
      eventCount: this.eventCount,
      lastEventAt: this.lastEventAt,
      reconnects: this.reconnectCount,
    };
  }

  recent(limit = 12): OneBotEvent[] {
    return this.events.slice(-Math.max(1, Math.min(50, limit))).reverse();
  }

  recentMessages(limit = 12): OneBotMessage[] {
    return this.messages.slice(-Math.max(1, Math.min(50, limit))).reverse();
  }

  mediaList(limit = 20): ReturnType<ChannelMediaStore['list']> {
    return this.media.list(limit);
  }

  mediaSearch(query: string, limit = 20): ReturnType<ChannelMediaStore['search']> {
    return this.media.search(query, limit);
  }

  mediaGet(key: string): ReturnType<ChannelMediaStore['get']> {
    return this.media.get(key);
  }

  mediaRead(record: ReturnType<ChannelMediaStore['get']>): Uint8Array | null {
    if (!record) return null;
    try { return this.media.read(record); } catch { return null; }
  }

  mediaMarkViewed(record: NonNullable<ReturnType<ChannelMediaStore['get']>>): void {
    this.media.markViewed(record);
  }

  mediaMarkSeen(record: NonNullable<ReturnType<ChannelMediaStore['get']>>): void {
    this.media.markSeen(record);
  }

  mediaMarkReminded(record: NonNullable<ReturnType<ChannelMediaStore['get']>>): void {
    this.media.markReminded(record);
  }

  mediaPendingMeaning(limit = 4): ReturnType<ChannelMediaStore['pendingMeaning']> {
    return this.media.pendingMeaning(limit);
  }

  mediaNote(key: string, meaning: string): ReturnType<ChannelMediaStore['attachMeaning']> {
    return this.media.attachMeaning(key, meaning);
  }

  mediaRemove(key: string): ReturnType<ChannelMediaStore['remove']> {
    return this.media.remove(key);
  }

  mediaImportFile(source: string): ReturnType<ChannelMediaStore['importFile']> {
    return this.media.importFile(source);
  }

  receiveText(): string {
    return this.config.receive;
  }

  sttCommand(): string {
    return this.config.sttCommand;
  }

  accepts(message: OneBotMessage): boolean {
    const patterns = this.config.receive.split(/[,\s]+/).filter(Boolean);
    if (!patterns.length || patterns.includes('*')) return true;
    const key = `${message.messageType}:${message.messageType === 'group' ? message.groupId : message.userId}`;
    return patterns.some((pattern) => {
      if (pattern === 'private:*') return message.messageType === 'private';
      if (pattern === 'group:*') return message.messageType === 'group';
      return pattern === key;
    });
  }

  async sendPrivate(userId: string, text: string): Promise<unknown> {
    return this.call('send_private_msg', { user_id: userId, message: text });
  }

  async sendGroup(groupId: string, text: string): Promise<unknown> {
    return this.call('send_group_msg', { group_id: groupId, message: text });
  }

  async sendVoice(targetType: 'private' | 'group', targetId: string, path: string): Promise<unknown> {
    const file = path.replace(/\\/g, '/');
    const message = [{ type: 'record', data: { file: `file:///${file.replace(/^\/+/, '')}` } }];
    return targetType === 'group'
      ? this.call('send_group_msg', { group_id: targetId, message })
      : this.call('send_private_msg', { user_id: targetId, message });
  }

  /** 引用消息可能不在最近 100 条里；向 OneBot 反查原消息，取回昵称和正文。 */
  private async quoteFor(messageId: string, fallback = ''): Promise<string> {
    const id = messageId.trim();
    if (!id) return fallback;
    const local = this.findMessage(id);
    if (local) return `${local.nickname}：${local.text.slice(0, 200)}`;
    try {
      const response = await this.call('get_msg', { message_id: Number(id) || id }, 8_000) as Record<string, unknown>;
      const data = response.data && typeof response.data === 'object' ? response.data as Record<string, unknown> : {};
      const parsed = textOfSegments(data.message);
      const sender = data.sender && typeof data.sender === 'object' ? data.sender as Record<string, unknown> : {};
      const nickname = asString(sender.card) || asString(sender.nickname) || String(data.user_id ?? '') || '对方';
      const quotedText = parsed.text.replace(/^\[引用\]\s*/, '').trim();
      if (quotedText) return `${nickname}：${quotedText.slice(0, 200)}`;
    } catch { /* 反查失败就保留占位 */ }
    return fallback;
  }

  findMessage(messageId: string): OneBotMessage | null {
    const id = messageId.trim();
    if (!id) return null;
    return this.messages.find((message) => message.messageId === id) ?? null;
  }

  async reply(messageId: string, text: string): Promise<unknown> {
    const original = this.findMessage(messageId);
    if (!original) throw new Error('没有找到被引用的消息');
    const message = [
      { type: 'reply', data: { id: original.messageId } },
      { type: 'text', data: { text } },
    ];
    if (original.messageType === 'group') return this.call('send_group_msg', { group_id: original.groupId, message });
    return this.call('send_private_msg', { user_id: original.userId, message });
  }

  async start(force = false): Promise<void> {
    this.stopped = false;
    this.loadConfig();
    if (force) this.config.enabled = true;
    if (!this.config.enabled) {
      this.state = 'disabled';
      return;
    }
    await this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.clearReconnect();
    this.state = 'disabled';
    this.rejectPending(new Error('通道已停止'));
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      try { socket.close(); } catch { /* ignore */ }
    }
  }

  async restart(): Promise<void> {
    await this.stop();
    this.stopped = false;
    await this.start();
  }

  /** 等登录信息/首个事件出现一小会儿，让面板第一次快照不是空的。 */
  async waitReady(timeoutMs = 1_200): Promise<void> {
    const deadline = Date.now() + Math.max(100, timeoutMs);
    while (Date.now() < deadline) {
      if (this.status().selfId || this.status().lastEventAt) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /** OneBot 通用 action；骨架先提供发送能力，供后续工具层复用。 */
  async call(action: string, params: Record<string, unknown> = {}, timeoutMs = 10_000): Promise<unknown> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('OneBot 未连接');
    }
    const echo = `companion-${Date.now()}-${++this.echoSeq}`;
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(echo);
        reject(new Error(`OneBot action 超时：${action}`));
      }, timeoutMs);
      this.pending.set(echo, { resolve, reject, timer });
      this.socket?.send(JSON.stringify({ action, params, echo }));
    });
  }

  private connect(): Promise<void> {
    this.clearReconnect();
    this.rejectPending(new Error('正在重连'));
    return new Promise((resolve) => {
      this.state = 'connecting';
      this.statusExtra.lastError = '';
      const headers: Record<string, string> = {};
      if (this.config.token) headers.Authorization = `Bearer ${this.config.token}`;
      let socket: WebSocket;
      try {
        socket = new WebSocket(this.config.wsUrl, { headers });
      } catch (error) {
        this.state = 'error';
        this.statusExtra.lastError = error instanceof Error ? error.message : String(error);
        this.scheduleReconnect();
        resolve();
        return;
      }
      this.socket = socket;
      const openTimer = setTimeout(() => {
        if (this.socket === socket && this.state !== 'online') {
          this.statusExtra.lastError = '连接超时';
          try { socket.close(); } catch { /* ignore */ }
        }
      }, 8_000);
      socket.on('open', () => {
        clearTimeout(openTimer);
        this.state = 'online';
        this.statusExtra.connectedAt = new Date().toISOString();
        this.reconnectCount = 0;
        void this.call('get_login_info').then((result) => {
          const data = result && typeof result === 'object' ? (result as Record<string, unknown>).data as Record<string, unknown> | undefined : undefined;
          if (data) {
            this.statusExtra.selfId = String(data.user_id ?? '');
            this.statusExtra.appName = asString(data.nickname);
          }
        }).catch(() => {});
        void this.call('get_version_info').then((result) => {
          const data = result && typeof result === 'object' ? (result as Record<string, unknown>).data as Record<string, unknown> | undefined : undefined;
          if (data) {
            this.statusExtra.appName = asString(data.app_name, this.statusExtra.appName);
            this.statusExtra.appVersion = asString(data.app_version);
          }
        }).catch(() => {});
        resolve();
      });
      socket.on('message', async (raw) => {
        let payload: Record<string, unknown>;
        try { payload = JSON.parse(raw.toString()) as Record<string, unknown>; } catch { return; }
        if (typeof payload.echo === 'string') {
          const pending = this.pending.get(payload.echo);
          if (pending) {
            clearTimeout(pending.timer);
            this.pending.delete(payload.echo);
            if (payload.status === 'failed' || payload.retcode) {
              pending.reject(new Error(asString(payload.wording, asString(payload.message, 'OneBot action 失败'))));
            } else {
              pending.resolve(payload);
            }
          }
          return;
        }
        const type = asString(payload.post_type, 'event');
        // 心跳/生命周期不是聊天事件，不占 UI 的「事件」计数。
        if (type === 'meta_event') return;
        this.eventCount += 1;
        this.lastEventAt = new Date().toISOString();
        if (type === 'message') {
          const message = parseMessagePayload(payload);
          if (!this.accepts(message)) return;
          if (message.replyTo) message.quote = await this.quoteFor(message.replyTo);
          this.messages.push(message);
          if (this.messages.length > 100) this.messages = this.messages.slice(-100);
          this.pushEvent({ at: this.lastEventAt, type, detail: this.describeEvent(payload, message) });
          await Promise.all([this.captureImages(message), this.captureAttachments(message)]);
          try { await this.onMessage?.(message); } catch { /* 回调失败不影响连接 */ }
          return;
        }
        this.pushEvent({ at: this.lastEventAt, type, detail: this.describeEvent(payload) });
      });
      socket.on('error', (error) => {
        clearTimeout(openTimer);
        this.state = 'error';
        this.statusExtra.lastError = error instanceof Error ? error.message : String(error);
      });
      socket.on('close', () => {
        clearTimeout(openTimer);
        if (this.socket !== socket) return;
        this.socket = null;
        this.rejectPending(new Error('连接已关闭'));
        if (this.stopped || !this.config.enabled) {
          this.state = 'disabled';
          resolve();
          return;
        }
        this.state = 'offline';
        this.scheduleReconnect();
        resolve();
      });
    });
  }

  private async captureImages(message: OneBotMessage): Promise<void> {
    const records = await Promise.all(message.images.slice(0, 4).map((url) => this.media.capture(url)));
    for (const record of records) {
      if (record) {
        message.imageFiles.push(record.path);
        message.imageKeys.push(record.hash);
      }
    }
  }

  private async captureAttachments(message: OneBotMessage): Promise<void> {
    const [files, voices] = await Promise.all([
      Promise.all(message.files.slice(0, 3).map((url) => /^https?:/i.test(url) ? this.media.capture(url, true) : null)),
      Promise.all(message.voices.slice(0, 2).map((url) => /^https?:/i.test(url) ? this.media.capture(url, true) : null)),
    ]);
    for (const record of files) if (record) message.filePaths.push(record.path);
    for (const record of voices) if (record) message.voicePaths.push(record.path);
  }

  private describeEvent(payload: Record<string, unknown>, message?: OneBotMessage): string {
    const type = asString(payload.post_type);
    if (type === 'message') {
      if (message) {
        const kind = message.messageType === 'group' ? '群' : '私聊';
        return `${kind}消息 · ${message.nickname}${message.text ? `：${message.text.slice(0, 70)}` : ''}`;
      }
      const sender = payload.sender && typeof payload.sender === 'object' ? payload.sender as Record<string, unknown> : {};
      const who = asString(sender.card) || asString(sender.nickname) || String(payload.user_id ?? '');
      const kind = payload.message_type === 'group' ? '群' : '私聊';
      return `${kind}消息 · ${who}`;
    }
    if (type === 'notice') return `通知 · ${asString(payload.notice_type)}`;
    if (type === 'request') return `请求 · ${asString(payload.request_type)}`;
    if (type === 'meta_event') return `元事件 · ${asString(payload.meta_event_type)}`;
    return type || '事件';
  }

  private pushEvent(event: OneBotEvent): void {
    this.events.push(event);
    if (this.events.length > 100) this.events = this.events.slice(-100);
  }

  private scheduleReconnect(): void {
    if (this.stopped || !this.config.enabled || this.reconnectTimer) return;
    this.reconnectCount += 1;
    const delay = Math.min(30_000, 2_000 * Math.max(1, this.reconnectCount));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.stopped && this.config.enabled) void this.connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private rejectPending(error: Error): void {
    for (const [echo, item] of this.pending) {
      clearTimeout(item.timer);
      item.reject(error);
      this.pending.delete(echo);
    }
  }
}
