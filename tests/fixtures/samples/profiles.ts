/**
 * 测试画像样本（工作包 0）。
 *
 * 仅供 tests/ 下的自动化测试使用；不得被 src/ 或 backend/src/ 生产代码引用
 * （隔离由 tests/fixtures/isolation.test.ts 守护）。
 * 字段全部为虚构测试数据，不对应任何真实用户。
 */
import type { UserRecruitmentProfile } from "@/lib/profile/types";

/**
 * 事实完整画像：浙江（省级 required）、本科+学士、汉语言文学（师范）、
 * 2026 应届未就业、社保 0、初中语文教资已取得、接受全部官方用工形式、
 * 出生日期与杭州户籍齐全。
 */
export const COMPLETE_PROFILE: UserRecruitmentProfile = {
  regions: [{ code: "330000", province: "浙江省", level: "required" }],
  educationLevel: "bachelor",
  degree: "bachelor",
  majorFullName: "汉语言文学（师范）",
  graduationDate: "2026-06-30",
  employmentStatus: "fresh_unemployed",
  socialSecurityMonths: 0,
  teacherCert: { status: "obtained", subject: "chinese", stage: "middle" },
  acceptedEmploymentNatures: [
    "public_institution_staff",
    "record_filing",
    "post_quota",
    "headcount_control",
    "other",
  ],
  birthDate: "2000-01-15",
  hukouRegionCode: "330102",
};

/**
 * 缺少条件事实画像：基础五组与 COMPLETE_PROFILE 相同，
 * 但未提供出生日期与户籍（条件画像缺省 = 未提供）。
 * 匹配结果对这些维度只能得到 UNKNOWN，补充事实后可重算。
 */
export const PROFILE_MISSING_CONDITIONAL_FACTS: UserRecruitmentProfile = {
  regions: [{ code: "330000", province: "浙江省", level: "required" }],
  educationLevel: "bachelor",
  degree: "bachelor",
  majorFullName: "汉语言文学（师范）",
  graduationDate: "2026-06-30",
  employmentStatus: "fresh_unemployed",
  socialSecurityMonths: 0,
  teacherCert: { status: "obtained", subject: "chinese", stage: "middle" },
  acceptedEmploymentNatures: [
    "public_institution_staff",
    "record_filing",
    "post_quota",
    "headcount_control",
    "other",
  ],
};
