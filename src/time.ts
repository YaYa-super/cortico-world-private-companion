/**
 * 时区相关的纯函数。所有对外的“几点/周几”都按部署时区算，不碰系统时区。
 */

export interface LocalParts {
  /** YYYY-MM-DD */
  date: string;
  hour: number;
  minute: number;
  /** 当天第几分钟，0-1439 */
  minutes: number;
  /** 周日..周六 */
  weekday: string;
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const EN_WEEKDAY: Record<string, string> = {
  Sun: '周日', Mon: '周一', Tue: '周二', Wed: '周三', Thu: '周四', Fri: '周五', Sat: '周六',
};

export function localParts(now: Date, timeZone: string): LocalParts {
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      weekday: 'short',
    });
  } catch {
    fmt = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
    });
  }
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(now)) parts[p.type] = p.value;
  const hour = Number(parts.hour ?? '0') % 24;
  const minute = Number(parts.minute ?? '0');
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour,
    minute,
    minutes: hour * 60 + minute,
    weekday: EN_WEEKDAY[parts.weekday ?? ''] ?? WEEKDAYS[new Date(now).getDay()] ?? '今天',
  };
}

/** "HH:MM" → 当天分钟数；格式不对返回 null。 */
export function hmToMinutes(hm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hm ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function minutesToHm(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** 时刻是否落在 [start,end) 里；start>end 视为跨零点。两端非法时返回 false。 */
export function inWindow(minutes: number, start: string, end: string): boolean {
  const a = hmToMinutes(start);
  const b = hmToMinutes(end);
  if (a === null || b === null || a === b) return false;
  return a < b ? minutes >= a && minutes < b : minutes >= a || minutes < b;
}

export function clock(parts: LocalParts): string {
  return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

/** 人类可读的时长，例如 "2 小时 10 分钟"；不到一分钟返回 "刚"。 */
export function humanSpan(ms: number): string {
  const total = Math.max(0, Math.round(ms / 60000));
  if (total < 1) return '刚';
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h <= 0) return `${m} 分钟`;
  if (m === 0) return `${h} 小时`;
  return `${h} 小时 ${m} 分钟`;
}

/** ISO 时间 → 部署时区的 `YYYY-MM-DD HH:MM`。 */
export function formatLocal(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  const p = localParts(d, timeZone);
  return `${p.date} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/** ISO 时间 → 部署时区的日期。 */
export function localDate(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso.slice(0, 10);
  return localParts(d, timeZone).date;
}
