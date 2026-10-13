/**
 * 数据库已发布公告样本（工作包 0）。
 *
 * 结构对齐 Prisma model PublishedAnnouncementVersion（backend/prisma/schema.prisma L319）：
 * 后台 extract → review → publish 后写入 published_announcement_versions 表。
 *
 * 用途：
 * - 链路③「后台发布 → DB 已发布版本 → 用户匹配结果」的回归与失败测试输入；
 * - WP3 建设 PublishedCatalogRepository 时，作为「从 DB 读出后应还原成的载荷」参照。
 *
 * payload 为公告版本载荷（与匹配引擎消费的 AnnouncementVersion 结构对齐），
 * 全部内容为虚构测试数据；dataset: "test" 显式标记，防止被误当生产数据。
 * 不得被 src/ 或 backend/src/ 生产代码引用（isolation.test.ts 守护）。
 */

/** Prisma PublishedAnnouncementVersion 的plain-object 形态（不依赖后端包，供两端测试消费） */
export interface PublishedAnnouncementVersionRow {
  id: string;
  announcementId: string;
  runId: string;
  versionNumber: number;
  status: "published" | "superseded" | "withdrawn";
  payload: Record<string, unknown>;
  publishedAt: string;
  previousVersionId: string | null;
  supersededAt: string | null;
}

export const PUBLISHED_ANNOUNCEMENT_SAMPLE: PublishedAnnouncementVersionRow = {
  id: "fx-pav-0001",
  announcementId: "fx-ann-db-priority",
  runId: "fx-run-0001",
  versionNumber: 1,
  status: "published",
  publishedAt: "2026-10-10T02:00:00.000Z",
  previousVersionId: null,
  supersededAt: null,
  payload: {
    dataset: "test",
    version: {
      id: "fx-ann-db-priority-v1",
      announcementId: "fx-ann-db-priority",
      versionNumber: 1,
      sourceKind: "original",
      publishedAt: "2026-10-10T02:00:00.000Z",
      officialSource: {
        id: "fx-db-evidence-official",
        locator: {
          kind: "url",
          url: "https://www.example.gov.cn/test/db-notice",
          anchor: "测试公告正文",
        },
        state: "official",
        checkedAt: "2026-10-10T00:00:00.000Z",
      },
      timeline: {
        registrationStart: "2026-10-10",
        registrationEnd: "2026-11-20",
      },
      units: [
        {
          id: "fx-unit-db-priority",
          code: "FX-DB-01",
          name: "测试市第五中学（初中语文）",
          announcementId: "fx-ann-db-priority",
          versionId: "fx-ann-db-priority-v1",
          region: { code: "330107", province: "浙江省", city: "杭州市", district: "测试区" },
          subject: "chinese",
          stage: "middle",
          headcount: 2,
          organizationType: "government_unified",
          employmentNature: { code: "public_institution_staff", officialName: "事业编制（测试）" },
          allocation: { code: "unified_assignment", description: "测试分配方式" },
          requirements: [
            {
              id: "fx-db-edu",
              dimension: "education",
              description: "本科及以上学历",
              hard: true,
              criterion: { kind: "education", minLevel: "bachelor" },
              evidence: {
                id: "fx-db-evidence-edu",
                locator: { kind: "excerpt", excerpt: "具有国家承认的本科及以上学历" },
                state: "official",
                checkedAt: "2026-10-10T00:00:00.000Z",
              },
            },
          ],
        },
      ],
    },
    announcement: {
      id: "fx-ann-db-priority",
      title: "【测试】数据库已发布公告",
      publisher: "测试市教育局",
      organizationType: "government_unified",
      officialUrl: "https://www.example.gov.cn/test/db-notice",
      subjectScope: ["chinese"],
      region: { code: "330100", province: "浙江省", city: "杭州市" },
      lifecycle: "active",
      firstPublishedAt: "2026-10-10T00:00:00.000Z",
    },
  },
};
