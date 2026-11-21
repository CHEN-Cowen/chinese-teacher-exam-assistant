/**
 * 公告补录纯函数（D08 / PRD 11.9 U08）。
 *
 * 前后端同口径的链接安全校验：官方链接只接受 http/https 公网地址，
 * 拒绝本机、内网/保留 IP（含 IPv4 映射的 IPv6 十六进制形式）与带凭据 URL。
 * 服务端仍会再次校验，前端校验只用于即时反馈，不构成安全边界。
 *
 * 处理状态与纠错共用同一状态机，这里提供用户视角与员工视角的文案映射。
 */

export type AnnouncementSubmissionStatus =
  | "submitted"
  | "reviewing"
  | "need_supplement"
  | "resolved"
  | "rejected";

const PRIVATE_V4_RANGES: readonly { net: number; bits: number }[] = [
  { net: 0x00000000, bits: 8 },
  { net: 0x0a000000, bits: 8 }, // 10/8
  { net: 0x7f000000, bits: 8 }, // 127/8
  { net: 0xa9fe0000, bits: 16 }, // 169.254/16
  { net: 0xac100000, bits: 12 }, // 172.16/12
  { net: 0xc0a80000, bits: 16 }, // 192.168/16
];

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return false;
    const n = Number(part);
    if (n > 255) return false;
    value = (value << 8) | n;
  }
  return PRIVATE_V4_RANGES.some(
    ({ net, bits }) => (value >>> (32 - bits)) === (net >>> (32 - bits)),
  );
}

function isPrivateIPv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "::1" || h === "::") return true;
  const mappedDec = h.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mappedDec) return isPrivateIPv4(mappedDec[1]);
  const mappedHex = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    return isPrivateIPv4(
      `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`,
    );
  }
  if (/^f[cd][0-9a-f]{2}:/.test(h)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(h)) return true;
  return false;
}

export interface OfficialUrlCheck {
  ok: boolean;
  normalized?: string;
  message?: string;
}

/** 校验并规范化用户提交的官方链接（与后端 announcement-submission.domain 同口径） */
export function checkOfficialUrl(raw: unknown): OfficialUrlCheck {
  if (typeof raw !== "string" || !raw.trim()) {
    return { ok: false, message: "请填写官方公告链接" };
  }
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, message: "链接格式不正确，请粘贴完整的官方网址" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, message: "只接受 http/https 官方链接" };
  }
  if (url.username || url.password) {
    return { ok: false, message: "链接不能包含账号密码等凭据信息" };
  }
  const host = url.hostname.toLowerCase();
  if (!host) return { ok: false, message: "链接缺少主机名" };
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    return { ok: false, message: "不接受本机或内网地址，请填写公网官方链接" };
  }
  if (url.port === "0") return { ok: false, message: "链接端口不正确" };
  if (isPrivateIPv4(host) || isPrivateIPv6(host)) {
    return { ok: false, message: "不接受内网或保留地址，请填写公网官方链接" };
  }
  url.hash = "";
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }
  return { ok: true, normalized: url.toString() };
}

/** 补录输入整体校验：返回第一个错误的提示，全部合法时返回规范化值 */
export function validateSubmissionForm(input: {
  officialUrl: string;
  publisherName: string;
  regionCode: string;
  note?: string;
}): { ok: false; message: string } | {
  ok: true;
  value: {
    officialUrl: string;
    publisherName: string;
    regionCode: string;
    note?: string;
  };
} {
  const urlCheck = checkOfficialUrl(input.officialUrl);
  if (!urlCheck.ok || !urlCheck.normalized) {
    return { ok: false, message: urlCheck.message ?? "官方链接不合法" };
  }
  const publisherName = input.publisherName.trim();
  if (!publisherName) return { ok: false, message: "请填写发布单位名称" };
  if (publisherName.length > 100) {
    return { ok: false, message: "发布单位名称不能超过 100 字" };
  }
  if (!/^\d{6}$/.test(input.regionCode)) {
    return { ok: false, message: "请选择公告所属地区" };
  }
  const note = input.note?.trim();
  if (note && note.length > 500) {
    return { ok: false, message: "补充说明不能超过 500 字" };
  }
  return {
    ok: true,
    value: {
      officialUrl: urlCheck.normalized,
      publisherName,
      regionCode: input.regionCode,
      note: note || undefined,
    },
  };
}

/** 处理状态 → 用户/员工通用中文标签与徽章色 */
export function submissionStatusMeta(status: string): {
  label: string;
  tone: "warning" | "info" | "success" | "muted";
} {
  switch (status) {
    case "submitted":
      return { label: "已提交", tone: "warning" };
    case "reviewing":
      return { label: "处理中", tone: "info" };
    case "need_supplement":
      return { label: "需补充", tone: "warning" };
    case "resolved":
      return { label: "已处理", tone: "success" };
    case "rejected":
      return { label: "暂未采纳", tone: "muted" };
    default:
      return { label: status, tone: "muted" as const };
  }
}
