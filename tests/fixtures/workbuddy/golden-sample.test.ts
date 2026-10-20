/**
 * WorkBuddy 黄金样本验证测试（WB0）。
 *
 * 只验证 tests/fixtures/workbuddy/ 下的黄金样本契约，不涉及生产代码。
 * 断言目标：
 * 1. 至少两个岗位 scope，岗位编号不同；
 * 2. 公共字段与岗位字段显式区分，归属可复核；
 * 3. “师范”保留、年龄基准日/例外、用工性质、报名批次有可见断言；
 * 4. 未知（unknown）与冲突（conflict）是结构化预期状态，而非空白备注；
 * 5. 每个值带 worksheet/cell、段落或 URL 锚点。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

interface Evidence {
  locator: Record<string, unknown>;
  excerpt?: string;
}

interface CandidateField {
  field: string;
  value?: string;
  status: "extracted" | "unknown" | "conflict";
  scope: "announcement" | "job" | "unknown";
  jobKey?: string;
  ruleVersion: string;
  origin?: string;
  batchId?: string;
  evidence?: Evidence[];
  alternatives?: Array<{ value: string; source: { excerpt?: string } }>;
}

interface GoldenSample {
  meta: { dataset: string; isFabricated: boolean };
  announcement: {
    id: string;
    title: string;
    region: { code: string };
    batch: {
      batchId: string;
      registrationStart: string;
      registrationEnd: string;
      registrationEndTime: string;
      materials: string[];
      officialEntry: { url: string; appliesToBatch: string };
    };
    ageBasisDate: string;
    employmentNature: string;
  };
  candidateFields: CandidateField[];
  expectedReview: {
    unknownFields: string[];
    conflictFields: Array<{ field: string; jobKey: string; candidates: unknown[] }>;
    publicFields: string[];
    jobAFields: string[];
    jobBFields: string[];
    crossJobMixedValueGuards: Array<Record<string, string>>;
  };
}

const SAMPLE_PATH = path.resolve(__dirname, "golden-sample.json");
const sample: GoldenSample = JSON.parse(readFileSync(SAMPLE_PATH, "utf8"));

const byField = (field: string) =>
  sample.candidateFields.filter((f) => f.field === field);

describe("黄金样本卫生", () => {
  it("显式 dataset=test 且标注为构造内容", () => {
    expect(sample.meta.dataset).toBe("test");
    expect(sample.meta.isFabricated).toBe(true);
  });

  it("不指向任何真实生产来源域名", () => {
    const text = JSON.stringify(sample);
    expect(text).not.toMatch(/hzedu\.gov\.cn|nbedu\.net\.cn|nbyz\.gov\.cn/);
  });

  it("所有字段带 ruleVersion", () => {
    for (const f of sample.candidateFields) {
      expect(f.ruleVersion, `${f.field} 缺 ruleVersion`).toBeTruthy();
    }
  });
});

describe("岗位 scope 与稳定标识", () => {
  const jobFields = sample.candidateFields.filter((f) => f.scope === "job");
  const jobKeys = new Set(jobFields.map((f) => f.jobKey).filter(Boolean));

  it("至少两个岗位 scope，岗位编号不同", () => {
    expect(jobKeys.size).toBeGreaterThanOrEqual(2);
    const codes = byField("job_code").map((f) => f.value);
    expect(new Set(codes).size).toBeGreaterThanOrEqual(2);
    expect(codes).toEqual(expect.arrayContaining(["3301A01", "3301A02"]));
  });

  it("每个 job 字段都带 jobKey（稳定归属）", () => {
    for (const f of jobFields) {
      expect(f.jobKey, `${f.field} 缺 jobKey`).toBeTruthy();
    }
  });

  it("跨岗位混值防护：两个岗位专业、学历不同", () => {
    const majors = jobFields.filter((f) => f.field === "major");
    const edus = jobFields.filter((f) => f.field === "education");
    expect(majors.map((m) => m.value)).toEqual(
      expect.arrayContaining(["汉语言文学（师范）", "数学与应用数学"]),
    );
    expect(edus.map((e) => e.value)).toEqual(
      expect.arrayContaining(["本科及以上", "硕士研究生及以上"]),
    );
  });
});

describe("“师范”保留", () => {
  it("汉语言文学（师范）值保留“师范”限定词", () => {
    const major = byField("major").find((f) => f.jobKey === "job-A-3301A01");
    expect(major?.value).toBe("汉语言文学（师范）");
    expect(major?.value).toContain("师范");
  });
});

describe("年龄基准日 / 例外 / 用工性质 / 报名批次", () => {
  it("年龄基准日是公告级显式字段", () => {
    const basis = byField("age_basis_date");
    expect(basis).toHaveLength(1);
    expect(basis[0]!.scope).toBe("announcement");
    expect(sample.announcement.ageBasisDate).toBe("2026-11-05");
  });

  it("年龄例外条件独立保留", () => {
    const exc = byField("age_exception");
    expect(exc).toHaveLength(1);
    expect(exc[0]!.value).toContain("40周岁");
  });

  it("用工性质为明确事业编", () => {
    expect(sample.announcement.employmentNature).toBe("事业编制");
    const nature = byField("employment_nature");
    expect(nature[0]!.value).toBe("事业编制");
  });

  it("报名时间、材料、入口都挂同一批次", () => {
    const batchId = sample.announcement.batch.batchId;
    expect(sample.announcement.batch.registrationStart).toBe("2026-10-20");
    expect(sample.announcement.batch.registrationEnd).toBe("2026-11-05");
    expect(sample.announcement.batch.registrationEndTime).toBe("17:00");
    // 材料与入口字段显式带 batchId
    expect(byField("materials")[0]!.batchId).toBe(batchId);
    expect(byField("official_entry")[0]!.batchId).toBe(batchId);
    // 公告级 officialEntry.appliesToBatch 与 batchId 一致
    expect(sample.announcement.batch.officialEntry.appliesToBatch).toBe(batchId);
  });
});

describe("未知与冲突是结构化预期状态", () => {
  it("unknown 字段显式 status=unknown 且非空白备注", () => {
    const degree = byField("degree");
    expect(degree).toHaveLength(1);
    expect(degree[0]!.status).toBe("unknown");
    expect(degree[0]!.value).toBeUndefined();
    expect(sample.expectedReview.unknownFields).toContain("degree");
  });

  it("conflict 字段保留 value + alternatives（各带证据），不静默覆盖", () => {
    const headcount = byField("headcount").find(
      (f) => f.jobKey === "job-A-3301A01" && f.status === "conflict",
    );
    expect(headcount).toBeTruthy();
    expect(headcount!.value).toBeTruthy();
    expect(headcount!.alternatives).toBeTruthy();
    expect(headcount!.alternatives!.length).toBeGreaterThanOrEqual(2);
    const vals = headcount!.alternatives!.map((a) => a.value);
    expect(vals).toEqual(expect.arrayContaining(["2", "3"]));
    expect(sample.expectedReview.conflictFields[0]!.field).toBe("headcount");
  });
});

describe("证据锚点", () => {
  it("每个 extracted/conflict 字段都带 evidence 且 locator 非空", () => {
    for (const f of sample.candidateFields) {
      if (f.status === "unknown") continue;
      expect(f.evidence, `${f.field} 缺 evidence`).toBeTruthy();
      expect(f.evidence!.length).toBeGreaterThan(0);
      for (const e of f.evidence!) {
        expect(e.locator, `${f.field} 证据缺 locator`).toBeTruthy();
      }
    }
  });

  it("岗位行字段用 worksheet+cell 锚点", () => {
    const jobCode = byField("job_code").find((f) => f.jobKey === "job-A-3301A01");
    const loc = jobCode!.evidence![0]!.locator;
    expect(loc.kind).toBe("worksheet");
    expect(loc.cell).toBe("A2");
  });
});
