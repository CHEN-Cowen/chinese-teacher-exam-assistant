/**
 * 首页 Hero 右侧「机会页界面预览」。
 *
 * 为什么用 DOM 而不是截图：
 * - 位图在高分屏/浏览器缩放下发虚，改一句文案就得重导图；
 * - 用真实元素复刻机会页「按地区浏览」的结构（标签页 + 省市区筛选 + 公告卡），
 *   任意分辨率都清晰，样式也跟着设计 token 走。
 *
 * 语义处理：整块是一张示意图，对读屏只暴露一句 aria-label，
 * 内部假数据不参与可访问性树（aria-hidden），避免把示意内容读成真实公告。
 * 数据不含年份，避免首页长期挂着过期信息。
 */

const PREVIEW_TABS = ["按地区浏览", "按我的条件", "往年参考"] as const;

const PREVIEW_FILTERS = [
  { label: "省份", value: "全部省份" },
  { label: "城市", value: "全部城市" },
  { label: "区县", value: "全部区县" },
] as const;

const PREVIEW_NOTICES = [
  {
    title: "宁波市鄞州区公开招聘事业编制教师公告",
    org: "宁波市鄞州区人力资源和社会保障局",
    region: "浙江省",
    tags: ["语文", "初中"],
    window: "11-21 至 12-10",
  },
  {
    title: "苏州高新区公办学校招聘员额制教师公告",
    org: "苏州高新区（虎丘区）教育局",
    region: "江苏省",
    tags: ["语文", "初中"],
    window: "11-20 至 12-13",
  },
] as const;

function Chevron() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 12 12"
      className="h-3 w-3 shrink-0 text-ink-muted"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <path d="m3 4.5 3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function HeroOpportunityPreview() {
  return (
    <div
      role="img"
      aria-label="机会页界面预览示意：选择省市区后按地区浏览招聘公告，每条公告标注报名状态与报名时间"
      data-testid="result-preview-mock"
      className="select-none rounded-xl border border-line bg-canvas p-3.5 md:p-4"
    >
      <div aria-hidden="true" className="space-y-3">
        {/* 标签页 */}
        <div className="flex items-center gap-1 rounded-lg bg-surface-2 p-1">
          {PREVIEW_TABS.map((tab, index) => (
            <span
              key={tab}
              className={
                index === 0
                  ? "inline-flex h-8 flex-1 items-center justify-center rounded-[7px] bg-surface text-[13px] font-semibold text-brand shadow-[0_1px_2px_rgba(37,41,39,0.08)]"
                  : "inline-flex h-8 flex-1 items-center justify-center rounded-[7px] text-[13px] text-ink-muted"
              }
            >
              {tab}
            </span>
          ))}
        </div>

        {/* 筛选条件 */}
        <div className="rounded-[10px] border border-line bg-surface p-3">
          {/* 窄屏纵向排列：三列并排在 375px 会把「全部省份」压成「全部…」 */}
          <div className="grid gap-2 sm:grid-cols-3">
            {PREVIEW_FILTERS.map((item) => (
              <div key={item.label}>
                <p className="text-[11px] leading-4 text-ink-muted">{item.label}</p>
                <div className="mt-1 flex h-9 items-center justify-between gap-1 rounded-lg border border-input-border px-2.5">
                  <span className="truncate text-[12.5px] text-ink">{item.value}</span>
                  <Chevron />
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] leading-4 text-ink-muted">公告或发布单位关键词</p>
          <div className="mt-1 flex h-9 items-center rounded-lg border border-input-border px-2.5 text-[12.5px] text-ink-muted">
            如：杭州 / 教育局
          </div>
        </div>

        {/* 条数 */}
        <p className="text-[12px] text-ink-muted">
          共 <span className="font-semibold text-ink">7</span> 条公告
        </p>

        {/* 公告卡 */}
        {PREVIEW_NOTICES.map((notice) => (
          <div key={notice.title} className="rounded-[10px] border border-line bg-surface p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="text-[13px] font-semibold leading-5 text-ink">{notice.title}</p>
              <span className="mt-0.5 inline-flex h-[22px] shrink-0 items-center rounded-full border border-ok-line bg-ok-bg px-2 text-[11px] font-medium text-ok-ink">
                报名中
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-4 text-ink-muted">
              {notice.org} · {notice.region}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {notice.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex h-5 items-center rounded-[4px] bg-surface-2 px-1.5 text-[11px] text-ink-muted"
                >
                  {tag}
                </span>
              ))}
              <span className="text-[11px] text-ink-muted">报名：{notice.window}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
