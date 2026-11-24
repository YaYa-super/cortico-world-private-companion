import { randomUUID } from 'node:crypto';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import QRCode from 'qrcode';

const endpoint = 'https://passport.bilibili.com/x/passport-login/web/qrcode/';
const expired = { state: 'expired' } as const;

async function request(path: string) {
  const response = await fetch(endpoint + path, { signal: AbortSignal.timeout(12_000), redirect: 'error' });
  if (!response.ok) throw new Error(`B站登录服务暂时不可用（HTTP ${response.status}）`);
  const payload = await response.json();
  if (payload.code !== 0 || !payload.data) throw new Error('B站登录请求失败，请重新获取二维码');
  return { data: payload.data, headers: response.headers };
}

/** 登录密钥仅在本次面板会话的服务端使用。 */
export class BiliLogin {
  private pending?: { id: string; key: string; expires: number };
  private generation = 0;

  cancel() {
    this.generation++;
    this.pending = undefined;
  }

  async start() {
    this.cancel();
    const generation = this.generation;
    const { data } = await request('generate');
    const url = new URL(data.url);
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.bilibili.com') || !data.qrcode_key) {
      throw new Error('B站返回的二维码无效，请重试');
    }
    const image = await QRCode.toDataURL(url.href, { width: 224, margin: 4 });
    if (this.generation !== generation) throw new Error('二维码已更新');
    this.pending = { id: randomUUID(), key: data.qrcode_key, expires: Date.now() + 180_000 };
    return { attempt: this.pending.id, image };
  }

  async poll(id: unknown, file: string) {
    const attempt = this.pending;
    if (!attempt || id !== attempt.id || Date.now() >= attempt.expires) return expired;
    const { data, headers } = await request('poll?qrcode_key=' + encodeURIComponent(attempt.key));
    if (this.pending !== attempt) return expired;
    switch (data.code) {
      case 86101: return { state: 'waiting' };
      case 86090: return { state: 'confirm' };
      case 86038: this.cancel(); return expired;
      case 0: break;
      default: throw new Error('B站未完成登录，请重新获取二维码');
    }
    const cookies = [];
    for (const header of headers.getSetCookie()) {
      const match = /^([^=;\s]+)=([^;]+)/.exec(header);
      if (match) cookies.push({ name: match[1], value: match[2], domain: '.bilibili.com' });
    }
    if (!cookies.some(cookie => cookie.name === 'SESSDATA')) throw new Error('未收到有效登录凭据，请重新扫码');
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    const temp = file + '.' + randomUUID() + '.tmp';
    try {
      writeFileSync(temp, JSON.stringify(cookies), { flag: 'wx', mode: 0o600 });
      renameSync(temp, file);
    } finally {
      rmSync(temp, { force: true });
    }
    this.cancel();
    return { state: 'done' };
  }
}
