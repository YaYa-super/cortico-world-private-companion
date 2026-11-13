/**
 * B 站只读客户端（无登录态）。
 *
 * 只做公开页面能看到的东西：搜索、视频信息、热评、弹幕。
 * 字幕/观看记录需要登录 Cookie；边界见 bili-read.ts。
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { randomUUID } from 'node:crypto';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const REFERER = 'https://www.bilibili.com/';

export interface BiliSearchItem {
  bvid: string;
  title: string;
  author: string;
  duration: string;
  play: number;
  cover: string;
}

export interface BiliInfo {
  bvid: string;
  aid: number;
  cid: number;
  title: string;
  owner: string;
  ownerMid: number;
  duration: number;
  desc: string;
  cover: string;
  play: number;
  pages: Array<{ page: number; cid: number; part: string; duration: number }>;
}


export interface BiliInboxItem {
  kind: 'reply' | 'at' | 'like';
  who: string;
  when: number;
  text: string;
  title?: string;
  link?: string;
  bvid?: string;
  rpid?: number;
  root?: number;
  parent?: number;
}

export interface BiliDmSession {
  talkerId: number;
  name: string;
  unread: number;
  lastAt: number;
  lastText: string;
}

export interface BiliDmMessage {
  at: number;
  mine: boolean;
  kind: 'text' | 'share-video' | 'image' | 'system' | 'unknown';
  text: string;
  aid?: number;
  bvid?: string;
  title?: string;
  author?: string;
}

export interface BiliComment {
  user: string;
  message: string;
  like: number;
  at: string;
  rpid: number;
  root: number;
}

export interface BiliDanmaku {
  time: number;
  text: string;
}

function stripHtml(text: string): string {
  return String(text || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .trim();
}

function durationText(seconds: number): string {
  const value = Math.max(0, Math.round(seconds || 0));
  const m = Math.floor(value / 60);
  const s = value % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export class BiliReadClient {
  private readonly cookieFile: string;
  private cookieHeader = '';
  private selfUid = '';
  private csrf = '';
  private cache = new Map<string, { at: number; value: unknown }>();
  private infoCache = new Map<string, { at: number; value: BiliInfo }>();
  private cookie = '';
  private cookieAt = 0;

  constructor(opts: { cookieFile?: string } = {}) {
    this.cookieFile = opts.cookieFile || '';
    this.loadCookieFile();
  }

  private loadCookieFile(): void {
    if (!this.cookieFile || !existsSync(this.cookieFile)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.cookieFile, 'utf8')) as unknown;
      if (!Array.isArray(parsed)) return;
      const pairs = parsed
        .filter((item) => item && typeof item === 'object' && String((item as Record<string, unknown>).domain || '').includes('bilibili'))
        .map((item) => {
          const row = item as Record<string, unknown>;
          return `${String(row.name)}=${String(row.value)}`;
        })
        .filter((pair) => !pair.startsWith('=') && !pair.endsWith('='));
      this.cookieHeader = pairs.join('; ');
      const rows = parsed.map((item) => item as Record<string, unknown>);
      this.selfUid = String(rows.find((row) => row.name === 'DedeUserID')?.value || '');
      this.csrf = String(rows.find((row) => row.name === 'bili_jct')?.value || '');
    } catch {
      this.cookieHeader = '';
    }
  }


  private cleanText(raw: unknown, limit = 200): string {
    if (typeof raw !== 'string') return '';
    const text = raw.replace(/<[^>]*>/g, ' ').replace(/\[[^\[\]]{1,24}\]/g, ' ').replace(/\s+/g, ' ').trim();
    return Array.from(text).slice(0, limit).join('');
  }

  private async resolveBvid(aid: number): Promise<string> {
    if (!Number.isFinite(aid) || aid <= 0) return '';
    try {
      const payload = await this.json(`https://api.bilibili.com/x/web-interface/view?aid=${aid}`);
      const data = payload.data && typeof payload.data === 'object' ? payload.data as Record<string, unknown> : {};
      return String(data.bvid || '');
    } catch {
      return '';
    }
  }

  async inbox(limit = 20): Promise<BiliInboxItem[]> {
    const headers: Record<string, string> = { 'user-agent': UA, referer: REFERER, origin: 'https://www.bilibili.com' };
    if (this.cookieHeader) headers.cookie = this.cookieHeader;
    else if (this.cookie) headers.cookie = this.cookie;
    const [reply, at] = await Promise.all([
      fetch('https://api.bilibili.com/x/msgfeed/reply?platform=web&build=0&mobi_app=web', { headers, signal: AbortSignal.timeout(12_000) }).then((r) => r.json()).catch(() => null),
      fetch('https://api.bilibili.com/x/msgfeed/at?platform=web&build=0&mobi_app=web', { headers, signal: AbortSignal.timeout(12_000) }).then((r) => r.json()).catch(() => null),
    ]);
    const parse = (payload: unknown, kind: 'reply' | 'at'): BiliInboxItem[] => {
      const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
      const data = body.data && typeof body.data === 'object' ? body.data as Record<string, unknown> : {};
      const items = Array.isArray(data.items) ? data.items : [];
      return items.slice(0, limit).map((entry) => {
        const outer = entry as Record<string, unknown>;
        const item = outer.item && typeof outer.item === 'object' ? outer.item as Record<string, unknown> : {};
        const user = outer.user && typeof outer.user === 'object' ? outer.user as Record<string, unknown> : {};
        const link = String(item.uri || '');
        const rpid = Number(item.source_id || 0) || undefined;
        const rootId = Number(item.root_id || 0) || rpid;
        const parentId = Number(item.source_id || 0) || undefined;
        const bvidMatch = link.match(/(BV[0-9A-Za-z]{10})/);
        return {
          kind,
          who: this.cleanText(user.nickname || user.uname, 40) || '有人',
          when: Number(outer.reply_time || outer.at_time || item.ctime || 0),
          text: this.cleanText(item.source_content || item.target_reply_content || ''),
          ...(item.title ? { title: this.cleanText(item.title, 80) } : {}),
          ...(link ? { link } : {}),
          ...(bvidMatch ? { bvid: bvidMatch[1] } : {}),
          ...(rpid ? { rpid } : {}),
          ...(rootId ? { root: rootId } : {}),
          ...(parentId ? { parent: parentId } : {}),
        } satisfies BiliInboxItem;
      }).filter((item) => item.text || item.title);
    };
    const merged = [...parse(reply, 'reply'), ...parse(at, 'at')];
    const seen = new Set<string>();
    return merged.filter((item) => {
      const key = `${item.kind}:${item.when}:${item.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a, b) => b.when - a.when).slice(0, limit);
  }

  async dmSessions(limit = 10): Promise<BiliDmSession[]> {
    const payload = await this.json('https://api.vc.bilibili.com/session_svr/v1/session_svr/get_sessions?session_type=1&group_id=0&sort_rule=2&build=0&mobi_app=web');
    const data = payload.data && typeof payload.data === 'object' ? payload.data as Record<string, unknown> : {};
    const list = Array.isArray(data.session_list) ? data.session_list : [];
    return list.slice(0, limit).map((entry) => {
      const row = entry as Record<string, unknown>;
      const last = row.last_msg && typeof row.last_msg === 'object' ? row.last_msg as Record<string, unknown> : {};
      let content = last.content;
      if (typeof content === 'string') {
        try { content = JSON.parse(content); } catch { /* keep string */ }
      }
      const obj = content && typeof content === 'object' ? content as Record<string, unknown> : {};
      const name = String((row.account_info as Record<string, unknown> | undefined)?.name || obj.title || `用户 ${row.talker_id}`);
      return {
        talkerId: Number(row.talker_id || 0),
        name: this.cleanText(name, 40) || '用户',
        unread: Number(row.unread_count || 0),
        lastAt: Number(last.timestamp || 0),
        lastText: this.cleanText(obj.content || last.content, 80) || '[消息]',
      };
    }).filter((row) => row.talkerId > 0);
  }

  async dmMessages(talkerId: number, size = 20): Promise<BiliDmMessage[]> {
    const payload = await this.json(`https://api.vc.bilibili.com/svr_sync/v1/svr_sync/fetch_session_msgs?talker_id=${talkerId}&session_type=1&size=${Math.max(1, Math.min(50, size))}`);
    const data = payload.data && typeof payload.data === 'object' ? payload.data as Record<string, unknown> : {};
    const rows = Array.isArray(data.messages) ? data.messages : [];
    const out: BiliDmMessage[] = [];
    for (const entry of rows) {
      const row = entry as Record<string, unknown>;
      const type = Number(row.msg_type || 1);
      let content = row.content;
      if (typeof content === 'string') {
        try { content = JSON.parse(content); } catch { /* keep */ }
      }
      const obj = content && typeof content === 'object' ? content as Record<string, unknown> : {};
      const at = Number(row.timestamp || 0);
      if (type === 7) {
        const aid = Number(obj.id || 0);
        const bvid = await this.resolveBvid(aid);
        out.push({ at, mine: Boolean(this.selfUid && String(row.sender_uid || '') === this.selfUid), kind: 'share-video', text: this.cleanText(obj.title, 120) || '分享视频', aid, bvid, title: this.cleanText(obj.title, 120), author: this.cleanText(obj.author, 60) });
      } else if (type === 2) {
        out.push({ at, mine: Boolean(this.selfUid && String(row.sender_uid || '') === this.selfUid), kind: 'image', text: '[图片]' });
      } else {
        const text = this.cleanText(obj.content || obj.text || '', 300);
        out.push({ at, mine: Boolean(this.selfUid && String(row.sender_uid || '') === this.selfUid), kind: type === 1 ? 'text' : 'unknown', text: text || '[消息]' });
      }
    }
    return out.sort((a, b) => a.at - b.at);
  }

  async nav(): Promise<{ loggedIn: boolean; name: string; mid: string; face: string }> {
    const payload = await this.json('https://api.bilibili.com/x/web-interface/nav');
    const data = payload.data && typeof payload.data === 'object' ? payload.data as Record<string, unknown> : {};
    return { loggedIn: data.isLogin === true, name: String(data.uname || ''), mid: String(data.mid || ''), face: String(data.face || '') };
  }

  async playUrl(bvid: string): Promise<{ url: string; duration: number }> {
    const info = await this.info(bvid);
    const params = new URLSearchParams({ bvid, cid: String(info.cid), qn: '64', fnval: '16' });
    const payload = await this.json(`https://api.bilibili.com/x/player/playurl?${params.toString()}`);
    const data = payload.data && typeof payload.data === 'object' ? payload.data as Record<string, unknown> : {};
    const dash = data.dash && typeof data.dash === 'object' ? data.dash as Record<string, unknown> : {};
    const videos = Array.isArray(dash.video) ? dash.video : [];
    const first = videos[0] as Record<string, unknown> | undefined;
    const url = String(first?.baseUrl || first?.base_url || '');
    if (!url) throw new Error('没有拿到视频流地址（可能需要登录或版权限制）');
    return { url, duration: Number(data.timelength || info.duration * 1000) / 1000 };
  }


  async like(bvid: string, like = true): Promise<{ ok: boolean; message: string }> {
    if (!this.csrf) return { ok: false, message: '登录态缺 bili_jct，点不了赞' };
    const form = new URLSearchParams({ bvid, like: like ? '1' : '2', csrf: this.csrf });
    const response = await fetch('https://api.bilibili.com/x/web-interface/archive/like', {
      method: 'POST',
      headers: { 'user-agent': UA, referer: `https://www.bilibili.com/video/${bvid}`, origin: 'https://www.bilibili.com', 'content-type': 'application/x-www-form-urlencoded', cookie: this.cookieHeader || this.cookie },
      body: form,
      signal: AbortSignal.timeout(20_000),
    });
    const payload = await response.json().catch(() => ({ code: -1, message: `HTTP ${response.status}` })) as Record<string, unknown>;
    return Number(payload.code) === 0 ? { ok: true, message: like ? '已点赞' : '已取消点赞' } : { ok: false, message: `B站返回 ${String(payload.code)}：${String(payload.message || '')}` };
  }

  async coin(bvid: string, count = 1): Promise<{ ok: boolean; message: string }> {
    if (!this.csrf) return { ok: false, message: '登录态缺 bili_jct，投不了币' };
    const multiply = Math.max(1, Math.min(2, Math.round(count)));
    const form = new URLSearchParams({ bvid, multiply: String(multiply), select_like: '0', csrf: this.csrf });
    const response = await fetch('https://api.bilibili.com/x/web-interface/coin/add', {
      method: 'POST',
      headers: { 'user-agent': UA, referer: `https://www.bilibili.com/video/${bvid}`, origin: 'https://www.bilibili.com', 'content-type': 'application/x-www-form-urlencoded', cookie: this.cookieHeader || this.cookie },
      body: form,
      signal: AbortSignal.timeout(20_000),
    });
    const payload = await response.json().catch(() => ({ code: -1, message: `HTTP ${response.status}` })) as Record<string, unknown>;
    return Number(payload.code) === 0 ? { ok: true, message: `已投 ${multiply} 币` } : { ok: false, message: `B站返回 ${String(payload.code)}：${String(payload.message || '')}` };
  }

  async favorite(bvid: string, add = true): Promise<{ ok: boolean; message: string }> {
    if (!this.csrf || !this.selfUid) return { ok: false, message: '登录态缺 bili_jct / DedeUserID，收藏不了' };
    if (!this.cookieHeader) return { ok: false, message: '没有登录 Cookie，收藏不了' };
    const folders = await this.json(`https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid=${encodeURIComponent(this.selfUid)}`).catch(() => null);
    const data = folders?.data && typeof folders.data === 'object' ? folders.data as Record<string, unknown> : {};
    const list = Array.isArray(data.list) ? data.list : [];
    const folderId = Number((list[0] as Record<string, unknown> | undefined)?.id || 0);
    if (!folderId) return { ok: false, message: '没有默认收藏夹' };
    const info = await this.info(bvid);
    const form = new URLSearchParams({ rid: String(info.aid), type: '2', csrf: this.csrf });
    if (add) form.set('add_media_ids', String(folderId));
    else form.set('del_media_ids', String(folderId));
    const response = await fetch('https://api.bilibili.com/x/v3/fav/resource/deal', {
      method: 'POST',
      headers: { 'user-agent': UA, referer: `https://www.bilibili.com/video/${bvid}`, origin: 'https://www.bilibili.com', 'content-type': 'application/x-www-form-urlencoded', cookie: this.cookieHeader },
      body: form, signal: AbortSignal.timeout(20_000),
    });
    const payload = await response.json().catch(() => ({ code: -1, message: `HTTP ${response.status}` })) as Record<string, unknown>;
    return Number(payload.code) === 0 ? { ok: true, message: add ? '已收藏到默认收藏夹' : '已取消收藏' } : { ok: false, message: `B站返回 ${String(payload.code)}：${String(payload.message || '')}` };
  }

  async follow(bvid: string, follow = true): Promise<{ ok: boolean; message: string }> {
    if (!this.csrf) return { ok: false, message: '登录态缺 bili_jct，关注不了' };
    const info = await this.info(bvid);
    if (!info.ownerMid) return { ok: false, message: '拿不到 UP 主 mid' };
    const form = new URLSearchParams({ fid: String(info.ownerMid), act: follow ? '1' : '2', re_src: '11', csrf: this.csrf });
    const response = await fetch('https://api.bilibili.com/x/relation/modify', {
      method: 'POST',
      headers: { 'user-agent': UA, referer: `https://www.bilibili.com/video/${bvid}`, origin: 'https://www.bilibili.com', 'content-type': 'application/x-www-form-urlencoded', cookie: this.cookieHeader || this.cookie },
      body: form, signal: AbortSignal.timeout(20_000),
    });
    const payload = await response.json().catch(() => ({ code: -1, message: `HTTP ${response.status}` })) as Record<string, unknown>;
    return Number(payload.code) === 0 ? { ok: true, message: follow ? `已关注 ${info.owner}` : `已取消关注 ${info.owner}` } : { ok: false, message: `B站返回 ${String(payload.code)}：${String(payload.message || '')}` };
  }

  async share(bvid: string): Promise<{ ok: boolean; message: string }> {
    if (!this.csrf) return { ok: false, message: '登录态缺 bili_jct，分享不了' };
    const info = await this.info(bvid);
    const form = new URLSearchParams({ aid: String(info.aid), csrf: this.csrf });
    const response = await fetch('https://api.bilibili.com/x/web-interface/share/add', {
      method: 'POST',
      headers: { 'user-agent': UA, referer: `https://www.bilibili.com/video/${bvid}`, origin: 'https://www.bilibili.com', 'content-type': 'application/x-www-form-urlencoded', cookie: this.cookieHeader || this.cookie },
      body: form, signal: AbortSignal.timeout(20_000),
    });
    const payload = await response.json().catch(() => ({ code: -1, message: `HTTP ${response.status}` })) as Record<string, unknown>;
    return Number(payload.code) === 0 ? { ok: true, message: '已分享视频' } : { ok: false, message: `B站返回 ${String(payload.code)}：${String(payload.message || '')}` };
  }

  async watchLater(bvid: string): Promise<{ ok: boolean; message: string }> {
    if (!this.csrf) return { ok: false, message: '登录态缺 bili_jct，加不了稍后再看' };
    const info = await this.info(bvid);
    const form = new URLSearchParams({ aid: String(info.aid), csrf: this.csrf });
    const response = await fetch('https://api.bilibili.com/x/v2/history/toview/add', {
      method: 'POST',
      headers: { 'user-agent': UA, referer: 'https://www.bilibili.com/', origin: 'https://www.bilibili.com', 'content-type': 'application/x-www-form-urlencoded', cookie: this.cookieHeader || this.cookie },
      body: form, signal: AbortSignal.timeout(20_000),
    });
    const payload = await response.json().catch(() => ({ code: -1, message: `HTTP ${response.status}` })) as Record<string, unknown>;
    return Number(payload.code) === 0 ? { ok: true, message: '已加入稍后再看' } : { ok: false, message: `B站返回 ${String(payload.code)}：${String(payload.message || '')}` };
  }

  async danmaku(bvid: string, text: string, seconds = 1): Promise<{ ok: boolean; message: string }> {
    if (!this.csrf) return { ok: false, message: '登录态缺 bili_jct，发不了弹幕' };
    const info = await this.info(bvid);
    const form = new URLSearchParams({ oid: String(info.cid), type: '1', msg: text.slice(0, 100), progress: String(Math.max(0, Math.round(seconds * 1000))), csrf: this.csrf, plat: '1' });
    const response = await fetch('https://api.bilibili.com/x/v1/dm/post', {
      method: 'POST',
      headers: { 'user-agent': UA, referer: `https://www.bilibili.com/video/${bvid}`, origin: 'https://www.bilibili.com', 'content-type': 'application/x-www-form-urlencoded', cookie: this.cookieHeader || this.cookie },
      body: form, signal: AbortSignal.timeout(20_000),
    });
    const payload = await response.json().catch(() => ({ code: -1, message: `HTTP ${response.status}` })) as Record<string, unknown>;
    return Number(payload.code) === 0 ? { ok: true, message: '弹幕已发' } : { ok: false, message: `B站返回 ${String(payload.code)}：${String(payload.message || '')}` };
  }

  async commentAction(bvid: string, rpid: number, like: boolean): Promise<{ ok: boolean; message: string }> {
    if (!this.csrf) return { ok: false, message: '登录态缺 bili_jct' };
    const info = await this.info(bvid);
    const form = new URLSearchParams({ oid: String(info.aid), type: '1', rpid: String(rpid), action: like ? '1' : '0', csrf: this.csrf });
    const response = await fetch('https://api.bilibili.com/x/v2/reply/action', {
      method: 'POST',
      headers: { 'user-agent': UA, referer: `https://www.bilibili.com/video/${bvid}`, origin: 'https://www.bilibili.com', 'content-type': 'application/x-www-form-urlencoded', cookie: this.cookieHeader || this.cookie },
      body: form, signal: AbortSignal.timeout(20_000),
    });
    const payload = await response.json().catch(() => ({ code: -1, message: `HTTP ${response.status}` })) as Record<string, unknown>;
    return Number(payload.code) === 0 ? { ok: true, message: like ? '已点赞评论' : '已取消评论点赞' } : { ok: false, message: `B站返回 ${String(payload.code)}：${String(payload.message || '')}` };
  }

  async deleteComment(bvid: string, rpid: number): Promise<{ ok: boolean; message: string }> {
    if (!this.csrf) return { ok: false, message: '登录态缺 bili_jct' };
    const info = await this.info(bvid);
    const form = new URLSearchParams({ oid: String(info.aid), type: '1', rpid: String(rpid), csrf: this.csrf });
    const response = await fetch('https://api.bilibili.com/x/v2/reply/del', {
      method: 'POST',
      headers: { 'user-agent': UA, referer: `https://www.bilibili.com/video/${bvid}`, origin: 'https://www.bilibili.com', 'content-type': 'application/x-www-form-urlencoded', cookie: this.cookieHeader || this.cookie },
      body: form, signal: AbortSignal.timeout(20_000),
    });
    const payload = await response.json().catch(() => ({ code: -1, message: `HTTP ${response.status}` })) as Record<string, unknown>;
    return Number(payload.code) === 0 ? { ok: true, message: '评论已删除' } : { ok: false, message: `B站返回 ${String(payload.code)}：${String(payload.message || '')}` };
  }

  private accountHeaders(): Record<string, string> {
    return {
      'user-agent': UA,
      referer: 'https://account.bilibili.com/account/setting',
      origin: 'https://account.bilibili.com',
      cookie: this.cookieHeader || this.cookie,
    };
  }

  async memberAccount(): Promise<{ uname: string; sign: string; face: string; sex: string; birthday: string }> {
    const response = await fetch('https://api.bilibili.com/x/member/web/account', { headers: this.accountHeaders(), signal: AbortSignal.timeout(20_000) });
    const payload = await response.json().catch(() => ({ code: -1, message: `HTTP ${response.status}` })) as Record<string, unknown>;
    const data = payload.data && typeof payload.data === 'object' ? payload.data as Record<string, unknown> : {};
    if (Number(payload.code) !== 0) throw new Error(`B站返回 ${String(payload.code)}：${String(payload.message || '')}`);
    return {
      uname: String(data.uname || ''),
      sign: String(data.sign || ''),
      face: String(data.face || ''),
      sex: String(data.sex || ''),
      birthday: String(data.birthday || ''),
    };
  }

  async updateSignature(sign: string): Promise<{ ok: boolean; message: string }> {
    if (!this.csrf) return { ok: false, message: '登录态缺 bili_jct，改不了签名' };
    const text = sign.trim().slice(0, 70);
    const form = new URLSearchParams({ user_sign: text, csrf: this.csrf });
    const response = await fetch('https://api.bilibili.com/x/member/web/sign/update', {
      method: 'POST',
      headers: { ...this.accountHeaders(), 'content-type': 'application/x-www-form-urlencoded' },
      body: form,
      signal: AbortSignal.timeout(20_000),
    });
    const payload = await response.json().catch(() => ({ code: -1, message: `HTTP ${response.status}` })) as Record<string, unknown>;
    const code = Number(payload.code ?? -1);
    return code === 0 ? { ok: true, message: text ? '签名已提交（可能需审核）' : '签名已清空' } : { ok: false, message: `B站返回 ${code}：${String(payload.message || '')}` };
  }

  async updateFace(path: string): Promise<{ ok: boolean; message: string }> {
    if (!this.csrf) return { ok: false, message: '登录态缺 bili_jct，改不了头像' };
    if (!existsSync(path)) return { ok: false, message: `找不到头像 ${path}` };
    const ext = path.split('.').pop()?.toLowerCase() || '';
    if (!['png', 'jpg', 'jpeg'].includes(ext)) return { ok: false, message: '头像只支持 png / jpg' };
    const buf = readFileSync(path);
    if (buf.length > 2 * 1024 * 1024) return { ok: false, message: '头像不能超过 2MB' };
    const form = new FormData();
    form.append('dopost', 'save');
    form.append('DisplayRank', '10000');
    form.append('face', new Blob([buf], { type: ext === 'png' ? 'image/png' : 'image/jpeg' }), basename(path));
    const response = await fetch(`https://api.bilibili.com/x/member/web/face/update?csrf=${encodeURIComponent(this.csrf)}`, {
      method: 'POST',
      headers: this.accountHeaders(),
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    const payload = await response.json().catch(() => ({ code: -1, message: `HTTP ${response.status}` })) as Record<string, unknown>;
    const code = Number(payload.code ?? -1);
    return code === 0 ? { ok: true, message: '头像已更新' } : { ok: false, message: `B站返回 ${code}：${String(payload.message || '')}` };
  }

  async ownerName(uid: string): Promise<string> {
    const id = String(uid || '').trim();
    if (!id) return '';
    try {
      const payload = await this.json(`https://api.bilibili.com/x/web-interface/card?mid=${encodeURIComponent(id)}`);
      const data = payload.data && typeof payload.data === 'object' ? payload.data as Record<string, unknown> : {};
      const card = data.card && typeof data.card === 'object' ? data.card as Record<string, unknown> : {};
      return this.cleanText(card.name, 40);
    } catch {
      return '';
    }
  }

  async uploadImage(path: string): Promise<{ ok: boolean; picture?: { img_src: string; img_width: number; img_height: number; img_size: number }; message?: string }> {
    if (!this.csrf) return { ok: false, message: '登录态缺 bili_jct，传不了图' };
    if (!existsSync(path)) return { ok: false, message: `找不到图片 ${path}` };
    const ext = path.split('.').pop()?.toLowerCase() || '';
    const mime = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    const form = new FormData();
    form.append('file_up', new Blob([readFileSync(path)], { type: mime }), basename(path));
    form.append('biz', 'new_dyn');
    form.append('category', 'daily');
    form.append('csrf', this.csrf);
    const response = await fetch('https://api.bilibili.com/x/dynamic/feed/draw/upload_bfs', {
      method: 'POST',
      headers: {
        'user-agent': UA, referer: 'https://www.bilibili.com/', origin: 'https://www.bilibili.com',
        cookie: this.cookieHeader || this.cookie,
      },
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
    const payload = await response.json().catch(() => ({ code: -1, message: `HTTP ${response.status}` })) as Record<string, unknown>;
    const data = payload.data && typeof payload.data === 'object' ? payload.data as Record<string, unknown> : {};
    if (Number(payload.code) !== 0 || !data.image_url) return { ok: false, message: `B站返回 ${String(payload.code)}：${String(payload.message || '')}` };
    return {
      ok: true,
      picture: {
        img_src: String(data.image_url).replace(/^http:\/\//, 'https://'),
        img_width: Number(data.image_width || 0),
        img_height: Number(data.image_height || 0),
        img_size: Number(data.img_size || 0),
      },
    };
  }

  async comment(bvid: string, text: string, opts: { root?: number; parent?: number; mentionUid?: string; mentionOwner?: boolean; imagePath?: string } = {}): Promise<{ ok: boolean; message: string; rpid?: number; mentioned?: boolean; imageUploaded?: boolean; imageError?: string }> {
    if (!this.csrf || !this.selfUid) return { ok: false, message: '登录态缺 bili_jct / DedeUserID，发不了评论' };
    const info = await this.info(bvid);
    const trimmed = text.trim().slice(0, 500);
    if (!trimmed) return { ok: false, message: '评论内容是空的' };
    let ownerName = '';
    if (opts.mentionOwner === true && opts.mentionUid) {
      ownerName = await this.ownerName(opts.mentionUid);
      if (!ownerName) return { ok: false, message: '拿不到主人昵称，不能保证 @ 生效' };
    }
    const message = `${ownerName ? `@${ownerName} ` : ''}${trimmed}`;
    const body = new URLSearchParams({ oid: String(info.aid), type: '1', message, csrf: this.csrf, plat: '1' });
    let imageUploaded = false;
    let imageError = '';
    if (opts.imagePath) {
      const upload = await this.uploadImage(opts.imagePath).catch((error) => ({ ok: false, message: String(error) }));
      if (upload.ok && upload.picture) {
        body.set('pictures', JSON.stringify([upload.picture]));
        imageUploaded = true;
      } else {
        imageError = upload.message || '图片上传失败';
      }
    }
    if (opts.root) {
      body.set('root', String(opts.root));
      body.set('parent', String(opts.parent || opts.root));
    }
    const response = await fetch('https://api.bilibili.com/x/v2/reply/add', {
      method: 'POST',
      headers: {
        'user-agent': UA, referer: `https://www.bilibili.com/video/${bvid}`, origin: 'https://www.bilibili.com',
        'content-type': 'application/x-www-form-urlencoded', cookie: this.cookieHeader || this.cookie,
      },
      body,
      signal: AbortSignal.timeout(20_000),
    });
    const payload = await response.json().catch(() => ({ code: -1, message: `HTTP ${response.status}` })) as Record<string, unknown>;
    const code = Number(payload.code ?? -1);
    if (code !== 0) return { ok: false, message: `B站返回 ${code}：${String(payload.message || '')}` };
    const data = payload.data && typeof payload.data === 'object' ? payload.data as Record<string, unknown> : {};
    const reply = data.reply && typeof data.reply === 'object' ? data.reply as Record<string, unknown> : {};
    const content = reply.content && typeof reply.content === 'object' ? reply.content as Record<string, unknown> : {};
    const members = Array.isArray(content.members) ? content.members : [];
    const mentioned = !ownerName || members.some((member) => String((member as Record<string, unknown>).mid || '') === String(opts.mentionUid || ''));
    return { ok: true, message: ownerName ? `已评论并 @${ownerName}` : '已评论', rpid: Number(data.rpid || 0) || undefined, mentioned, imageUploaded, ...(imageError ? { imageError } : {}) };
  }

  async dmSend(talkerId: number, text: string): Promise<{ ok: boolean; message: string }> {
    if (!this.csrf || !this.selfUid) return { ok: false, message: '登录态缺 DedeUserID / bili_jct，发不了私信' };
    const clean = text.replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!clean) return { ok: false, message: '私信内容是空的' };
    const form = new URLSearchParams();
    form.set('msg[sender_uid]', this.selfUid);
    form.set('msg[receiver_id]', String(talkerId));
    form.set('msg[receiver_type]', '1');
    form.set('msg[msg_type]', '1');
    form.set('msg[content]', JSON.stringify({ content: clean }));
    form.set('msg[dev_id]', randomUUID().toUpperCase());
    form.set('msg[timestamp]', String(Math.floor(Date.now() / 1000)));
    form.set('csrf', this.csrf);
    form.set('csrf_token', this.csrf);
    const response = await fetch('https://api.vc.bilibili.com/web_im/v1/web_im/send_msg', {
      method: 'POST',
      headers: {
        'user-agent': UA, referer: 'https://message.bilibili.com/', origin: 'https://message.bilibili.com',
        'content-type': 'application/x-www-form-urlencoded', cookie: this.cookieHeader || this.cookie,
      },
      body: form,
      signal: AbortSignal.timeout(20_000),
    });
    const payload = await response.json().catch(() => ({ code: -1, message: `HTTP ${response.status}` })) as Record<string, unknown>;
    const code = Number(payload.code ?? -1);
    return code === 0 ? { ok: true, message: '已发私信' } : { ok: false, message: `B站返回 ${code}：${String(payload.message || '')}` };
  }

  async videoShots(bvid: string): Promise<{ imageUrl: string; cols: number; rows: number; cellW: number; cellH: number }> {
    const info = await this.info(bvid);
    const params = new URLSearchParams({ bvid, cid: String(info.cid), index: '1' });
    const payload = await this.json(`https://api.bilibili.com/x/player/videoshot?${params.toString()}`);
    const data = payload.data && typeof payload.data === 'object' ? payload.data as Record<string, unknown> : {};
    const images = Array.isArray(data.image) ? data.image : [];
    const first = String(images[0] || '');
    if (!first) throw new Error('这条视频没有缩略图网格');
    return {
      imageUrl: first.startsWith('//') ? `https:${first}` : first,
      cols: Number(data.img_x_len || 10),
      rows: Number(data.img_y_len || 10),
      cellW: Number(data.img_x_size || 160),
      cellH: Number(data.img_y_size || 90),
    };
  }

  async downloadVideo(bvid: string, maxBytes = 40 * 1024 * 1024): Promise<Uint8Array> {
    const play = await this.playUrl(bvid);
    const response = await this.get(play.url, 60_000);
    const length = Number(response.headers.get('content-length') || 0);
    if (length > maxBytes) throw new Error(`视频太大：${length} > ${maxBytes}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new Error('视频超过大小限制');
    return bytes;
  }

  async popular(limit = 8): Promise<Array<{ bvid: string; title: string; owner: string; duration: number }>> {
    const payload = await this.json(`https://api.bilibili.com/x/web-interface/popular?ps=${Math.max(1, Math.min(20, limit))}&pn=1`);
    const data = payload.data && typeof payload.data === 'object' ? payload.data as Record<string, unknown> : {};
    const list = Array.isArray(data.list) ? data.list : [];
    return list.map((entry) => {
      const row = entry as Record<string, unknown>;
      return {
        bvid: String(row.bvid || ''),
        title: String(row.title || ''),
        owner: String((row.owner as Record<string, unknown> | undefined)?.name || ''),
        duration: Number(row.duration || 0),
      };
    }).filter((item) => item.bvid);
  }

  async history(limit = 20): Promise<Array<{ bvid: string; title: string; author: string; progress: number; duration: number; at: string }>> {
    const params = new URLSearchParams({ max: '0', view_at: '0', business: '', ps: String(Math.max(1, Math.min(50, limit))) });
    const payload = await this.json(`https://api.bilibili.com/x/web-interface/history/cursor?${params.toString()}`);
    const data = payload.data && typeof payload.data === 'object' ? payload.data as Record<string, unknown> : {};
    const list = Array.isArray(data.list) ? data.list : [];
    return list.map((item) => {
      const row = item as Record<string, unknown>;
      return {
        bvid: String((row.history as Record<string, unknown> | undefined)?.bvid || row.bvid || ''),
        title: String(row.title || ''),
        author: String(row.author_name || row.author || ''),
        progress: Number(row.progress || 0),
        duration: Number(row.duration || 0),
        at: new Date(Number(row.view_at || 0) * 1000).toISOString(),
      };
    }).filter((item) => item.bvid);
  }

  private async ensureCookie(): Promise<void> {
    if (this.cookie && Date.now() - this.cookieAt < 3_600_000) return;
    try {
      const response = await fetch('https://api.bilibili.com/x/frontend/finger/spi', {
        headers: { 'user-agent': UA, referer: REFERER },
        signal: AbortSignal.timeout(8_000),
      });
      const payload = await response.json() as Record<string, unknown>;
      const data = payload.data && typeof payload.data === 'object' ? payload.data as Record<string, unknown> : {};
      const b3 = String(data.b_3 || '');
      const b4 = String(data.b_4 || '');
      if (b3) {
        this.cookie = `buvid3=${b3}${b4 ? `; buvid4=${b4}` : ''}`;
        this.cookieAt = Date.now();
      }
    } catch {
      // 没有设备指纹也继续；412 时由上层给出可读错误。
    }
  }

  private async get(url: string, timeoutMs = 12_000): Promise<Response> {
    await this.ensureCookie();
    const headers: Record<string, string> = {
      'user-agent': UA, referer: REFERER, origin: 'https://www.bilibili.com',
      accept: 'application/json,text/xml,*/*',
    };
    if (this.cookieHeader) headers.cookie = this.cookieHeader;
    else if (this.cookie) headers.cookie = this.cookie;
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (response.status === 412) throw new Error('B 站风控拦截（412），稍后再试或登录后读取。');
    if (!response.ok) throw new Error(`B 站请求失败：HTTP ${response.status}`);
    return response;
  }

  private async json(url: string): Promise<Record<string, unknown>> {
    const response = await this.get(url);
    const payload = await response.json() as Record<string, unknown>;
    if (payload.code !== 0) {
      throw new Error(`B 站接口错误 ${String(payload.code)}：${String(payload.message || '')}`);
    }
    return payload;
  }

  async search(keyword: string, limit = 8): Promise<BiliSearchItem[]> {
    const query = keyword.trim();
    if (!query) return [];
    const key = `search:${query}:${limit}`;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < 60_000) return cached.value as BiliSearchItem[];
    const payload = await this.json(`https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(query)}&page=1`);
    const data = payload.data && typeof payload.data === 'object' ? payload.data as Record<string, unknown> : {};
    const result = Array.isArray(data.result) ? data.result : [];
    const hits = result.slice(0, Math.max(1, Math.min(20, limit))).map((item) => {
      const row = item as Record<string, unknown>;
      return {
        bvid: String((row.history as Record<string, unknown> | undefined)?.bvid || row.bvid || ''),
        title: stripHtml(String(row.title || '')),
        author: String(row.author || ''),
        duration: String(row.duration || ''),
        play: Number(row.play || 0),
        cover: String(row.pic || '').replace(/^\/\//, 'https://'),
      };
    }).filter((item) => item.bvid);
    this.cache.set(key, { at: Date.now(), value: hits });
    return hits;
  }

  async info(bvid: string): Promise<BiliInfo> {
    const id = bvid.trim();
    if (!/^BV[0-9A-Za-z]+$/.test(id)) throw new Error('bvid 格式不对');
    const cached = this.infoCache.get(id);
    if (cached && Date.now() - cached.at < 60_000) return cached.value;
    const payload = await this.json(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(id)}`);
    const data = payload.data && typeof payload.data === 'object' ? payload.data as Record<string, unknown> : {};
    const pages = Array.isArray(data.pages) ? data.pages.map((page) => {
      const row = page as Record<string, unknown>;
      return {
        page: Number(row.page || 1),
        cid: Number(row.cid || 0),
        part: String(row.part || ''),
        duration: Number(row.duration || 0),
      };
    }) : [];
    const info: BiliInfo = {
      bvid: String(data.bvid || id),
      aid: Number(data.aid || 0),
      cid: Number(data.cid || 0),
      title: String(data.title || ''),
      owner: String((data.owner as Record<string, unknown> | undefined)?.name || ''),
      ownerMid: Number((data.owner as Record<string, unknown> | undefined)?.mid || 0),
      duration: Number(data.duration || 0),
      desc: String(data.desc || ''),
      cover: String(data.pic || '').replace(/^\/\//, 'https://'),
      play: Number((data.stat as Record<string, unknown> | undefined)?.view || 0),
      pages,
    };
    this.infoCache.set(id, { at: Date.now(), value: info });
    return info;
  }

  async comments(bvid: string, limit = 8): Promise<BiliComment[]> {
    const details = await this.info(bvid);
    const payload = await this.json(`https://api.bilibili.com/x/v2/reply?type=1&oid=${details.aid}&sort=2&ps=${Math.max(1, Math.min(20, limit))}`);
    const data = payload.data && typeof payload.data === 'object' ? payload.data as Record<string, unknown> : {};
    const replies = Array.isArray(data.replies) ? data.replies : [];
    return replies.map((reply) => {
      const row = reply as Record<string, unknown>;
      const member = row.member && typeof row.member === 'object' ? row.member as Record<string, unknown> : {};
      const content = row.content && typeof row.content === 'object' ? row.content as Record<string, unknown> : {};
      return {
        user: String(member.uname || ''),
        message: stripHtml(String(content.message || '')),
        like: Number(row.like || 0),
        at: new Date(Number(row.ctime || 0) * 1000).toISOString(),
      };
    }).filter((item) => item.message);
  }

  async danmaku(bvid: string, limit = 80): Promise<BiliDanmaku[]> {
    const details = await this.info(bvid);
    if (!details.cid) return [];
    const response = await this.get(`https://comment.bilibili.com/${details.cid}.xml`);
    const xml = await response.text();
    const list: BiliDanmaku[] = [];
    const pattern = /<d p="([^"]+)">([^<]*)<\/d>/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(xml)) && list.length < Math.max(1, Math.min(500, limit))) {
      const time = Number(match[1].split(',')[0]) || 0;
      const text = stripHtml(match[2]);
      if (text) list.push({ time, text });
    }
    return list;
  }

  /** 无登录态下字幕通常为空；保留接口给 M3 登录后使用。 */
  async subtitles(bvid: string): Promise<Array<{ from: number; to: number; text: string }>> {
    const details = await this.info(bvid);
    const payload = await this.json(`https://api.bilibili.com/x/player/v2?aid=${details.aid}&cid=${details.cid}`);
    const data = payload.data && typeof payload.data === 'object' ? payload.data as Record<string, unknown> : {};
    const subtitle = data.subtitle && typeof data.subtitle === 'object' ? data.subtitle as Record<string, unknown> : {};
    const list = Array.isArray(subtitle.subtitles) ? subtitle.subtitles : [];
    if (!list.length) return [];
    const first = list[0] as Record<string, unknown>;
    const url = String(first.subtitle_url || '');
    if (!url) return [];
    const response = await this.get(url.startsWith('//') ? `https:${url}` : url);
    const body = await response.json() as Record<string, unknown>;
    const lines = Array.isArray(body.body) ? body.body : [];
    return lines.map((line) => {
      const row = line as Record<string, unknown>;
      return { from: Number(row.from || 0), to: Number(row.to || 0), text: String(row.content || '').trim() };
    }).filter((line) => line.text);
  }
}
