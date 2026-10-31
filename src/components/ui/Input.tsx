import { cn } from "@/lib/utils";
import {
  InputHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
  forwardRef,
  useId,
} from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, hint, id, ...props }, ref) => {
    const autoId = useId();
    const inputId = id ?? autoId;
    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={inputId}
            className="mb-2 block text-sm font-semibold text-ink"
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={cn(
            "h-11 w-full rounded-lg border border-[#BFC9D9] bg-surface px-3 text-sm text-ink placeholder:text-ink-muted/60 transition-colors",
            "hover:border-brand/30 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/10",
            "disabled:bg-[#E9EDF5] disabled:text-ink-muted disabled:cursor-not-allowed",
            error && "border-danger focus:ring-danger",
            className
          )}
          aria-invalid={error ? true : undefined}
          {...props}
        />
        {error && <p className="mt-1.5 text-sm text-danger">{error}</p>}
        {hint && !error && (
          <p className="mt-1.5 text-[13px] text-ink-muted">{hint}</p>
        )}
      </div>
    );
  }
);

Input.displayName = "Input";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: { value: string; label: string }[];
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, label, error, options, placeholder, id, ...props }, ref) => {
    const autoId = useId();
    const selectId = id ?? autoId;
    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={selectId}
            className="mb-2 block text-sm font-semibold text-ink"
          >
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={selectId}
          className={cn(
            "h-11 w-full rounded-lg border border-[#BFC9D9] bg-surface px-3 text-sm text-ink transition-colors",
            "hover:border-brand/30 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/10",
            "disabled:bg-[#E9EDF5] disabled:text-ink-muted disabled:cursor-not-allowed",
            error && "border-danger focus:ring-danger",
            className
          )}
          aria-invalid={error ? true : undefined}
          {...props}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {error && <p className="mt-1.5 text-sm text-danger">{error}</p>}
      </div>
    );
  }
);

Select.displayName = "Select";

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, error, id, ...props }, ref) => {
    const autoId = useId();
    const areaId = id ?? autoId;
    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={areaId}
            className="mb-2 block text-sm font-semibold text-ink"
          >
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={areaId}
          className={cn(
            "min-h-[112px] w-full rounded-lg border border-[#BFC9D9] bg-surface px-3 py-3 text-sm leading-[22px] text-ink placeholder:text-ink-muted/60 transition-colors",
            "hover:border-brand/30 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/10",
            "disabled:bg-[#E9EDF5] disabled:text-ink-muted disabled:cursor-not-allowed",
            error && "border-danger focus:ring-danger",
            className
          )}
          aria-invalid={error ? true : undefined}
          {...props}
        />
        {error && <p className="mt-1.5 text-sm text-danger">{error}</p>}
      </div>
    );
  }
);

Textarea.displayName = "Textarea";
