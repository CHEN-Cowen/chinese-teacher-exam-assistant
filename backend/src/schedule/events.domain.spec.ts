import { describe, expect, it } from 'vitest';
import {
  daysUntil,
  dueReminderStages,
  generateEvents,
  isPast,
  reminderDedupKey,
  REMINDER_STAGES,
  severityOfChange,
  urgencyOf,
  KIND_LABELS,
} from './events.domain.js';

describe('generateEvents（从公告版本 timeline 生成事件）', () => {
  it('为每个明确的时间字段生成对应类型的事件，且 eventKey 唯一', () => {
    const events = generateEvents('unit-1', {
      registrationStart: '2026-03-01',
      registrationEnd: '2026-03-15',
      paymentDeadline: '2026-03-18',
      admitTicketStart: '2026-04-01',
      writtenExamDate: '2026-04-10',
      scoreDate: '2026-04-25',
      interviewDate: '2026-05-05',
    });
    const kinds = events.map((e) => e.kind).sort();
    expect(kinds).toEqual([
      'admit_ticket',
      'interview',
      'payment',
      'registration_end',
      'registration_start',
      'score',
      'written_exam',
    ]);
    const keys = new Set(events.map((e) => e.eventKey));
    expect(keys.size).toBe(events.length);
    expect(events.every((e) => e.dateIso !== null)).toBe(true);
  });

  it('pendingItems 生成 dateIso=null 的 pending_notice 事件，绝不推测日期', () => {
    const events = generateEvents('unit-2', {
      registrationStart: '2026-03-01',
      registrationEnd: '2026-03-15',
      pendingItems: ['资格审核结果待公告', '面试时间另行通知'],
    });
    const pendings = events.filter((e) => e.kind === 'pending_notice');
    expect(pendings).toHaveLength(2);
    expect(pendings.every((e) => e.dateIso === null)).toBe(true);
    expect(pendings.map((e) => e.title)).toEqual([
      '资格审核结果待公告',
      '面试时间另行通知',
    ]);
  });

  it('时间未定的字段不生成事件，避免伪精确提醒', () => {
    const events = generateEvents('unit-3', {
      registrationStart: '2026-03-01',
      registrationEnd: '2026-03-15',
    });
    expect(events).toHaveLength(2);
  });
});

describe('urgencyOf（展示强度）', () => {
  it('报名截止 7 天内为 must', () => {
    expect(urgencyOf('registration_end', 3)).toBe('must');
    expect(urgencyOf('registration_end', 7)).toBe('must');
    expect(urgencyOf('registration_end', 8)).toBe('info');
  });

  it('笔试/面试 14 天内为 suggest', () => {
    expect(urgencyOf('written_exam', 10)).toBe('suggest');
    expect(urgencyOf('interview', 14)).toBe('suggest');
    expect(urgencyOf('written_exam', 20)).toBe('info');
  });

  it('已过去或待定为 info', () => {
    expect(urgencyOf('registration_end', -1)).toBe('info');
    expect(urgencyOf('pending_notice', null)).toBe('info');
  });
});

describe('severityOfChange（变更通知分级）', () => {
  it('截止日期变化为 must_handle', () => {
    expect(severityOfChange('registration_end', '2026-03-15', '2026-03-10')).toBe('must_handle');
    expect(severityOfChange('payment', null, '2026-03-18')).toBe('must_handle');
  });

  it('笔试/面试时间变化为 suggest_handle', () => {
    expect(severityOfChange('written_exam', '2026-04-10', '2026-04-12')).toBe('suggest_handle');
  });

  it('成绩/待定事项变化为 info', () => {
    expect(severityOfChange('score', '2026-04-25', '2026-04-26')).toBe('info');
  });
});

describe('daysUntil / isPast', () => {
  it('daysUntil 返回向上取整的天数差，null 表示未定', () => {
    expect(daysUntil('2026-01-02', '2026-01-01T00:00:00Z')).toBe(1);
    expect(daysUntil(null, '2026-01-01T00:00:00Z')).toBeNull();
  });

  it('isPast 在目标日期早于今天时为 true', () => {
    expect(isPast('2026-01-01', '2026-01-02T00:00:00Z')).toBe(true);
    expect(isPast('2026-01-03', '2026-01-02T00:00:00Z')).toBe(false);
    expect(isPast(null, '2026-01-02T00:00:00Z')).toBe(false);
  });
});

describe('KIND_LABELS', () => {
  it('所有类型都有中文标签', () => {
    expect(Object.keys(KIND_LABELS)).toHaveLength(19);
    expect(KIND_LABELS.registration_end).toBe('报名截止');
    expect(KIND_LABELS.preliminary_review).toBe('资格初审');
    expect(KIND_LABELS.qualification_review).toBe('资格复审');
    expect(KIND_LABELS.publication).toBe('拟聘用公示');
  });
});

describe('M7 提醒阶段（REMINDER_STAGES + dueReminderStages + reminderDedupKey）', () => {
  it('报名截止有 7/3/1 天三档提醒', () => {
    expect(REMINDER_STAGES.registration_end).toEqual(['d-7', 'd-3', 'd-1']);
  });

  it('成绩查询有 published 阶段', () => {
    expect(REMINDER_STAGES.score).toEqual(['published']);
  });

  it('距报名截止 5 天时仅触发 d-7（d-3 需 ≤3 天）', () => {
    const stages = dueReminderStages('registration_end', '2026-10-15', '2026-10-10T00:00:00Z');
    expect(stages).toContain('d-7');
    expect(stages).not.toContain('d-3');
    expect(stages).not.toContain('d-1');
  });

  it('距报名截止 1 天时触发全部三档', () => {
    const stages = dueReminderStages('registration_end', '2026-10-11', '2026-10-10T00:00:00Z');
    expect(stages).toEqual(['d-7', 'd-3', 'd-1']);
  });

  it('时间未定时不触发任何提醒', () => {
    expect(dueReminderStages('registration_end', null, '2026-10-10T00:00:00Z')).toEqual([]);
  });

  it('无提醒配置的节点不触发', () => {
    expect(dueReminderStages('preliminary_review', '2026-10-15', '2026-10-10T00:00:00Z')).toEqual([]);
  });

  it('提醒幂等键格式稳定', () => {
    expect(reminderDedupKey('unit-1-registration_end', 'd-7')).toBe(
      'unit-1-registration_end#d-7',
    );
  });
});
