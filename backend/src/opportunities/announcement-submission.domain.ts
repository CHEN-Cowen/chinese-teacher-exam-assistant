/**
 * 公告补录领域规则（D08 / PRD 11.9 U08）：纯函数，不含存储与框架代码。
 *
 * 用户报告未收录的官方公告（官方链接、发布单位、地区、可选说明）。
 * 提交只进入运营待办队列，绝不直接进入采集或发布；处理状态机与纠错共用
 * corrections.domain（submitted → reviewing → resolved/rejected，含 need_supplement）。
 *
 * 安全与滥用边界（dev D08 出口）：
 * - 官方链接只接受 http/https，拒绝 localhost、内网/私网 IP、带凭据的 URL
 *   （恶意/内网链接被拒）；服务端不抓取该 URL，仅登记供员工人工核对。
 * - 限流：同一用户 24 小时内最多 MAX_SUBMISSIONS_PER_DAY 条。
 * - 去重可识别：本人 24 小时内重复同一链接返回 409 并附原记录；
 *   该链接已被任何人「已处理（已收录）」时拒绝并说明。
 */

import { createHash } from 'node:crypto';

/** 同一用户 24 小时滚动窗口内允许的补录提交上限 */
export const MAX_SUBMISSIONS_PER_DAY = 10;
/** 窗口长度（毫秒） */
export const SUBMISSION_WINDOW_MS = 24 * 60 * 60 * 1000;

const PRIVATE_V4_RANGES: readonly { net: number; bits: number }[] = [
  { net: 0x00000000, bits: 8 }, // 0.0.0.0/8
  { net: 0x0a000000, bits: 8 }, // 10/8
  { net: 0x7f000000, bits: 8 }, // 127/8
  { net: 0xa9fe0000, bits: 16 }, // 169.254/16 链路本地
  { net: 0xac100000, bits: 12 }, // 172.16/12
  { net: 0xc0a80000, bits: 16 }, // 192.168/16
];

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.');
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
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === '::1' || h === '::') return true;
  // IPv4 映射地址：十进制 ::ffff:a.b.c.d，或 Node 规范化后的十六进制 ::ffff:xxxx:xxxx
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
  // 唯一本地 fc00::/7 与链路本地 fe80::/10
  if (/^f[cd][0-9a-f]{2}:/.test(h)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(h)) return true;
  return false;
}

export interface UrlCheck {
  ok: boolean;
  /** 校验通过时的规范形（去 hash、小写协议与主机名） */
  normalized?: string;
  message?: string;
}

/**
 * 校验并规范化用户提交的官方链接。
 * 只接受 http/https；拒绝 localhost/.local 主机名、私网/内网 IP（含 IPv6）、
 * 带 user:pass 凭据的 URL。hash 片段不参与校验与去重。
 */
export function checkSubmissionUrl(raw: unknown): UrlCheck {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { ok: false, message: '请填写官方公告链接' };
  }
  const trimmed = raw.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, message: '链接格式不正确，请粘贴完整的官方网址' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, message: '只接受 http/https 官方链接' };
  }
  if (url.username || url.password) {
    return { ok: false, message: '链接不能包含账号密码等凭据信息' };
  }
  const host = url.hostname.toLowerCase();
  if (!host) {
    return { ok: false, message: '链接缺少主机名' };
  }
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    return { ok: false, message: '不接受本机或内网地址，请填写公网官方链接' };
  }
  if (url.port === '0') {
    return { ok: false, message: '链接端口不正确' };
  }
  if (isPrivateIPv4(host) || isPrivateIPv6(host)) {
    return { ok: false, message: '不接受内网或保留地址，请填写公网官方链接' };
  }
  url.hash = '';
  // 规范化：路径结尾斜杠视为同一链接（根路径除外）
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.slice(0, -1);
  }
  return { ok: true, normalized: url.toString() };
}

/** 规范化 URL 的 SHA-256 指纹（去重键；服务端存储哈希而非原文重复比对） */
export function submissionUrlHash(normalizedUrl: string): string {
  return createHash('sha256').update(normalizedUrl).digest('hex');
}

export interface SubmissionInputCheck {
  ok: boolean;
  message?: string;
  value?: {
    officialUrl: string;
    urlHash: string;
    publisherName: string;
    regionCode: string;
    note: string | null;
  };
}

