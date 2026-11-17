/**
 * 图片/动图查看辅助：GIF 用 ffmpeg 抽几帧，失败就退回原 GIF。
 *
 * ffmpeg 是可选能力：环境变量 FFMPEG_PATH、@ffmpeg-installer/ffmpeg、PATH 任一可用即可。
 * 抽帧上限受工具层控制，避免把一条动图拆成几十张图烧 token。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { join } from 'node:path';

export interface ImageBlob {
  bytes: Uint8Array;
  mime: string;
  name: string;
  fallbackText: string;
}

const require = createRequire(import.meta.url);

function resolveFfmpeg(): string | null {
  const env = process.env.FFMPEG_PATH;
  if (env) return env;
  try {
    // 可选依赖；没装就继续找 PATH。
    const mod = require('@ffmpeg-installer/ffmpeg') as { path?: string };
    if (mod?.path) return mod.path;
  } catch {
    // ignore
  }
  const probe = spawnSync('ffmpeg', ['-version'], { timeout: 3_000, windowsHide: true });
  return probe.status === 0 ? 'ffmpeg' : null;
}

/** 给视觉模型准备一张 BMP/WebP/GIF 也能吃的 JPEG；失败返回 null。 */
export function imageForVision(path: string, maxWidth = 1280): { bytes: Uint8Array; mime: string } | null {
  const ffmpeg = resolveFfmpeg();
  if (!ffmpeg) return null;
  const dir = mkdtempSync(join(tmpdir(), 'coo-vision-'));
  try {
    const output = join(dir, 'image.jpg');
    const result = spawnSync(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', path,
      '-vf', `scale='min(${maxWidth},iw)':-2`,
      '-frames:v', '1', '-q:v', '3', output,
    ], { timeout: 30_000, windowsHide: true });
    if (result.status !== 0 || !existsSync(output)) return null;
    return { bytes: new Uint8Array(readFileSync(output)), mime: 'image/jpeg' };
  } catch {
    return null;
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

export function videoFrames(path: string, maxFrames = 4): ImageBlob[] {
  const ffmpeg = resolveFfmpeg();
  if (!ffmpeg) return [];
  const dir = mkdtempSync(join(tmpdir(), 'coo-video-'));
  try {
    const result = spawnSync(ffmpeg, [
      '-hide_banner', '-loglevel', 'error',
      '-i', path,
      '-vf', 'fps=1/8,scale=640:-1',
      '-frames:v', String(Math.max(1, Math.min(6, maxFrames))),
      join(dir, 'frame-%02d.jpg'),
    ], { timeout: 60_000, windowsHide: true });
    if (result.status !== 0) return [];
    return readdirSync(dir).filter((file) => file.endsWith('.jpg')).sort().slice(0, maxFrames).map((file, index) => ({
      bytes: readFileSync(join(dir, file)),
      mime: 'image/jpeg',
      name: `video-frame-${index + 1}.jpg`,
      fallbackText: `[视频第 ${index + 1} 帧]`,
    }));
  } catch {
    return [];
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}


/** 把若干张同尺寸截图拼成一张图集（2×2 等），返回是否成功。 */
export function montageImages(paths: string[], output: string, cols = 2, rows = 2): boolean {
  const ffmpeg = resolveFfmpeg();
  if (!ffmpeg || paths.length < 2) return false;
  const count = Math.min(paths.length, cols * rows);
  if (count !== cols * rows || count < 2) return false;
  const inputs = paths.slice(0, count).flatMap((path) => ['-i', path]);
  const filters: string[] = [];
  const rowLabels: string[] = [];
  for (let row = 0; row < rows; row += 1) {
    const indexes = Array.from({ length: cols }, (_, col) => row * cols + col).filter((index) => index < count);
    if (!indexes.length) continue;
    const sources = indexes.map((index) => `[${index}:v]`).join('');
    filters.push(`${sources}hstack=inputs=${indexes.length}[r${row}]`);
    rowLabels.push(`[r${row}]`);
  }
  if (!rowLabels.length) return false;
  const map = rowLabels.length === 1 ? rowLabels[0] : '[out]';
  if (rowLabels.length > 1) filters.push(`${rowLabels.join('')}vstack=inputs=${rowLabels.length}[out]`);
  const result = spawnSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y', ...inputs,
    '-filter_complex', filters.join(';'), '-map', map, '-frames:v', '1', '-q:v', '3', output,
  ], { timeout: 30_000, windowsHide: true });
  return result.status === 0 && existsSync(output);
}

export function cropSprite(path: string, cols: number, rows: number, cellW: number, cellH: number, count = 4, seed = ''): ImageBlob[] {
  const ffmpeg = resolveFfmpeg();
  if (!ffmpeg || cols < 1 || rows < 1 || cellW < 1 || cellH < 1) return [];
  const dir = mkdtempSync(join(tmpdir(), 'coo-sprite-'));
  try {
    const total = cols * rows;
    const wanted = Math.max(1, Math.min(6, count));
    // 伪随机选格：避开首尾极端位置，固定种子保证同一条视频不会抽到全边缘帧。
    let state = 2166136261;
    for (const ch of `${seed}:${total}:${wanted}`) state = Math.imul(state ^ ch.charCodeAt(0), 16777619) >>> 0;
    const rng = (): number => {
      state = (state + 0x6D2B79F5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const picked: number[] = [];
    if (total <= 2) {
      for (let index = 0; index < Math.min(wanted, total); index += 1) picked.push(index);
    } else {
      const candidates = Array.from({ length: total - 2 }, (_, index) => index + 1);
      while (picked.length < wanted && candidates.length) {
        picked.push(candidates.splice(Math.floor(rng() * candidates.length), 1)[0]!);
      }
      picked.sort((a, b) => a - b);
    }
    const frames: ImageBlob[] = [];
    for (let index = 0; index < picked.length; index += 1) {
      const cell = Math.max(0, Math.min(total - 1, picked[index]));
      const x = (cell % cols) * cellW;
      const y = Math.floor(cell / cols) * cellH;
      const out = join(dir, `sprite-${index}.jpg`);
      const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', path, '-vf', `crop=${cellW}:${cellH}:${x}:${y}`, '-frames:v', '1', '-y', out], { timeout: 20_000, windowsHide: true });
      if (result.status !== 0) continue;
      frames.push({ bytes: readFileSync(out), mime: 'image/jpeg', name: `bili-frame-${index + 1}.jpg`, fallbackText: `[B站画面 ${index + 1}]` });
    }
    return frames;
  } catch {
    return [];
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

export function gifFrames(path: string, maxFrames = 4): ImageBlob[] {
  const ffmpeg = resolveFfmpeg();
  if (!ffmpeg) return [];
  const dir = mkdtempSync(join(tmpdir(), 'coo-gif-'));
  try {
    const result = spawnSync(ffmpeg, [
      '-hide_banner', '-loglevel', 'error',
      '-i', path,
      '-vf', 'fps=2,scale=480:-1',
      '-frames:v', String(Math.max(1, Math.min(8, maxFrames))),
      join(dir, 'frame-%02d.jpg'),
    ], { timeout: 20_000, windowsHide: true });
    if (result.status !== 0) return [];
    const files = readdirSync(dir).filter((file) => file.endsWith('.jpg')).sort();
    return files.slice(0, maxFrames).map((file, index) => ({
      bytes: readFileSync(join(dir, file)),
      mime: 'image/jpeg',
      name: `gif-frame-${index + 1}.jpg`,
      fallbackText: `[动图第 ${index + 1} 帧]`,
    }));
  } catch {
    return [];
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
