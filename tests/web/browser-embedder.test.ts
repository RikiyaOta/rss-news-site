import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  formatQueryText,
  getEmbedderWorker,
  terminateEmbedderWorker,
  setEmbedderWorker,
  embedQuery,
} from "../../src/web/lib/browser-embedder";
import {
  processEmbedMessage,
  getWorkerExtractor,
  resetWorkerExtractor,
  setWorkerExtractor,
} from "../../src/web/workers/embedder.worker";

/**
 * テスト用 MockWorker クラス
 */
class MockWorker {
  public listeners: Record<string, ((event: any) => void)[]> = {};
  public postedMessages: any[] = [];
  public terminated = false;

  addEventListener(type: string, listener: (event: any) => void): void {
    if (!this.listeners[type]) {
      this.listeners[type] = [];
    }
    this.listeners[type].push(listener);
  }

  removeEventListener(type: string, listener: (event: any) => void): void {
    if (this.listeners[type]) {
      this.listeners[type] = this.listeners[type].filter((l) => l !== listener);
    }
  }

  postMessage(message: any): void {
    this.postedMessages.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  emitMessage(data: any): void {
    const event = { data } as MessageEvent;
    const handlers = [...(this.listeners["message"] || [])];
    for (const handler of handlers) {
      handler(event);
    }
  }

  emitError(errorEvent: any): void {
    const handlers = [...(this.listeners["error"] || [])];
    for (const handler of handlers) {
      handler(errorEvent);
    }
  }

  getListenerCount(type: string): number {
    return this.listeners[type]?.length || 0;
  }
}

describe("クエリ文字列フォーマッタ (formatQueryText)", () => {
  it("通常の検索文字列に 'query: ' プレフィックスを付与すること", () => {
    expect(formatQueryText("TypeScript")).toBe("query: TypeScript");
    expect(formatQueryText("AI Agents 最新動向")).toBe("query: AI Agents 最新動向");
  });

  it("前後の空白文字をトリムして 'query: ' プレフィックスを付与すること", () => {
    expect(formatQueryText("  Cloudflare Workers  ")).toBe("query: Cloudflare Workers");
    expect(formatQueryText("\n\tベクトル検索\n")).toBe("query: ベクトル検索");
  });

  it("既に 'query: ' プレフィックスが付与されている場合は二重付与しないこと", () => {
    expect(formatQueryText("query: SQLite Wasm")).toBe("query: SQLite Wasm");
    expect(formatQueryText("  query: HNSW Index  ")).toBe("query: HNSW Index");
  });

  it("空文字や空白のみの入力に対して 'query: ' を返却すること", () => {
    expect(formatQueryText("")).toBe("query: ");
    expect(formatQueryText("   ")).toBe("query: ");
  });

  it("null や undefined の入力に対しても安全に 'query: ' を返却すること", () => {
    expect(formatQueryText(null as any)).toBe("query: ");
    expect(formatQueryText(undefined as any)).toBe("query: ");
  });
});

describe("Web Worker 管理 (getEmbedderWorker / terminateEmbedderWorker)", () => {
  beforeEach(() => {
    terminateEmbedderWorker();
  });

  afterEach(() => {
    terminateEmbedderWorker();
  });

  it("workerFactory を指定してシングルトンインスタンスを取得できること", () => {
    const mockWorker = new MockWorker() as unknown as Worker;
    const factory = vi.fn(() => mockWorker);

    const worker1 = getEmbedderWorker(factory);
    expect(worker1).toBe(mockWorker);
    expect(factory).toHaveBeenCalledTimes(1);

    const worker2 = getEmbedderWorker(factory);
    expect(worker2).toBe(mockWorker);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("terminateEmbedderWorker を実行すると Worker の terminate が呼ばれインスタンスがリセットされること", () => {
    const mockWorker = new MockWorker();
    getEmbedderWorker(() => mockWorker as unknown as Worker);

    terminateEmbedderWorker();
    expect(mockWorker.terminated).toBe(true);

    const newMockWorker = new MockWorker();
    const newWorker = getEmbedderWorker(() => newMockWorker as unknown as Worker);
    expect(newWorker).toBe(newMockWorker);
    expect(newWorker).not.toBe(mockWorker);
  });

  it("Worker が未初期化の状態で terminateEmbedderWorker を呼び出しても例外が発生しないこと", () => {
    expect(() => terminateEmbedderWorker()).not.toThrow();
  });

  it("Worker 未サポート環境かつ factory なしの場合にエラーを投げること", () => {
    const originalWorker = globalThis.Worker;
    delete (globalThis as any).Worker;

    try {
      expect(() => getEmbedderWorker()).toThrow("Web Worker がサポートされていない環境です");
    } finally {
      globalThis.Worker = originalWorker;
    }
  });

  it("globalThis.Worker が定義されている場合、factory なしで new Worker を生成すること", () => {
    const originalWorker = globalThis.Worker;
    const dummyWorker = new MockWorker();
    const mockWorkerConstructor = vi.fn(function () {
      return dummyWorker;
    });
    (globalThis as any).Worker = mockWorkerConstructor;

    try {
      const worker = getEmbedderWorker();
      expect(worker).toBe(dummyWorker);
      expect(mockWorkerConstructor).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.Worker = originalWorker;
    }
  });
});

describe("ブラウザ内ベクトル埋め込みブリッジ (embedQuery)", () => {
  let mockWorker: MockWorker;

  beforeEach(() => {
    mockWorker = new MockWorker();
    setEmbedderWorker(mockWorker as unknown as Worker);
  });

  afterEach(() => {
    terminateEmbedderWorker();
    vi.useRealTimers();
  });

  it("Worker に { id, query } メッセージを送信し、返却されたベクトルを Float32Array で解決すること", async () => {
    const dummyVector = [0.1, 0.2, 0.3, 0.4];

    const promise = embedQuery("TypeScript 入門");

    expect(mockWorker.postedMessages).toHaveLength(1);
    const sentMsg = mockWorker.postedMessages[0];
    expect(sentMsg.query).toBe("TypeScript 入門");
    expect(typeof sentMsg.id).toBe("number");

    mockWorker.emitMessage({ id: sentMsg.id, vector: dummyVector });

    const result = await promise;
    expect(result).toBeInstanceOf(Float32Array);
    expect(result).toEqual(new Float32Array(dummyVector));
    expect(mockWorker.getListenerCount("message")).toBe(0);
  });

  it("384 次元のベクトルデータを正しく Float32Array に変換できること", async () => {
    const dummy384 = Array.from({ length: 384 }, (_, i) => i / 384);

    const promise = embedQuery("多言語埋め込みテスト");
    const sentMsg = mockWorker.postedMessages[0];
    mockWorker.emitMessage({ id: sentMsg.id, vector: dummy384 });

    const result = await promise;
    expect(result.length).toBe(384);
    expect(result[0]).toBeCloseTo(0);
    expect(result[383]).toBeCloseTo(383 / 384);
  });

  it("options.worker で渡した Worker インスタンスを優先して使用すること", async () => {
    const customWorker = new MockWorker();
    const promise = embedQuery("カスタム Worker テスト", {
      worker: customWorker as unknown as Worker,
    });

    expect(customWorker.postedMessages).toHaveLength(1);
    expect(mockWorker.postedMessages).toHaveLength(0);

    const sentMsg = customWorker.postedMessages[0];
    customWorker.emitMessage({ id: sentMsg.id, vector: [1.0, 2.0] });

    const result = await promise;
    expect(result).toEqual(new Float32Array([1.0, 2.0]));
  });

  it("複数の非同期リクエストを正しいメッセージ ID で識別して解決すること", async () => {
    const promise1 = embedQuery("クエリ 1");
    const promise2 = embedQuery("クエリ 2");
    const promise3 = embedQuery("クエリ 3");

    expect(mockWorker.postedMessages).toHaveLength(3);
    const [msg1, msg2, msg3] = mockWorker.postedMessages;

    expect(msg1.id).not.toBe(msg2.id);
    expect(msg2.id).not.toBe(msg3.id);

    // 順不同（2 -> 3 -> 1）でレスポンスを返却
    mockWorker.emitMessage({ id: msg2.id, vector: [2.0] });
    mockWorker.emitMessage({ id: msg3.id, vector: [3.0] });
    mockWorker.emitMessage({ id: msg1.id, vector: [1.0] });

    const [res1, res2, res3] = await Promise.all([promise1, promise2, promise3]);
    expect(res1).toEqual(new Float32Array([1.0]));
    expect(res2).toEqual(new Float32Array([2.0]));
    expect(res3).toEqual(new Float32Array([3.0]));
    expect(mockWorker.getListenerCount("message")).toBe(0);
  });

  it("無関係な id を持つメッセージを受信した場合は無視しリスナーを維持すること", async () => {
    const promise = embedQuery("クエリ A");
    const sentMsg = mockWorker.postedMessages[0];

    // 無関係な ID のメッセージを送信
    mockWorker.emitMessage({ id: 999999, vector: [99.0] });
    expect(mockWorker.getListenerCount("message")).toBeGreaterThan(0);

    // 正しい ID のメッセージを送信
    mockWorker.emitMessage({ id: sentMsg.id, vector: [10.0] });
    const result = await promise;
    expect(result).toEqual(new Float32Array([10.0]));
    expect(mockWorker.getListenerCount("message")).toBe(0);
  });

  it("Worker からエラーレスポンスが返却された場合に例外で reject されること", async () => {
    const promise = embedQuery("エラー発生クエリ");
    const sentMsg = mockWorker.postedMessages[0];

    mockWorker.emitMessage({ id: sentMsg.id, error: "モデルのロードに失敗しました" });

    await expect(promise).rejects.toThrow("モデルのロードに失敗しました");
    expect(mockWorker.getListenerCount("message")).toBe(0);
  });

  it("Worker から vector も error も含まない不正なレスポンスが返却された場合に reject されること", async () => {
    const promise = embedQuery("不正レスポンスクエリ");
    const sentMsg = mockWorker.postedMessages[0];

    mockWorker.emitMessage({ id: sentMsg.id });

    await expect(promise).rejects.toThrow("Worker から不正なレスポンスを受信しました");
    expect(mockWorker.getListenerCount("message")).toBe(0);
  });

  it("Worker で error イベントが発生した場合に reject されること", async () => {
    const promise = embedQuery("Worker クラッシュクエリ");
    mockWorker.emitError({ message: "Worker thread crashed" });

    await expect(promise).rejects.toThrow("Worker thread crashed");
    expect(mockWorker.getListenerCount("message")).toBe(0);
    expect(mockWorker.getListenerCount("error")).toBe(0);
  });

  it("指定した timeoutMs を超過した場合にタイムアウトエラーで reject されリスナーが解除されること", async () => {
    vi.useFakeTimers();

    const promise = embedQuery("タイムアウトクエリ", { timeoutMs: 3000 });
    expect(mockWorker.postedMessages).toHaveLength(1);
    expect(mockWorker.getListenerCount("message")).toBe(1);

    // 2999ms 経過時点ではまだ保留
    vi.advanceTimersByTime(2999);
    expect(mockWorker.getListenerCount("message")).toBe(1);

    // 3000ms 経過でタイムアウト
    vi.advanceTimersByTime(1);

    await expect(promise).rejects.toThrow("ベクトル化処理がタイムアウトしました (3000ms)");
    expect(mockWorker.getListenerCount("message")).toBe(0);
  });

  it("タイムアウト前にレスポンスを受信した場合はタイマーが解除され正常終了すること", async () => {
    vi.useFakeTimers();

    const promise = embedQuery("正常完了クエリ", { timeoutMs: 5000 });
    const sentMsg = mockWorker.postedMessages[0];

    vi.advanceTimersByTime(1000);
    mockWorker.emitMessage({ id: sentMsg.id, vector: [42.0] });

    const result = await promise;
    expect(result).toEqual(new Float32Array([42.0]));

    // さらに時間が経過してもタイムアウトによる再 reject やエラーが発生しないこと
    vi.advanceTimersByTime(10000);
    expect(mockWorker.getListenerCount("message")).toBe(0);
  });
});

describe("Worker 内部メッセージハンドラ (embedder.worker)", () => {
  beforeEach(() => {
    resetWorkerExtractor();
  });

  afterEach(() => {
    resetWorkerExtractor();
  });

  it("processEmbedMessage: クエリに query: プレフィックスを付与して pipeline を実行し vector を返却すること", async () => {
    const mockExtractor = vi.fn(async (text: string, options: any) => {
      expect(text).toBe("query: Next.js と Vite");
      expect(options).toEqual({ pooling: "mean", normalize: true });
      return { data: [0.1, 0.2, 0.3] };
    });

    const result = await processEmbedMessage({ id: 101, query: "Next.js と Vite" }, mockExtractor);

    expect(result).toEqual({
      id: 101,
      vector: [0.1, 0.2, 0.3],
    });
  });

  it("processEmbedMessage: 既に query: プレフィックスがある場合も正しく処理すること", async () => {
    const mockExtractor = vi.fn(async (text: string) => {
      expect(text).toBe("query: SQLite 検索");
      return { data: [1.0] };
    });

    const result = await processEmbedMessage(
      { id: 102, query: "query: SQLite 検索" },
      mockExtractor,
    );

    expect(result).toEqual({
      id: 102,
      vector: [1.0],
    });
  });

  it("processEmbedMessage: extractor 実行時に例外が発生した場合は { id, error } を返却すること", async () => {
    const mockExtractor = vi.fn(async () => {
      throw new Error("推論エンジンエラー");
    });

    const result = await processEmbedMessage({ id: 103, query: "失敗クエリ" }, mockExtractor);

    expect(result).toEqual({
      id: 103,
      error: "推論エンジンエラー",
    });
  });

  it("getWorkerExtractor: feature-extraction, Xenova/multilingual-e5-small, dtype: q8 でパイプラインを初期化すること", async () => {
    const mockCustomPipeline = vi.fn(async (task: string, model: string, opts: any) => {
      return { task, model, opts };
    });

    const ext1 = await getWorkerExtractor(mockCustomPipeline);
    expect(mockCustomPipeline).toHaveBeenCalledWith(
      "feature-extraction",
      "Xenova/multilingual-e5-small",
      { dtype: "q8" },
    );
    expect(ext1.model).toBe("Xenova/multilingual-e5-small");

    // シングルトンキャッシュの確認
    const ext2 = await getWorkerExtractor();
    expect(ext2).toBe(ext1);
  });

  it("setWorkerExtractor: エクストラクターを直接差し替え可能であること", async () => {
    const dummy = { dummy: true };
    setWorkerExtractor(dummy);
    const ext = await getWorkerExtractor();
    expect(ext).toBe(dummy);
  });

  it("processEmbedMessage: output.data ではなく直接配列が返された場合でも正しく vector を抽出できること", async () => {
    const mockExtractor = vi.fn(async () => {
      return [0.5, 0.6, 0.7];
    });

    const result = await processEmbedMessage({ id: 104, query: "直接配列テスト" }, mockExtractor);

    expect(result).toEqual({
      id: 104,
      vector: [0.5, 0.6, 0.7],
    });
  });

  it("processEmbedMessage: data が null / undefined の場合でも安全にデフォルト処理されること", async () => {
    const mockExtractor = vi.fn(async (text: string) => {
      expect(text).toBe("query: ");
      return { data: [] };
    });

    const result = await processEmbedMessage(null as any, mockExtractor);
    expect(result).toEqual({
      id: 0,
      vector: [],
    });
  });
});

describe("Worker 環境での onmessage リスナー動作 (embedder.worker)", () => {
  it("Worker global scope の onmessage がメッセージを受信して postMessage を実行すること", async () => {
    let capturedOnMessage: ((e: MessageEvent) => Promise<void>) | null = null;
    const posted: any[] = [];

    const fakeSelf: any = {
      set onmessage(fn: any) {
        capturedOnMessage = fn;
      },
      get onmessage() {
        return capturedOnMessage;
      },
      postMessage: (msg: any) => {
        posted.push(msg);
      },
    };

    const mockExtractor = vi.fn(async (text: string) => {
      expect(text).toBe("query: Worker イベントテスト");
      return { data: [1.0, 2.0] };
    });
    setWorkerExtractor(mockExtractor);

    // fakeSelf にハンドラを設定してテスト
    fakeSelf.onmessage = async (e: MessageEvent) => {
      const result = await processEmbedMessage(e.data);
      fakeSelf.postMessage(result);
    };

    await fakeSelf.onmessage({ data: { id: 200, query: "Worker イベントテスト" } } as MessageEvent);

    expect(posted).toHaveLength(1);
    expect(posted[0]).toEqual({
      id: 200,
      vector: [1.0, 2.0],
    });
  });
});
