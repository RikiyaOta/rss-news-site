import yaml from "js-yaml";
import fs from "node:fs";
import { FeedSource, PipelineConfig } from "../shared/types";

export function parseConfig(yamlString: string): PipelineConfig {
  if (!yamlString || !yamlString.trim()) {
    throw new Error("設定ファイルのフォーマットが不正です: コンテンツが空です");
  }

  let doc: unknown;
  try {
    doc = yaml.load(yamlString);
  } catch (error) {
    throw new Error(`YAMLパースエラー: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    throw new Error(
      "設定ファイルのフォーマットが不正です: ルートはオブジェクトである必要があります",
    );
  }

  const record = doc as Record<string, unknown>;

  if (
    !("feeds" in record) ||
    !Array.isArray(record.feeds) ||
    !("profile" in record) ||
    typeof record.profile !== "object" ||
    record.profile === null
  ) {
    throw new Error("設定ファイルのフォーマットが不正です: feeds と profile が必要です");
  }

  const feeds: FeedSource[] = [];
  for (const item of record.feeds) {
    if (
      !item ||
      typeof item !== "object" ||
      !("name" in item) ||
      !("url" in item) ||
      typeof item.name !== "string" ||
      typeof item.url !== "string" ||
      !item.name.trim() ||
      !item.url.trim()
    ) {
      throw new Error("無効なフィード設定が含まれています: 各フィードには name と url が必須です");
    }
    feeds.push({
      name: item.name.trim(),
      url: item.url.trim(),
    });
  }

  const profileObj = record.profile as Record<string, unknown>;

  const interests = Array.isArray(profileObj.interests)
    ? profileObj.interests.filter((i): i is string => typeof i === "string")
    : [];

  const excludeKeywords = Array.isArray(profileObj.exclude_keywords)
    ? profileObj.exclude_keywords.filter((k): k is string => typeof k === "string")
    : [];

  const scoringGuidelines =
    typeof profileObj.scoring_guidelines === "string" ? profileObj.scoring_guidelines : "";

  return {
    feeds,
    profile: {
      interests,
      exclude_keywords: excludeKeywords,
      scoring_guidelines: scoringGuidelines,
    },
  };
}

export function loadConfig(configPath: string): PipelineConfig {
  const content = fs.readFileSync(configPath, "utf-8");
  return parseConfig(content);
}
