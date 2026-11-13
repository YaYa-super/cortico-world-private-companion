/**
 * 效用模型预览（只读）：用线上状态/记忆构造几条候选，看看不同情境下的分数。
 *
 * 用法：
 *   node tools/preview-utility.mjs
 *   node tools/preview-utility.mjs --data "D:/Coopanion/data/home/companion/data"
 *
 * 不写任何文件，不改世界行为；只用来调参与对照。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { MemoryStore } from '../src/memory-store.ts';
import { localParts } from '../src/time.ts';
import { computeUtility, rankCandidates, UTILITY_DEFAULTS } from '../src/utility.ts';

const args = process.argv.slice(2);
const valueOf = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
const DATA = valueOf('--data') || 'D:/Coopanion/data/home/companion/data';
const BOT = join(DATA, 'private-companion');
const CONFIG = join(DATA, '..', 'config.json');

const state = JSON.parse(readFileSync(join(BOT, 'state.json'), 'utf8'));
const cfg = existsSync(CONFIG) ? (JSON.parse(readFileSync(CONFIG, 'utf8')).worlds?.companion ?? {}) : {};
const tz = cfg.timeZone || 'Asia/Shanghai';
const store = new MemoryStore(join(BOT, 'memory'));
if (store.error) console.warn('记忆库错误：', store.error);

const now = new Date();
const p = localParts(now, tz);
const thread = store.openThreads(1)[0];
const episode = store.highIntensityEpisodes(7, 1)[0];
const label = (text, max = 26) => String(text ?? '').replace(/\s+/g, ' ').slice(0, max);

const candidates = [
  {
    key: 'thread',
    source: 'thread',
    salience: 0.8,
    note: thread ? label(thread.details?.what ?? thread.text) : '（没有未完成话头）',
  },
  {
    key: 'memory',
    source: 'memory',
    salience: 0.6,
    note: episode ? label(episode.text) : '（没有高情绪 episode）',
  },
  { key: 'social', source: 'social', salience: 0.55, note: '很久没说话' },
  { key: 'weather', source: 'weather', salience: 0.3, note: '下雨/降温提醒' },
];

const talkMin = state.lastTalkAt
  ? Math.max(0, Math.round((now.getTime() - Date.parse(state.lastTalkAt)) / 60_000))
  : null;
const proactiveH = state.lastProactiveAt
  ? Math.round(((now.getTime() - Date.parse(state.lastProactiveAt)) / 3_600_000) * 10) / 10
  : null;
const unanswered = state.cognitionUnanswered ?? 0;

const base = {
  minutesSinceUser: talkMin,
  hoursSinceProactive: proactiveH,
  unanswered,
  closeness: 0.7,
  replyRate: 0.5,
  clinginess: Number.isFinite(cfg.proactiveClinginess) ? cfg.proactiveClinginess : UTILITY_DEFAULTS.clinginess,
};

const contexts = [
  { name: '现在', input: base },
  { name: '空闲2小时', input: { ...base, minutesSinceUser: 180, hoursSinceProactive: 8 } },
  { name: '刚聊完5分', input: { ...base, minutesSinceUser: 5 } },
  { name: '日程繁忙', input: { ...base, busy: true } },
  { name: '未回应1', input: { ...base, unanswered: 1 } },
  { name: '未回应2', input: { ...base, unanswered: 2 } },
];

console.log(`# 效用预览 · ${p.date} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`);
console.log(`状态：精力 ${Math.round(state.energy)} · 心情 ${Math.round(state.mood)} · ${state.activity}`);
console.log(`距上次说话：${talkMin === null ? '未知' : `${talkMin} 分钟`} · 距上次主动：${proactiveH === null ? '未知' : `${proactiveH} 小时`} · 未回应：${unanswered}`);
console.log(`黏人度：${base.clinginess} · 阈值：${UTILITY_DEFAULTS.threshold}`);
console.log('');

const header = ['候选'.padEnd(10), ...contexts.map((context) => context.name.padStart(12))].join(' ');
console.log(header);
for (const candidate of candidates) {
  const cells = contexts.map((context) => {
    const result = computeUtility({ ...context.input, source: candidate.source, salience: candidate.salience });
    const mark = result.ok ? '✓' : '·';
    return `${result.score.toFixed(2)} ${mark}`.padStart(12);
  });
  console.log([`${candidate.key}`.padEnd(10), ...cells].join(' '));
}

console.log('\n# 现在这一拍，各候选的理由');
for (const candidate of candidates) {
  const result = computeUtility({ ...base, source: candidate.source, salience: candidate.salience });
  console.log(`- ${candidate.key}（${candidate.note}）`);
  console.log(`  ${result.reason}`);
  console.log(`  ${result.ok ? '→ 开口' : `→ 不开口（${result.code}）`}`);
}

console.log('\n# 现在按效用排序');
for (const { candidate, result } of rankCandidates(candidates, base)) {
  console.log(`- ${candidate.key} ${result.score.toFixed(2)} ${result.ok ? '开口' : '暂缓'}`);
}
store.close?.();
