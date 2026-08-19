import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  sleep,
  buildScoringPrompt,
  parseGeminiResponse,
  summarizeAndScoreArticle,
  type ScoringResult,
} from "../../src/pipeline/gemini";
import { UserProfile } from "../../src/shared/types";
import { RawArticle } from "../../src/pipeline/fetcher";

const mockDefaultGenerateContent = vi.fn().mockResolvedValue({
  text: JSON.stringify({
    summary: "・デフォルトクライアント要約1\n・要約2\n・要約3",
    score: 95,
  }),
});

vi.mock("@google/genai", () => {
  return {
    GoogleGenAI: class MockGoogleGenAI {
      apiKey: string;
      models: { generateContent: typeof mockDefaultGenerateContent };
      constructor(opts: { apiKey: string }) {
        this.apiKey = opts.apiKey;
        this.models = {
          generateContent: mockDefaultGenerateContent,
        };
      }
    },
  };
});

describe("Gemini 2.5 Flash-Lite 要約・スコアリングモジュール (src/pipeline/gemini) のテスト", () => {
  describe("sleep 関数", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("指定したミリ秒（4200ms）待機すること", async () => {
      const sleepPromise = sleep(4200);

      let resolved = false;
      sleepPromise.then(() => {
        resolved = true;
      });

      expect(resolved).toBe(false);

      // 4199ms経過時点では未解決
      await vi.advanceTimersByTimeAsync(4199);
      expect(resolved).toBe(false);

      // 4200ms経過で解決
      await vi.advanceTimersByTimeAsync(1);
      expect(resolved).toBe(true);
    });

    it("0ミリ秒の指定でも正常に即座に解決すること", async () => {
      const sleepPromise = sleep(0);
      await vi.advanceTimersByTimeAsync(0);
      await expect(sleepPromise).resolves.toBeUndefined();
    });

    it("負のミリ秒が指定された場合でも0ミリ秒として安全に解決すること", async () => {
      const sleepPromise = sleep(-100);
      await vi.advanceTimersByTimeAsync(0);
      await expect(sleepPromise).resolves.toBeUndefined();
    });
  });

  describe("buildScoringPrompt 関数", () => {
    const mockProfile: UserProfile = {
      interests: ["TypeScript", "Cloudflare Workers", "生成AI"],
      exclude_keywords: ["PR記事", "入門まとめ"],
      scoring_guidelines: "実用的なコード例や技術的洞察が含まれている記事を高く評価する",
    };

    const mockArticle = {
      title: "Cloudflare Workers で動かす TypeScript 5.8 ガイド",
      snippet: "エッジ環境での型安全性とパフォーマンスを極限まで高めるアーキテクチャの解説。",
    };

    it("記事のタイトルおよび内容抜粋がプロンプトに含まれること", () => {
      const prompt = buildScoringPrompt(mockArticle, mockProfile);

      expect(prompt).toContain(mockArticle.title);
      expect(prompt).toContain(mockArticle.snippet);
    });

    it("ユーザーの興味トピック、除外キーワード、採点ガイドラインがプロンプトに含まれること", () => {
      const prompt = buildScoringPrompt(mockArticle, mockProfile);

      expect(prompt).toContain("TypeScript");
      expect(prompt).toContain("Cloudflare Workers");
      expect(prompt).toContain("生成AI");
      expect(prompt).toContain("PR記事");
      expect(prompt).toContain("入門まとめ");
      expect(prompt).toContain("実用的なコード例や技術的洞察が含まれている記事を高く評価する");
    });

    it("関心トピックや除外キーワードが空配列の場合でも適切にプロンプトが生成されること", () => {
      const emptyProfile: UserProfile = {
        interests: [],
        exclude_keywords: [],
        scoring_guidelines: "",
      };

      const prompt = buildScoringPrompt(mockArticle, emptyProfile);
      expect(prompt).toContain(mockArticle.title);
      expect(prompt).toContain("なし");
    });

    it("JSON形式での出力を指示するフォーマット指定が含まれること", () => {
      const prompt = buildScoringPrompt(mockArticle, mockProfile);

      expect(prompt).toContain('"summary"');
      expect(prompt).toContain('"score"');
      expect(prompt).toContain("JSON");
    });
  });

  describe("parseGeminiResponse 関数", () => {
    it("正常なプレーンJSON文字列から要約とスコアを正しくパースできること", () => {
      const jsonText = JSON.stringify({
        summary:
          "・Cloudflare Workersの新機能解説\n・TypeScript 5.8の型互換性\n・実務でのベストプラクティス",
        score: 92,
      });

      const result: ScoringResult = parseGeminiResponse(jsonText);

      expect(result.score).toBe(92);
      expect(result.summary).toBe(
        "・Cloudflare Workersの新機能解説\n・TypeScript 5.8の型互換性\n・実務でのベストプラクティス",
      );
    });

    it("```json ... ``` マークダウンコードブロック付きのレスポンスを正しくパースできること", () => {
      const markdownText = `\`\`\`json
{
  "summary": "・エッジ環境でのAI活用\n・Worker間通信の最適化\n・レイテンシ削減手法",
  "score": 85
}
\`\`\``;

      const result: ScoringResult = parseGeminiResponse(markdownText);

      expect(result.score).toBe(85);
      expect(result.summary).toContain("エッジ環境でのAI活用");
    });

    it("``` のみ（言語識別子なし）のコードブロック付きレスポンスを正しくパースできること", () => {
      const markdownText = `\`\`\`
{
  "summary": "・要点1\n・要点2\n・要点3",
  "score": 70
}
\`\`\``;

      const result: ScoringResult = parseGeminiResponse(markdownText);

      expect(result.score).toBe(70);
      expect(result.summary).toBe("・要点1\n・要点2\n・要点3");
    });

    it("コードブロックの前後に説明テキストが含まれる場合でもJSON部分を抽出してパースできること", () => {
      const rawText = `以下の通り要約とスコアリング結果を出力します。

\`\`\`json
{
  "summary": "・記事概要1\n・記事概要2\n・記事概要3",
  "score": 78
}
\`\`\`
以上です。ご参考にしてください。`;

      const result: ScoringResult = parseGeminiResponse(rawText);

      expect(result.score).toBe(78);
      expect(result.summary).toBe("・記事概要1\n・記事概要2\n・記事概要3");
    });

    it("スコアが100を超える場合は100にクランプされること", () => {
      const jsonText = JSON.stringify({ summary: "優秀な記事", score: 150 });
      const result: ScoringResult = parseGeminiResponse(jsonText);
      expect(result.score).toBe(100);
    });

    it("スコアが0未満（負の値）の場合は0にクランプされること", () => {
      const jsonText = JSON.stringify({ summary: "低品質な記事", score: -25 });
      const result: ScoringResult = parseGeminiResponse(jsonText);
      expect(result.score).toBe(0);
    });

    it("スコアが小数の場合に四捨五入されること", () => {
      const result1: ScoringResult = parseGeminiResponse(
        JSON.stringify({ summary: "要約1", score: 85.4 }),
      );
      expect(result1.score).toBe(85);

      const result2: ScoringResult = parseGeminiResponse(
        JSON.stringify({ summary: "要約2", score: 85.6 }),
      );
      expect(result2.score).toBe(86);
    });

    it("スコアが文字列形式の数字の場合に数値に変換されてクランプされること", () => {
      const result: ScoringResult = parseGeminiResponse(
        JSON.stringify({ summary: "要約", score: "88" }),
      );
      expect(result.score).toBe(88);
    });

    it("不正なJSON文字列の場合にフォールバック（スコア50、エラー要約メッセージ）を返すこと", () => {
      const invalidJson = "{ invalid json content ...";
      const result: ScoringResult = parseGeminiResponse(invalidJson);

      expect(result.score).toBe(50);
      expect(result.summary).toBe("要約の解析に失敗しました");
    });

    it("空文字列や空白のみの場合にフォールバックを返すこと", () => {
      const result1: ScoringResult = parseGeminiResponse("");
      expect(result1.score).toBe(50);
      expect(result1.summary).toBe("要約の解析に失敗しました");

      const result2: ScoringResult = parseGeminiResponse("   ");
      expect(result2.score).toBe(50);
      expect(result2.summary).toBe("要約の解析に失敗しました");

      const result3: ScoringResult = parseGeminiResponse(null as any);
      expect(result3.score).toBe(50);
      expect(result3.summary).toBe("要約の解析に失敗しました");
    });

    it("JSONは有効だが summary が欠落または空文字の場合にフォールバック要約を返すこと", () => {
      const jsonWithoutSummary = JSON.stringify({ score: 80 });
      const result1: ScoringResult = parseGeminiResponse(jsonWithoutSummary);
      expect(result1.score).toBe(80);
      expect(result1.summary).toBe("要約の取得に失敗しました");

      const jsonWithEmptySummary = JSON.stringify({ summary: "   ", score: 80 });
      const result2: ScoringResult = parseGeminiResponse(jsonWithEmptySummary);
      expect(result2.score).toBe(80);
      expect(result2.summary).toBe("要約の取得に失敗しました");
    });

    it("JSONは有効だが score が数値として不正または欠落している場合にスコア50を返すこと", () => {
      const jsonWithoutScore = JSON.stringify({ summary: "有効な要約" });
      const result1: ScoringResult = parseGeminiResponse(jsonWithoutScore);
      expect(result1.score).toBe(50);
      expect(result1.summary).toBe("有効な要約");

      const jsonWithInvalidScore = JSON.stringify({ summary: "有効な要約", score: "not-a-number" });
      const result2: ScoringResult = parseGeminiResponse(jsonWithInvalidScore);
      expect(result2.score).toBe(50);
      expect(result2.summary).toBe("有効な要約");
    });

    it("未エスケープ改行を含むJSONでスコアが不正な場合に正規表現フォールバックでスコア50となること", () => {
      const rawInvalidScoreJson = `{\n  "summary": "・要約1\n・要約2",\n  "score": "invalid_number"\n}`;
      const result: ScoringResult = parseGeminiResponse(rawInvalidScoreJson);
      expect(result.score).toBe(50);
      expect(result.summary).toBe("・要点1\n・要約2".replace("要点", "要約"));
    });

    it("未エスケープ改行を含むJSONで要約が空白のみの場合に正規表現フォールバックでフォールバック要約となること", () => {
      const rawEmptySummaryJson = `{\n  "summary": "   \n   \n   ",\n  "score": 88\n}`;
      const result: ScoringResult = parseGeminiResponse(rawEmptySummaryJson);
      expect(result.score).toBe(88);
      expect(result.summary).toBe("要約の取得に失敗しました");
    });
  });

  describe("summarizeAndScoreArticle 関数", () => {
    const mockProfile: UserProfile = {
      interests: ["TypeScript", "AI"],
      exclude_keywords: ["PR"],
      scoring_guidelines: "技術的深みを評価",
    };

    const mockArticle: RawArticle = {
      id: "art-1234567890ab",
      title: "TypeScript AI Agent 入門",
      url: "https://example.com/ai-agent",
      source_name: "Tech Blog",
      snippet: "自律型エージェントのTypeScriptによる実装パターン。",
      published_at: "2026-08-19T00:00:00.000Z",
    };

    it("モックされた aiClient を使用して gemini-2.5-flash-lite を呼び出し、結果を正しく返却すること", async () => {
      const mockGenerateContent = vi.fn().mockResolvedValue({
        text: JSON.stringify({
          summary:
            "・TypeScriptでのAIエージェント設計\n・ツール呼び出しの型安全性\n・実装上の注意点",
          score: 88,
        }),
      });

      const mockAiClient = {
        models: {
          generateContent: mockGenerateContent,
        },
      };

      const result: ScoringResult = await summarizeAndScoreArticle(
        mockArticle,
        mockProfile,
        "dummy-api-key",
        mockAiClient,
      );

      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      expect(mockGenerateContent).toHaveBeenCalledWith({
        model: "gemini-2.5-flash-lite",
        contents: expect.stringContaining(mockArticle.title),
        config: {
          responseMimeType: "application/json",
        },
      });

      expect(result.score).toBe(88);
      expect(result.summary).toContain("TypeScriptでのAIエージェント設計");
    });

    it("aiClient が渡されない場合にデフォルトで GoogleGenAI インスタンスを生成して呼び出すこと", async () => {
      mockDefaultGenerateContent.mockClear();

      const result: ScoringResult = await summarizeAndScoreArticle(
        mockArticle,
        mockProfile,
        "test-api-key",
      );

      expect(mockDefaultGenerateContent).toHaveBeenCalledTimes(1);
      expect(mockDefaultGenerateContent).toHaveBeenCalledWith({
        model: "gemini-2.5-flash-lite",
        contents: expect.stringContaining(mockArticle.title),
        config: {
          responseMimeType: "application/json",
        },
      });
      expect(result.score).toBe(95);
      expect(result.summary).toContain("デフォルトクライアント要約1");
    });

    it("API呼び出し時に例外が発生した場合にエラーログを出力しフォールバック結果を返すこと", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const mockAiClient = {
        models: {
          generateContent: vi.fn().mockRejectedValue(new Error("API Quota Exceeded (429)")),
        },
      };

      const result: ScoringResult = await summarizeAndScoreArticle(
        mockArticle,
        mockProfile,
        "dummy-api-key",
        mockAiClient,
      );

      expect(result.score).toBe(50);
      expect(result.summary).toBe("要約の生成中にエラーが発生しました");
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Gemini API 呼び出しエラー"),
        expect.any(Error),
      );

      consoleErrorSpy.mockRestore();
    });

    it("レスポンステキストが空の場合でも安全にフォールバックすること", async () => {
      const mockAiClient = {
        models: {
          generateContent: vi.fn().mockResolvedValue({ text: null }),
        },
      };

      const result: ScoringResult = await summarizeAndScoreArticle(
        mockArticle,
        mockProfile,
        "dummy-api-key",
        mockAiClient,
      );

      expect(result.score).toBe(50);
      expect(result.summary).toBe("要約の解析に失敗しました");
    });
  });
});
