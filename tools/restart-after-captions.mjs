import { spawn, spawnSync } from 'node:child_process';
import { ChannelMediaStore } from '../src/channels/media-store.ts';

const mediaDir = process.argv[2];
const limitMs = Number(process.argv[3]) || 6 * 3_600_000;
const started = Date.now();
const store = new ChannelMediaStore(mediaDir);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

for (;;) {
  const pending = store.all().filter((record) => !record.meaning).length;
  console.log(new Date().toISOString(), `pending=${pending}`);
  if (pending === 0 || Date.now() - started > limitMs) break;
  await sleep(60_000);
}

spawnSync('taskkill', ['/IM', 'Coopanion.exe', '/F'], { windowsHide: true });
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = spawn('D:/Coopanion/Coopanion.exe', [], { detached: true, stdio: 'ignore', env, windowsHide: false });
app.unref();
console.log('restarted Coopanion', app.pid);
