-- 单位关注基线同步水位（R04）
--
-- baseline_synced_at = 该关注完成首次同步基线回填的时间。
-- NULL：尚未完成首次同步，首次同步只回填关注时刻前已发布的公告；
-- 首次同步即使没有任何匹配公告也会写入，避免“历史键为空”被永久当作首次同步而漏报。

ALTER TABLE "followed_organizations"
  ADD COLUMN "baseline_synced_at" TIMESTAMP(3);
