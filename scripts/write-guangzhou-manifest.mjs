// 生成广州夹具的公开采样清单（一次性本地计算，不提交）
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'tests/fixtures/golden-sources/guangzhou-education';
const sha = (name) =>
  createHash('sha256')
    .update(readFileSync(join(DIR, name)))
    .digest('hex');

const list = {
  source: 'guangzhou-education',
  capturedAt: '2026-11-06T10:26:00Z',
  scope: 'public-list',
  site: 'https://jyj.gz.gov.cn/',
  column: '网上公示（/yw/wsgs/，含公开招聘教师、拟聘用人员公示、优才计划等）',
  files: [
    {
      name: 'wsgs-index.html',
      url: 'https://jyj.gz.gov.cn/yw/wsgs/index.html',
      sha256: sha('wsgs-index.html'),
      method: 'GET',
      note: '首屏 20 条；方括号日期 [YYYY-MM-DD]；静态锚点分页 a.last -> index_20.html（官方 20 页 / 每页 20 条）；页内 createPageHTML 声明已被注释失效',
    },
    {
      name: 'wsgs-index-2.html',
      url: 'https://jyj.gz.gov.cn/yw/wsgs/index_2.html',
      sha256: sha('wsgs-index-2.html'),
      method: 'GET',
      note: '第 2 页 20 条；与首屏无重叠，招聘相关 14/20',
    },
  ],
};

const detail = {
  source: 'guangzhou-education',
  capturedAt: '2026-11-06T10:26:00Z',
  scope: 'public-detail',
  site: 'https://jyj.gz.gov.cn/',
  files: [
    {
      name: 'detail-post_11019946.html',
      url: 'https://jyj.gz.gov.cn/yw/wsgs/content/post_11019946.html',
      sha256: sha('detail-post_11019946.html'),
      note: '广州市教育局直属事业单位广州市第六中学2026年第一次公开招聘教师第三批拟聘用人员公示；meta ArticleTitle/PubDate + div#zoomcon；1 个 xlsx 附件（拟聘用人员名单）',
    },
    {
      name: 'detail-post_11080595.html',
      url: 'https://jyj.gz.gov.cn/yw/wsgs/content/post_11080595.html',
      sha256: sha('detail-post_11080595.html'),
      note: '事业单位引进急需人才相关公示；meta + div#zoomcon；1 个 xlsx 附件',
    },
    {
      name: 'detail-post_11088519.html',
      url: 'https://jyj.gz.gov.cn/yw/wsgs/content/post_11088519.html',
      sha256: sha('detail-post_11088519.html'),
      note: '采样补充（未纳入断言换行校验）；同族详情结构',
    },
    {
      name: 'detail-post_11088535.html',
      url: 'https://jyj.gz.gov.cn/yw/wsgs/content/post_11088535.html',
      sha256: sha('detail-post_11088535.html'),
      note: '采样补充（未纳入断言校验）；同族详情结构',
    },
    {
      name: 'detail-post_11090956.html',
      url: 'https://jyj.gz.gov.cn/yw/wsgs/content/post_11090956.html',
      sha256: sha('detail-post_11090956.html'),
      note: '基础教育精品课名单公示；同族详情结构',
    },
  ],
};

writeFileSync(join(DIR, 'public-manifest.json'), JSON.stringify(list, null, 2) + '\n', 'utf8');
writeFileSync(
  join(DIR, 'public-detail-manifest.json'),
  JSON.stringify(detail, null, 2) + '\n',
  'utf8',
);
console.log('manifest written');
