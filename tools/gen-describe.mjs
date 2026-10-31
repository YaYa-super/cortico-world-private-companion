/**
 * 生成 describe.json（扩展自描述：工具、事件、环境提示词）。
 * 跑法：node tools/gen-describe.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { COMPANION_WORLD } from '../src/definition.ts';

const describe = COMPANION_WORLD.describe;
if (!describe) throw new Error('definition 里没有 describe');

const envPrompt = readFileSync(new URL('../ENV_PROMPT.md', import.meta.url), 'utf8');

const payload = {
  tools: describe.tools,
  events: describe.events,
  prompts: [
    {
      key: 'worlds.companion.envPrompt',
      title: '我会永远陪着你 · 环境提示词',
      role: 'envPrompt',
      content: envPrompt,
    },
  ],
};

const target = new URL('../describe.json', import.meta.url);
writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
console.log(`describe.json: ${payload.tools.length} tools, ${payload.events.length} events, ${envPrompt.length} chars prompt`);
