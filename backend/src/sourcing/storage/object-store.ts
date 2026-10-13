/**
 * v7.2 工作包 4：对象存储 Seam。
 *
 * 开发/测试用 LocalObjectStore（写入 .data 内容寻址目录，同名同哈希不覆盖）；
 * 生产可替换为阿里云 OSS 实现（本轮不实现，接口先立）。
 * 原始快照不可覆盖：key 由内容哈希决定，相同内容永远映射到同一 key。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface ObjectStore {
  /** 写入一份不可变字节版本，返回 storageKey（内容寻址） */
  put(input: {
    content: string;
    mimeType: string;
    contentHash: string;
  }): Promise<string>;
  get(storageKey: string): Promise<string>;
}

export function snapshotStorageKey(contentHash: string): string {
  return `snapshots/${contentHash.slice(0, 2)}/${contentHash}`;
}

export class LocalObjectStore implements ObjectStore {
  constructor(private readonly baseDir = process.env.OBJECT_STORE_DIR ?? '.data') {}

  async put(input: { content: string; contentHash: string }): Promise<string> {
    const key = snapshotStorageKey(input.contentHash);
    const target = path.join(this.baseDir, key);
    await mkdir(path.dirname(target), { recursive: true });
    // 同哈希内容相同：若已存在则直接复用，不重复写
    try {
      await readFile(target);
      return key;
    } catch {
      await writeFile(target, input.content, 'utf8');
      return key;
    }
  }

  async get(storageKey: string): Promise<string> {
    return readFile(path.join(this.baseDir, storageKey), 'utf8');
  }
}
