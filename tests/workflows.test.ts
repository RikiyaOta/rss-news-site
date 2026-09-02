import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { execSync } from "node:child_process";

describe("GitHub Actions ワークフローおよび pinact バージョン固定の検証", () => {
  const rootDir = path.resolve(__dirname, "..");
  const workflowsDir = path.join(rootDir, ".github", "workflows");

  const workflowFiles = [
    "ci.yml",
    "fetch-and-score-pipeline.yml",
    "deploy.yml",
    "e2e.yml",
    "embedding-model-smoke-test.yml",
  ];

  describe("ワークフローファイルの存在と YAML 構文検証", () => {
    for (const file of workflowFiles) {
      it(`${file} が存在し、有効な YAML としてパースできること`, () => {
        const filePath = path.join(workflowsDir, file);
        expect(fs.existsSync(filePath)).toBe(true);

        const content = fs.readFileSync(filePath, "utf-8");
        const parsed = yaml.load(content);
        expect(parsed).toBeDefined();
        expect(typeof parsed).toBe("object");
      });
    }
  });

  describe("pinact による全サードパーティアクションの 40桁 SHA ハッシュ固定検証", () => {
    for (const file of workflowFiles) {
      it(`${file} 内のすべての uses 参照が 40桁の SHA ハッシュで固定されていること`, () => {
        const filePath = path.join(workflowsDir, file);
        expect(fs.existsSync(filePath)).toBe(true);

        const content = fs.readFileSync(filePath, "utf-8");
        const usesRegex = /uses:\s*([^\s\r\n]+)/g;
        const matches = [...content.matchAll(usesRegex)];

        expect(matches.length).toBeGreaterThan(0);

        for (const match of matches) {
          const actionRef = match[1];
          // ローカルアクション (./...) でない場合は SHA 固定が必要
          if (!actionRef.startsWith("./")) {
            // 例: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683
            const shaMatch = actionRef.match(/^([^@]+)@([a-f0-9]{40})$/);
            expect(
              shaMatch,
              `Action "${actionRef}" in ${file} は 40桁の SHA コミットハッシュで固定されていません`,
            ).not.toBeNull();
            expect(shaMatch![2]).toHaveLength(40);
          }
        }
      });
    }

    it("pinact による静的検証 (pinact run -fix=false -no-api) がパスすること", () => {
      try {
        execSync("mise exec -- pinact run -fix=false -no-api .github/workflows/*.yml", {
          cwd: rootDir,
          stdio: "pipe",
        });
      } catch (error: any) {
        const stderr = error.stderr?.toString() || error.message;
        throw new Error(`pinact による検証に失敗しました: ${stderr}`);
      }
    });
  });

  describe("CI ワークフロー (ci.yml) の設定検証", () => {
    it("push および pull_request トリガーが main ブランチ向けに設定されていること", () => {
      const filePath = path.join(workflowsDir, "ci.yml");
      const content = fs.readFileSync(filePath, "utf-8");
      const doc = yaml.load(content) as any;

      expect(doc.on).toBeDefined();
      const triggers =
        typeof doc.on === "string"
          ? [doc.on]
          : Array.isArray(doc.on)
            ? doc.on
            : Object.keys(doc.on);
      expect(triggers).toContain("push");
      expect(triggers).toContain("pull_request");

      if (typeof doc.on === "object" && !Array.isArray(doc.on)) {
        if (doc.on.push) {
          const pushBranches = doc.on.push.branches || [];
          expect(pushBranches).toContain("main");
        }
        if (doc.on.pull_request) {
          const prBranches = doc.on.pull_request.branches || [];
          expect(prBranches).toContain("main");
        }
      }
    });

    it("型チェック、テストカバレッジ実行、および GITHUB_STEP_SUMMARY 出力が含まれていること", () => {
      const filePath = path.join(workflowsDir, "ci.yml");
      const content = fs.readFileSync(filePath, "utf-8");

      expect(content).toContain("pnpm install --frozen-lockfile");
      expect(content).toContain("pnpm typecheck");
      expect(content).toContain("pnpm test:coverage");
      expect(content).toContain("GITHUB_STEP_SUMMARY");
    });
    it("CI ワークフローに pinact によるアクション検証ステップが含まれていること", () => {
      const filePath = path.join(workflowsDir, "ci.yml");
      const content = fs.readFileSync(filePath, "utf-8");

      expect(content).toContain("pinact");
      expect(content).toMatch(/pinact:check|pinact\s+run\s+--check/);
    });

    it("package.json に pinact:check スクリプトが定義されていること", () => {
      const pkgPath = path.join(rootDir, "package.json");
      const pkgContent = fs.readFileSync(pkgPath, "utf-8");
      const pkg = JSON.parse(pkgContent);

      expect(pkg.scripts["pinact:check"]).toBeDefined();
      expect(pkg.scripts["pinact:check"]).toContain("pinact run --check --verify");
    });

    it("Terraform 初期化、構文検証 (validate)、および計画実行 (plan) が含まれていること", () => {
      const filePath = path.join(workflowsDir, "ci.yml");
      const content = fs.readFileSync(filePath, "utf-8");

      expect(content).toMatch(/terraform\s+init/);
      expect(content).toContain("terraform validate");
      expect(content).toContain("terraform plan");
    });
  });

  describe("記事収集・スコアリングパイプラインワークフロー (fetch-and-score-pipeline.yml) の設定検証", () => {
    it("定期実行 (cron: 0 */3 * * *) および手動実行 (workflow_dispatch) がトリガーに設定されていること", () => {
      const filePath = path.join(workflowsDir, "fetch-and-score-pipeline.yml");
      const content = fs.readFileSync(filePath, "utf-8");
      const doc = yaml.load(content) as any;

      expect(doc.on).toBeDefined();
      expect(doc.on.workflow_dispatch !== undefined || doc.on.includes?.("workflow_dispatch")).toBe(
        true,
      );

      const schedule = doc.on.schedule;
      expect(schedule).toBeDefined();
      expect(Array.isArray(schedule)).toBe(true);
      expect(schedule[0].cron).toBe("0 */3 * * *");
    });

    it("pnpm pipeline の実行と必要な環境変数シークレットが設定されていること", () => {
      const filePath = path.join(workflowsDir, "fetch-and-score-pipeline.yml");
      const content = fs.readFileSync(filePath, "utf-8");

      expect(content).toContain("pnpm pipeline");
      expect(content).not.toContain("GEMINI_API_KEY");
      expect(content).toContain("CLOUDFLARE_API_TOKEN");
      expect(content).toContain("CLOUDFLARE_ACCOUNT_ID");
      expect(content).toContain("CLOUDFLARE_D1_DATABASE_ID");
      expect(content).not.toContain("R2_ACCESS_KEY_ID");
      expect(content).not.toContain("R2_SECRET_ACCESS_KEY");
    });
  });

  describe("デプロイワークフロー (deploy.yml) の設定検証", () => {
    it("main ブランチへの push トリガーが設定されていること", () => {
      const filePath = path.join(workflowsDir, "deploy.yml");
      const content = fs.readFileSync(filePath, "utf-8");
      const doc = yaml.load(content) as any;

      expect(doc.on).toBeDefined();
      if (doc.on.push) {
        const pushBranches = doc.on.push.branches || [];
        expect(pushBranches).toContain("main");
      }
    });

    it("pnpm build および Terraform / wrangler deploy によるデプロイ手順が含まれていること", () => {
      const filePath = path.join(workflowsDir, "deploy.yml");
      const content = fs.readFileSync(filePath, "utf-8");

      expect(content).toContain("pnpm build");
      expect(content).toContain("wrangler deploy");
      expect(content).toMatch(/wrangler\s+d1\s+(execute|migrations)/);
      expect(content).toMatch(/terraform\s+init/);
      expect(content).toMatch(/terraform\s+apply/);
    });
  });

  describe("E2E 定期実行ワークフロー (e2e.yml) の設定検証", () => {
    it("毎朝9時 JST (cron: 0 0 * * *) および手動実行 (workflow_dispatch) がトリガーに設定されていること", () => {
      const filePath = path.join(workflowsDir, "e2e.yml");
      const content = fs.readFileSync(filePath, "utf-8");
      const doc = yaml.load(content) as any;

      expect(doc.on).toBeDefined();
      expect(doc.on.workflow_dispatch !== undefined || doc.on.includes?.("workflow_dispatch")).toBe(
        true,
      );

      const schedule = doc.on.schedule;
      expect(schedule).toBeDefined();
      expect(Array.isArray(schedule)).toBe(true);
      expect(schedule[0].cron).toBe("0 0 * * *");
    });

    it("Playwright ブラウザのインストール、E2E_REAL_MODEL 環境変数、および pnpm test:e2e の実行が含まれていること", () => {
      const filePath = path.join(workflowsDir, "e2e.yml");
      const content = fs.readFileSync(filePath, "utf-8");

      expect(content).toMatch(/playwright\s+install/);
      expect(content).toContain("E2E_REAL_MODEL");
      expect(content).toContain("pnpm test:e2e");
    });
  });

  describe("埋め込みモデル スモークテストワークフロー (embedding-model-smoke-test.yml) の設定検証", () => {
    it("依存パッケージおよび埋め込み関連コードの変更を対象とした pull_request トリガーが設定されていること", () => {
      const filePath = path.join(workflowsDir, "embedding-model-smoke-test.yml");
      const doc = yaml.load(fs.readFileSync(filePath, "utf-8")) as any;

      expect(doc.on.pull_request).toBeDefined();
      expect(doc.on.pull_request.branches).toContain("main");

      const paths = doc.on.pull_request.paths ?? [];
      expect(paths).toContain("pnpm-lock.yaml");
      expect(paths).toContain("package.json");
      expect(paths).toContain("src/pipeline/embedder.ts");
      expect(doc.on.workflow_dispatch !== undefined).toBe(true);
    });

    it("実モデルを読み込む統合テスト (pnpm test:integration) が実行されること", () => {
      const filePath = path.join(workflowsDir, "embedding-model-smoke-test.yml");
      const content = fs.readFileSync(filePath, "utf-8");

      expect(content).toContain("pnpm install --frozen-lockfile");
      expect(content).toContain("pnpm test:integration");
    });

    it("package.json に test:integration スクリプトが定義されていること", () => {
      const pkgPath = path.join(rootDir, "package.json");
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));

      expect(pkg.scripts["test:integration"]).toBeDefined();
      expect(pkg.scripts["test:integration"]).toContain("vitest.integration.config.ts");
    });

    it("統合テストが既定のユニットテスト実行 (vitest.config.ts) から除外されていること", () => {
      const configPath = path.join(rootDir, "vitest.config.ts");
      const content = fs.readFileSync(configPath, "utf-8");

      expect(content).toContain("tests/integration/**");
    });
  });

  describe("パッケージマネージャーのセキュリティ・整合性検証", () => {
    for (const file of workflowFiles) {
      it(`${file} 内で npm または yarn が使用されておらず、pnpm が使用されていること`, () => {
        const filePath = path.join(workflowsDir, file);
        expect(fs.existsSync(filePath)).toBe(true);

        const content = fs.readFileSync(filePath, "utf-8");

        // 禁止されているコマンド (npm run, npx, yarn 等)
        expect(content).not.toMatch(/(^|\s)npm\s+(install|run|ci|exec|test)/m);
        expect(content).not.toMatch(/(^|\s)npx\s+/m);
        expect(content).not.toMatch(/(^|\s)yarn\s+/m);

        // 依存関係インストールは frozen-lockfile が付与された pnpm であること
        expect(content).toContain("pnpm");
      });
    }
  });

  describe("シェルパイプを含むステップの終了ステータス伝播検証 (pipefail)", () => {
    /**
     * run スクリプト内でパイプ演算子 (`|`) が使われているかを判定する。
     * `||` (OR 演算子) はパイプ演算子ではないため除外する。
     */
    function containsShellPipe(script: string): boolean {
      return script.split("\n").some((line) => /\|\s*\S/.test(line.replace(/\|\|/g, "")));
    }

    /**
     * ステップが pipefail を有効にした状態で実行されるかを判定する。
     * GitHub Actions のデフォルトシェルは `bash -e` で pipefail が無効だが、
     * `shell: bash` を明示すると `bash --noprofile --norc -eo pipefail` になる。
     */
    function hasPipefail(doc: any, job: any, step: any): boolean {
      const shell = step.shell ?? job.defaults?.run?.shell ?? doc.defaults?.run?.shell;
      if (shell === "bash") return true;
      return /set\s+-[a-zA-Z]*o\s+pipefail|set\s+-o\s+pipefail/.test(step.run ?? "");
    }

    for (const file of workflowFiles) {
      it(`${file} のパイプを含む run ステップが pipefail 有効で実行されること`, () => {
        const filePath = path.join(workflowsDir, file);
        const doc = yaml.load(fs.readFileSync(filePath, "utf-8")) as any;

        for (const [jobName, job] of Object.entries<any>(doc.jobs ?? {})) {
          for (const step of job.steps ?? []) {
            if (typeof step.run !== "string" || !containsShellPipe(step.run)) continue;

            expect(
              hasPipefail(doc, job, step),
              `${file} のジョブ "${jobName}" のステップ "${step.name ?? step.run.trim().split("\n")[0]}" は ` +
                `パイプを含むが pipefail が無効です。GitHub Actions のデフォルトシェル (bash -e) では ` +
                `パイプラインの終了ステータスが最後のコマンドのものになるため、` +
                `前段のコマンドが失敗しても CI が成功扱いになります。` +
                `\`shell: bash\` を明示するか \`set -o pipefail\` を追加してください。`,
            ).toBe(true);
          }
        }
      });
    }
  });

  describe("Dependabot (dependabot.yml) の設定検証", () => {
    it(".github/dependabot.yml が存在し、有効な YAML としてパースできること", () => {
      const filePath = path.join(rootDir, ".github", "dependabot.yml");
      expect(fs.existsSync(filePath)).toBe(true);

      const content = fs.readFileSync(filePath, "utf-8");
      const doc = yaml.load(content) as any;
      expect(doc.version).toBe(2);
      expect(Array.isArray(doc.updates)).toBe(true);
      expect(doc.updates.length).toBeGreaterThanOrEqual(3);
    });

    it("npm, terraform, github-actions の週次更新 (weekly) が設定されていること", () => {
      const filePath = path.join(rootDir, ".github", "dependabot.yml");
      const content = fs.readFileSync(filePath, "utf-8");
      const doc = yaml.load(content) as any;

      const ecosystems = doc.updates.map((u: any) => u["package-ecosystem"]);
      expect(ecosystems).toContain("npm");
      expect(ecosystems).toContain("terraform");
      expect(ecosystems).toContain("github-actions");

      for (const update of doc.updates) {
        expect(update.schedule.interval).toBe("weekly");
      }
    });
  });
});
