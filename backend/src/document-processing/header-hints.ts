/**
 * 表头候选关键词 → 建议字段（公共常量）。
 *
 * 供电子表格解析器与 PDF 表格还原器共用：把"表头单元格文本"映射为
 * 建议字段名（仅候选，业务语义由抽取层与人工审核最终确认）。
 *
 * 分层边界：本文件只做"表头文本 → 字段名"的确定性关键词匹配，
 * 不包含任何业务资格判断。
 */

/** 表头候选关键词 → 建议字段 */
export const HEADER_HINTS: Array<{ keywords: string[]; field: string }> = [
  { keywords: ['岗位代码', '职位代码', '代码'], field: 'position_code' },
  { keywords: ['招聘单位', '用人单位', '单位名称', '主管部门'], field: 'employer' },
  { keywords: ['岗位', '职位名称', '招聘岗位'], field: 'position_name' },
  { keywords: ['学科', '科目'], field: 'subjects' },
  { keywords: ['人数', '名额', '招聘数'], field: 'headcount' },
  { keywords: ['学历'], field: 'education' },
  { keywords: ['专业'], field: 'major' },
  { keywords: ['年龄'], field: 'age' },
  { keywords: ['户籍', '户口'], field: 'hukou' },
  { keywords: ['教师资格', '教资'], field: 'teacher_cert' },
  { keywords: ['用工', '编制', '性质'], field: 'employment_nature' },
  { keywords: ['备注'], field: 'remarks' },
];

/** 具体学科名（用于「招聘单位 × 学科 × 人数」矩阵表头识别） */
const SUBJECT_NAMES = [
  '语文', '数学', '英语', '物理', '化学', '生物', '道德与法治', '思想政治',
  '历史', '地理', '音乐', '体育', '美术', '信息', '心理', '科学',
];

/** 判断表头文本是否是一个具体学科名（含跨行拆分片段，如「法治(思」） */
export function isSubjectName(text: string): boolean {
  const t = text.replace(/\s+/g, '');
  if (SUBJECT_NAMES.some((s) => t === s)) return true;
  // 跨行拆分的学科名片段（如「法治(思」「想政治)」「道德与」）
  if (/^(道德与|法治|思想|政治|信息|科学)$/.test(t)) return true;
  if (/^(语文|数学|英语|物理|化学|生物|历史|地理|音乐|体育|美术|心理)$/.test(t)) return true;
  return false;
}

/** 依据表头文本返回建议字段；学科名映射为 subject（矩阵列），其余走关键词映射 */
export function suggestField(headerText: string): string | undefined {
  const t = headerText.replace(/\s+/g, '');
  if (isSubjectName(t)) return 'subject';
  // 「岗位职责」不是岗位名称。先排除，避免覆盖「招聘岗位」列。
  if (t.includes('职责')) return undefined;
  const hit = HEADER_HINTS.find((h) =>
    h.keywords.some((kw) => headerText.includes(kw)),
  );
  return hit?.field;
}
