import { Button } from "./Button";
import { LinkButton } from "./LinkButton";

interface EmptyStateProps {
  title: string;
  description?: string;
  actionLabel?: string;
  actionHref?: string;
  onAction?: () => void;
  icon?: React.ReactNode;
}

export function EmptyState({
  title,
  description,
  actionLabel,
  actionHref,
  onAction,
  icon,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-surface/70 px-5 py-10 text-center">
      {icon && (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-soft text-brand">
          {icon}
        </div>
      )}
      <h3 className={description ? "mb-2 text-lg font-semibold text-ink" : "mb-4 text-lg font-semibold text-ink"}>{title}</h3>
      {description && <p className="mb-6 max-w-sm text-sm leading-relaxed text-ink-muted">{description}</p>}
      {actionLabel && actionHref && (
        <LinkButton href={actionHref} variant="primary">
          {actionLabel}
        </LinkButton>
      )}
      {actionLabel && onAction && !actionHref && (
        <Button variant="primary" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
