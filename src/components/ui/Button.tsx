import { cn } from "@/lib/utils";
import { ButtonHTMLAttributes, forwardRef, ReactNode } from "react";

/**
 * 按钮统一规范（蓝白界面重构 v1.1 同层级一致性）
 *
 * - variant：
 *   - primary：高强调实心主按钮，品牌蓝；每屏只允许一个
 *   - secondary：次级实心，用于"次要但需要可见强调"的操作
 *   - outline：边框幽灵，用于"修改""返回修改"等次级操作
 *   - ghost：纯文字 hover 反色，用于工具条/卡片内的轻量操作
 *   - link：低强调文字入口，用于"先了解""暂时不确定""查看全部"等
 *   - danger：危险实心，仅出现在不可逆确认界面
 * - size：
 *   - sm：表单内辅助（仍保持 44px 触控高，仅内边距略小）
 *   - md：默认 44px（标准按钮）
 *   - lg：移动主按钮 48px（首页/问答/详情主行动）
 *
 * 关键可访问性：
 * - 焦点环始终可见（focus-visible 双环）
 * - 禁用态：#E9EDF5 底 + #626B7C 字，不改变几何尺寸
 * - loading：禁用 + spinner，aria-busy，不改变宽高
 */
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "link" | "danger";
  size?: "sm" | "md" | "lg";
  fullWidth?: boolean;
  loading?: boolean;
  iconStart?: ReactNode;
  iconEnd?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "primary",
      size = "md",
      fullWidth = false,
      loading = false,
      disabled,
      iconStart,
      iconEnd,
      children,
      type = "button",
      ...props
    },
    ref
  ) => {
    const baseStyles =
      "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:pointer-events-none";

    const variants = {
      primary:
        "bg-brand text-white hover:bg-brand-strong active:bg-brand-strong focus-visible:ring-brand disabled:bg-[#E9EDF5] disabled:text-ink-muted",
      secondary:
        "bg-brand-soft text-brand hover:bg-bar focus-visible:ring-brand disabled:bg-[#E9EDF5] disabled:text-ink-muted",
      outline:
        "border border-line bg-surface text-ink hover:border-brand/30 hover:bg-brand-soft/50 focus-visible:ring-brand disabled:bg-[#E9EDF5] disabled:text-ink-muted",
      ghost:
        "bg-transparent text-ink hover:bg-brand-soft/80 focus-visible:ring-brand disabled:text-ink-muted",
      link:
        "bg-transparent text-brand underline-offset-4 hover:underline focus-visible:ring-brand px-0 h-auto",
      danger:
        "bg-danger text-white hover:bg-danger/90 focus-visible:ring-danger disabled:bg-[#E9EDF5] disabled:text-ink-muted",
    };

    const sizes = {
      sm: "h-11 px-3 text-sm",
      md: "h-11 px-4 text-sm",
      lg: "h-11 px-6 text-base",
    };

    const isLink = variant === "link";

    return (
      <button
        ref={ref}
        type={type}
        aria-busy={loading || undefined}
        className={cn(
          baseStyles,
          variant === "primary" && "font-semibold",
          variants[variant],
          !isLink && sizes[size],
          fullWidth && "w-full",
          loading && "cursor: progress",
          className
        )}
        disabled={disabled || loading}
        {...props}
      >
        {loading && (
          <svg
            aria-hidden="true"
            className="h-4 w-4 animate-spin opacity-80"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
            <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
        )}
        {!loading && iconStart}
        {children}
        {!loading && iconEnd}
      </button>
    );
  }
);

Button.displayName = "Button";
