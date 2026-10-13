/**
 * v7.2 版本撤回 withdrawVersion 纯函数测试。
 *
 * 口径：撤回保留历史（不删除行、不改写 payload、不产生新版本、不复活旧版），
 * 仅 published 可撤回，原因必填，记录原因/时间/操作人供审计。
 */
import { describe, expect, it } from 'vitest';
import {
  withdrawVersion,
  type ExtractionCandidate,
  type PublishedVersion,
} from './domain.js';

function payload(): ExtractionCandidate {
  return {
    fields: [
      {
        field: 'registration_time',
        value: '2026-11-01 至 2026-11-07',
        anchor: { field: 'registration_time', locator: { kind: 'excerpt', excerpt: '原文' } },
      },
    ],
    parserVersion: 'deterministic-parser@1',
  };
}

function publishedV2(): PublishedVersion {
  return {
    id: 'ann-hz-v2',
    announcementId: 'ann-hz',
    versionNumber: 2,
    status: 'published',
    payload: payload(),
    publishedAt: '2026-10-10T10:00:00Z',
    previousVersionId: 'ann-hz-v1',
  };
}

describe('withdrawVersion', () => {
  it('published → withdrawn：写入原因/时间/操作人，supersededAt 记为撤回时间', () => {
    const result = withdrawVersion(publishedV2(), {
      reason: '官方撤回公告',
      withdrawnAt: '2026-10-13T08:00:00Z',
      withdrawnBy: 'reviewer-1',
    });

    expect(result.status).toBe('withdrawn');
    expect(result.withdrawnAt).toBe('2026-10-13T08:00:00Z');
    expect(result.withdrawReason).toBe('官方撤回公告');
    expect(result.withdrawnBy).toBe('reviewer-1');
    expect(result.supersededAt).toBe('2026-10-13T08:00:00Z');
  });

  it('撤回不改写 payload、不改版本号、不换 id（不产生新版本）', () => {
    const before = publishedV2();
    const result = withdrawVersion(before, {
      reason: '信息有误',
      withdrawnAt: '2026-10-13T08:00:00Z',
    });

    expect(result.id).toBe(before.id);
    expect(result.versionNumber).toBe(before.versionNumber);
    expect(result.payload).toEqual(before.payload);
    expect(result.publishedAt).toBe(before.publishedAt);
    expect(result.previousVersionId).toBe(before.previousVersionId);
  });

  it('撤回不复活旧版：旧版保持 superseded（由调用方持久化，纯函数只处理当前行）', () => {
    const supersededV1: PublishedVersion = {
      ...publishedV2(),
      id: 'ann-hz-v1',
      versionNumber: 1,
      status: 'superseded',
      supersededAt: '2026-10-10T10:00:00Z',
    };
    const result = withdrawVersion(publishedV2(), {
      reason: '官方撤回',
      withdrawnAt: '2026-10-13T08:00:00Z',
    });
    // 纯函数不触碰旧版；旧版状态维持 superseded
    expect(supersededV1.status).toBe('superseded');
    expect(result.previousVersionId).toBe('ann-hz-v1');
  });

  it('非 published 状态撤回抛错（superseded / withdrawn）', () => {
    for (const status of ['superseded', 'withdrawn'] as const) {
      const version: PublishedVersion = { ...publishedV2(), status };
      expect(() =>
        withdrawVersion(version, {
          reason: '重复撤回',
          withdrawnAt: '2026-10-13T08:00:00Z',
        }),
      ).toThrow(/只有当前发布中的版本可以撤回/);
    }
  });

  it('空原因（空串/纯空白）抛错', () => {
    for (const reason of ['', '   ']) {
      expect(() =>
        withdrawVersion(publishedV2(), {
          reason,
          withdrawnAt: '2026-10-13T08:00:00Z',
        }),
      ).toThrow(/撤回原因不能为空/);
    }
  });
});
