-- v7.2 发布规则补强：已发布公告版本撤回留痕。
-- 撤回保留历史（不删除行、不产生新版本、不复活旧版），
-- 记录撤回时间、原因与操作人供审计；撤回版本投影出 lifecycle=withdrawn。
ALTER TABLE "published_announcement_versions" ADD COLUMN "withdrawn_at" TIMESTAMP(3);
ALTER TABLE "published_announcement_versions" ADD COLUMN "withdraw_reason" TEXT;
ALTER TABLE "published_announcement_versions" ADD COLUMN "withdrawn_by" TEXT;
