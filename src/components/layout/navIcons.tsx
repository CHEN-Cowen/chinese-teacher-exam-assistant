import type { PrimaryNavId } from "@/lib/ia/nav";

/**
 * 用户端主导航内联 SVG 图标（模块 0A：不使用任何境外图标 CDN/图标字体）。
 * 描边跟随 currentColor，激活态只改颜色与字重，不引入装饰图形。
 */
export function NavIcon({ id, className }: { id: PrimaryNavId; className?: string }) {
  const common = {
    className,
    fill: "none" as const,
    viewBox: "0 0 24 24",
    stroke: "currentColor",
    "aria-hidden": true,
  };
  switch (id) {
    case "opportunities":
      return (
        <svg {...common} strokeWidth={1.8}>
          <circle cx="12" cy="12" r="9" />
          <path d="m15.5 8.5-2.2 4.8-4.8 2.2 2.2-4.8 4.8-2.2Z" strokeLinejoin="round" />
        </svg>
      );
    case "history":
      return (
        <svg {...common} strokeWidth={1.8}>
          <path
            d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M3 3v5h5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M12 7v5l4 2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "follows":
      return (
        <svg {...common} strokeWidth={1.8}>
          <path
            d="M12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2Z"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "me":
      return (
        <svg {...common} strokeWidth={1.8}>
          <circle cx="12" cy="8" r="4" />
          <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" strokeLinecap="round" />
        </svg>
      );
  }
}
