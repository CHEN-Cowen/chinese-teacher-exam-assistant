/**
 * v7.2 存储层测试：本地内容寻址不可变存储 + OSS 私有桶签名（零日志、短时效）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  LocalObjectStore,
  snapshotStorageKey,
} from './object-store.js';
import { OssObjectStore, readOssConfigFromEnv } from './oss-object-store.js';

function hashOf(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('LocalObjectStore（二进制不可变）', () => {
  let dir: string;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = '';
  });

  it('putBinary/getBinary 往返一致（PDF 等二进制不被字符化破坏）', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'objstore-'));
    const store = new LocalObjectStore(dir);
    const bytes = Buffer.concat([
      Buffer.from('%PDF-1.4\n', 'latin1'),
      Buffer.from([0x00, 0x01, 0xff, 0xfe, 0x80]),
    ]);
    const key = await store.putBinary({
      content: bytes,
      mimeType: 'application/pdf',
      contentHash: hashOf(bytes),
    });
    expect(key).toBe(snapshotStorageKey(hashOf(bytes)));
    const roundtrip = await store.getBinary(key);
    expect(roundtrip.equals(bytes)).toBe(true);
  });

  it('同哈希重复写入不覆盖（原始快照不可变）', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'objstore-'));
    const store = new LocalObjectStore(dir);
    const bytes = Buffer.from('announcement body');
    const hash = hashOf(bytes);
    const key1 = await store.putBinary({ content: bytes, mimeType: 'text/html', contentHash: hash });
    const target = path.join(dir, key1);
    // 手动篡改磁盘内容，再次 put 不应覆盖
    await writeFile(target, Buffer.from('tampered'));
    const key2 = await store.putBinary({ content: bytes, mimeType: 'text/html', contentHash: hash });
    expect(key2).toBe(key1);
    expect((await readFile(target)).toString()).toBe('tampered');
  });

  it('put/get 文本通道与二进制通道等价', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'objstore-'));
    const store = new LocalObjectStore(dir);
    const html = '<p>正文</p>';
    const key = await store.put({ content: html, mimeType: 'text/html', contentHash: hashOf(Buffer.from(html)) });
    expect(await store.get(key)).toBe(html);
  });
});

describe('readOssConfigFromEnv', () => {
  const ENV_KEYS = ['OSS_BUCKET', 'OSS_ENDPOINT', 'OSS_ACCESS_KEY_ID', 'OSS_ACCESS_KEY_SECRET'] as const;
  afterEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
    delete process.env.OSS_SIGNED_URL_TTL_SECONDS;
  });

  it('配置不完整 → null（回退本地存储）', () => {
    expect(readOssConfigFromEnv({})).toBeNull();
    expect(
      readOssConfigFromEnv({ OSS_BUCKET: 'b', OSS_ENDPOINT: 'e', OSS_ACCESS_KEY_ID: 'id' }),
    ).toBeNull();
  });

  it('配置完整 → 返回配置（TTL 默认 300 秒）', () => {
    const config = readOssConfigFromEnv({
      OSS_BUCKET: 'jzlj-snapshots',
      OSS_ENDPOINT: 'https://oss-cn-hangzhou.aliyuncs.com',
      OSS_ACCESS_KEY_ID: 'id',
      OSS_ACCESS_KEY_SECRET: 'secret',
    });
    expect(config).toMatchObject({
      bucket: 'jzlj-snapshots',
      endpoint: 'oss-cn-hangzhou.aliyuncs.com',
      signedUrlTtlSeconds: 300,
    });
  });
});

describe('OssObjectStore（私有/版本化/短时签名）', () => {
  const config = {
    bucket: 'jzlj-snapshots',
    endpoint: 'oss-cn-hangzhou.aliyuncs.com',
    accessKeyId: 'test-id',
    accessKeySecret: 'test-secret',
    signedUrlTtlSeconds: 300,
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('getSignedUrl：短时签名 URL，含凭据三元组；错误信息不回显 URL', async () => {
    const store = new OssObjectStore(config);
    const url = await store.getSignedUrl('snapshots/ab/abc', 60);
    expect(url).toContain('https://jzlj-snapshots.oss-cn-hangzhou.aliyuncs.com/snapshots/ab/abc');
    expect(url).toContain('OSSAccessKeyId=test-id');
    expect(url).toContain('Expires=');
    expect(url).toContain('Signature=');
    // TTL 生效：expires 在 60 秒附近
    const expires = Number(new URL(url).searchParams.get('Expires'));
    expect(expires).toBeGreaterThan(Math.floor(Date.now() / 1000) + 30);
    expect(expires).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 61);
  });

  it('putBinary：PUT 私有 ACL；失败只报状态码（不打印签名 URL 与密钥）', async () => {
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      expect(init?.method).toBe('PUT');
      const headers = init?.headers as Record<string, string>;
      expect(headers['x-oss-object-acl']).toBe('private');
      expect(headers.authorization).toMatch(/^OSS test-id:/);
      return new Response('reject', { status: 403 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const store = new OssObjectStore(config);
    await expect(
      store.putBinary({
        content: Buffer.from('bytes'),
        mimeType: 'application/pdf',
        contentHash: 'ff'.repeat(32),
      }),
    ).rejects.toThrow('OSS 写入失败（HTTP 403）');
    // 断言错误信息不包含签名 URL / 密钥
    try {
      await store.putBinary({
        content: Buffer.from('bytes'),
        mimeType: 'application/pdf',
        contentHash: 'ff'.repeat(32),
      });
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain('Signature');
      expect(message).not.toContain('test-secret');
      expect(message).not.toContain('http');
    }
  });

  it('getBinary：GET 返回原始字节；读取失败抛错', async () => {
    const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46]);
    const fetchMock = vi.fn(async () => new Response(new Uint8Array(bytes), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const store = new OssObjectStore(config);
    const roundtrip = await store.getBinary('snapshots/ab/abc');
    expect(roundtrip.equals(bytes)).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toContain('jzlj-snapshots.oss-cn-hangzhou.aliyuncs.com');

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 404 })),
    );
    await expect(store.getBinary('snapshots/xx/xyz')).rejects.toThrow('OSS 读取失败');
  });
});
