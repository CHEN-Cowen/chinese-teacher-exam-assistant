export function LoadingSpinner({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const sizes = {
    sm: "w-4 h-4",
    md: "w-8 h-8",
    lg: "w-12 h-12",
  };

  return (
    <div className="flex items-center justify-center p-8">
      <div
        className={`${sizes[size]} border-2 border-brand-soft border-t-brand rounded-full animate-spin`}
        role="status"
        aria-label="加载中"
      />
    </div>
  );
}

export function LoadingPage() {
  return (
    <div className="mx-auto min-h-[400px] w-full max-w-2xl space-y-4 px-4 py-8" role="status" aria-label="正在加载页面">
      <div className="animate-pulse rounded-2xl border border-brand/10 bg-surface p-6">
        <div className="h-3 w-28 rounded-full bg-brand-soft" />
        <div className="mt-4 h-7 w-4/5 rounded-lg bg-brand-soft/80" />
        <div className="mt-3 h-4 w-3/5 rounded bg-canvas" />
        <div className="mt-6 h-11 rounded-lg bg-brand-soft" />
      </div>
      <div className="animate-pulse space-y-3" aria-hidden="true">
        <div className="h-4 w-24 rounded bg-line" />
        <div className="h-24 rounded-2xl border border-line bg-surface" />
        <div className="h-20 rounded-2xl border border-line bg-surface" />
      </div>
      <span className="sr-only">正在获取内容，请稍候</span>
    </div>
  );
}

export function LoadingCard() {
  return (
    <div
      className="bg-surface rounded-xl border border-line p-6 animate-pulse"
      role="status"
      aria-label="加载中"
    >
      <div className="h-4 bg-brand-soft/60 rounded w-1/4 mb-4"></div>
      <div className="space-y-3">
        <div className="h-3 bg-brand-soft/60 rounded"></div>
        <div className="h-3 bg-brand-soft/60 rounded w-5/6"></div>
        <div className="h-3 bg-brand-soft/60 rounded w-4/6"></div>
      </div>
    </div>
  );
}
