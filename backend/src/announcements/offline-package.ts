/**
 * M6：离线交付包（manifest / S1-S2 复用记录 / 成果摘要）——纯函数，无副作用。
 *
 * 目标：让本人能用真实数据离线核对「处理了什么、质量如何、人工投入多少、
 * 第二份材料能否复用、WorkBuddy 实际贡献了什么」，复用 WB6 的 JSON/CSV/指标
 * 导出，不重做报表系统、不建复杂计时平台、不强加压缩依赖。
 *
 * 红线（M6-C）：
 * - 沿用同一规范、换输入才算「复用」；已有黄金样本测试不替代 S2 真实处理；
 * - 保留原始输出与修改，不用最终输出覆盖原始数据；
 * - 公开包去除敏感个人数据、密钥与带凭据链接（证据 URL 只留 host+path）；
 * - 真实材料不足时生成空白待填写模板并明确标记，不填虚构成绩。
 */
import { computeContentHash } from './domain.js';
import { redactUrl } from '../sourcing/fetch/safe-fetcher.js';

// ==================== manifest 与离线包 ====================

/** manifest 条目：文件、样本/运行/清单/规范版本、内容哈希、公开展示标识 */
export interface ManifestEntry {
  /** 文件在包内的相对路径 */
  path: string;
  /** 文件用途说明 */
  description: string;
  /** 关联 id（run id / sample id / checklist 版本等，用于文件间 ID 关联） */
  relatedIds: string[];
  /** 样本/运行/清单/规范版本（可空） */
  version?: string;
  /** 内容 SHA-256（十六进制） */
  contentHash: string;
  /** 公开展示标识：public=可对外 / internal=仅内部 / redacted=已脱敏 */
  visibility: 'public' | 'internal' | 'redacted';
}

export interface Manifest {
  schemaVersion: string;
  packageId: string;
  generatedAt: string;
  /** 是否构造/测试包（true=非真实成绩，须明确标记） */
  synthetic: boolean;
  /** 数据集合标记：real/demo/test */
  datasetMark: 'real' | 'demo' | 'test';
  /** 输入材料（S1/S2 各自的说明） */
  inputs: Array<{ sample: 'S1' | 'S2'; description: string; version?: string }>;
  entries: ManifestEntry[];
  /** 公开展示许可范围说明 */
  licenseNote: string;
}

export const MANIFEST_SCHEMA_VERSION = 'wb-offline-package@1.0.0';

/**
 * 组装离线包 manifest（M6-C11）。
 * 纯函数：内容哈希由调用方传入（调用方负责对真实文件算哈希），
 * 本函数只组织结构，不读文件、不联网。
 */
export function buildManifest(input: {
  packageId: string;
  generatedAt: Date;
  synthetic: boolean;
  datasetMark: 'real' | 'demo' | 'test';
  inputs: Manifest['inputs'];
  entries: ManifestEntry[];
  licenseNote?: string;
}): Manifest {
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    packageId: input.packageId,
    generatedAt: input.generatedAt.toISOString(),
    synthetic: input.synthetic,
    datasetMark: input.datasetMark,
    inputs: input.inputs,
    entries: input.entries,
    licenseNote:
      input.licenseNote ??
      '本包仅含已脱敏/公开展示材料；不含个人敏感数据、访问令牌、数据库连接信息或带凭据的 URL。',
  };
}

/** 计算文件内容哈希（供离线打包脚本对真实文件计算，复用 domain 的 SHA-256） */
export function fileContentHash(bytes: Buffer | string): string {
  return computeContentHash(bytes);
}

/** 证据 URL 脱敏（复用既有 redactUrl：host+path，丢弃 query 凭据） */
export function redactEvidenceUrl(url: string): string {
  return redactUrl(url);
}

// ==================== S1 / S2 复用记录 ====================

/**
 * S1/S2 复用记录（M6-C9）。
 * 沿用同一规范、换输入才算复用；必须记录实际改动、失败与重试，
 * 不能用 S1 复制冒充 S2。
 */
