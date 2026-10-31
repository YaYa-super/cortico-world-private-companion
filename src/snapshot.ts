/**
 * 快照去重：内容没变就不推；推新的之前撤回上一条尚未投递的。
 * 结论来自 cortico-world-memory 的实测（piggyback 事件不会自动合并且会积压），
 * 这里只保留最小实现。
 */
export interface SnapshotSink {
  push(text: string): Promise<number | null>;
  withdraw(cursor: number): Promise<boolean>;
}

export class SnapshotPusher {
  private lastSig: string | null = null;
  private pending: number | null = null;
  private inFlight = false;
  private closed = false;
  private readonly sink: SnapshotSink;

  constructor(sink: SnapshotSink) {
    this.sink = sink;
  }

  get hasPending(): boolean {
    return this.pending !== null;
  }

  async maybePush(signature: string, text: string, force = false): Promise<boolean> {
    if (this.closed) return false;
    if (this.inFlight) return false;
    if (!force && signature === this.lastSig) return false;
    this.inFlight = true;
    try {
      if (this.pending !== null) {
        const cur = this.pending;
        this.pending = null;
        try {
          await this.sink.withdraw(cur);
        } catch {
          // 已投递或宿主不支持撤回：无需处理
        }
      }
      const cursor = await this.sink.push(text);
      if (cursor === null) return false;
      this.lastSig = signature;
      this.pending = cursor;
      return true;
    } finally {
      this.inFlight = false;
    }
  }

  invalidate(): void {
    this.lastSig = null;
  }

  /** 世界停止时撤回尚未投递的 context，避免卸载后旧上下文继续进模型。 */
  async close(): Promise<void> {
    this.closed = true;
    if (this.pending === null) return;
    const cursor = this.pending;
    this.pending = null;
    try {
      await this.sink.withdraw(cursor);
    } catch {
      // 已投递或宿主不支持撤回：无需处理
    }
  }
}
