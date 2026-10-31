import { cn } from "@/lib/utils";
import { ReactNode } from "react";

interface CardProps {
  children: ReactNode;
  className?: string;
  padding?: "none" | "sm" | "md" | "lg";
}

/**
 * 卡片（v1.1 同层级一致性）：
 * 白底、1px 边框、圆角 10px；标准内边距 24px（md），手机 20px。
 * 默认无阴影；浮层可用 shadow-2。
 */
export function Card({ children, className, padding = "md" }: CardProps) {
  const paddings = {
    none: "",
    sm: "p-3",
    md: "p-5",
    lg: "p-6",
  };

  return (
    <div
      className={cn(
        "rounded-[10px] border border-line bg-surface",
        paddings[padding],
        className
      )}
    >
      {children}
    </div>
  );
}

interface CardHeaderProps {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function CardHeader({ title, description, action, className }: CardHeaderProps) {
  return (
    <div className={cn("mb-4 flex items-start justify-between", className)}>
      <div>
        <h3 className="text-base font-semibold text-ink">{title}</h3>
        {description && (
          <p className="mt-1 text-sm text-ink-muted">{description}</p>
        )}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}
