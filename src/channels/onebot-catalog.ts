/**
 * OneBot action 目录。
 *
 * 数据来自 cortico-world-onebot 的 SnowLuma 目录（MIT），保留原字段；
 * 只做本地查询和 onebot_call 的 schema 校验，不依赖第三方扩展运行时。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface OneBotActionParam {
  name: string;
  type?: string;
  required?: boolean;
  desc?: string;
  schema?: Record<string, unknown>;
}

export interface OneBotAction {
  name: string;
  aliases?: string[];
  summary?: string;
  readOnly?: boolean;
  params?: OneBotActionParam[];
}

interface CatalogFile {
  source?: string;
  version?: string;
  actions?: OneBotAction[];
  categories?: Record<string, unknown>;
}

let cache: OneBotAction[] | null = null;

const CATALOG_FILES = ['onebot-catalog.json', 'onebot-catalog-napcat.json', 'onebot-catalog-onebot11.json'];

export function oneBotActions(): OneBotAction[] {
  if (cache) return cache;
  const merged = new Map<string, OneBotAction>();
  for (const file of CATALOG_FILES) {
    try {
      const path = fileURLToPath(new URL(`./${file}`, import.meta.url));
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as CatalogFile;
      for (const action of Array.isArray(parsed.actions) ? parsed.actions : []) {
        if (action?.name && !merged.has(action.name)) merged.set(action.name, action);
      }
    } catch {
      // 单个实现目录缺失不影响其余目录。
    }
  }
  cache = [...merged.values()];
  return cache;
}

export function findOneBotAction(name: string): OneBotAction | null {
  const needle = name.trim();
  if (!needle) return null;
  return oneBotActions().find((action) => action.name === needle || (action.aliases ?? []).includes(needle)) ?? null;
}

export function searchOneBotActions(query: string, limit = 12): OneBotAction[] {
  const needle = query.trim().toLowerCase();
  const all = oneBotActions();
  const matched = needle
    ? all.filter((action) => `${action.name} ${action.summary ?? ''} ${(action.aliases ?? []).join(' ')}`.toLowerCase().includes(needle))
    : all;
  return matched.slice(0, Math.max(1, Math.min(50, limit)));
}

/** 轻量但覆盖目录字段的参数校验；返回可读错误，空数组=通过。 */
export function validateActionParams(action: OneBotAction, params: Record<string, unknown>): string[] {
  const errors: string[] = [];
  for (const param of action.params ?? []) {
    const value = params[param.name];
    if (value === undefined || value === null || value === '') {
      if (param.required) errors.push(`缺少必填参数 ${param.name}`);
      continue;
    }
    const schema = param.schema ?? {};
    const type = String(schema.type ?? param.type ?? '');
    if (type === 'integer' || type === 'uint' || type === 'int') {
      if (typeof value !== 'number' || !Number.isInteger(value)) errors.push(`${param.name} 需要整数`);
      else if (type === 'uint' && value < 0) errors.push(`${param.name} 需要非负整数`);
    } else if (type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) errors.push(`${param.name} 需要数字`);
    } else if (type === 'string') {
      if (typeof value !== 'string') errors.push(`${param.name} 需要字符串`);
    } else if (type === 'boolean' || type === 'bool') {
      if (typeof value !== 'boolean') errors.push(`${param.name} 需要布尔值`);
    } else if (type === 'array') {
      if (!Array.isArray(value)) errors.push(`${param.name} 需要数组`);
    } else if (type === 'object') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) errors.push(`${param.name} 需要对象`);
    }
    if (Array.isArray(schema.enum) && !schema.enum.includes(value)) errors.push(`${param.name} 不在可选值里`);
    if (typeof schema.minimum === 'number' && typeof value === 'number' && value < schema.minimum) errors.push(`${param.name} 小于最小值`);
    if (typeof schema.maximum === 'number' && typeof value === 'number' && value > schema.maximum) errors.push(`${param.name} 大于最大值`);
  }
  return errors;
}

/** 这些 action 会直接影响宿主进程/安全边界，目录里有也拒绝。 */
export const BLOCKED_ACTIONS = new Set(['set_restart', 'clean_cache', 'bot_exit', 'send_packet', '_set_restart']);