/** 校验补录提交整体输入：链接安全 + 单位名 + 6 位地区码 + 可选说明 */
export function validateSubmissionInput(body: {
  officialUrl?: unknown;
  publisherName?: unknown;
  regionCode?: unknown;
  note?: unknown;
}): SubmissionInputCheck {
  const urlCheck = checkSubmissionUrl(body.officialUrl);
  if (!urlCheck.ok || !urlCheck.normalized) {
    return { ok: false, message: urlCheck.message };
  }
  const publisherName =
    typeof body.publisherName === 'string' ? body.publisherName.trim() : '';
  if (!publisherName) {
    return { ok: false, message: '请填写发布单位名称' };
  }
  if (publisherName.length > 100) {
    return { ok: false, message: '发布单位名称不能超过 100 字' };
  }
  const regionCode =
    typeof body.regionCode === 'string' ? body.regionCode.trim() : '';
  if (!/^\d{6}$/.test(regionCode)) {
    return { ok: false, message: '请选择公告所属地区' };
  }
  let note: string | null = null;
  if (typeof body.note === 'string' && body.note.trim()) {
    note = body.note.trim();
    if (note.length > 500) {
      return { ok: false, message: '补充说明不能超过 500 字' };
    }
  }
  return {
    ok: true,
    value: {
      officialUrl: urlCheck.normalized,
      urlHash: submissionUrlHash(urlCheck.normalized),
      publisherName,
      regionCode,
      note,
    },
  };
}

export interface ExistingSubmissionLite {
  id: string;
  userId: string;
  urlHash: string;
  status: string;
  createdAt: Date;
}

/** 补录提交对外 DTO（本人视角；不含审核人内部账号之外的用户信息） */
export interface AnnouncementSubmissionDTO {
  id: string;
  officialUrl: string;
  publisherName: string;
  regionCode: string;
  note: string | null;
  status: string;
  reviewNote: string | null;
  reviewerId: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

/** 员工队列项：附带提交人账号信息（仅 STAFF_ROLES 可见） */
export interface StaffAnnouncementSubmissionDTO
  extends AnnouncementSubmissionDTO {
  submitter: {
    id: string;
    email: string;
    name: string | null;
  };
}

export type SubmissionDecision =
  | { ok: true }
  | { ok: false; kind: 'duplicate_self'; message: string; existingId: string }
  | { ok: false; kind: 'already_accepted'; message: string }
  | { ok: false; kind: 'rate_limited'; message: string };

/**
 * 提交前置决策（去重 + 限流）。
 * - 本人 24h 内同一链接（任意状态）→ duplicate_self（附原受理记录 id）；
 * - 该链接已被任何人 resolved（已收录）→ already_accepted；
 * - 本人 24h 窗口内提交数达上限 → rate_limited。
 */
export function decideSubmission(input: {
  urlHash: string;
  userId: string;
  recentForUser: readonly ExistingSubmissionLite[];
  acceptedHashes: ReadonlySet<string>;
  now: Date;
}): SubmissionDecision {
  const windowStart = input.now.getTime() - SUBMISSION_WINDOW_MS;
  const inWindow = input.recentForUser.filter(
    (row) => row.createdAt.getTime() >= windowStart,
  );
  const selfDuplicate = input.recentForUser.find(
    (row) => row.urlHash === input.urlHash,
  );
  if (selfDuplicate) {
    return {
      ok: false,
      kind: 'duplicate_self',
      message: '你已经提交过这条链接的补录，可在「我的资料」页查看处理进度',
      existingId: selfDuplicate.id,
    };
  }
  if (input.acceptedHashes.has(input.urlHash)) {
    return {
      ok: false,
      kind: 'already_accepted',
      message: '该链接已由用户补录并处理完成，感谢你的反馈',
    };
  }
  if (inWindow.length >= MAX_SUBMISSIONS_PER_DAY) {
    return {
      ok: false,
      kind: 'rate_limited',
      message: `提交太频繁：24 小时内最多提交 ${MAX_SUBMISSIONS_PER_DAY} 条补录，请稍后再试`,
    };
  }
  return { ok: true };
}
