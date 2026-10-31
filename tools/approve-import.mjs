/**
 * 隔离区审核 CLI（模型无权批准，只有人能跑这个脚本）。
 *
 * 用法（先退出 Coopanion，避免运行中的进程用内存副本覆盖）：
 *   node tools/approve-import.mjs list
 *   node tools/approve-import.mjs approve <bundleId>
 *   node tools/approve-import.mjs reject <bundleId>
 *   --data "D:/Coopanion/data/home/companion/data"
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { MemoryStore } from '../src/memory-store.ts';

const args = process.argv.slice(2);
const dataArg = args.includes('--data') ? args[args.indexOf('--data') + 1] : null;
const DATA = dataArg || 'D:/Coopanion/data/home/companion/data';
const MEM = join(DATA, 'private-companion', 'memory');

const positional = [];
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--data') {
    i += 1;
    continue;
  }
  positional.push(args[i]);
}
const [command, bundleId] = positional;

if (!existsSync(join(MEM, 'records.json'))) {
  console.error(`没有找到 ${MEM}/records.json，先确认 --data。`);
  process.exit(1);
}

const store = new MemoryStore(MEM, (message) => console.log(message), { lock: true });

if (command === 'list' || !command) {
  const items = store.listQuarantine();
  if (!items.length) {
    console.log('隔离区是空的。');
  } else {
    for (const item of items) {
      console.log(`${item.bundleId}  ${item.records} 条  ${item.stagedAt}`);
    }
  }
  process.exit(0);
}

if ((command === 'approve' || command === 'reject') && !bundleId) {
  console.error(`用法：node tools/approve-import.mjs ${command} <bundleId>`);
  process.exit(1);
}

if (command === 'approve') {
  const result = store.approveImport(bundleId);
  if (result.error) {
    console.error(`批准失败：${result.error}`);
    process.exit(1);
  }
  console.log(`已批准：新增 ${result.added}，重复 ${result.duplicates}，无效 ${result.invalid}。`);
} else if (command === 'reject') {
  console.log(store.rejectImport(bundleId) ? '已拒绝并删除该 bundle。' : '没有找到这个 bundleId。');
} else {
  console.error('未知命令，支持 list / approve / reject。');
  process.exit(1);
}
