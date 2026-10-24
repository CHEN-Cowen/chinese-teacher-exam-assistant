import { normalizeUrl } from './official-site-adapter.js';

/** 独立清单必须先于系统发现结果冻结；不从抓取结果生成分母。 */
export interface SourceChecklist {
  sourceKey: string;
  listUrl: string;
  window: { from: string; to: string };
  verification: 'verified' | 'pending';
  checkedAt: string;
  entries: Array<{
    url: string;
    title: string;
    publishedAt: string;
    disposition: 'target' | 'excluded';
    reason: string;
  }>;
}

export interface SourceObservation {
  url: string;
  title: string;
  publishedAt: string;
  outcome: 'discovered' | 'access_failed' | 'parse_failed' | 'misclassified' | 'pending_manual';
  materialComplete: boolean;
}

export function reconcileSource(checklist: SourceChecklist, observations: SourceObservation[]) {
  const { from, to } = checklist.window;
  const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!isDate(from) || !isDate(to) || from > to) throw new Error('独立清单时间窗口无效');
  const seen = new Set<string>();
  for (const entry of checklist.entries) {
    const key = normalizeUrl(entry.url);
    if (seen.has(key)) throw new Error('独立清单存在重复 URL');
    seen.add(key);
    if (!isDate(entry.publishedAt) || entry.publishedAt < from || entry.publishedAt > to || !entry.reason.trim()) {
      throw new Error('清单条目缺少有效日期、窗口或纳入/排除理由');
    }
  }
  const rows = checklist.entries.filter((entry) => entry.disposition === 'target').map((entry) => {
    const matches = observations.filter((item) => normalizeUrl(item.url) === normalizeUrl(entry.url));
    // 同 URL 不同标题/日期不能静默算命中；重复运行有失败时保守保留待复核。
    const exact = matches.filter((item) => item.title.trim() === entry.title.trim() && item.publishedAt === entry.publishedAt);
    const observation = exact.find((item) => item.outcome !== 'discovered') ?? exact[0];
    const outcome = observation?.outcome ?? (matches.length ? 'metadata_mismatch' : 'not_discovered');
    return { ...entry, outcome, materialComplete: outcome === 'discovered' && observation?.materialComplete === true };
  });
  const denominator = rows.length;
  const metric = (numerator: number) => ({ numerator, denominator,
    ratio: checklist.verification === 'verified' && denominator > 0 ? numerator / denominator : null });
  return {
    sourceKey: checklist.sourceKey,
    verification: checklist.verification,
    rows,
    excluded: checklist.entries.filter((entry) => entry.disposition === 'excluded'),
    recall: metric(rows.filter((row) => row.outcome === 'discovered').length),
    materialCompleteness: metric(rows.filter((row) => row.materialComplete).length),
  };
}
