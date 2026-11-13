/**
 * B 站只读层的设计骨架。
 *
 * 这一版只定义边界、能力和未来面板所需状态，不发起任何 B 站请求，
 * 也不保存 Cookie；真正的 API 客户端在 M3 接入。
 */
export type BiliCapabilityState = 'planned' | 'designing' | 'ready';

export interface BiliCapability {
  id: string;
  label: string;
  state: BiliCapabilityState;
  description: string;
}

export interface BiliReadOnlyStatus {
  phase: 'readonly';
  version: string;
  capabilities: BiliCapability[];
  boundaries: string[];
  note: string;
}

export const BILI_READONLY_CAPABILITIES: BiliCapability[] = [
  { id: 'search', label: '搜索视频', state: 'ready', description: '按关键词搜索公开结果，返回 BV 号、标题、UP 主、时长。' },
  { id: 'info', label: '视频信息', state: 'ready', description: '标题、UP 主、简介、分 P、时长、播放量；章节后续补。' },
  { id: 'subtitle', label: '字幕', state: 'ready', description: 'CC / AI 字幕，带时间轴；需要登录 Cookie。' },
  { id: 'danmaku', label: '弹幕', state: 'ready', description: '公开 XML 弹幕，按条数取样，不整段塞进上下文。' },
  { id: 'comments', label: '热评', state: 'ready', description: '公开热评前若干条，只读；显式 bili_comment_reply 才回复。' },
  { id: 'history', label: '观看记录', state: 'ready', description: '读取 B 站观看记录；需要登录 Cookie；bili_watch 可写观看账与记忆。' },
];

export const BILI_READONLY_BOUNDARIES = [
  '默认只读；显式 confirm 的评论/私信/账号动作会写外部状态；是否 @ 主人/私信主人由模型判断。',
  '登录态只保存在本机数据目录；不写进记忆、不写进日志。',
  '接口非官方，失败只影响 B 站通道，不影响 companion 主流程。',
  '字幕/弹幕按时间窗取样，避免把整条视频塞进上下文。',
];

export const BILI_READONLY_DESIGN: BiliReadOnlyStatus = {
  phase: 'readonly',
  version: '0.2',
  capabilities: BILI_READONLY_CAPABILITIES,
  boundaries: BILI_READONLY_BOUNDARIES,
  note: '只读已接：搜索 / 视频信息 / 热评 / 弹幕 / 字幕 / 观看记录（后两者需要登录 Cookie）；自己看/bili_watch/抽帧/一起看已接基础版。',
};
