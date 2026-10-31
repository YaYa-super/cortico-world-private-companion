/**
 * 冒烟测试：不靠 Coopanion，用假宿主把 World 跑一遍。
 * 跑法：node tools/smoke.ts（Node 24 直接剥离类型）
 */
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { create, defaults } from '../src/index.ts';

const dataDir = mkdtempSync(join(tmpdir(), 'coo-companion-'));

const events: Array<{ type: string; text: string; cursor: number; trigger?: string }> = [];
let cursor = 0;
const host = {
  pushEvent: async (e: { type: string; text: string }, opts?: { trigger?: string }) => {
    cursor += 1;
    events.push({ type: e.type, text: e.text, cursor, trigger: opts?.trigger });
    return { cursor };
  },
  pushDeferred: () => {},
  store: { range: () => [], latestCursor: () => cursor, get: () => undefined, around: () => [], grep: () => [] },
  withdrawPending: async () => true,
  modelFacts: {},
  blob: () => null,
  reportUsage: () => {},
  log: { info: (...a: unknown[]) => console.log('[info]', ...a), warn: (...a: unknown[]) => console.warn('[warn]', ...a), error: console.error },
};

const cfg = { ...defaults(), enabled: true };
const ctx = {
  id: 'companion',
  cfg,
  timezone: 'Asia/Shanghai',
  botName: 'coo',
  botDir: dataDir,
  packageDir: dataDir,
  dataDir,
  repoRoot: dataDir,
  secret: () => '',
  storeSecret: () => {},
  persist: () => {},
  restart: async () => {},
};

const world = create(ctx as never);
await world.start(host as never);

const vars = world.envPromptVars();
console.log('\n== envPromptVars ==');
console.log(vars);

const tools = world.tools();
console.log('\n== tools ==', tools.map((t) => t.name));

const call = async (name: string, args: Record<string, unknown>) => {
  const tool = tools.find((t) => t.name === name)!;
  const out = await tool.handler(args, { role: 'main', log: host.log } as never);
  console.log(`\n== ${name} ${JSON.stringify(args)} ==\n${typeof out === 'string' ? out : out.text}`);
  return out;
};

await call('companion_state', { action: 'get' });
await call('companion_state', { action: 'update', energy: 31, mood: 30, activity: '看雨', location: '窗台' });
await call('companion_agenda', { action: 'get' });
await call('companion_agenda', {
  action: 'add',
  items: [{ time: '22:40', title: '听雨', place: '窗边' }, { time: 'bad', title: '坏的' }],
});
await call('companion_profile', { action: 'set', name: '主人', relation: '搭档', birthday: '03-14', notes: ['喜欢安静', '夜里不睡'] });
await call('companion_profile', { action: 'get' });
await call('companion_journal', { action: 'write', text: '今天在窗台上看了很久的雨。', kind: '日记' });
await call('companion_journal', { action: 'read', limit: 2 });
await call('companion_remember', { kind: 'rule', text: '不要在凌晨主动找人' });
await call('companion_remember', { kind: 'fact', text: '主人对花生过敏，点菜要注意' });
await call('companion_recall', { query: '花生' });
await call('companion_memory', { action: 'stats' });
await call('companion_proactive', { action: 'status' });
await call('companion_proactive', { action: 'trigger' });

console.log('\n== events ==');
for (const e of events) console.log(`#${e.cursor} [${e.trigger}] ${e.type}\n${e.text}\n`);

console.log('\n== webUi ==');
const web = world.webUi!();
console.log(JSON.stringify({ label: web.label, lamps: web.lamps, badges: web.badges, storage: web.storage?.map((s) => s.stat()) }, null, 2));

console.log('\n== state file ==');
console.log(readFileSync(join(dataDir, 'private-companion', 'state.json'), 'utf8').slice(0, 400));

await world.stop();
console.log('\nOK');
