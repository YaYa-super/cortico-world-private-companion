/**
 * 人格卡评测：检查 CONSTITUTION.md 是否覆盖口癖、被夸/被戳、群聊、日记、不懂怎么办等行为。
 * 这些不是记忆检索问题，不该混在记忆评测里。
 *
 * 用法：node tools/eval-persona.mjs [--constitution "D:/Coopanion/.../workspace/CONSTITUTION.md"]
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const valueOf = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
const file = valueOf('--constitution')
  || join('D:/Coopanion/data/home/companion/workspace', 'CONSTITUTION.md');
const questions = JSON.parse(readFileSync('eval/persona-questions.json', 'utf8'));

if (!existsSync(file)) {
  console.error(`没有找到 ${file}`);
  process.exit(1);
}
const text = readFileSync(file, 'utf8').toLowerCase();
let hits = 0;
const rows = [];
for (const item of questions) {
  const hit = item.expect.some((word) => text.includes(String(word).toLowerCase()));
  if (hit) hits += 1;
  rows.push({ id: item.id, q: item.q, hit });
}
console.log(JSON.stringify({
  questions: questions.length,
  hits,
  detail: rows.filter((row) => !row.hit),
}, null, 2));
