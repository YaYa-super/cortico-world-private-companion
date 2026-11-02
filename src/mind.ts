/**
 * 心理活动日志：只记“决定”，不记基础设施。
 * 一行一个 JSON，环形保留最近 N 条；默认不进模型上下文，只给面板看。
 */
import { appendFileSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';

export type MindType = 'proactive' | 'gate' | 'thought' | 'echo' | 'memory' | 'nightly' | 'error';

export interface MindEvent {
  ts: string;
  type: MindType;
  summary: string;
  refs?: Record<string, string | number>;
}

const SUMMARY_MAX = 200;

export class MindLog {
  private readonly file: string;
  private readonly limit: number;
  private count = 0;

  constructor(file: string, limit = 500) {
    this.file = file;
    this.limit = limit;
    try {
      if (existsSync(file)) {
        this.count = readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).length;
      }
    } catch {
      this.count = 0;
    }
  }

  append(event: Omit<MindEvent, 'ts'> & { ts?: string }): void {
    const line: MindEvent = {
      ts: event.ts ?? new Date().toISOString(),
      type: event.type,
      summary: String(event.summary ?? '').replace(/\s+/g, ' ').slice(0, SUMMARY_MAX),
      ...(event.refs && Object.keys(event.refs).length ? { refs: event.refs } : {}),
    };
    if (!line.summary) return;
    try {
      appendFileSync(this.file, `${JSON.stringify(line)}\n`, 'utf8');
      this.count += 1;
      if (this.count > this.limit) this.trim();
    } catch {
      // 日志失败不影响主流程
    }
  }

  private trim(): void {
    try {
      const lines = readFileSync(this.file, 'utf8').split(/\r?\n/).filter(Boolean);
      const valid = lines.filter((line) => {
        try { JSON.parse(line.trim()); return true; } catch { return false; }
      });
      const kept = valid.slice(-this.limit);
      const tmp = `${this.file}.tmp-${process.pid}`;
      writeFileSync(tmp, `${kept.join('\n')}\n`, 'utf8');
      try {
        renameSync(tmp, this.file);
      } catch {
        // Windows 目标存在时 rename 可能失败：先删再换，日志可容忍极小丢失窗口。
        rmSync(this.file, { force: true });
        renameSync(tmp, this.file);
      }
      this.count = kept.length;
    } catch {
      // 下次再裁
    }
  }

  /** 最近的事件，按时间倒序；type 为空表示全部。 */
  tail(limit = 100, type?: string): MindEvent[] {
    const n = Math.min(this.limit, Math.max(1, limit));
    try {
      const lines = readFileSync(this.file, 'utf8').split(/\r?\n/).filter(Boolean);
      const out: MindEvent[] = [];
      for (let i = lines.length - 1; i >= 0 && out.length < n; i -= 1) {
        try {
          const event = JSON.parse(lines[i].trim()) as MindEvent;
          if (!event?.ts || !event?.summary) continue;
          if (type && event.type !== type) continue;
          out.push(event);
        } catch {
          // 坏行跳过
        }
      }
      return out;
    } catch {
      return [];
    }
  }
}
