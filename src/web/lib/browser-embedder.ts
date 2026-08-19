let workerInstance: Worker | null = null;
let messageId = 0;

/**
 * 検索クエリ文字列に "query: " プレフィックスを付与する（intfloat/multilingual-e5-small 仕様）
 */
export function formatQueryText(query: string): string {
  const trimmed = (query ?? "").trim();
  if (trimmed.startsWith("query: ")) {
    return trimmed;
  }
  return `query: ${trimmed}`;
}

/**
 * Web Worker のシングルトンインスタンスを取得・管理する（DIファクトリ対応）
 */
export function getEmbedderWorker(workerFactory?: () => Worker): Worker {
  if (!workerInstance) {
    if (workerFactory) {
      workerInstance = workerFactory();
    } else if (typeof Worker !== "undefined") {
      workerInstance = new Worker(new URL("../workers/embedder.worker.ts", import.meta.url), {
        type: "module",
      });
    } else {
      throw new Error("Web Worker がサポートされていない環境です");
    }
  }
  return workerInstance;
}

/**
 * Worker インスタンスを明示的に設定する（テスト・DI用）
 */
export function setEmbedderWorker(worker: Worker | null): void {
  workerInstance = worker;
}

/**
 * Worker インスタンスを破棄・リセットするクリーンアップ関数
 */
export function terminateEmbedderWorker(): void {
  if (workerInstance) {
    if (typeof workerInstance.terminate === "function") {
      workerInstance.terminate();
    }
    workerInstance = null;
  }
}

export interface EmbedQueryOptions {
  worker?: Worker;
  timeoutMs?: number;
}

/**
 * Web Worker を介してクエリ文字列を 384 次元の多言語ベクトル（Float32Array）に変換する
 */
export function embedQuery(query: string, options?: EmbedQueryOptions): Promise<Float32Array> {
  const worker = options?.worker ?? getEmbedderWorker();
  const id = ++messageId;
  const timeoutMs = options?.timeoutMs;

  return new Promise<Float32Array>((resolve, reject) => {
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      worker.removeEventListener("message", messageHandler);
      worker.removeEventListener("error", errorHandler);
      if (timeoutTimer !== null) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
    };

    const messageHandler = (e: MessageEvent) => {
      if (e.data && e.data.id === id) {
        cleanup();
        if (e.data.error) {
          reject(new Error(e.data.error));
        } else if (e.data.vector) {
          resolve(new Float32Array(e.data.vector));
        } else {
          reject(new Error("Worker から不正なレスポンスを受信しました"));
        }
      }
    };

    const errorHandler = (e: ErrorEvent | any) => {
      cleanup();
      const msg =
        e?.message ||
        e?.error?.message ||
        (e?.filename
          ? `${e.message} (${e.filename}:${e.lineno})`
          : "Worker でエラーが発生しました");
      reject(new Error(msg));
    };

    worker.addEventListener("message", messageHandler);
    worker.addEventListener("error", errorHandler);

    if (typeof timeoutMs === "number" && timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        cleanup();
        reject(new Error(`ベクトル化処理がタイムアウトしました (${timeoutMs}ms)`));
      }, timeoutMs);
    }

    worker.postMessage({ id, query });
  });
}
