import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { create, defaults } from '../src/index.ts';

test('扫码登录：等待、确认、过期重试、保存并立即切换账号；重开后仍有效', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'bili-login-'));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  const ctx = { id: 'companion', cfg: { ...defaults(), biliChannelEnabled: true }, dataDir: dir, botDir: dir };
  const make = () => create(ctx as never).webUi!().invoke!;
  const invoke = make();
  let code = 86101;
  let currentCookie = '';
  const file = join(dir, 'private-companion', 'bili', 'cookies.json');
  t.mock.method(globalThis, 'fetch', async (input: string, options: RequestInit = {}) => {
    const path = new URL(input).pathname;
    if (path.endsWith('/generate')) return Response.json({code: 0, data: {url: 'https://account.bilibili.com/h5/account-h5/auth/scan-web?foo=bar', qrcode_key: 'test-key'}});
    if (path.endsWith('/poll')) {
      const headers = new Headers();
      if (!code) headers.append('set-cookie', 'SESSDATA=fixture; Domain=.bilibili.com; HttpOnly');
      return Response.json({ code: 0, data: { code } }, { headers });
    }
    if (path.endsWith('/nav')) {
      currentCookie = new Headers(options.headers).get('cookie') || '';
      return Response.json({code: 0, data: {isLogin: currentCookie.includes('SESSDATA'), uname: '测试用户'}});
    }
    return Response.json({ code: 0, data: {} });
  });
  const legacyDir = join(dir, 'data', 'bili-video-pro');
  mkdirSync(legacyDir, {recursive: true});
  const legacyFile = join(legacyDir, 'cookies.json');
  const original = JSON.stringify([{name: 'SESSDATA', value: 'legacy', domain: '.bilibili.com'}]);
  writeFileSync(legacyFile, original);
  await make()('bili', 'status', []);
  assert.equal(currentCookie, 'SESSDATA=legacy');
  const start = () => invoke('bili', 'login_start', []) as Promise<{image: string; attempt: string}>;
  const poll = (id: string) => invoke('bili', 'login_poll', [id]);
  const first = await start();
  assert.match(first.image, /^data:image\/png;base64,/);
  assert.deepEqual(await poll(first.attempt), {state: 'waiting'});
  code = 86090;
  assert.deepEqual(await poll(first.attempt), {state: 'confirm'});
  code = 86038;
  assert.deepEqual(await poll(first.attempt), {state: 'expired'});
  assert.equal(existsSync(file), false);
  const second = await start();
  code = 0;
  assert.deepEqual(await poll(first.attempt), {state: 'expired'});
  assert.deepEqual(await poll(second.attempt), {state: 'done'});
  assert.equal(JSON.parse(readFileSync(file, 'utf8'))[0].value, 'fixture');
  for (const view of [invoke, make()]) {
    await view('bili', 'status', []);
    assert.equal(currentCookie, 'SESSDATA=fixture');
  }
  assert.equal(readFileSync(legacyFile, 'utf8'), original);
  const manual = join(dir, 'manual.json');
  writeFileSync(manual, JSON.stringify([{name:'SESSDATA',value:'manual',domain:'.bilibili.com'}]));
  ctx.cfg.biliCookieFile = manual;
  const view = make();
  await view('bili', 'status', []);
  assert.equal(currentCookie, 'SESSDATA=manual');
  await assert.rejects(async () => view('bili', 'login_start', []), /Cookie 文件/);
});
