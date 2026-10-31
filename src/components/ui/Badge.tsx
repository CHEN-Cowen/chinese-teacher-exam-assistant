import { cn } from "@/lib/utils";
import { isDemoMode } from "@/lib/demo/config";
import {
  ExtractionJobStatus,
  ReviewStatus,
  TaskStatus,
  MaterialStatus,
} from "@/types";
import {
  EXTRACTION_JOB_STATUS_LABELS,
  REVIEW_STATUS_LABELS,
  TASK_STATUS_LABELS,
  MATERIAL_STATUS_LABELS,
} from "@/types";

interface BadgeProps {
  variant?: "default" | "primary" | "success" | "warning" | "danger" | "info" | "muted";
  children: React.ReactNode;
  className?: string;
}

/**
 * 状态与分类标签（v1.1 同层级一致性）：
 * 固定高 24px，字号 12/20，500，水平内边距 8，圆角 4。
 * 状态同时使用文本与颜色，不只用颜色。
 */
const variantStyles: Record<string, string> = {
  default: "bg-brand-soft/60 text-ink",
  primary: "bg-brand-soft text-brand",
  success: "bg-ok-bg text-ok-ink",
  warning: "bg-ask-bg text-ask-ink",
  danger: "bg-no-bg text-no-ink",
  info: "bg-brand-soft text-brand",
  muted: "bg-brand-soft/40 text-ink-muted",
};

export function Badge({ variant = "default", children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center justify-center whitespace-nowrap rounded px-2 text-xs font-medium leading-none",
        variantStyles[variant],
        className
      )}
    >
      {children}
    </span>
  );
}

// 考情结论审核状态标签（状态不仅靠颜色，文字直接写明）
export function ReviewStatusBadge({ status }: { status: ReviewStatus }) {
  const variantMap: Record<ReviewStatus, BadgeProps["variant"]> = {
    official: "success",
    ai_extracted: "primary",
    pending_review: "warning",
    historical: "info",
    personal: "muted",
    unconfirmed: "muted",
  };
  return (
    <Badge variant={variantMap[status]}>
      {isDemoMode && status === "official"
        ? `${REVIEW_STATUS_LABELS.official}·演示`
        : REVIEW_STATUS_LABELS[status]}
    </Badge>
  );
}

// 公告提取任务状态标签
export function ExtractionJobBadge({ status }: { status: ExtractionJobStatus }) {
  const variantMap: Record<ExtractionJobStatus, BadgeProps["variant"]> = {
    idle: "muted",
    processing: "primary",
    succeeded: "success",
    failed: "danger",
    pending_review: "warning",
  };
  return (
    <Badge variant={variantMap[status]}>
      {EXTRACTION_JOB_STATUS_LABELS[status]}
    </Badge>
  );
}

// 任务状态标签
export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const variantMap: Record<TaskStatus, BadgeProps["variant"]> = {
    pending: "muted",
    in_progress: "primary",
    completed: "success",
    partial: "warning",
    abandoned: "danger",
  };
  return (
    <Badge variant={variantMap[status]}>
      {TASK_STATUS_LABELS[status]}
    </Badge>
  );
}

// 资料状态标签
export function MaterialStatusBadge({ status }: { status: MaterialStatus }) {
  const variantMap: Record<MaterialStatus, BadgeProps["variant"]> = {
    in_use: "success",
    partial_use: "warning",
    paused: "muted",
    replaced: "danger",
  };
  return (
    <Badge variant={variantMap[status]}>
      {MATERIAL_STATUS_LABELS[status]}
    </Badge>
  );
}
