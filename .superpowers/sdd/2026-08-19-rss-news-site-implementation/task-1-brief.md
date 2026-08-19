# Task 1 Brief: ツールチェーン & ワークスペース初期設定

**Files:**
- Create: `mise.toml`
- Create: `pnpm-workspace.yaml`
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`

**Requirements:**
1. `mise.toml`:
   - node = "24.19.0"
   - pnpm = "11.22.0"
   - terraform = "1.15.8"
   - "github:suzuki-shunsuke/pinact" = "4.0.0"
2. `pnpm-workspace.yaml`:
   - `packages: ["."]`
   - `minimumReleaseAge: 10080` (7 days in minutes)
   - `minimumReleaseAgeStrict: true`
3. `package.json`:
   - Name: `rss-news-site`, private: true, type: "module"
   - Scripts: `dev`, `build`, `preview`, `test`, `test:coverage`, `test:e2e`, `pipeline`, `typecheck`, `pinact`
   - Dependencies: `@aws-sdk/client-s3`, `@google/genai`, `@huggingface/transformers`, `better-sqlite3`, `clsx`, `js-yaml`, `lucide-react`, `react`, `react-dom`, `rss-parser`, `sql.js`, `tailwind-merge`
   - DevDependencies: `@playwright/test`, `@types/better-sqlite3`, `@types/js-yaml`, `@types/node`, `@types/react`, `@types/react-dom`, `@types/sql.js`, `@vitejs/plugin-react`, `@vitest/coverage-v8`, `autoprefixer`, `postcss`, `tailwindcss`, `tsx`, `typescript`, `vite`, `vitest`
4. `tsconfig.json`, `vite.config.ts`, `vitest.config.ts` (with coverage v8 configured)
5. Verify files exist and syntax is valid.
