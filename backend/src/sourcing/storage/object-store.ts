/**
 * v7.2 工作包 4：对象存储 Seam。
 *
 * 开发/测试用 LocalObjectStore（写入 .data 内容寻址目录，同名同哈希不覆盖）；
 * 生产用 OssObjectStore（私有桶 + 版本控制 + 短期签名下载）。
 * 原始快照不可覆盖：key 由内容哈希决定，相同内容永远映射到同一 key。
 *
 * 二进制 API（putBinary/getBinary）用于 PDF/Excel 等附件原件：
 * 字符串 API 会破坏二进制内容，附件一律走二进制通道。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface ObjectStore {
  /** 写入一份不可变文本版本，返回 storageKey（内容寻址） */
  put(input: {
    content: string;
    mimeType: string;
    contentHash: string;
  }): Promise<string>;
  /** 写入一份不可变二进制版本（PDF/Excel/ET 等原件），返回 storageKey */
  putBinary(input: {
    content: Buffer;
    mimeType: string;
    contentHash: string;
  }): Promise<string>;
  get(storageKey: string): Promise<string>;
  /** 读取原始字节（解析层从原件出发，绝不用被字符化后的副本） */
  getBinary(storageKey: string): Promise<Buffer>;
  /** 受控下载：短期签名 URL（默认 5 分钟）；实现不得打印或持久化该 URL */
  getSignedUrl?(storageKey: string, ttlSeconds?: number): Promise<string>;
}

export function snapshotStorageKey(contentHash: string): string {
  return `snapshots/${contentHash.slice(0, 2)}/${contentHash}`;
}

export class LocalObjectStore implements ObjectStore {
  constructor(private readonly baseDir = process.env.OBJECT_STORE_DIR ?? '.data') {}

  async put(input: { content: string; contentHash: string }): Promise<string> {
    return this.putBinary({
      content: Buffer.from(input.content, 'utf8'),
      contentHash: input.contentHash,
    });
  }

  async putBinary(input: { content: Buffer; contentHash: string }): Promise<string> {
    const key = snapshotStorageKey(input.contentHash);
    const target = path.join(this.baseDir, key);
    await mkdir(path.dirname(target), { recursive: true });
    // 同哈希内容相同：若已存在则直接复用，不覆盖（原始快照不可变）
    try {
      await readFile(target);
      return key;
    } catch {
      await writeFile(target, input.content);
      return key;
    }
  }

  async get(storageKey: string): Promise<string> {
    return (await this.getBinary(storageKey)).toString('utf8');
  }

  async getBinary(storageKey: string): Promise<Buffer> {
    return readFile(path.join(this.baseDir, storageKey));
  }
}
