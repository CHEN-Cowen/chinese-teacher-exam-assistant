import {
  checkSubmissionUrl,
  decideSubmission,
  MAX_SUBMISSIONS_PER_DAY,
  submissionUrlHash,
  validateSubmissionInput,
} from './announcement-submission.domain.js';

describe('checkSubmissionUrl（D08 补录链接安全校验）', () => {
  it('接受 http/https 公网链接并规范化（去 hash、小写协议主机、补结尾斜杠）', () => {
    const ok = checkSubmissionUrl('https://Example.Gov.CN/a/b?x=1#top');
    expect(ok.ok).toBe(true);
    expect(ok.normalized).toBe('https://example.gov.cn/a/b?x=1');
  });

  it('拒绝非 http(s)、本机、内网与保留地址', () => {
    const rejected = [
      'javascript:alert(1)',
      'ftp://example.gov.cn/a',
      'file:///C:/notice.pdf',
      'http://localhost/notice',
      'http://api.localhost/notice',
      'http://svc.local/notice',
      'http://127.0.0.1/notice',
      'http://10.1.2.3/notice',
      'http://172.16.0.9/notice',
      'http://172.31.255.1/notice',
      'http://192.168.1.1/notice',
      'http://169.254.1.1/notice',
      'http://0.0.0.0/notice',
      'http://[::1]/notice',
      'http://[fe80::1]/notice',
      'http://[fc00::1]/notice',
      'http://[::ffff:192.168.0.1]/notice',
    ];
    for (const url of rejected) {
      const result = checkSubmissionUrl(url);
      expect(result.ok).toBe(false);
      expect(result.message).toBeTruthy();
    }
  });

  it('拒绝带凭据的链接与空输入', () => {
    expect(checkSubmissionUrl('https://u:p@example.gov.cn/a').ok).toBe(false);
    expect(checkSubmissionUrl('   ').ok).toBe(false);
    expect(checkSubmissionUrl(42).ok).toBe(false);
    expect(checkSubmissionUrl('http://').ok).toBe(false);
  });
});

describe('validateSubmissionInput（D08 补录整体输入）', () => {
  const VALID = {
    officialUrl: 'https://example.gov.cn/notice',
    publisherName: '某市教育局',
    regionCode: '330100',
    note: '未收录',
  };

  it('合法输入返回规范化链接、哈希与裁剪后的字段', () => {
    const result = validateSubmissionInput({
      ...VALID,
      publisherName: ' 某市教育局 ',
      note: ' 未收录 ',
    });
    expect(result.ok).toBe(true);
    expect(result.value?.officialUrl).toBe('https://example.gov.cn/notice');
    expect(result.value?.publisherName).toBe('某市教育局');
    expect(result.value?.note).toBe('未收录');
    expect(result.value?.urlHash).toBe(
      submissionUrlHash('https://example.gov.cn/notice'),
    );
  });

  it('note 可省略；非法输入逐项拒绝', () => {
    expect(validateSubmissionInput(VALID).ok).toBe(true);
    expect(validateSubmissionInput({ ...VALID, note: '' }).ok).toBe(true);
    expect(validateSubmissionInput({ ...VALID, officialUrl: '' }).ok).toBe(false);
    expect(validateSubmissionInput({ ...VALID, publisherName: '' }).ok).toBe(false);
    expect(validateSubmissionInput({ ...VALID, regionCode: '3301' }).ok).toBe(false);
    expect(validateSubmissionInput({ ...VALID, regionCode: 'abc123' }).ok).toBe(false);
    expect(validateSubmissionInput({ ...VALID, note: '长'.repeat(501) }).ok).toBe(false);
  });
});

describe('decideSubmission（D08 去重与限流决策）', () => {
  const now = new Date('2026-10-28T10:00:00Z');
  const HASH_A = submissionUrlHash('https://example.gov.cn/a');
  const HASH_B = submissionUrlHash('https://example.gov.cn/b');

  function recent(
    overrides: Partial<{
      id: string;
      userId: string;
      urlHash: string;
      status: string;
      createdAt: Date;
    }> = {},
  ) {
    return {
      id: 'sub-1',
      userId: 'user-1',
      urlHash: HASH_A,
      status: 'submitted',
      createdAt: new Date(now.getTime() - 60 * 60 * 1000),
      ...overrides,
    };
  }

  it('无冲突时允许提交', () => {
    const decision = decideSubmission({
      urlHash: HASH_A,
      userId: 'user-1',
      recentForUser: [],
      acceptedHashes: new Set(),
      now,
    });
    expect(decision.ok).toBe(true);
  });

  it('本人同链接（不限状态）判定重复并附原记录 id', () => {
    const decision = decideSubmission({
      urlHash: HASH_A,
      userId: 'user-1',
      recentForUser: [recent()],
      acceptedHashes: new Set(),
      now,
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok && decision.kind === 'duplicate_self') {
      expect(decision.existingId).toBe('sub-1');
      expect(decision.message).toContain('已经提交过');
    } else {
      fail('expected duplicate_self');
    }
  });

  it('已收录链接拒绝任何人重复补录', () => {
    const decision = decideSubmission({
      urlHash: HASH_A,
      userId: 'user-2',
      recentForUser: [],
      acceptedHashes: new Set([HASH_A]),
      now,
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.kind).toBe('already_accepted');
    }
  });

  it('24 小时窗口内达到上限限流；窗口外的旧提交不计入', () => {
    const twenty = Array.from({ length: MAX_SUBMISSIONS_PER_DAY }, (_, i) =>
      recent({
        id: `sub-${i}`,
        urlHash: i === 0 ? HASH_A : `hash-${i}`,
        createdAt: new Date(now.getTime() - (i + 1) * 60 * 60 * 1000),
      }),
    );
    const limited = decideSubmission({
      urlHash: HASH_B,
      userId: 'user-1',
      recentForUser: twenty,
      acceptedHashes: new Set(),
      now,
    });
    expect(limited.ok).toBe(false);
    if (!limited.ok) expect(limited.kind).toBe('rate_limited');

    const outsideWindow = twenty.map((row, i) => ({
      ...row,
      createdAt: new Date(now.getTime() - (25 + i) * 60 * 60 * 1000),
    }));
    const allowed = decideSubmission({
      urlHash: HASH_B,
      userId: 'user-1',
      recentForUser: outsideWindow,
      acceptedHashes: new Set(),
      now,
    });
    expect(allowed.ok).toBe(true);
  });
});
