/**
 * 判断一条宿主事件是不是“人说的话”。捕获层只记这个，其余都是遥测。
 * 单独成文件便于单测（不依赖 World / host）。
 */
export interface CapturableEvent {
  origin?: string;
  source?: string;
  senderKey?: string;
  text?: string;
  meta?: Record<string, unknown>;
}

/** 各世界自己的动作/通知/元事件，不算入站。 */
const SELF_KEYS = /\.(self|touch|answer)$/;

export function isHumanEvent(event: CapturableEvent): boolean {
  if (event.origin !== 'external') return false;
  const who = event.senderKey ?? '';
  const source = event.source ?? '';
  if (SELF_KEYS.test(who)) return false;
  if (source === 'persona' || source === 'console') return false;
  // 桌宠世界自己也有多种 senderKey，只有打字/语音/聊天是人的输入。
  if (source === 'desktop-pet' && !/^desktop-pet\.(text|voice|chat)$/.test(who)) return false;
  if (/^(civ6-assistant|terrarium|bilibili)$/.test(source)) return false;
  const text = (event.text ?? '').trim();
  if (!text) return false;
  if (text.startsWith('[system]') || text.startsWith('[系统]')) return false;
  if (/^\[(notice|request|meta_event)\//.test(text)) return false;
  const kind = event.meta?.['kind'];
  if (kind === 'activity' || kind === 'delivered') return false;
  return true;
}

/** QQ 号统一成 qq:<号>，其余沿用 senderKey/source。 */
export function scopeOfEvent(event: { senderKey?: string; source?: string }): string {
  const key = event.senderKey ?? '';
  if (/^\d{4,}$/.test(key)) return `qq:${key}`;
  return key || event.source || 'main';
}
