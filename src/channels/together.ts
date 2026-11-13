/**
 * B站「一起看」：照原陪看插件的浏览器层重做。
 *
 * 关键点：
 * - 用 Puppeteer 管一个真正的浏览器进程，而不是手写 CDP 目标；
 * - 浏览器窗口是普通窗口，视频用新标签打开，首页标签保留；
 * - 关闭窗口后 Puppeteer 的 disconnected 事件会清掉旧 browser/page；
 * - 服务端读页面、截图都走 page，不再自己维护 WebSocket / pending 请求。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface TogetherStatus {
  open: boolean;
  url: string;
  title: string;
  time: number;
  duration: number;
  paused: boolean;
}

const WINDOW_WIDTH = 1160;
const WINDOW_HEIGHT = 800;
const DEBUG_TIMEOUT = 20_000;
const require = createRequire(import.meta.url);

function loadPuppeteer(): any {
  try {
    return require('puppeteer-core');
  } catch {
    throw new Error('缺少 puppeteer-core，请安装扩展依赖后再试');
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => port ? resolve(port) : reject(new Error('拿不到空闲端口')));
    });
  });
}

async function endpointReady(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`);
    return response.ok;
  } catch {
    return false;
  }
}

export class TogetherBrowser {
  private readonly dataDir: string;
  private readonly edgePath: string;
  private proc: ChildProcess | null = null;
  private browser: any = null;
  private page: any = null;
  private port = 0;
  private launching: Promise<void> | null = null;

  constructor(opts: { dataDir: string; edgePath?: string }) {
    this.dataDir = opts.dataDir;
    this.edgePath = opts.edgePath || process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  }

  private get profile(): string { return join(this.dataDir, 'bili', 'together', 'profile'); }
  private get portFile(): string { return join(this.dataDir, 'bili', 'together', 'port.txt'); }

  private clearRefs(): void {
    this.browser = null;
    this.page = null;
    this.port = 0;
    this.proc = null;
  }

  private removePortFile(): void {
    try { unlinkSync(this.portFile); } catch { /* ignore */ }
  }

  private reset(): void {
    const browser = this.browser;
    const proc = this.proc;
    this.clearRefs();
    this.removePortFile();
    if (browser?.connected) void browser.close().catch(() => {});
    if (proc && proc.exitCode === null) {
      try { proc.kill(); } catch { /* ignore */ }
    }
  }

  private async launch(): Promise<void> {
    if (!existsSync(this.edgePath)) throw new Error(`找不到 Edge：${this.edgePath}`);
    const puppeteer = loadPuppeteer();
    mkdirSync(this.profile, { recursive: true });
    try { unlinkSync(join(this.profile, 'DevToolsActivePort')); } catch { /* ignore */ }
    const port = await freePort();
    const args = [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${this.profile}`,
      '--no-first-run', '--no-default-browser-check', '--disable-infobars',
      '--disable-session-crashed-bubble', '--hide-crash-restore-bubble',
      `--window-size=${WINDOW_WIDTH},${WINDOW_HEIGHT}`,
      '--autoplay-policy=no-user-gesture-required',
      '--disable-features=Translate',
      'https://www.bilibili.com/',
    ];
    const proc = spawn(this.edgePath, args, { windowsHide: false, detached: false, stdio: 'ignore' });
    this.proc = proc;
    proc.on('exit', () => {
      if (this.proc !== proc) return;
      this.reset();
    });
    const deadline = Date.now() + DEBUG_TIMEOUT;
    while (Date.now() < deadline) {
      if (await endpointReady(port)) break;
      if (proc.exitCode !== null) throw new Error('Edge 启动后立即退出了');
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!(await endpointReady(port))) {
      try { proc.kill(); } catch { /* ignore */ }
      this.reset();
      throw new Error('Edge 没有在 20 秒内打开调试端口');
    }
    try {
      this.browser = await puppeteer.connect({
        browserURL: `http://127.0.0.1:${port}`,
        defaultViewport: null,
      });
    } catch (error) {
      this.reset();
      throw new Error(`连不上 Edge 调试端口：${(error as Error).message}`);
    }
    this.port = port;
    try { writeFileSync(this.portFile, String(port)); } catch { /* ignore */ }
    const current = this.browser;
    current.on('disconnected', () => {
      if (this.browser === current) this.reset();
    });
    const pages = await this.browser.pages();
    this.page = pages.find((item: any) => item.url().startsWith('https://www.bilibili.com')) || pages[0] || await this.browser.newPage();
  }

  private async connectExisting(): Promise<boolean> {
    const puppeteer = loadPuppeteer();
    let port = 0;
    try { port = Number(readFileSync(this.portFile, 'utf8').trim()) || 0; } catch { /* none */ }
    if (!port) return false;
    if (!(await endpointReady(port))) {
      try { unlinkSync(this.portFile); } catch { /* ignore */ }
      return false;
    }
    try {
      const browser = await puppeteer.connect({
        browserURL: `http://127.0.0.1:${port}`,
        defaultViewport: null,
      });
      this.browser = browser;
      this.port = port;
      browser.on('disconnected', () => {
        if (this.browser === browser) this.reset();
      });
      const pages = await this.browser.pages();
      this.page = pages.find((item: any) => !item.isClosed()) || await this.browser.newPage();
      return true;
    } catch {
      this.reset();
      return false;
    }
  }

  private async ensureBrowser(): Promise<void> {
    if (this.browser?.connected) return;
    this.reset();
    if (this.launching) return this.launching;
    this.launching = (async () => {
      if (!(await this.connectExisting())) await this.launch();
    })().finally(() => { this.launching = null; });
    return this.launching;
  }

  private async pages(): Promise<any[]> {
    if (!this.browser?.connected) return [];
    try { return (await this.browser.pages()).filter((p: any) => !p.isClosed()); } catch { return []; }
  }

  private isVideo(page: any): boolean {
    try { return /bilibili\.com\/video\//i.test(page.url()); } catch { return false; }
  }

  private async homePage(): Promise<any> {
    const pages = await this.pages();
    return pages.find((p) => !this.isVideo(p)) || await this.browser.newPage();
  }

  private async videoPage(): Promise<any | null> {
    const pages = await this.pages();
    const videos = pages.filter((p) => this.isVideo(p));
    const latest = videos[videos.length - 1] || null;
    if (this.page && !this.page.isClosed?.() && this.isVideo(this.page)) {
      if (latest && latest !== this.page) {
        // 用户从旧视频点开了新视频标签：旧视频已暂停/结束时跟到最新标签。
        try {
          const oldState = await this.page.evaluate(() => {
            const video = document.querySelector('video');
            return video ? { paused: video.paused, ended: video.ended } : null;
          });
          const active = await latest.evaluate(() => document.visibilityState === 'visible').catch(() => false);
          if (active || !oldState || oldState.paused || oldState.ended) this.page = latest;
        } catch { /* keep current */ }
      }
      return this.page;
    }
    if (latest) this.page = latest;
    return latest;
  }

  private async fitWindow(): Promise<void> {
    if (!this.page) return;
    try {
      const session = await this.page.createCDPSession();
      const info = await session.send('Browser.getWindowForTarget') as { windowId?: number };
      if (!info?.windowId) return;
      let left = 180;
      let top = 100;
      try {
        const screen = await this.page.evaluate(() => ({ width: screen.availWidth, height: screen.availHeight }));
        if (Number(screen.width) > WINDOW_WIDTH && Number(screen.height) > WINDOW_HEIGHT) {
          left = Math.round((Number(screen.width) - WINDOW_WIDTH) / 2);
          top = Math.round((Number(screen.height) - WINDOW_HEIGHT) / 2);
        }
      } catch { /* ignore */ }
      await session.send('Browser.setWindowBounds', {
        windowId: info.windowId,
        bounds: { left, top, width: WINDOW_WIDTH, height: WINDOW_HEIGHT, windowState: 'normal' },
      });
      await session.detach().catch(() => {});
    } catch { /* window bounds are best effort */ }
  }

  async open(url: string): Promise<{ url: string }> {
    await this.ensureBrowser();
    const video = /bilibili\.com\/video\//i.test(url);
    if (!this.browser?.connected) throw new Error('浏览器没有连上');
    if (video) {
      const page = await this.browser.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForSelector('video', { timeout: 15_000 }).catch(() => {});
      this.page = page;
    } else {
      const page = await this.homePage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      this.page = page;
    }
    await this.fitWindow();
    await new Promise((resolve) => setTimeout(resolve, 1200));
    return { url };
  }

  async status(): Promise<TogetherStatus> {
    const page = await this.videoPage();
    if (!page) return { open: false, url: '', title: '', time: 0, duration: 0, paused: true };
    try {
      const value = await page.evaluate(() => {
        const video = document.querySelector('video');
        return {
          url: location.href,
          title: document.title,
          time: video ? Number(video.currentTime) || 0 : 0,
          duration: video ? Number(video.duration) || 0 : 0,
          paused: video ? Boolean(video.paused) : true,
        };
      });
      return {
        open: true,
        url: String(value.url || page.url()),
        title: String(value.title || ''),
        time: Number(value.time || 0),
        duration: Number(value.duration || 0),
        paused: value.paused !== false,
      };
    } catch {
      return { open: false, url: '', title: '', time: 0, duration: 0, paused: true };
    }
  }

  async control(action: string, seconds = 0): Promise<TogetherStatus> {
    const page = await this.videoPage();
    if (!page) throw new Error('一起看浏览器未打开');
    if (action === 'play') await page.waitForSelector('video', { timeout: 15_000 }).catch(() => {});
    await page.evaluate((method, at) => {
      const video = document.querySelector('video');
      if (!video) throw new Error('页面上没有播放器');
      if (method === 'play') void video.play().catch(() => {});
      else if (method === 'pause') video.pause();
      else if (method === 'seek') video.currentTime = Math.max(0, Math.min(Number(video.duration) || 0, Number(at) || 0));
    }, action, seconds).catch((error: Error) => { throw new Error(error.message || '播放控制失败'); });
    return this.status();
  }

  async frame(dest: string): Promise<{ path: string; bytes: Uint8Array }> {
    const page = await this.videoPage();
    if (!page) throw new Error('一起看浏览器未打开');
    let bytes: Uint8Array | null = null;
    // 照原陪看插件直接从 <video> 画布取画面；取不到才退回整页截图。
    try {
      const encoded = await page.evaluate(() => {
        const video = document.querySelector('video') as HTMLVideoElement | null;
        if (!video || !video.videoWidth || !video.videoHeight) return '';
        const canvas = document.createElement('canvas');
        canvas.width = 854;
        canvas.height = 480;
        const context = canvas.getContext('2d');
        if (!context) return '';
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', 0.8).split(',')[1] || '';
      }) as string;
      if (encoded) bytes = Buffer.from(encoded, 'base64');
    } catch { /* fall back to page screenshot */ }
    if (!bytes || bytes.length === 0) bytes = await page.screenshot({ type: 'png' });
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, bytes);
    return { path: dest, bytes };
  }

  async close(): Promise<void> {
    const browser = this.browser;
    const proc = this.proc;
    this.clearRefs();
    this.removePortFile();
    if (browser) {
      await Promise.race([
        browser.close().catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, 3_000)),
      ]);
    }
    if (proc && proc.exitCode === null) {
      try { proc.kill(); } catch { /* ignore */ }
    }
  }
}
