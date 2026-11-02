/**
 * 陪伴上下文（每轮随事件投递的“此刻”）与它的语义指纹。
 * 指纹只认会改变模型判断的字段，忽略秒级时间与文件时间戳，
 * 否则每秒都在变，去重就失效、队列会被同样的文本灌满。
 */
import type { CompanionConfig } from './config.ts';
import type { JournalEntry, Profile } from './store.ts';
import { MAIN_KEY, profileText } from './store.ts';
import {
  agendaText, currentItem, moodLabel, type CompanionState,
} from './state.ts';
import { formatLocal, localParts } from './time.ts';

export interface ContextInput {
  state: CompanionState;
  profile: Profile | undefined;
  profileKey: string;
  journal: JournalEntry[];
  cfg: CompanionConfig;
  tz: string;
  now: Date;
  memory?: { rules: string[]; person?: string; working?: string; echo?: string; recent: string[]; followup?: string };
}

export function buildContextText(input: ContextInput): string {
  const { state, profile, cfg, tz, now } = input;
  const p = localParts(now, tz);
  const lines: string[] = ['【陪伴上下文】'];
  lines.push(`现在：${p.date} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')} ${p.weekday}`);
  lines.push(
    `状态：精力 ${Math.round(state.energy)}/100 · 心情 ${moodLabel(state.mood)} · 在${state.location} · 正在${state.activity}`,
  );
  if (cfg.agendaEnabled && state.agenda.length) lines.push(`今日：${agendaText(state.agenda, p)}`);
  const rel = profileText(profile, input.profileKey ?? MAIN_KEY);
  if (rel) lines.push(`关系：${rel}`);
  if (input.memory) {
    if (input.memory.rules.length) lines.push(`规则（必须遵守）：${input.memory.rules.join('；')}`);
    if (input.memory.person) lines.push(input.memory.person);
    if (input.memory.working) lines.push(`今天：${input.memory.working}`);
    if (input.memory.echo) lines.push(`情绪回声（只是提示，不一定说）：${input.memory.echo}`);
    if (input.memory.followup) lines.push(`待复核话头（判断完成/取消/更新，不要重复追问）：${input.memory.followup}`);
    if (input.memory.recent.length) lines.push(`最近：${input.memory.recent.map((n) => n.slice(0, 80)).join('；')}`);
  }
  if (input.journal.length) {
    lines.push(`最近日记：${input.journal.map((entry) => { const short = entry.text.length > 80 ? `${entry.text.slice(0, 80)}…` : entry.text; return `${formatLocal(entry.ts, tz)} ${entry.kind}：${short}`; }).join('；')}`);
  }
  return lines.join('\n');
}

export function contextSignature(input: ContextInput): string {
  const { state, profile, cfg, tz, now } = input;
  const p = localParts(now, tz);
  const item = currentItem(state.agenda, p.minutes);
  return JSON.stringify([
    p.date,
    Math.floor(p.minutes / 5),
    Math.floor(Math.round(state.energy) / 8),
    moodLabel(state.mood),
    state.sleeping,
    state.activity,
    state.location,
    cfg.agendaEnabled ? state.agenda.map((i) => `${i.time}${i.title}`).join('|') : '',
    item?.title ?? '',
    profile?.name ?? '',
    profile?.relation ?? '',
    profile?.notes?.join(';') ?? '',
    input.journal.length ? input.journal[input.journal.length - 1].text.slice(0, 60) : '',
    input.memory?.rules.join('|') ?? '',
    input.memory?.person ?? '',
    input.memory?.working ?? '',
    input.memory?.echo ?? '',
    input.memory?.recent.join('|') ?? '',
    input.memory?.followup ?? '',
  ]);
}

/** 主动消息正文：给模型看的一小段“为什么现在想开口”，不给用户看。 */
export function buildProactiveText(input: {
  state: CompanionState;
  reason: string;
  now: Date;
  tz: string;
  quiet: string;
  sinceTalk: string;
}): string {
  const p = localParts(input.now, input.tz);
  const lines = [
    '【想开口】',
    `现在：${p.date} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')} ${p.weekday}`,
    `你的状态：精力 ${Math.round(input.state.energy)}/100 · 心情 ${moodLabel(input.state.mood)} · 正在${input.state.activity}`,
    `离上一次说话：${input.sinceTalk}`,
    `想开口的由头：${input.reason}`,
    '这是你自己的念头，不是对方的请求。想说什么、要不要说，都由你决定；不想说就保持安静。',
  ];
  return lines.join('\n');
}
