"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { stageLabel, subjectLabel } from "@/lib/ia/labels";
import type { StageCode, SubjectCode } from "@/lib/announcements/types";

interface Notice {
  id: string;
  title: string;
  publisher: string;
  province: string;
  subjects: SubjectCode[];
  stages: StageCode[];
  checkedAt: string;
  publishedAt: string;
  officialUrl: string;
  registrationStart?: string;
  registrationEnd?: string;
}

function NoticeStatus({ notice }: { notice: Notice }) {
  const now = Date.parse(notice.checkedAt);
  const start = Date.parse(notice.registrationStart ?? "");
  const end = Date.parse(notice.registrationEnd ?? "");
  if (end <= now) return <Badge variant="muted">已截止</Badge>;
  if (start > now) return <Badge variant="info">未开始</Badge>;
  if (!(start <= now && end > now)) return <Badge variant="muted">报名时间待核对</Badge>;
  return end - now <= 3 * 86400000
    ? <Badge variant="warning">即将截止</Badge>
    : <Badge variant="success">报名中</Badge>;
}

export function PublicRecruitment({ featured = false }: { featured?: boolean }) {
  const [notices, setNotices] = useState<Notice[]>();
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [province, setProvince] = useState("");
  const [subject, setSubject] = useState("");
  const [stage, setStage] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/opportunities/public-notices", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("加载失败");
        return response.json() as Promise<Notice[]>;
      })
      .then(setNotices)
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [retry]);

  const rows = notices ?? [];
  const visible = featured ? rows.slice(0, 3) : rows.filter(
    (notice) => (!province || notice.province === province) &&
      (!subject || notice.subjects.some((code) => code === subject)) &&
      (!stage || notice.stages.some((code) => code === stage)),
  );

  return (
    <section className={featured ? "mt-10 space-y-5 border-t border-line pt-8" : "space-y-5"}>
      {featured && (
        <nav aria-label="招聘资源" className="flex flex-wrap items-center gap-5 text-sm font-semibold text-brand">
          <Link href="/recruitment" className="hover:underline">浏览招聘公告</Link>
          <Link href="/history" className="hover:underline">往年参考</Link>
          <Link href="/policy" className="hover:underline">政策检索</Link>
          <Link href="/learn" className="hover:underline">产品说明</Link>
        </nav>
      )}
      {!featured && notices && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-sm font-medium">
            地区
            <select className="rounded-lg border border-line bg-surface px-3 py-2" value={province} onChange={(event) => setProvince(event.target.value)}>
              <option value="">全部地区</option>
              {[...new Set(rows.map((notice) => notice.province))].map((value) => <option key={value}>{value}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium">
            学科
            <select className="rounded-lg border border-line bg-surface px-3 py-2" value={subject} onChange={(event) => setSubject(event.target.value)}>
              <option value="">全部学科</option>
              {[...new Set(rows.flatMap((notice) => notice.subjects))].map((value) => <option key={value} value={value}>{subjectLabel(value)}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium">
            学段
            <select className="rounded-lg border border-line bg-surface px-3 py-2" value={stage} onChange={(event) => setStage(event.target.value)}>
              <option value="">全部学段</option>
              {[...new Set(rows.flatMap((notice) => notice.stages))].map((value) => <option key={value} value={value}>{stageLabel(value)}</option>)}
            </select>
          </label>
          {(province || subject || stage) && <button type="button" className="p-2 text-sm text-brand" onClick={() => { setProvince(""); setSubject(""); setStage(""); }}>清除筛选</button>}
        </div>
      )}
      {visible.length > 0 && (
        <>
          {featured && <h2 className="text-xl font-bold text-ink">近期官方招聘</h2>}
          <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
            {visible.map((notice) => (
              <li key={notice.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5">
                <div className="min-w-0">
                  <a href={notice.officialUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand hover:underline">{notice.title} ↗</a>
                  <p className="mt-1 text-sm text-ink-muted">{notice.publisher} · {notice.publishedAt.slice(0, 10)}</p>
                </div>
                <NoticeStatus notice={notice} />
              </li>
            ))}
          </ul>
        </>
      )}
      {!featured && error && <p role="alert">公告加载失败。 <button type="button" className="text-brand underline" onClick={() => { setError(false); setRetry(retry + 1); }}>重试</button></p>}
      {!featured && !error && !notices && <p role="status">正在读取公告…</p>}
      {!featured && notices && !visible.length && (
        <p className="rounded-xl border border-dashed border-line p-4 text-sm text-ink-muted">
          {rows.length ? "当前筛选下暂无公告。" : "暂无已收录的公开公告。"}
        </p>
      )}
    </section>
  );
}
