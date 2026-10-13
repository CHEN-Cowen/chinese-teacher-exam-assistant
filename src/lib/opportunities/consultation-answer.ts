/**
 * 官方咨询个人答复的信封编码（v7.2 FR-3）。
 *
 * 答复只写入当前用户 FollowRecord.consultationNotes 中（不透明字符串），
 * 不参与匹配、不改公共维度判定、对其他用户不可见。为兼容历史自由文本备注，
 * 解析器必须永不抛错：旧纯文本/坏 JSON 一律回退为 { outcome: null, note: raw }。
 */

export type ConsultationOutcome =
  | "confirmed_match" // 官方确认：本人符合
  | "confirmed_mismatch" // 官方确认：本人不符合
  | "still_unclear" // 联系后仍不明确
  | "not_contacted"; // 暂未联系

export const CONSULTATION_OUTCOMES: readonly ConsultationOutcome[] = [
  "confirmed_match",
  "confirmed_mismatch",
  "still_unclear",
  "not_contacted",
];

/** 个人答复四态的用户可见文案（选择按钮与记录展示统一从此取） */
export const CONSULTATION_OUTCOME_LABELS: Record<ConsultationOutcome, string> = {
  confirmed_match: "官方确认：我符合",
  confirmed_mismatch: "官方确认：我不符合",
  still_unclear: "联系后仍不明确",
  not_contacted: "暂未联系",
};

export interface ConsultationAnswerInput {
  outcome: ConsultationOutcome;
  /** 用户可选的自由文本补充；不进埋点 */
  note?: string;
  /** 答复时间 ISO（由调用方传入，纯函数不读时钟） */
  at: string;
}

export interface ParsedConsultationAnswer {
  /** null = 历史自由文本或无法解析的记录（四态之外，不参与选择器跳过逻辑） */
  outcome: ConsultationOutcome | null;
  note: string;
  at?: string;
}

const ENVELOPE_VERSION = 1;

function isOutcome(value: unknown): value is ConsultationOutcome {
  return (
    typeof value === "string" &&
    (CONSULTATION_OUTCOMES as readonly string[]).includes(value)
  );
}

/** 编码为 consultationNotes 中存储的不透明字符串 */
export function encodeConsultationAnswer(input: ConsultationAnswerInput): string {
  return JSON.stringify({
    v: ENVELOPE_VERSION,
    outcome: input.outcome,
    note: input.note ?? "",
    at: input.at,
  });
}

/**
 * 解析历史 note：
 * - 信封 JSON（v=1 且 outcome 合法）→ 结构化答复；
 * - 旧版纯文本 / 空串 / 坏 JSON / 缺字段 → { outcome: null, note: 原样文本 }，
 *   绝不抛错（note 是用户数据，损坏不能导致页面崩溃）。
 */
export function parseConsultationAnswer(raw: string | null | undefined): ParsedConsultationAnswer {
  if (raw == null) return { outcome: null, note: "" };
  if (raw === "") return { outcome: null, note: "" };
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith("{")) return { outcome: null, note: raw };
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (parsed.v === ENVELOPE_VERSION && isOutcome(parsed.outcome)) {
      return {
        outcome: parsed.outcome,
        note: typeof parsed.note === "string" ? parsed.note : "",
        at: typeof parsed.at === "string" ? parsed.at : undefined,
      };
    }
    return { outcome: null, note: raw };
  } catch {
    return { outcome: null, note: raw };
  }
}
