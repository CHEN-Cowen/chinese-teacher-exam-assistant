import OSS from 'ali-oss';
import { snapshotStorageKey, type ObjectStore } from './object-store.js';

export interface OssObjectStoreConfig {
  bucket: string;
  /** 数据中心 endpoint，如 oss-cn-hangzhou.aliyuncs.com */
  endpoint: string;
  accessKeyId: string;
  accessKeySecret: string;
  /** 签名下载 URL 有效期（秒），默认 300 */
  signedUrlTtlSeconds: number;
}

/** 从环境变量读取 OSS 配置；未配置完整时返回 null（回退本地存储） */
export function readOssConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): OssObjectStoreConfig | null {
  const bucket = env.OSS_BUCKET;
  const endpoint = env.OSS_ENDPOINT;
  const accessKeyId = env.OSS_ACCESS_KEY_ID;
  const accessKeySecret = env.OSS_ACCESS_KEY_SECRET;
  if (!bucket || !endpoint || !accessKeyId || !accessKeySecret) return null;
  const ttl = Number(env.OSS_SIGNED_URL_TTL_SECONDS);
  return {
    bucket,
    endpoint: endpoint.replace(/^https?:\/\//, ''),
    accessKeyId,
    accessKeySecret,
    signedUrlTtlSeconds: Number.isFinite(ttl) && ttl > 0 ? Math.floor(ttl) : 300,
  };
}

export class OssObjectStore implements ObjectStore {
  private readonly client: OSS;

  constructor(
    private readonly config: OssObjectStoreConfig,
    private readonly legacyStore?: ObjectStore,
  ) {
    const region = /^oss-(.+?)(?:-internal)?\.aliyuncs\.com$/.exec(config.endpoint)?.[1];
    if (!region) throw new Error('OSS_ENDPOINT must be an Alibaba Cloud OSS regional endpoint');
    this.client = new OSS({
      bucket: config.bucket,
      endpoint: 'https://' + config.endpoint,
      region: 'oss-' + region,
      accessKeyId: config.accessKeyId,
      accessKeySecret: config.accessKeySecret,
      authorizationV4: true,
    });
  }

  async put(input: { content: string; mimeType: string; contentHash: string }): Promise<string> {
    return this.putBinary({ ...input, content: Buffer.from(input.content, 'utf8') });
  }

  async putBinary(input: {
    content: Buffer;
    mimeType: string;
    contentHash: string;
  }): Promise<string> {
    const key = snapshotStorageKey(input.contentHash);
    const headers = { 'content-type': input.mimeType };
    const url = await this.client.signatureUrlV4('PUT', 60, { headers }, key);
    const response = await this.request(url, {
      method: 'PUT',
      headers,
      body: new Uint8Array(input.content),
    });
    if (!response.ok) throw new Error(`OSS 写入失败（HTTP ${response.status}）`);
    return key;
  }

  async get(storageKey: string): Promise<string> {
    return (await this.getBinary(storageKey)).toString('utf8');
  }

  async getBinary(storageKey: string): Promise<Buffer> {
    // Content-addressed legacy files can be read locally without an OSS lookup.
    if (this.legacyStore) {
      try {
        return await this.legacyStore.getBinary(storageKey);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    const response = await this.request(await this.getSignedUrl(storageKey));
    if (!response.ok) throw new Error(`OSS 读取失败（HTTP ${response.status}）`);
    return Buffer.from(await response.arrayBuffer());
  }

  async getSignedUrl(storageKey: string, ttlSeconds?: number): Promise<string> {
    const ttl = ttlSeconds ?? this.config.signedUrlTtlSeconds;
    return this.client.signatureUrlV4('GET', Math.min(604800, Math.max(1, Math.floor(ttl))), {}, storageKey);
  }

  /**
   * 删除对象。本地遗留副本必须先删：getBinary 会优先命中本地，
   * 只删 OSS 会留下「行已删、字节仍被读到」的假象。
   */
  async delete(storageKey: string): Promise<void> {
    if (this.legacyStore) {
      try {
        await this.legacyStore.delete(storageKey);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    try {
      await this.client.delete(storageKey);
    } catch (error) {
      // OSS 删除本身幂等；NoSuchKey 视为成功，其余错误上抛交保留策略记账
      const status = (error as { status?: number }).status;
      const code = (error as { code?: string }).code;
      if (status === 404 || code === 'NoSuchKey') return;
      throw error;
    }
  }

  private async request(url: string, init?: RequestInit): Promise<Response> {
    try {
      return await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(30_000) });
    } catch {
      throw new Error('OSS 请求失败');
    }
  }
}
