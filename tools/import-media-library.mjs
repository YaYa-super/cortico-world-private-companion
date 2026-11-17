import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ChannelMediaStore } from '../src/channels/media-store.ts';
import { imageForVision } from '../src/channels/image-view.ts';

const root = process.argv[2];
const mediaDir = process.argv[3];
const withCaption = process.argv.includes('--caption');
if (!root || !mediaDir) {
  console.error('usage: node tools/import-media-library.mjs <source-dir> <media-dir> [--caption]');
  process.exit(2);
}

const extensions = /\.(png|jpe?g|jfif|gif|webp|bmp|avif)$/i;
const files = [];
const walk = (path) => {
  for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) walk(child);
    else if (entry.isFile() && extensions.test(entry.name)) files.push(child);
  }
};
walk(root);
console.log(`发现 ${files.length} 张图片`);

const store = new ChannelMediaStore(mediaDir);
let imported = 0;
let duplicates = 0;
let skipped = 0;
const records = new Map();
for (let index = 0; index < files.length; index += 1) {
  const result = store.importFile(files[index]);
  if (!result) skipped += 1;
  else {
    records.set(result.record.hash, result.record);
    if (result.duplicate) duplicates += 1;
    else imported += 1;
  }
  if ((index + 1) % 200 === 0 || index + 1 === files.length) {
    console.log(`导入 ${index + 1}/${files.length} · 新增 ${imported} · 重复 ${duplicates} · 跳过 ${skipped}`);
  }
}
console.log(`导入完成：新增 ${imported}，重复 ${duplicates}，跳过 ${skipped}，库内去重 ${records.size}`);

if (withCaption) {
  const pending = [...records.values()].filter((record) => !record.meaning);
  console.log(`开始自动描述：${pending.length} 张`);
  let next = 0;
  let captioned = 0;
  let failed = 0;
  const worker = async () => {
    for (;;) {
      const record = pending[next++];
      if (!record) return;
      try {
        const prepared = imageForVision(record.path, 768);
        if (!prepared) { failed += 1; continue; }
        const data = Buffer.from(prepared.bytes).toString('base64');
        const response = await fetch('http://127.0.0.1:8081/v1/chat/completions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: 'qwen2.5-vl-3b',
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
        store.attachMeaning(record.hash, meaning);
        captioned += 1;
      } catch {
        failed += 1;
      }
      if ((captioned + failed) % 25 === 0) console.log(`描述 ${captioned + failed}/${pending.length} · 成功 ${captioned} · 失败 ${failed}`);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  console.log(`描述完成：成功 ${captioned}，失败 ${failed}`);
}
