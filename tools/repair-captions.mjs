import { ChannelMediaStore } from '../src/channels/media-store.ts';
import { imageForVision } from '../src/channels/image-view.ts';

const mediaDir = process.argv[2];
if (!mediaDir) {
  console.error('usage: node tools/repair-captions.mjs <media-dir>');
  process.exit(2);
}
const store = new ChannelMediaStore(mediaDir);
const all = store.all();
const bad = all.filter((record) => record.meaning && record.meaning.includes('?'));
for (const record of bad) store.clearMeaning(record.hash, false);
store.flush();
const pending = store.all().filter((record) => !record.meaning);
console.log(`清除乱码 ${bad.length} 条，待重写 ${pending.length} 条`);

let ok = 0;
let failed = 0;
const started = Date.now();
for (let index = 0; index < pending.length; index += 1) {
  const record = pending[index];
  let meaning = '';
  for (let attempt = 0; attempt < 3 && !meaning; attempt += 1) {
    try {
      const prepared = imageForVision(record.path, 512);
      if (!prepared) continue;
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
      if (!response.ok) continue;
      const payload = await response.json();
      const content = payload?.choices?.[0]?.message?.content;
      const candidate = String(typeof content === 'string' ? content : '').trim().slice(0, 200);
      if (candidate && !candidate.includes('?')) meaning = candidate;
    } catch {
      /* retry */
    }
  }
  if (meaning) {
    store.attachMeaning(record.hash, meaning, false);
    ok += 1;
  } else {
    failed += 1;
  }
  if ((ok + failed) % 20 === 0) store.flush();
  if ((ok + failed) % 25 === 0) {
    const perMin = (ok + failed) / Math.max(1, (Date.now() - started) / 60_000);
    console.log(`重写 ${ok + failed}/${pending.length} · 成功 ${ok} · 失败 ${failed} · ${perMin.toFixed(1)} 张/分`);
  }
}
store.flush();
console.log(`重写完成：成功 ${ok}，失败 ${failed}`);
