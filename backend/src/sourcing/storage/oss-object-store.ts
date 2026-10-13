/**
 * v7.2 附件处理：生产对象存储（阿里云 OSS，最小签名 REST 客户端）。
 *
 * 安全与不可变约束（用户要求 / china-network-accessibility）：
 * - 私有桶：所有写入对象带 x-oss-object-acl: private，绝不公开读；
 * - 版本控制：桶需在控制台/基础设施侧开启版本化（本客户端只读写对象）；
 * - 不可覆盖：key 由内容哈希决定（snapshotStorageKey），相同内容永不重写，
 *   不同内容永不共用 key；
 * - 受控下载：getSignedUrl 生成短期签名 URL（默认 5 分钟），按需生成、
 *   绝不打印到日志、绝不持久化；
 * - 密钥只从环境变量读取，不落库、不进日志。
 *
 * 说明：仅实现本轮所需的 put/get/签名下载，不引入官方 SDK（避免额外依赖面）。
 */
import { createHmac } from 'node:crypto';
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

/** OSS V1 签名：base64(hmac-sha1(secret, stringToSign)) */
function ossSignature(secret: string, stringToSign: string): string {
  return createHmac('sha1', secret).update(stringToSign, 'utf8').digest('base64');
}

function encodeKeyPath(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/');
}

export class OssObjectStore implements ObjectStore {
  constructor(private readonly config: OssObjectStoreConfig) {}

  async put(input: { content: string; mimeType: string; contentHash: string }): Promise<string> {
    return this.putBinary({
      content: Buffer.from(input.content, 'utf8'),
      mimeType: input.mimeType,
      contentHash: input.contentHash,
    });
  }

  async putBinary(input: {
    content: Buffer;
    mimeType: string;
    contentHash: string;
  }): Promise<string> {
    const key = snapshotStorageKey(input.contentHash);
    const date = new Date().toUTCString();
    // 私有桶：显式声明对象 ACL 为 private
    const ossHeaders = 'x-oss-object-acl:private\n';
    const resource = `/${this.config.bucket}/${key}`;
    const stringToSign = `PUT\n\n${input.mimeType}\n${date}\n${ossHeaders}${resource}`;
    const authorization = `OSS ${this.config.accessKeyId}:${ossSignature(
      this.config.accessKeySecret,
      stringToSign,
    )}`;
    const url = `https://${this.config.bucket}.${this.config.endpoint}/${encodeKeyPath(key)}`;
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        date,
        'content-type': input.mimeType,
        authorization,
        'x-oss-object-acl': 'private',
      },
      body: new Uint8Array(input.content),
    });
    if (!response.ok) {
      // 失败信息只含状态码，不回显 URL/密钥
      throw new Error(`OSS 写入失败（HTTP ${response.status}）`);
    }
    return key;
  }

  async get(storageKey: string): Promise<string> {
    return (await this.getBinary(storageKey)).toString('utf8');
  }

  async getBinary(storageKey: string): Promise<Buffer> {
    const response = await this.request('GET', storageKey);
    if (!response.ok) {
      throw new Error(`OSS 读取失败（HTTP ${response.status}）`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  /** 短期签名下载 URL（V1 query 签名）；调用方不得打印或持久化返回值 */
  async getSignedUrl(storageKey: string, ttlSeconds?: number): Promise<string> {
    const ttl = ttlSeconds ?? this.config.signedUrlTtlSeconds;
    const expires = Math.floor(Date.now() / 1000) + Math.max(1, ttl);
    const resource = `/${this.config.bucket}/${storageKey}`;
    const stringToSign = `GET\n\n\n${expires}\n${resource}`;
    const signature = ossSignature(this.config.accessKeySecret, stringToSign);
    return (
      `https://${this.config.bucket}.${this.config.endpoint}/${encodeKeyPath(storageKey)}` +
      `?OSSAccessKeyId=${encodeURIComponent(this.config.accessKeyId)}` +
      `&Expires=${expires}` +
      `&Signature=${encodeURIComponent(signature)}`
    );
  }

  /** 带签名的只读请求（无响应体场景外的统一入口） */
  private async request(
    verb: 'GET',
    storageKey: string,
  ): Promise<Response> {
    const date = new Date().toUTCString();
    const resource = `/${this.config.bucket}/${storageKey}`;
    const stringToSign = `${verb}\n\n\n${date}\n${resource}`;
    const authorization = `OSS ${this.config.accessKeyId}:${ossSignature(
      this.config.accessKeySecret,
      stringToSign,
    )}`;
    const url = `https://${this.config.bucket}.${this.config.endpoint}/${encodeKeyPath(storageKey)}`;
    return fetch(url, { method: verb, headers: { date, authorization } });
  }
}
