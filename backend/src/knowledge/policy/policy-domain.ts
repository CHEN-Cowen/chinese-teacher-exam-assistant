/**
 * W5：范围明确政策检索的纯函数。
 *
 * - 地区选择支持全国（000000）与 6 位行政区划代码；
 * - 有效期判断以问答当日为准，失效材料不得作为依据；
 * - 公告与政策同时命中时并列展示，由用户/招聘单位核实，不自动认定覆盖关系。
 */

export const NATIONAL_REGION_CODE = '000000';
export const NO_COVERAGE_ANSWER =
  '所选地区与年份没有已发布且可检索的政策或招聘材料，暂不能回答。这不代表当地没有招聘或没有相关政策；请调整年份/地区，或直接查看官方公告。';
export const CONFLICT_NOTICE =
  '（同时命中招聘公告与政策材料：具体招聘条件请以本次公告及招聘单位确认为准，系统不会自动认定政策或更高层级文件覆盖具体招聘条款。）';
export const NOT_YET_EFFECTIVE_NOTICE =
  '（部分材料尚未到生效日期，仅作参考，请以届时有效的官方文本为准。）';

export const PROVINCE_LABELS: Record<string, string> = {
  '11': '北京市',
  '12': '天津市',
  '13': '河北省',
  '14': '山西省',
  '15': '内蒙古自治区',
  '21': '辽宁省',
  '22': '吉林省',
  '23': '黑龙江省',
  '31': '上海市',
  '32': '江苏省',
  '33': '浙江省',
  '34': '安徽省',
  '35': '福建省',
  '36': '江西省',
  '37': '山东省',
  '41': '河南省',
  '42': '湖北省',
  '43': '湖南省',
  '44': '广东省',
  '45': '广西壮族自治区',
  '46': '海南省',
  '50': '重庆市',
  '51': '四川省',
  '52': '贵州省',
  '53': '云南省',
  '54': '西藏自治区',
  '61': '陕西省',
  '62': '甘肃省',
  '63': '青海省',
  '64': '宁夏回族自治区',
  '65': '新疆维吾尔自治区',
};

/** 校验政策检索地区：全国或 6 位数字行政区划代码 */
export function normalizeRegionCode(value: string | undefined): string | null {
  const code = (value ?? '').trim();
  if (code === NATIONAL_REGION_CODE) return code;
  return /^\d{6}$/.test(code) ? code : null;
}

export function isNationalRegion(code: string): boolean {
  return code === NATIONAL_REGION_CODE;
}

export function isProvinceRegion(code: string): boolean {
  return /^\d{2}0000$/.test(code);
}

export function provinceCodeOf(code: string): string | null {
  return /^\d{6}$/.test(code) ? `${code.slice(0, 2)}0000` : null;
}

/** 人类可读地区名；未知市级只显示代码，不猜测名称 */
export function regionLabel(code: string): string {
  if (isNationalRegion(code)) return '全国';
  const province = provinceCodeOf(code);
  const provinceLabel = province ? PROVINCE_LABELS[province.slice(0, 2)] : null;
  if (isProvinceRegion(code)) return provinceLabel ?? `地区 ${code}`;
  return provinceLabel ? `${provinceLabel}（${code}）` : `地区 ${code}`;
}

export type MaterialValidity =
  | 'effective'
  | 'expired'
  | 'not_yet_effective'
  | 'unknown';

/** 有效期状态：任一边界缺失只表达事实，不推断无限有效 */
export function validityOf(
  effectiveFrom: string | null,
  effectiveTo: string | null,
  asOf: Date,
): MaterialValidity {
  const from = effectiveFrom ? new Date(effectiveFrom) : null;
  const to = effectiveTo ? new Date(effectiveTo) : null;
  if (from && Number.isNaN(from.getTime())) return 'unknown';
  if (to && Number.isNaN(to.getTime())) return 'unknown';
  if (to && to.getTime() < asOf.getTime()) return 'expired';
  if (from && from.getTime() > asOf.getTime()) return 'not_yet_effective';
  if (!from && !to) return 'unknown';
  return 'effective';
}

export interface PolicyCitationView {
  index: number;
  documentId: string;
  documentTitle: string;
  documentType: string;
  officialUrl: string | null;
  snippet: string;
  regionCode: string | null;
  year: number | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  validity: MaterialValidity;
}

export interface PolicyConflict {
  kind: 'announcement_policy';
  announcement: PolicyCitationView;
  policy: PolicyCitationView;
  reason: string;
  suggestion: string;
}

/**
 * 公告 × 政策冲突候选：只并列展示，不排序为“谁覆盖谁”。
 * 最多返回 4 组，避免把同一公告与多份政策全部展开成噪声。
 */
export function detectAnnouncementPolicyConflicts(
  citations: readonly PolicyCitationView[],
  limit = 4,
): PolicyConflict[] {
  const announcements = citations.filter((item) => item.documentType === 'announcement');
  const policies = citations.filter((item) => item.documentType === 'policy');
  const conflicts: PolicyConflict[] = [];
  for (const announcement of announcements) {
    for (const policy of policies) {
      if (conflicts.length >= limit) return conflicts;
      conflicts.push({
        kind: 'announcement_policy',
        announcement,
        policy,
        reason:
          '同一问题同时命中招聘公告与政策文本，二者可能只部分重叠或存在口径差异；系统不自动判定谁覆盖谁。',
        suggestion: '请对照公告原文与政策原文，并向招聘单位确认具体招聘条款如何适用。',
      });
    }
  }
  return conflicts;
}

/** 回答中追加范围说明，避免用户把局部材料当成全国/全年结论 */
export function scopeNotice(region: string, year: number): string {
  return `（本次检索范围：${region} · ${year} 年；仅使用该范围内已发布的材料。）`;
}
