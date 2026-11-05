/**
 * W5：范围明确的政策问答 API 客户端。
 *
 * 地区与年份必须显式选择；覆盖查询是公开只读聚合。
 * 不把“无覆盖”“索引未完成”“服务故障”混为一谈，错误信息原样展示。
 */
import { AUTH_MODE } from "@/lib/auth";
import type { QaAnswerDTO } from "@/lib/knowledge/qa-api";

export const NATIONAL_REGION = "000000";

export interface RegionOption {
  code: string;
  label: string;
}

export const POLICY_REGIONS: RegionOption[] = [
  { code: NATIONAL_REGION, label: "全国" },
  { code: "110000", label: "北京市" },
  { code: "120000", label: "天津市" },
  { code: "130000", label: "河北省" },
  { code: "140000", label: "山西省" },
  { code: "150000", label: "内蒙古自治区" },
  { code: "210000", label: "辽宁省" },
  { code: "220000", label: "吉林省" },
  { code: "230000", label: "黑龙江省" },
  { code: "310000", label: "上海市" },
  { code: "320000", label: "江苏省" },
  { code: "330000", label: "浙江省" },
  { code: "340000", label: "安徽省" },
  { code: "350000", label: "福建省" },
  { code: "360000", label: "江西省" },
  { code: "370000", label: "山东省" },
  { code: "410000", label: "河南省" },
  { code: "420000", label: "湖北省" },
  { code: "430000", label: "湖南省" },
  { code: "440000", label: "广东省" },
  { code: "450000", label: "广西壮族自治区" },
  { code: "460000", label: "海南省" },
  { code: "500000", label: "重庆市" },
  { code: "510000", label: "四川省" },
  { code: "520000", label: "贵州省" },
  { code: "530000", label: "云南省" },
  { code: "540000", label: "西藏自治区" },
  { code: "610000", label: "陕西省" },
  { code: "620000", label: "甘肃省" },
  { code: "630000", label: "青海省" },
  { code: "640000", label: "宁夏回族自治区" },
  { code: "650000", label: "新疆维吾尔自治区" },
];

export interface CoverageBucketDTO {
  documents: number;
  policy: number;
  announcement: number;
  queryable: number;
  publishedNotIndexed: number;
  undated: number;
  expired: number;
}

export interface PolicyCoverageDTO {
  status: "covered" | "partial" | "no_coverage";
  regionCode: string;
  regionLabel: string;
  year: number;
  exact: CoverageBucketDTO;
  national: CoverageBucketDTO;
  descendants: Array<CoverageBucketDTO & { regionCode: string; regionLabel: string }>;
  sources: Array<{
    publisher: string;
    documents: number;
    queryable: number;
    documentTypes: string[];
  }>;
  years: Array<{ year: number | null; documents: number; queryable: number }>;
  subjectExcluded: number;
  note: string;
  generatedAt: string;
}

export interface PolicyConflictDTO {
  kind: "announcement_policy";
  announcement: {
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
    validity: string;
  };
  policy: PolicyConflictDTO["announcement"];
  reason: string;
  suggestion: string;
}

export interface PolicyAnswerDTO extends QaAnswerDTO {
  scope: {
    regionCode: string;
    regionLabel: string;
    year: number;
    applicableSubjects: string[];
    applicableAudience: string | null;
  };
  coverage: PolicyCoverageDTO;
  conflicts: PolicyConflictDTO[];
}

export interface AskPolicyInput {
  question: string;
  regionCode: string;
  year: number;
  applicableSubjects?: string[];
  applicableAudience?: string;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/knowledge${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    const err = new Error(body.message || body.error || `请求失败 (${res.status})`) as Error & {
      status?: number;
      code?: string;
    };
    err.status = res.status;
    err.code = typeof body.code === "string" ? body.code : undefined;
    throw err;
  }
  return res.json() as Promise<T>;
}

export const policyApi = {
  supported: AUTH_MODE === "invited",

  coverage(input: { regionCode: string; year: number; subjects?: string[] }) {
    const params = new URLSearchParams({
      regionCode: input.regionCode,
      year: String(input.year),
    });
    if (input.subjects?.length) params.set("subjects", input.subjects.join(","));
    return request<PolicyCoverageDTO>(`/policy-coverage?${params.toString()}`);
  },

  ask(input: AskPolicyInput) {
    if (AUTH_MODE !== "invited") throw new Error("演示环境不开放政策问答");
    return request<PolicyAnswerDTO>("/questions", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
};

export type PolicyRequestError = Error & { status?: number; code?: string };
