import { GoogleGenAI } from "@google/genai";
import { UserProfile } from "../shared/types";
import { RawArticle } from "./fetcher";

export interface ScoringResult {
  summary: string;
  score: number;
}

/**
 * 指定されたミリ秒待機するPromise関数
 * Gemini API 無料枠の 15 RPM レートリミット（4200ms 待機）などを遵守するために使用する
 */
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

/**
 * 記事情報とユーザープロファイルに基づいてGemini用のプロンプト文字列を構築する
 */
export function buildScoringPrompt(
  article: { title: string; snippet: string },
  profile: UserProfile,
): string {
  const interests = profile.interests.length > 0 ? profile.interests.join(", ") : "なし";
  const excludeKeywords =
    profile.exclude_keywords.length > 0 ? profile.exclude_keywords.join(", ") : "なし";
  const scoringGuidelines = profile.scoring_guidelines || "特になし";

  return `あなたは技術記事のキュレーターです。以下の記事を分析し、ユーザーの興味関心に基づいて3行要約とスコア（0〜100点）を算出してJSONで出力してください。

【記事情報】
タイトル: ${article.title}
内容抜粋: ${article.snippet}

【ユーザーの興味関心】
- 興味のあるトピック: ${interests}
- 除外したいキーワード: ${excludeKeywords}
- 採点ガイドライン: ${scoringGuidelines}

【要件】
1. summary は記事の要点を簡潔に箇条書きで3行（改行区切り）で要約してください。
2. score はユーザーの興味関心への合致度や記事の有益性を 0〜100 の整数値で評価してください。除外キーワードが含まれる場合や関連性が低い場合は低スコア（0〜30点）、興味トピックに合致し技術的価値が高い場合は高スコア（70〜100点）としてください。

【出力フォーマット（JSON形式のみ）】
{
  "summary": "・要点1\\n・要点2\\n・要点3",
  "score": 85
}`;
}

/**
 * Gemini API から返却されたテキストから JSON を抽出し、ScoringResult に正規化・パースする
 */
export function parseGeminiResponse(responseText: string): ScoringResult {
  if (!responseText || typeof responseText !== "string") {
    return { summary: "要約の解析に失敗しました", score: 50 };
  }

  let cleaned = responseText.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
  } else {
    const jsonBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (jsonBlockMatch) {
      cleaned = jsonBlockMatch[1].trim();
    }
  }

  // 1. 通常の JSON.parse を試行
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === "object") {
      let score = 50;
      if (parsed.score !== undefined && parsed.score !== null) {
        const num = typeof parsed.score === "number" ? parsed.score : Number(parsed.score);
        if (!Number.isNaN(num)) {
          score = Math.max(0, Math.min(100, Math.round(num)));
        }
      }

      const summary =
        typeof parsed.summary === "string" && parsed.summary.trim().length > 0
          ? parsed.summary.trim()
          : "要約の取得に失敗しました";

      return { summary, score };
    }
  } catch {
    // JSON.parse が失敗した場合（未エスケープ改行など）、正規表現による安全抽出にフォールバック
  }

  // 2. 正規表現によるフィールド抽出フォールバック
  try {
    const scoreMatch = cleaned.match(/"score"\s*:\s*(-?\d+(?:\.\d+)?|"[^"]*")/i);
    let score = 50;
    if (scoreMatch) {
      const rawScoreStr = scoreMatch[1].replace(/"/g, "");
      const num = Number(rawScoreStr);
      if (!Number.isNaN(num)) {
        score = Math.max(0, Math.min(100, Math.round(num)));
      }
    }

    const summaryMatch = cleaned.match(/"summary"\s*:\s*"([\s\S]*?)"(?:\s*,|\s*\})/i);
    if (summaryMatch) {
      const rawSummary = summaryMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').trim();
      const summary = rawSummary.length > 0 ? rawSummary : "要約の取得に失敗しました";
      return { summary, score };
    }
  } catch {
    // エラー時はデフォルトフォールバック
  }

  return { summary: "要約の解析に失敗しました", score: 50 };
}

/**
 * 単一の記事に対して Gemini 2.5 Flash-Lite を呼び出し、要約とスコアを生成する
 */
export async function summarizeAndScoreArticle(
  article: RawArticle,
  profile: UserProfile,
  apiKey: string,
  aiClient?: any,
): Promise<ScoringResult> {
  const ai = aiClient ?? new GoogleGenAI({ apiKey });
  const prompt = buildScoringPrompt(article, profile);

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      },
    });

    const responseText = response?.text ?? "";
    return parseGeminiResponse(responseText);
  } catch (error) {
    console.error(`Gemini API 呼び出しエラー [記事ID: ${article.id}]:`, error);
    return {
      summary: "要約の生成中にエラーが発生しました",
      score: 50,
    };
  }
}
