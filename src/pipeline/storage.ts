import { S3Client, PutObjectCommand, GetObjectCommand, S3ClientConfig } from "@aws-sdk/client-s3";
import fs from "node:fs";
import path from "node:path";

export interface R2ClientConfig {
  endpoint: string;
  region: string;
  credentials: {
    accessKeyId: string;
    secretAccessKey: string;
  };
  bucketName: string;
}

/**
 * 環境変数から Cloudflare R2 クライアント設定を取得・検証する
 */
export function getR2ClientConfig(
  env: Record<string, string | undefined> = process.env,
): R2ClientConfig {
  const accountId = env.R2_ACCOUNT_ID?.trim();
  if (!accountId) {
    throw new Error("Cloudflare R2 の設定エラー: 環境変数 R2_ACCOUNT_ID が設定されていません");
  }

  const accessKeyId = env.R2_ACCESS_KEY_ID?.trim();
  if (!accessKeyId) {
    throw new Error("Cloudflare R2 の設定エラー: 環境変数 R2_ACCESS_KEY_ID が設定されていません");
  }

  const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim();
  if (!secretAccessKey) {
    throw new Error(
      "Cloudflare R2 の設定エラー: 環境変数 R2_SECRET_ACCESS_KEY が設定されていません",
    );
  }

  const bucketName = env.R2_BUCKET_NAME?.trim() || "rss-news-site-data";

  return {
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    region: "auto",
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    bucketName,
  };
}

/**
 * Cloudflare R2 用の S3Client インスタンスを生成する
 */
export function createR2Client(config?: Partial<R2ClientConfig> | S3ClientConfig): S3Client {
  if (config && (config as any).endpoint && (config as any).credentials) {
    return new S3Client(config as S3ClientConfig);
  }

  const r2Config = getR2ClientConfig();
  return new S3Client({
    endpoint: r2Config.endpoint,
    region: r2Config.region,
    credentials: r2Config.credentials,
    ...config,
  });
}

/**
 * ローカルファイルを Cloudflare R2 にアップロードする
 */
export async function uploadFileToR2(
  localPath: string,
  r2Key: string,
  customClient?: S3Client,
  customBucket?: string,
): Promise<void> {
  const client = customClient ?? createR2Client();
  const bucket = customBucket || process.env.R2_BUCKET_NAME?.trim() || "rss-news-site-data";

  const fileData = fs.readFileSync(localPath);

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: r2Key,
    Body: fileData,
    ContentType: "application/vnd.sqlite3",
  });

  await client.send(command);
}

/**
 * Cloudflare R2 からファイルをローカルにダウンロードする
 * オブジェクトが存在しない（404 または NoSuchKey）場合は例外を投げずに false を返す
 */
export async function downloadFileFromR2(
  r2Key: string,
  localPath: string,
  customClient?: S3Client,
  customBucket?: string,
): Promise<boolean> {
  const client = customClient ?? createR2Client();
  const bucket = customBucket || process.env.R2_BUCKET_NAME?.trim() || "rss-news-site-data";

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: r2Key,
  });

  try {
    const response = await client.send(command);
    if (!response.Body) {
      return false;
    }

    let buffer: Buffer;
    if (typeof (response.Body as any).transformToByteArray === "function") {
      const bytes = await (response.Body as any).transformToByteArray();
      buffer = Buffer.from(bytes);
    } else if (Buffer.isBuffer(response.Body)) {
      buffer = response.Body;
    } else if (response.Body instanceof Uint8Array) {
      buffer = Buffer.from(response.Body);
    } else if (typeof (response.Body as any)[Symbol.asyncIterator] === "function") {
      const chunks: Uint8Array[] = [];
      for await (const chunk of response.Body as any) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      }
      buffer = Buffer.concat(chunks);
    } else {
      throw new Error("予期しないレスポンスボディ形式です");
    }

    const dir = path.dirname(localPath);
    if (dir && dir !== "." && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(localPath, buffer);
    return true;
  } catch (error: any) {
    if (
      error?.name === "NoSuchKey" ||
      error?.name === "NotFound" ||
      error?.$metadata?.httpStatusCode === 404 ||
      error?.code === "NoSuchKey" ||
      error?.Code === "NoSuchKey"
    ) {
      return false;
    }
    throw error;
  }
}
