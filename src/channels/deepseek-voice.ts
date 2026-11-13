/**
 * DeepSeek 语音转写：ASR。
 *
 * 不接本地语音模型；用现有 DeepSeek API Key 调官方接口：
 *   POST /v1/tools/asr  multipart file（16-bit PCM WAV / Ogg Opus，≤120s）
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface DeepSeekVoiceOptions {
  botDir: string;
  baseUrl?: string;
  keyFile?: string;
}

export class DeepSeekVoice {
  private readonly baseUrl: string;
  private readonly keyFile: string;

  constructor(opts: DeepSeekVoiceOptions) {
    this.baseUrl = (opts.baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '').replace(/\/v1$/, '');
    this.keyFile = opts.keyFile || join(opts.botDir, '..', 'providers', 'deepseek', '.env');
  }

  private apiKey(): string {
    if (process.env.DEEPSEEK_API_KEY?.trim()) return process.env.DEEPSEEK_API_KEY.trim();
    if (!existsSync(this.keyFile)) return '';
    try {
      const raw = readFileSync(this.keyFile, 'utf8');
      const hit = /^\s*DEEPSEEK_API_KEY\s*=\s*(.+?)\s*$/m.exec(raw);
      return hit?.[1]?.replace(/^['"]|['"]$/g, '').trim() || '';
    } catch {
      return '';
    }
  }

  private ffmpegPath(): string | null {
    if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
    try {
      const req = createRequire(import.meta.url);
      const mod = req('@ffmpeg-installer/ffmpeg') as { path?: string };
      if (mod?.path) return mod.path;
    } catch { /* try PATH */ }
    const probe = spawnSync('ffmpeg', ['-version'], { timeout: 3_000, windowsHide: true });
    return probe.status === 0 ? 'ffmpeg' : null;
  }

  async transcribe(path: string): Promise<{ text: string; error?: string }> {
    const key = this.apiKey();
    if (!key) return { text: '', error: '没有 DeepSeek API Key（DEEPSEEK_API_KEY 或 providers/deepseek/.env）' };
    const ffmpeg = this.ffmpegPath();
    if (!ffmpeg) return { text: '', error: '没有找到 ffmpeg' };
    const dir = mkdtempSync(join(tmpdir(), 'coo-ds-asr-'));
    try {
      const wav = join(dir, 'audio.wav');
      const converted = spawnSync(ffmpeg, [
        '-hide_banner', '-loglevel', 'error', '-y', '-i', path,
        '-t', '120', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav,
      ], { timeout: 30_000, windowsHide: true });
      if (converted.status !== 0 || !existsSync(wav)) return { text: '', error: '音频转码失败（可能是 SILK/AMR）' };
      const bytes = readFileSync(wav);
      if (bytes.length > 8 * 1024 * 1024) return { text: '', error: '音频超过 8 MiB' };
      const form = new FormData();
      form.append('file', new Blob([bytes], { type: 'audio/wav' }), 'audio.wav');
      const response = await fetch(`${this.baseUrl}/v1/tools/asr`, {
        method: 'POST',
        headers: { authorization: `Bearer ${key}` },
        body: form,
        signal: AbortSignal.timeout(120_000),
      });
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!response.ok) return { text: '', error: `DeepSeek ASR HTTP ${response.status}：${String(payload.error || payload.message || '').slice(0, 200)}` };
      return { text: String(payload.text || '').trim() };
    } catch (error) {
      return { text: '', error: `DeepSeek ASR 失败：${error instanceof Error ? error.message : String(error)}` };
    } finally {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }

}
