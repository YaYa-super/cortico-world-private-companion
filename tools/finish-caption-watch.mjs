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

// 批量描述结束后把 GPU 还给文本模型，并恢复 CPU 视觉服务。
spawnSync('taskkill', ['/IM', 'llama-server.exe', '/F'], { windowsHide: true });
const server = 'D:/llm/llamacpp-cuda/llama-server.exe';
const text = spawn(server, [
  '-m', 'D:/ollama/models-gguf/Qwen3.5-9B-Q4_K_M.gguf',
  '--host', '127.0.0.1', '--port', '8080', '--alias', 'qwen3.5-9b',
  '-ngl', '99', '-c', '32768', '--jinja', '-t', '8', '--no-warmup',
], { detached: true, stdio: 'ignore', windowsHide: true });
text.unref();
const vision = spawn(server, [
  '-m', 'D:/ollama/models-gguf/Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf',
  '--mmproj', 'D:/ollama/models-gguf/mmproj-Qwen2.5-VL-3B-Instruct-f16.gguf',
  '--host', '127.0.0.1', '--port', '8081', '--alias', 'qwen2.5-vl-3b',
  '-ngl', '0', '-c', '8192', '--jinja', '-t', '8', '--no-warmup',
], { detached: true, stdio: 'ignore', windowsHide: true });
vision.unref();
await sleep(15_000);

spawnSync('taskkill', ['/IM', 'Coopanion.exe', '/F'], { windowsHide: true });
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = spawn('D:/Coopanion/Coopanion.exe', [], { detached: true, stdio: 'ignore', env, windowsHide: false });
app.unref();
console.log('restored models and restarted Coopanion', app.pid);
