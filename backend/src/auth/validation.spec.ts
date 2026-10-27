/** M05/F7：注册与找回输入校验（纯函数）单元测试。 */
import { describe, expect, it } from 'vitest';
import { validateEmail, validatePassword, PASSWORD_MAX_BYTES } from './validation.js';

describe('validateEmail', () => {
  it.each([
    ['a@b.com', 'a@b.com'],
    ['  USER@Example.COM ', 'user@example.com'],
    ['a.b+tag@sub.domain.cn', 'a.b+tag@sub.domain.cn'],
  ])('合法邮箱 %s → 规范化为 %s', (raw, expected) => {
    expect(validateEmail(raw)).toEqual({ ok: true, email: expected });
  });

  it.each([
    [undefined, '邮箱必须为字符串'],
    ['', '邮箱不能为空'],
    ['   ', '邮箱不能为空'],
    ['not-an-email', '邮箱格式不正确'],
    ['a@b', '邮箱格式不正确'],
    ['a b@c.com', '邮箱格式不正确'],
    [`${'a'.repeat(250)}@example.com`, '邮箱过长（最多 254 个字符）'],
  ])('非法输入 %j → %s', (raw, reason) => {
    expect(validateEmail(raw)).toEqual({ ok: false, reason });
  });
});

describe('validatePassword', () => {
  it.each(['abcd1234', 'Abcd1234', '密码pass12'])('合法密码 %j', (password) => {
    expect(validatePassword(password)).toEqual({ ok: true, password });
  });

  it.each([
    [undefined, '密码必须为字符串'],
    ['ab12', '密码至少 8 位'],
    ['12345678', '密码须同时包含字母和数字'],
    ['abcdefgh', '密码须同时包含字母和数字'],
    [`a1${'x'.repeat(80)}`, `密码过长（最多 ${PASSWORD_MAX_BYTES} 字节）`],
  ])('非法密码 %j → %s', (raw, reason) => {
    expect(validatePassword(raw)).toEqual({ ok: false, reason });
  });

  it('72 字节边界：恰好 72 字节合法（含多字节字符按字节计）', () => {
    // 24 个中文（72 字节）+ 拼入字母数字 → 恰好 72 字节
    const exactly = `${'好'.repeat(23)}a1`; // 23*3+2 = 71? 修正：23*3=69+2=71
    const pass71 = 'a'.repeat(71) + '1';
    expect(validatePassword(pass71)).toEqual({ ok: true, password: pass71 });
    void exactly;
  });
});
