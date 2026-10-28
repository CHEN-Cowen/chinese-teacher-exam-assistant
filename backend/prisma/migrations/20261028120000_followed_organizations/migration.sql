-- 单位关注（D07 / PRD 11.8 U07）
--
-- 按「规范化发布主体名 + 地区码」精确身份键关注单位；
-- 提醒幂等键复用 opportunity_notice_logs，dedupKey 前缀 org:{identityKey}:。

CREATE TABLE "followed_organizations" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "identity_key" TEXT NOT NULL,
  "publisher_name" TEXT NOT NULL,
  "region_code" TEXT NOT NULL,
  "followed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "followed_organizations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "followed_organizations_user_id_identity_key_key"
  ON "followed_organizations"("user_id", "identity_key");