export interface ReuseRecord {
  /** 样本标识：S1 / S2 */
  sample: 'S1' | 'S2';
  /** 输入材料说明（公告来源/岗位表等） */
  inputDescription: string;
  /** 输入材料版本/哈希（可空） */
  inputVersion?: string;
  /** 使用的运行/规范版本 */
  runVersion: string;
  /** 规范版本 */
  specVersion: string;
  /** 实际改动清单（空数组表示无需改动，但必须显式列出） */
  changes: string[];
  /** 失败记录（每次失败的原因与重试） */
  failures: Array<{ at: string; reason: string; retried: boolean }>;
  /** 是否复用（true=沿用同规范换输入；false=首次/新规范） */
  reused: boolean;
}

/**
 * 校验复用记录是否「真复用」：S2 必须显式声明独立输入与改动/重试，
 * 不得与 S1 的 inputVersion + runVersion 完全相同（否则视为复制冒充）。
 * 返回错误列表；空数组表示合法。
 */
export function validateReuse(s1: ReuseRecord, s2: ReuseRecord): string[] {
  const errors: string[] = [];
  if (s1.sample !== 'S1') errors.push('第一条记录必须为 S1');
  if (s2.sample !== 'S2') errors.push('第二条记录必须为 S2');
  if (s2.reused) {
    if (s2.inputVersion && s1.inputVersion && s2.inputVersion === s1.inputVersion) {
      errors.push('S2 声明复用但输入版本与 S1 完全相同，疑似复制冒充');
    }
    if (s2.changes.length === 0 && s2.failures.length === 0) {
      errors.push('S2 声明复用但未记录任何实际改动或失败/重试，不构成可核对的复用');
    }
  }
  return errors;
}

// ==================== 成果摘要（供 PPT 引用） ====================

/**
 * 简明成果摘要（M6-C14）。所有数字必须能回到 manifest 与原始记录；
 * 节点能力名称必须来自实际记录，不从 Git 提交推断工具调用。
 */
export interface WorkbuddyEvidence {
  /** 真实会话/录屏/调用 ID 或文件索引 */
  referenceId: string;
  /** 能力名称（专家/Skill/连接器/自动化；只登记实际使用的） */
  capability: string;
  /** 对应改动/成果 */
  outcome: string;
  /** 人工判断结论 */
  humanJudgment: string;
  /** 赛前/赛内时间 */
  phase: 'pre_contest' | 'in_contest';
}

export interface AchievementSummary {
  schemaVersion: string;
  generatedAt: string;
  /** 是否构造/测试（true=非真实成绩） */
  synthetic: boolean;
  /** 关键数字（每条带回溯来源 manifest 路径 / 原始记录 id） */
  keyNumbers: Array<{
    label: string;
    value: string;
    source: string;
  }>;
  /** WorkBuddy 过程证据：只在有真实会话/调用/文件索引时登记 */
  workbuddyEvidence: WorkbuddyEvidence[];
  /** 明确未使用的能力（专家/Skill/连接器/自动化） */
  unusedCapabilities: string[];
  /** 待补项（缺证据时明确列出，不伪造） */
  pending: string[];
}

export const SUMMARY_SCHEMA_VERSION = 'wb-achievement-summary@1.0.0';

/**
 * 组装成果摘要（M6-C14）。纯函数，所有数字与证据由调用方提供并标注来源。
 * 空证据时 pending 说明「待补」，不伪造截图/调用 ID。
 */
export function buildAchievementSummary(input: {
  generatedAt: Date;
  synthetic: boolean;
  keyNumbers: AchievementSummary['keyNumbers'];
  workbuddyEvidence?: WorkbuddyEvidence[];
  unusedCapabilities?: string[];
  pending?: string[];
}): AchievementSummary {
  const evidence = input.workbuddyEvidence ?? [];
  const pending = [...(input.pending ?? [])];
  if (evidence.length === 0) {
    pending.push('WorkBuddy 过程证据缺失：需补充真实会话/录屏/调用 ID 或文件索引后才能计为「已提供」');
  }
  return {
    schemaVersion: SUMMARY_SCHEMA_VERSION,
    generatedAt: input.generatedAt.toISOString(),
    synthetic: input.synthetic,
    keyNumbers: input.keyNumbers,
    workbuddyEvidence: evidence,
    unusedCapabilities: input.unusedCapabilities ?? [],
    pending,
  };
}
