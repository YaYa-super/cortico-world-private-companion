/**
 * 节日：优先 nager.date 的中国法定节假日（免费，无需 key），失败时退回固定公历节日。
 * 只存日期 → 名称，不把任何网络原文写进上下文。
 */

const FIXED: Record<string, string> = {
  '01-01': '元旦',
  '02-14': '情人节',
  '03-08': '妇女节',
  '05-01': '劳动节',
  '05-04': '青年节',
  '06-01': '儿童节',
  '09-10': '教师节',
  '10-01': '国庆节',
  '12-25': '圣诞节',
};

export function fixedHolidays(year: number): Record<string, string> {
  return Object.fromEntries(Object.entries(FIXED).map(([md, name]) => [`${year}-${md}`, name]));
}

/** 拉取中国法定节假日；失败抛错，由调用方回落 fixedHolidays。 */
export async function fetchHolidays(year: number): Promise<Record<string, string>> {
  const signal = AbortSignal.timeout(8000);
  const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/CN`, { signal });
  if (!res.ok) throw new Error(`holiday HTTP ${res.status}`);
  const rows = await res.json() as Array<{ date?: string; localName?: string; name?: string }>;
  const out = fixedHolidays(year);
  for (const row of rows) {
    if (typeof row.date !== 'string') continue;
    const name = row.localName || row.name;
    if (name) out[row.date] = name;
  }
  return out;
}
