import { describe, expect, it } from 'vitest';
import { TRIAL_EVENT_TYPES, dedupKeyFor, sanitizeProps } from './trial.domain.js';

/**
 * v7.2「保存后的下一步 + 官方确认」埋点白名单与脱敏守卫：
 * - next_action_opened / consultation_template_copied 必须在白名单且不去重；
 * - 合法枚举 props（tier/kind、tpl/edited）通过；
 * - 任何夹带问题正文/原文/答复/联系方式的 props 必须被拒绝。
 */
describe('v7.2 埋点事件白名单', () => {
  it('两个新事件在 TRIAL_EVENT_TYPES 中且仅出现一次', () => {
    for (const type of ['next_action_opened', 'consultation_template_copied']) {
      expect(TRIAL_EVENT_TYPES.filter((t) => t === type)).toHaveLength(1);
    }
  });

  it('两个新事件均不去重（曝光/复制可重复发生）', () => {
    // dedupKeyFor 返回 null 即不去重（与 DEDUP_SCOPES 中 null 配置等价）
    expect(
      dedupKeyFor('next_action_opened', 'unit-1', { tier: 1, kind: 'resolve_blocker' }),
    ).toBeNull();
    expect(
      dedupKeyFor('consultation_template_copied', 'unit-1', { tpl: 'major', edited: true }),
    ).toBeNull();
  });
});

describe('sanitizeProps：v7.2 合法枚举通过', () => {
  it('next_action_opened 的 {tier, kind} 通过', () => {
    const result = sanitizeProps({ tier: 2, kind: 'urgent_node' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.props).toEqual({ tier: 2, kind: 'urgent_node' });
  });

  it('consultation_template_copied 的 {tpl, edited} 通过', () => {
    // tpl 为维度短枚举（前端实际发维度键，如 major），不是自由文本
    const result = sanitizeProps({ tpl: 'major', edited: false });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.props).toEqual({ tpl: 'major', edited: false });
  });
});

describe('sanitizeProps：夹带正文的同名事件被拒', () => {
  // 问题正文、公告原文、个人答复、联系方式等自由文本一律不得落库
  const rejectedCases: { props: Record<string, unknown>; case: string }[] = [
    {
      case: '夹带咨询问题正文（question）',
      props: { tier: 1, kind: 'resolve_blocker', question: '请问汉语言文学师范是否可以报考？' },
    },
    {
      case: '夹带公告原文（excerpt）',
      props: { tpl: 'major', edited: true, excerpt: '中国语言文学类相关专业以招聘单位解释为准' },
    },
    {
      case: '夹带个人答复（note）',
      props: { tpl: 'major', note: '打电话确认过，我符合条件' },
    },
    {
      case: '夹带联系方式（contact）',
      props: { tpl: 'major', edited: true, contact: '0571-87012345' },
    },
    {
      case: '键名合规但字符串值超长（kind 不应是长文本）',
      props: { tier: 1, kind: 'x'.repeat(65) },
    },
  ];

  for (const { props, case: label } of rejectedCases) {
    it(`拒绝：${label}`, () => {
      const result = sanitizeProps(props);
      expect(result.ok).toBe(false);
    });
  }
});
