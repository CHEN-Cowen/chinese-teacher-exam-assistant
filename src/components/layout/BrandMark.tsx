import { cn } from "@/lib/utils";

/**
 * 品牌标记（模块 0A 5.3 品牌图形）：
 * - 用户端正式品牌位置不再使用 📝 等 Emoji；
 * - 使用文字 + 本地自包含 SVG/CSS 标记，不新增远程图片或图标依赖；
 * - 标记为墨蓝实心方块叠加“公告文档 + 核对勾”，表达“官方依据可追溯”。
 */
interface BrandMarkProps {
  className?: string;
  /** 是否带文字"教招有据" */
  withText?: boolean;
  /** 文字大小 */
  size?: "sm" | "md" | "lg";
}

export function BrandMark({
  className,
  withText = true,
  size = "md",
}: BrandMarkProps) {
  const markSizes = {
    sm: "h-6 w-6",
    md: "h-8 w-8",
    lg: "h-10 w-10",
  };
  const textSizes = {
    sm: "text-sm",
    md: "text-base",
    lg: "text-lg",
  };

  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <BrandGlyph className={markSizes[size]} aria-hidden="true" />
      {withText && (
        <span className={cn("font-bold text-brand", textSizes[size])}>
          教招有据
        </span>
      )}
    </span>
  );
}

/** 自包含 SVG 标记：墨蓝圆角方块 + 公告文档 + 核对勾。 */
export function BrandGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="32" height="32" rx="7" fill="var(--color-brand)" />
      <path
        d="M10 7.5h8l4 4v13H10z"
        stroke="#fff"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M18 7.5v4h4M12.5 17l2.2 2.2 4.8-5"
        stroke="#fff"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
