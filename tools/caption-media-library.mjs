import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ChannelMediaStore } from '../src/channels/media-store.ts';
import { imageForVision } from '../src/channels/image-view.ts';

const mediaDir = process.argv[2];
if (!mediaDir) {
  console.error('usage: node tools/caption-media-library.mjs <media-dir> [concurrency]');
  process.exit(2);
}
const concurrency = Math.max(1, Math.min(6, Number(process.argv[3]) || 4));
const store = new ChannelMediaStore(mediaDir);
const pending = store.all().filter((record) => !record.meaning);
console.log(`待描述 ${pending.length} 张，并发 ${concurrency}`);

let next = 0;
let captioned = 0;
let failed = 0;
const started = Date.now();
const worker = async () => {
  for (;;) {
    const record = pending[next++];
    if (!record) return;
    try {
      const prepared = imageForVision(record.path, 512);
      if (!prepared) { failed += 1; continue; }
      const data = Buffer.from(prepared.bytes).toString('base64');
      const response = await fetch('http://127.0.0.1:8081/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'qwen3-vl-8b',
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: '用一句中文描述这张图或表情包表达的意思，不超过 40 个字，不要解释。' },
              { type: 'image_url', image_url: { url: `data:${prepared.mime};base64,${data}` } },
            ],
          }],
          max_tokens: 64,
          temperature: 0.2,
          stream: false,
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) { failed += 1; continue; }
      const payload = await response.json();
      const content = payload?.choices?.[0]?.message?.content;
      const meaning = String(typeof content === 'string' ? content : '').trim().slice(0, 200);
      if (!meaning) { failed += 1; continue; }
      store.attachMeaning(record.hash, meaning, false);
      captioned += 1;
      if (captioned % 50 === 0) store.flush();
    } catch {
      failed += 1;
    }
    const done = captioned + failed;
    if (done % 25 === 0) {
      const perMin = done / Math.max(1, (Date.now() - started) / 60_000);
      console.log(`描述 ${done}/${pending.length} · 成功 ${captioned} · 失败 ${failed} · ${perMin.toFixed(1)} 张/分`);
    }
  }
};
await Promise.all(Array.from({ length: concurrency }, () => worker()));
store.flush();
console.log(`描述完成：成功 ${captioned}，失败 ${failed}`);
