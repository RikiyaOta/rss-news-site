import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { execSync } from "node:child_process";

describe("GitHub Actions ワークフローおよび pinact バージョン固定の検証", () => {
  const rootDir = path.resolve(__dirname, "..");
  const workflowsDir = path.join(rootDir, ".github", "workflows");

  const workflowFiles = ["ci.yml", "daily-pipeline.yml", "deploy.yml", "e2e.yml"];

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

  describe("日次巡回パイプラインワークフロー (daily-pipeline.yml) の設定検証", () => {
    it("定期実行 (cron: 0 21 * * *) および手動実行 (workflow_dispatch) がトリガーに設定されていること", () => {
      const filePath = path.join(workflowsDir, "daily-pipeline.yml");
      const content = fs.readFileSync(filePath, "utf-8");
      const doc = yaml.load(content) as any;

      expect(doc.on).toBeDefined();
      expect(doc.on.workflow_dispatch !== undefined || doc.on.includes?.("workflow_dispatch")).toBe(
        true,
      );

      const schedule = doc.on.schedule;
      expect(schedule).toBeDefined();
      expect(Array.isArray(schedule)).toBe(true);
      expect(schedule[0].cron).toBe("0 21 * * *");
    });

    it("pnpm pipeline の実行と必要な環境変数シークレットが設定されていること", () => {
      const filePath = path.join(workflowsDir, "daily-pipeline.yml");
      const content = fs.readFileSync(filePath, "utf-8");

      expect(content).toContain("pnpm pipeline");
      expect(content).not.toContain("GEMINI_API_KEY");
      expect(content).toContain("R2_ACCOUNT_ID");
      expect(content).toContain("R2_ACCESS_KEY_ID");
      expect(content).toContain("R2_SECRET_ACCESS_KEY");
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

    it("pnpm build および Terraform によるデプロイ手順が含まれていること", () => {
      const filePath = path.join(workflowsDir, "deploy.yml");
      const content = fs.readFileSync(filePath, "utf-8");

      expect(content).toContain("pnpm build");
      expect(content).toContain("VITE_R2_PUBLIC_URL");
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
