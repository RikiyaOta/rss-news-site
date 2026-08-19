# Task 2 Brief: 共通型定義および設定ファイル管理

**Files:**
- Create: `src/shared/types.ts`
- Create: `config/feeds.yaml`
- Create: `src/pipeline/config.ts`
- Test: `tests/pipeline/config.test.ts`

**Requirements:**
1. `src/shared/types.ts`:
   - `Article`: `id: string`, `title: string`, `url: string`, `source_name: string`, `summary: string`, `score: number`, `published_at: string`
   - `FeedSource`: `name: string`, `url: string`
   - `UserProfile`: `interests: string[]`, `exclude_keywords: string[]`, `scoring_guidelines: string`
   - `PipelineConfig`: `feeds: FeedSource[]`, `profile: UserProfile`
   - `SearchResultItem`: extends `Article`, `date: string`, `similarity: number`
2. `config/feeds.yaml`:
   - Valid YAML with `feeds` array and `profile` object (with realistic technical RSS feeds like Zenn, Hacker News, Cloudflare Blog, and interests profile).
3. `src/pipeline/config.ts`:
   - `parseConfig(yamlString: string): PipelineConfig` using `js-yaml`
   - `loadConfig(configPath: string): PipelineConfig` using `node:fs`
   - Throw descriptive errors if required fields are missing or invalid.
4. `tests/pipeline/config.test.ts`:
   - All test descriptions must be written in **Japanese**.
   - Verify valid YAML parsing, default values fallback, and invalid YAML error handling.
5. All tests must pass with `vitest run tests/pipeline/config.test.ts` and `tsc --noEmit`.
