/**
 * 与 DeepSeek Anthropic 兼容端点配合的“按需联网”客户端。
 *
 * 参考了 cortico-world-webanswer 的协议做法：/chat/completions 不接受
 * 服务端 web_search，所以这里走 /anthropic/v1/messages + web_search_20250305。
 * 与那个扩展不同，这里只做一次联网问答，并把结果交回角色自己说，不额外做便签。
 */

export const DEFAULT_WEB_BASE_URL = 'https://api.deepseek.com/anthropic/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

export interface WebSource {
  title: string;
  url: string;
}

export interface WebAnswer {
  answer: string;
  sources: WebSource[];
  queries: string[];
  searches: number;
}

export interface WebAskOptions {
  apiKey: string;
  model: string;
  maxSearches: number;
  maxTokens: number;
  timeoutMs: number;
  baseUrl?: string;
}

function hostOf(baseUrl: string): string {
  try { return new URL(baseUrl).host; } catch { return baseUrl; }
}

function dedupeSources(sources: WebSource[]): WebSource[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const url = source.url.trim();
    if (!url || seen.has(url)) return false;
    seen.add(url);
    return true;
  });
}

function parseContent(content: unknown): Omit<WebAnswer, 'searches'> {
  const blocks = Array.isArray(content) ? content : [];
  const answers: string[] = [];
  const sources: WebSource[] = [];
  const queries: string[] = [];
  for (const raw of blocks) {
    if (!raw || typeof raw !== 'object') continue;
    const block = raw as Record<string, unknown>;
    if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
      answers.push(block.text.trim());
    } else if (block.type === 'server_tool_use') {
      const input = block.input && typeof block.input === 'object' ? block.input as Record<string, unknown> : {};
      if (typeof input.query === 'string' && input.query.trim()) queries.push(input.query.trim());
    } else if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
      for (const item of block.content as Array<Record<string, unknown>>) {
        if (item?.type !== 'web_search_result') continue;
        const title = typeof item.title === 'string' ? item.title.trim() : '';
        const url = typeof item.url === 'string' ? item.url.trim() : '';
        if (url) sources.push({ title: title || url, url });
      }
    }
  }
  return { answer: answers.join('\n\n'), sources: dedupeSources(sources), queries };
}

function describeFailure(status: number, body: string, host: string): string {
  const brief = body.replace(/\s+/g, ' ').slice(0, 280);
  if (status === 401 || status === 403) return `密钥无效或无权限（${host} 返回 HTTP ${status}）。`;
  if (status === 429) return `请求太频繁被限流（${host} 返回 HTTP 429）。`;
  if (status === 400 && /web_search/i.test(body)) return `当前端点不支持服务端联网搜索（${host} 返回 HTTP 400）。`;
  return `${host} 返回 HTTP ${status}：${brief}`;
}

export async function askWithWebSearch(question: string, opts: WebAskOptions): Promise<WebAnswer> {
  const baseUrl = (opts.baseUrl || DEFAULT_WEB_BASE_URL).trim();
  const host = hostOf(baseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  let response: Response;
  try {
    response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': opts.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: opts.model,
        max_tokens: opts.maxTokens,
        system: '你是检索助手。直接给出简洁的事实结论，不要寒暄，不要说「我来帮你查一下」，不要用客服口吻；信息不足就直说。',
        messages: [{ role: 'user', content: question }],
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: opts.maxSearches }],
      }),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`联网搜索超时（超过 ${Math.round(opts.timeoutMs / 1000)} 秒）`);
    }
    throw new Error(`连不上 ${host}，检查网络后重试。`);
  }
  clearTimeout(timer);
  const text = await response.text();
  if (!response.ok) throw new Error(describeFailure(response.status, text, host));
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error('联网服务返回了无法解析的内容。');
  }
  const parsed = parseContent(json.content);
  if (!parsed.answer) throw new Error(parsed.sources.length ? '搜到了来源，但模型没给出回答。' : '联网服务没有给出回答。');
  const usage = json.usage && typeof json.usage === 'object' ? json.usage as Record<string, unknown> : {};
  const toolUse = usage.server_tool_use && typeof usage.server_tool_use === 'object'
    ? usage.server_tool_use as Record<string, unknown>
    : {};
  return {
    ...parsed,
    searches: Number(toolUse.web_search_requests ?? parsed.queries.length) || 0,
  };
}

/** 给模型看的工具回执：答案在前，来源简短列出，避免把网页原文灌进上下文。 */
export function formatWebAnswer(result: WebAnswer): string {
  const lines = [result.answer];
  if (result.sources.length) {
    lines.push('');
    lines.push('来源：');
    result.sources.slice(0, 4).forEach((source, index) => {
      lines.push(`${index + 1}. ${source.title}`);
      lines.push(`   ${source.url}`);
    });
  }
  return lines.join('\n');
}
