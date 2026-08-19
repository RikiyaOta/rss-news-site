import { env, pipeline } from "@huggingface/transformers";

// ブラウザ Web Worker 環境用の Hugging Face Transformers 設定
env.allowLocalModels = false;
env.useBrowserCache = true;
// COOP/COEP ヘッダー不要化のためシングルスレッドに設定
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.numThreads = 1;
}

let extractor: any = null;

/**
 * intfloat/multilingual-e5-small の仕様に従い、検索クエリに "query: " プレフィックスを付与する
 */
export function formatQueryText(query: string): string {
  const trimmed = (query ?? "").trim();
  if (trimmed.startsWith("query: ")) {
    return trimmed;
  }
  return `query: ${trimmed}`;
}

/**
 * feature-extraction pipeline インスタンスを取得する（シングルトン管理、DI可能）
 */
export async function getWorkerExtractor(customPipeline?: any): Promise<any> {
  if (customPipeline) {
    extractor = await customPipeline("feature-extraction", "Xenova/multilingual-e5-small", {
      dtype: "q8",
    });
    return extractor;
  }

  if (!extractor) {
    extractor = await pipeline("feature-extraction", "Xenova/multilingual-e5-small", {
      dtype: "q8",
    });
  }

  return extractor;
}

/**
 * extractor インスタンスを直接設定する（テスト用）
 */
export function setWorkerExtractor(instance: any): void {
  extractor = instance;
}

/**
 * extractor インスタンスをリセットする（テスト用）
 */
export function resetWorkerExtractor(): void {
  extractor = null;
}

/**
 * Worker で受信したメッセージを処理してベクトル化を行う
 */
export async function processEmbedMessage(
  data: { id?: number; query?: string },
  customExtractor?: any,
): Promise<{ id: number; vector?: number[]; error?: string }> {
  const id = data?.id ?? 0;
  try {
    const query = data?.query ?? "";
    const formatted = formatQueryText(query);
    const ext = customExtractor ?? (await getWorkerExtractor());
    const output = await ext(formatted, { pooling: "mean", normalize: true });
    const rawData = output?.data
      ? Array.from(output.data)
      : Array.from(output as ArrayLike<number>);
    return { id, vector: rawData as number[] };
  } catch (error: any) {
    return { id, error: error?.message ?? String(error) };
  }
}

// Web Worker 環境でのメッセージハンドラ登録
if (typeof self !== "undefined" && typeof (self as any).postMessage === "function") {
  (self as any).onmessage = async (e: MessageEvent) => {
    const result = await processEmbedMessage(e.data);
    (self as any).postMessage(result);
  };
}
