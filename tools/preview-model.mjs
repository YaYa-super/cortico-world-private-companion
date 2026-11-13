/**
 * 用户模型预览（只读）：从线上记忆推导“我对他的理解”，看看会注入什么。
 *
 * 用法：
 *   node tools/preview-model.mjs
 *   node tools/preview-model.mjs --data "D:/Coopanion/data/home/companion/data"
 *
 * 不写任何文件；落盘与注入形态等接进 world 之后再定。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { MemoryStore } from '../src/memory-store.ts';
import { localParts } from '../src/time.ts';
import { deriveUserModel, renderUserModel } from '../src/user-model.ts';

const args = process.argv.slice(2);
const valueOf = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
const DATA = valueOf('--data') || 'D:/Coopanion/data/home/companion/data';
const BOT = join(DATA, 'private-companion');
const state = JSON.parse(readFileSync(join(BOT, 'state.json'), 'utf8'));
const store = new MemoryStore(join(BOT, 'memory'));
if (store.error) console.warn('记忆库错误：', store.error);

const now = new Date();
const tz = 'Asia/Shanghai';
const model = deriveUserModel({ records: store.entries(), now, tz, maxItems: 8 });
const text = renderUserModel(model);
const p = localParts(now, tz);

console.log(`# 用户模型 · ${p.date} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`);
console.log(`记录 ${store.stats().records} 条（人物 ${store.people().length}） · 模型 ${model.items.length} 条 · sourceHash ${model.sourceHash}`);
console.log('');
console.log(text || '（没有可注入的内容）');
console.log('');
console.log(`注入长度：${text.length} 字（预算 300）`);
console.log('');
console.log('# 明细');
for (const item of model.items) {
  console.log(`- [${item.kind}] ${item.key} · 置信 ${item.confidence.toFixed(2)} · 证据 ${item.evidenceRefs.length}`);
  console.log(`  ${item.text}`);
}
store.close?.();
