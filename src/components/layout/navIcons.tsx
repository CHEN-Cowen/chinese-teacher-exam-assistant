import type { PrimaryNavId } from "@/lib/ia/nav";

/**
 * 用户端主导航内联 SVG 图标（模块 0A：不使用任何境外图标 CDN/图标字体）。
 * 描边跟随 currentColor，激活态只改颜色与字重，不引入装饰图形。
 */
const utilityPaths = {
  applications: "M8 6V4h8v2M4 7h16v13H4zM4 12h16m-10 0v2h4v-2",
  schedule: "M4 6h16v14H4zM8 4v4m8-4v4M4 10h16m-12 4h2m4 0h2",
  materials: "M6 3h9l4 4v14H6zM14 3v5h5m-9 4h5m-5 4h5",
  study: "M3 5h5l4 2 4-2h5v13h-5l-4 2-4-2H3zM12 7v13",
  settings: "M4 7h16M4 12h16M4 17h16M8 5v4m8 1v4m-6 1v4",
};

export function NavIcon({ id, className }: { id: PrimaryNavId | keyof typeof utilityPaths; className?: string }) {
  const common = {
    className,
    fill: "none" as const,
    viewBox: "0 0 24 24",
    stroke: "currentColor",
    "aria-hidden": true,
  };
  switch (id) {
    case "applications":
    case "schedule":
    case "materials":
    case "study":
    case "settings":
      return (
        <svg {...common} strokeWidth={1.8}>
          <path d={utilityPaths[id]} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
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
