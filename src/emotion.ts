/**
 * 轻量情绪识别：只做“这句话里有没有明显情绪”，不判断反话。
 * 词表是透明的、可调的；真正的“原因”由模型写入 episode 时打标（details.userEmotion）。
 */

export type EmotionLabel = '疲惫' | '烦躁' | '开心' | '难过' | '焦虑' | '孤独';

export interface EmotionSignal {
  label: EmotionLabel;
  intensity: number;
  matched: string;
}

interface EmotionGroup {
  label: EmotionLabel;
  words: string[];
  /** 检索旧记忆时的同义扩展（“累”不一定和“加班”共享字）。 */
  related: string[];
}

const GROUPS: EmotionGroup[] = [
  { label: '疲惫', words: ['累', '困', '熬夜', '没睡好', '撑不住', '疲惫'], related: ['加班', '熬夜', '通宵', '没睡', '上班', '工作'] },
  { label: '烦躁', words: ['烦', '气死', '生气', '火大', '吵', '无语', '受不了'], related: ['烦', '生气', '吵', '压力', '领导', '客户'] },
  { label: '开心', words: ['开心', '高兴', '哈哈', '爽', '太好了', '笑死', '舒服'], related: ['开心', '高兴', '玩', '吃', '礼物'] },
  { label: '难过', words: ['难过', '伤心', '哭', '委屈', '失落', '想哭'], related: ['难过', '伤心', '哭', '委屈', '失败'] },
  { label: '焦虑', words: ['焦虑', '紧张', '担心', '怕', '压力', '慌'], related: ['焦虑', '担心', '怕', '考试', '截止', '钱'] },
  { label: '孤独', words: ['孤独', '寂寞', '一个人', '没人', '空落落'], related: ['孤独', '一个人', '没人', '寂寞'] },
];

const INTENSIFIER = /很|超|特别|太|死了|爆|极|非常|真的/;

/** 词前面的否定词（不累/没生气/别烦）不算情绪。 */
function negatedAt(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 3), index);
  return /(不|没|别|无|未|不太|不怎么|没有)$/.test(before);
}

/** 识别一句话里的主导情绪；没有明显情绪返回 null。 */
export function detectEmotion(text: string): EmotionSignal | null {
  // 去掉“积累/累计/困难”这类非情绪词，避免把“困难”当成“困”。
  const lower = text.toLowerCase().replace(/积累|累计|困难|贫困|缺乏|哪怕/g, '');
  let best: { group: EmotionGroup; hits: string[] } | null = null;
  for (const group of GROUPS) {
    const hits = group.words.filter((word) => {
      let at = lower.indexOf(word);
      while (at >= 0) {
        if (!negatedAt(lower, at)) return true;
        at = lower.indexOf(word, at + word.length);
      }
      return false;
    });
    if (hits.length && (!best || hits.length > best.hits.length)) best = { group, hits };
  }
  if (!best) return null;
  const intensity = Math.min(1, 0.5 + (best.hits.length - 1) * 0.15 + (INTENSIFIER.test(lower) ? 0.2 : 0));
  return { label: best.group.label, intensity, matched: best.hits[0] };
}

/** 某个情绪标签的检索扩展词（没有打标旧记忆时的兜底）。 */
export function relatedWords(label: EmotionLabel): string[] {
  return GROUPS.find((group) => group.label === label)?.related ?? [];
}

/** 从一条 episode 的 details 里读情绪标签。 */
export function emotionLabelOf(details?: { userEmotion?: { label?: string } }): string | undefined {
  return details?.userEmotion?.label;
}
