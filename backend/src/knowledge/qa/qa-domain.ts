/**
 * W3：问答纯函数（可单测，不依赖数据库/模型）。
 *
 * - 中文检索词：拉丁词 + 中文二元组，避免依赖分词服务；
 * - 余弦相似度：向量未归一化时仍按真实模长计算；
 * - 引用校验：只接受落在本次证据编号范围内的 [n]，其余标记为无效引用；
 * - 拒答/未核对判定：没有证据一律拒答；有答案但无有效引用标记为待核对。
 */

const LATIN_OR_CJK = /[a-z0-9]+|[\u4e00-\u9fff]/gi;
/** 注意必须带方括号：`\u4e00-\u9fff` 在类外是字面序列而非范围 */
const CJK_CHAR = /[\u4e00-\u9fff]/;

/** 中文二元组 + 拉丁词；单字查询同时保留单字 */
export function tokenize(text: string): string[] {
  const normalized = text.normalize('NFKC').toLowerCase();
  const raw = normalized.match(LATIN_OR_CJK) ?? [];
  const tokens: string[] = [];
  let cjkBuffer = '';
  const flushCjk = () => {
    if (!cjkBuffer) return;
    if (cjkBuffer.length === 1) tokens.push(cjkBuffer);
    for (let i = 0; i < cjkBuffer.length - 1; i += 1) {
      tokens.push(cjkBuffer.slice(i, i + 2));
    }
    cjkBuffer = '';
  };
  for (const item of raw) {
    if (CJK_CHAR.test(item)) {
      cjkBuffer += item;
    } else {
      flushCjk();
      tokens.push(item);
    }
  }
  flushCjk();
  return tokens;
}

/** 词法相关度 0..1：查询词在材料中的覆盖率（二元组计一次） */
export function lexicalScore(question: string, content: string): number {
  const queryTokens = Array.from(new Set(tokenize(question)));
  if (queryTokens.length === 0) return 0;
  const contentTokens = new Set(tokenize(content));
  const matched = queryTokens.filter((token) => contentTokens.has(token)).length;
  return matched / queryTokens.length;
}

/** 余弦相似度；空向量或模长为 0 返回 0，不把坏数据当正相关 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const va = a[i]!;
    const vb = b[i]!;
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }
  if (normA === 0 || normB === 0) return 0;
  const cosine = dot / Math.sqrt(normA * normB);
  return Number.isFinite(cosine) ? cosine : 0;
}

/** 混合分数：向量为主、词法兜底；向量缺失时不虚增分数 */
export function hybridScore(lexical: number, vector: number | null): number {
  if (vector === null) return lexical;
  return Math.max(0, 0.62 * Math.max(0, vector) + 0.38 * lexical);
}

/** 从模型回答中提取引用编号（去重、保持出现顺序） */
export function parseCitations(answer: string): number[] {
  const found = new Set<number>();
  for (const match of answer.matchAll(/\[(\d{1,2})\]/g)) {
    const value = Number(match[1]);
    if (Number.isInteger(value)) found.add(value);
  }
  return Array.from(found);
}

/** 校验引用：1..max 视为有效；返回有效/越界编号 */
export function validateCitations(
  answer: string,
  max: number,
): { valid: number[]; invalid: number[]; hasCitation: boolean } {
  const cited = parseCitations(answer);
  const valid = cited.filter((value) => value >= 1 && value <= max);
  const invalid = cited.filter((value) => value < 1 || value > max);
  return { valid, invalid, hasCitation: cited.length > 0 };
}

/** Mock 模式抽取式回答：只用原文摘录 + 编号，不编造 */
export function extractiveAnswer(
  snippets: ReadonlyArray<{ content: string }>,
): string {
  const picked = snippets.slice(0, 3);
  if (picked.length === 0) return '';
  const parts = picked.map((item, index) => {
    const text = item.content.replace(/\s+/g, ' ').trim();
    const excerpt = text.length > 140 ? `${text.slice(0, 140)}…` : text;
    return `“${excerpt}”[${index + 1}]`;
  });
  return `根据已发布的官方材料原文：${parts.join('；')}。以上为原文摘录，具体以官方公告为准。`;
}

export const REFUSAL_ANSWER =
  '未在已发布的官方材料中找到足够依据，暂不能回答这个问题。建议直接查看公告原文，或向招聘单位确认。';
export const UNVERIFIED_NOTICE =
  '（回答未引用可回查的原文片段，请以官方公告为准。）';
