import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Readable } from "node:stream";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import {
  getR2ClientConfig,
  createR2Client,
  uploadFileToR2,
  downloadFileFromR2,
  R2ClientConfig,
} from "../../src/pipeline/storage";

describe("Cloudflare R2 ストレージ同期クライアント (src/pipeline/storage) のテスト", () => {
  let tempDir: string;
  const originalEnv = process.env;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "r2-storage-test-"));
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  describe("getR2ClientConfig", () => {
    it("必要な環境変数が全て設定されている場合、正しい設定オブジェクトを返却すること", () => {
      const mockEnv = {
        R2_ACCOUNT_ID: "test-account-id-12345",
        R2_ACCESS_KEY_ID: "test-access-key-id",
        R2_SECRET_ACCESS_KEY: "test-secret-access-key",
      };

      const config = getR2ClientConfig(mockEnv);

      expect(config.endpoint).toBe("https://test-account-id-12345.r2.cloudflarestorage.com");
      expect(config.region).toBe("auto");
      expect(config.credentials).toEqual({
        accessKeyId: "test-access-key-id",
        secretAccessKey: "test-secret-access-key",
      });
      expect(config.bucketName).toBe("rss-news-site-data");
    });

    it("R2_BUCKET_NAME が指定されている場合、カスタムバケット名が設定されること", () => {
      const mockEnv = {
        R2_ACCOUNT_ID: "acc-id",
        R2_ACCESS_KEY_ID: "acc-key",
        R2_SECRET_ACCESS_KEY: "sec-key",
        R2_BUCKET_NAME: "custom-my-bucket",
      };

      const config = getR2ClientConfig(mockEnv);
      expect(config.bucketName).toBe("custom-my-bucket");
    });

    it("R2_ACCOUNT_ID が未設定または空文字の場合に日本語エラーを投げること", () => {
      const envWithoutAccount = {
        R2_ACCESS_KEY_ID: "key",
        R2_SECRET_ACCESS_KEY: "sec",
      };

      expect(() => getR2ClientConfig(envWithoutAccount as any)).toThrow(
        "Cloudflare R2 の設定エラー: 環境変数 R2_ACCOUNT_ID が設定されていません",
      );

      const envWithEmptyAccount = {
        R2_ACCOUNT_ID: "   ",
        R2_ACCESS_KEY_ID: "key",
        R2_SECRET_ACCESS_KEY: "sec",
      };

      expect(() => getR2ClientConfig(envWithEmptyAccount)).toThrow(
        "Cloudflare R2 の設定エラー: 環境変数 R2_ACCOUNT_ID が設定されていません",
      );
    });

    it("R2_ACCESS_KEY_ID が未設定または空文字の場合に日本語エラーを投げること", () => {
      const envWithoutAccessKey = {
        R2_ACCOUNT_ID: "acc",
        R2_SECRET_ACCESS_KEY: "sec",
      };

      expect(() => getR2ClientConfig(envWithoutAccessKey as any)).toThrow(
        "Cloudflare R2 の設定エラー: 環境変数 R2_ACCESS_KEY_ID が設定されていません",
      );

      const envWithEmptyAccessKey = {
        R2_ACCOUNT_ID: "acc",
        R2_ACCESS_KEY_ID: "  ",
        R2_SECRET_ACCESS_KEY: "sec",
      };

      expect(() => getR2ClientConfig(envWithEmptyAccessKey)).toThrow(
        "Cloudflare R2 の設定エラー: 環境変数 R2_ACCESS_KEY_ID が設定されていません",
      );
    });

    it("R2_SECRET_ACCESS_KEY が未設定または空文字の場合に日本語エラーを投げること", () => {
      const envWithoutSecretKey = {
        R2_ACCOUNT_ID: "acc",
        R2_ACCESS_KEY_ID: "key",
      };

      expect(() => getR2ClientConfig(envWithoutSecretKey as any)).toThrow(
        "Cloudflare R2 の設定エラー: 環境変数 R2_SECRET_ACCESS_KEY が設定されていません",
      );

      const envWithEmptySecretKey = {
        R2_ACCOUNT_ID: "acc",
        R2_ACCESS_KEY_ID: "key",
        R2_SECRET_ACCESS_KEY: "\t\n",
      };

      expect(() => getR2ClientConfig(envWithEmptySecretKey)).toThrow(
        "Cloudflare R2 の設定エラー: 環境変数 R2_SECRET_ACCESS_KEY が設定されていません",
      );
    });

    it("引数を省略した場合は process.env を参照すること", () => {
      process.env.R2_ACCOUNT_ID = "env-acc-id";
      process.env.R2_ACCESS_KEY_ID = "env-access-key";
      process.env.R2_SECRET_ACCESS_KEY = "env-secret-key";
      process.env.R2_BUCKET_NAME = "env-bucket";

      const config = getR2ClientConfig();
      expect(config.endpoint).toBe("https://env-acc-id.r2.cloudflarestorage.com");
      expect(config.bucketName).toBe("env-bucket");
    });
  });

  describe("createR2Client", () => {
    it("有効な設定から S3Client インスタンスを生成できること", () => {
      const config: R2ClientConfig = {
        endpoint: "https://example-acc.r2.cloudflarestorage.com",
        region: "auto",
        credentials: {
          accessKeyId: "dummy-key",
          secretAccessKey: "dummy-secret",
        },
        bucketName: "rss-news-site-data",
      };

      const client = createR2Client(config);
      expect(client).toBeInstanceOf(S3Client);
    });

    it("引数を省略した場合に getR2ClientConfig() を通じて環境変数から S3Client を生成すること", () => {
      process.env.R2_ACCOUNT_ID = "auto-acc";
      process.env.R2_ACCESS_KEY_ID = "auto-key";
      process.env.R2_SECRET_ACCESS_KEY = "auto-secret";

      const client = createR2Client();
      expect(client).toBeInstanceOf(S3Client);
    });
  });

  describe("uploadFileToR2", () => {
    it("ローカルファイルを読み込み、PutObjectCommand で R2 に ContentType 付きでアップロードすること", async () => {
      const localFilePath = path.join(tempDir, "test.sqlite");
      const fileData = Buffer.from("SQLite format 3\x00dummy-data");
      fs.writeFileSync(localFilePath, fileData);

      const mockSend = vi.fn().mockResolvedValue({});
      const mockClient = {
        send: mockSend,
      } as unknown as S3Client;

      await uploadFileToR2(localFilePath, "data/2026-08-19.sqlite", mockClient, "test-bucket");

      expect(mockSend).toHaveBeenCalledTimes(1);
      const command = mockSend.mock.calls[0][0];
      expect(command).toBeInstanceOf(PutObjectCommand);
      expect(command.input).toEqual({
        Bucket: "test-bucket",
        Key: "data/2026-08-19.sqlite",
        Body: fileData,
        ContentType: "application/vnd.sqlite3",
      });
    });

    it("customBucket が省略された場合は環境変数またはデフォルトバケット名を使用すること", async () => {
      process.env.R2_ACCOUNT_ID = "acc";
      process.env.R2_ACCESS_KEY_ID = "key";
      process.env.R2_SECRET_ACCESS_KEY = "secret";
      process.env.R2_BUCKET_NAME = "default-env-bucket";

      const localFilePath = path.join(tempDir, "search_index.sqlite");
      fs.writeFileSync(localFilePath, "sample data");

      const mockSend = vi.fn().mockResolvedValue({});
      const mockClient = {
        send: mockSend,
      } as unknown as S3Client;

      await uploadFileToR2(localFilePath, "data/search_index.sqlite", mockClient);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const command = mockSend.mock.calls[0][0];
      expect(command.input.Bucket).toBe("default-env-bucket");
    });

    it("customClient が省略された場合に createR2Client を使用してアップロードすること", async () => {
      process.env.R2_ACCOUNT_ID = "acc";
      process.env.R2_ACCESS_KEY_ID = "key";
      process.env.R2_SECRET_ACCESS_KEY = "secret";

      const localFilePath = path.join(tempDir, "daily.sqlite");
      fs.writeFileSync(localFilePath, "daily-data");

      const sendSpy = vi.spyOn(S3Client.prototype, "send").mockImplementation(async () => ({}));

      await uploadFileToR2(localFilePath, "data/daily.sqlite");

      expect(sendSpy).toHaveBeenCalledTimes(1);
      const command = sendSpy.mock.calls[0][0] as PutObjectCommand;
      expect(command.input.Key).toBe("data/daily.sqlite");
    });

    it("ローカルファイルが存在しない場合にエラーをスローすること", async () => {
      const nonExistentPath = path.join(tempDir, "non_existent.sqlite");
      const mockSend = vi.fn();
      const mockClient = { send: mockSend } as unknown as S3Client;

      await expect(
        uploadFileToR2(nonExistentPath, "data/non_existent.sqlite", mockClient, "bucket"),
      ).rejects.toThrow();

      expect(mockSend).not.toHaveBeenCalled();
    });

    it("S3Client.send がエラーを投げた場合にその例外を上位に伝播すること", async () => {
      const localFilePath = path.join(tempDir, "test.sqlite");
      fs.writeFileSync(localFilePath, "content");

      const mockSend = vi.fn().mockRejectedValue(new Error("R2 Upload Failed (500)"));
      const mockClient = { send: mockSend } as unknown as S3Client;

      await expect(
        uploadFileToR2(localFilePath, "data/test.sqlite", mockClient, "bucket"),
      ).rejects.toThrow("R2 Upload Failed (500)");
    });
  });

  describe("downloadFileFromR2", () => {
    it("R2から正常にダウンロードし、親ディレクトリを作成してローカルファイルに書き込み true を返すこと", async () => {
      const destinationPath = path.join(tempDir, "nested", "sub", "downloaded.sqlite");
      const contentBuffer = Buffer.from("SQLite format 3\x00downloaded-content");

      const mockSend = vi.fn().mockResolvedValue({
        Body: {
          transformToByteArray: async () => new Uint8Array(contentBuffer),
        },
      });
      const mockClient = { send: mockSend } as unknown as S3Client;

      const result = await downloadFileFromR2(
        "data/2026-08-19.sqlite",
        destinationPath,
        mockClient,
        "custom-bucket",
      );

      expect(result).toBe(true);
      expect(mockSend).toHaveBeenCalledTimes(1);
      const command = mockSend.mock.calls[0][0];
      expect(command).toBeInstanceOf(GetObjectCommand);
      expect(command.input).toEqual({
        Bucket: "custom-bucket",
        Key: "data/2026-08-19.sqlite",
      });

      expect(fs.existsSync(destinationPath)).toBe(true);
      expect(fs.readFileSync(destinationPath)).toEqual(contentBuffer);
    });

    it("レスポンスボディが Node.js Readable ストリームの場合でもローカルファイルに書き込めること", async () => {
      const destinationPath = path.join(tempDir, "stream-download.sqlite");
      const contentBuffer = Buffer.from("Stream content payload");
      const readableStream = Readable.from([contentBuffer]);

      const mockSend = vi.fn().mockResolvedValue({
        Body: readableStream,
      });
      const mockClient = { send: mockSend } as unknown as S3Client;

      const result = await downloadFileFromR2(
        "data/stream.sqlite",
        destinationPath,
        mockClient,
        "custom-bucket",
      );

      expect(result).toBe(true);
      expect(fs.readFileSync(destinationPath)).toEqual(contentBuffer);
    });

    it("customClient が省略された場合に createR2Client を使用してダウンロードすること", async () => {
      process.env.R2_ACCOUNT_ID = "acc";
      process.env.R2_ACCESS_KEY_ID = "key";
      process.env.R2_SECRET_ACCESS_KEY = "secret";

      const destinationPath = path.join(tempDir, "default-client-dl.sqlite");
      const contentBuffer = Buffer.from("downloaded via default client");

      const sendSpy = vi.spyOn(S3Client.prototype, "send").mockImplementation(async () => ({
        Body: {
          transformToByteArray: async () => new Uint8Array(contentBuffer),
        },
      }));

      const result = await downloadFileFromR2("data/default.sqlite", destinationPath);

      expect(result).toBe(true);
      expect(sendSpy).toHaveBeenCalledTimes(1);
      expect(fs.readFileSync(destinationPath)).toEqual(contentBuffer);
    });

    it("エラー名が NoSuchKey の場合に例外を投げずに false を返すこと", async () => {
      const destinationPath = path.join(tempDir, "missing.sqlite");
      const noSuchKeyError = new Error("The specified key does not exist.");
      noSuchKeyError.name = "NoSuchKey";

      const mockSend = vi.fn().mockRejectedValue(noSuchKeyError);
      const mockClient = { send: mockSend } as unknown as S3Client;

      const result = await downloadFileFromR2("data/missing.sqlite", destinationPath, mockClient);

      expect(result).toBe(false);
      expect(fs.existsSync(destinationPath)).toBe(false);
    });

    it("エラー名が NotFound の場合に例外を投げずに false を返すこと", async () => {
      const destinationPath = path.join(tempDir, "missing-notfound.sqlite");
      const notFoundError = new Error("Not Found");
      notFoundError.name = "NotFound";

      const mockSend = vi.fn().mockRejectedValue(notFoundError);
      const mockClient = { send: mockSend } as unknown as S3Client;

      const result = await downloadFileFromR2("data/missing.sqlite", destinationPath, mockClient);

      expect(result).toBe(false);
      expect(fs.existsSync(destinationPath)).toBe(false);
    });

    it("HTTP ステータスコードが 404 の場合に例外を投げずに false を返すこと", async () => {
      const destinationPath = path.join(tempDir, "missing-404.sqlite");
      const http404Error = new Error("Object not found") as any;
      http404Error.$metadata = { httpStatusCode: 404 };

      const mockSend = vi.fn().mockRejectedValue(http404Error);
      const mockClient = { send: mockSend } as unknown as S3Client;

      const result = await downloadFileFromR2("data/missing.sqlite", destinationPath, mockClient);

      expect(result).toBe(false);
      expect(fs.existsSync(destinationPath)).toBe(false);
    });

    it("エラーコードが NoSuchKey の場合に例外を投げずに false を返すこと", async () => {
      const destinationPath = path.join(tempDir, "missing-code.sqlite");
      const codeError = new Error("NoSuchKey error") as any;
      codeError.Code = "NoSuchKey";

      const mockSend = vi.fn().mockRejectedValue(codeError);
      const mockClient = { send: mockSend } as unknown as S3Client;

      const result = await downloadFileFromR2("data/missing.sqlite", destinationPath, mockClient);

      expect(result).toBe(false);
      expect(fs.existsSync(destinationPath)).toBe(false);
    });

    it("レスポンスの Body が null/undefined の場合に false を返すこと", async () => {
      const destinationPath = path.join(tempDir, "null-body.sqlite");
      const mockSend = vi.fn().mockResolvedValue({ Body: undefined });
      const mockClient = { send: mockSend } as unknown as S3Client;

      const result = await downloadFileFromR2("data/null-body.sqlite", destinationPath, mockClient);
      expect(result).toBe(false);
      expect(fs.existsSync(destinationPath)).toBe(false);
    });

    it("404/NoSuchKey 以外のエラー（例: 403 Forbidden, 500 Internal Error）の場合は例外を再スローすること", async () => {
      const destinationPath = path.join(tempDir, "auth-error.sqlite");
      const authError = new Error("Access Denied (403 Forbidden)");
      authError.name = "AccessDenied";

      const mockSend = vi.fn().mockRejectedValue(authError);
      const mockClient = { send: mockSend } as unknown as S3Client;

      await expect(
        downloadFileFromR2("data/secret.sqlite", destinationPath, mockClient),
      ).rejects.toThrow("Access Denied (403 Forbidden)");

      expect(fs.existsSync(destinationPath)).toBe(false);
    });
  });
});
