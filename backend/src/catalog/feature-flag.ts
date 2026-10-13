/**
 * v7.2 工作包 3：数据库真实目录 Feature Flag（`ff_db_catalog`）。
 *
 * 语义（见 PRD v7.2 / docs/v7.2-implementation-tracking.md §5）：
 * - 开：用户端匹配只读数据库 `PublishedAnnouncementVersion(status=published)`，
 *   静态演示/台账目录一律不参与（生产唯一事实源）；
 * - 关：沿用 v7.1 现状（滚动演示目录 + 真实台账），仅用于 Demo 与测试。
 *
 * 缺省值：显式 `FF_DB_CATALOG` 优先；未设置时生产默认开、dev/test 默认关，
 * 以免在测试/演示环境无意间改变既有行为。
 */
export function isDbCatalogEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const value = env.FF_DB_CATALOG;
  if (value === 'on' || value === 'true' || value === '1') return true;
  if (value === 'off' || value === 'false' || value === '0') return false;
  return env.NODE_ENV === 'production';
}
