import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("Terraform による Cloudflare D1 データベースインフラ定義の検証", () => {
  const rootDir = path.resolve(__dirname, "..");
  const tfDir = path.join(rootDir, "terraform");

  describe("backend.tf の設定検証", () => {
    it("backend.tf が存在すること", () => {
      const backendPath = path.join(tfDir, "backend.tf");
      expect(fs.existsSync(backendPath)).toBe(true);
    });

    it("S3互換バックエンド (R2) の設定が正しく定義されていること", () => {
      const backendPath = path.join(tfDir, "backend.tf");
      const content = fs.readFileSync(backendPath, "utf-8");

      expect(content).toMatch(/backend\s+"s3"/);
      expect(content).toMatch(/bucket\s*=\s*"rss-news-site-tfstate"/);
      expect(content).toMatch(/key\s*=\s*"rss-news-site\/terraform\.tfstate"/);
      expect(content).toMatch(/region\s*=\s*"auto"/);
      expect(content).toMatch(/skip_credentials_validation\s*=\s*true/);
      expect(content).toMatch(/skip_region_validation\s*=\s*true/);
      expect(content).toMatch(/skip_requesting_account_id\s*=\s*true/);
      expect(content).toMatch(/skip_s3_checksum\s*=\s*true/);
      expect(content).toMatch(/use_path_style\s*=\s*true/);
    });
  });

  describe("main.tf のリソース定義検証", () => {
    it("main.tf が存在すること", () => {
      const mainPath = path.join(tfDir, "main.tf");
      expect(fs.existsSync(mainPath)).toBe(true);
    });

    it("Terraform と Wrangler の責務分離方針 (Cloudflare Best Practice) に関するアーキテクチャ設計コメントが明記されていること", () => {
      const mainPath = path.join(tfDir, "main.tf");
      const content = fs.readFileSync(mainPath, "utf-8");

      expect(content).toContain("Architecture Design Note: Terraform & Wrangler 責務分離方針");
      expect(content).toContain("Wrangler の責務 (`wrangler.jsonc`)");
    });

    it("terraform および cloudflare プロバイダーの設定が正しく定義されていること", () => {
      const mainPath = path.join(tfDir, "main.tf");
      const content = fs.readFileSync(mainPath, "utf-8");

      expect(content).toMatch(/source\s*=\s*"cloudflare\/cloudflare"/);
      expect(content).toMatch(/version\s*=\s*"(~>|>=|>|=)?\s*5\./);
      expect(content).toMatch(/provider\s+"cloudflare"/);
    });

    it("Cloudflare D1 データベースリソース (cloudflare_d1_database.news_db) が正しく定義されていること", () => {
      const mainPath = path.join(tfDir, "main.tf");
      const content = fs.readFileSync(mainPath, "utf-8");

      expect(content).toMatch(/resource\s+"cloudflare_d1_database"\s+"news_db"/);
      expect(content).toMatch(/account_id\s*=\s*var\.cloudflare_account_id/);
      expect(content).toMatch(/name\s*=\s*var\.d1_database_name/);
      expect(content).toMatch(/read_replication\s*=\s*\{\s*mode\s*=\s*"disabled"\s*\}/);
    });

    it("アプリケーション層 (Worker / Pages / R2) は Wrangler 側で一元管理され、Terraform に重複定義されていないこと", () => {
      const mainPath = path.join(tfDir, "main.tf");
      const content = fs.readFileSync(mainPath, "utf-8");

      expect(content).not.toMatch(/resource\s+"cloudflare_workers_script"/);
      expect(content).not.toMatch(/resource\s+"cloudflare_workers_custom_domain"/);
      expect(content).not.toMatch(/resource\s+"cloudflare_pages_project"/);
      expect(content).not.toMatch(/resource\s+"cloudflare_pages_domain"/);
      expect(content).not.toMatch(/resource\s+"cloudflare_r2_bucket"/);
    });
  });

  describe("variables.tf の変数定義検証", () => {
    it("variables.tf が存在すること", () => {
      const varsPath = path.join(tfDir, "variables.tf");
      expect(fs.existsSync(varsPath)).toBe(true);
    });

    it("cloudflare_account_id 変数が定義されていること (必須)", () => {
      const varsPath = path.join(tfDir, "variables.tf");
      const content = fs.readFileSync(varsPath, "utf-8");

      expect(content).toMatch(/variable\s+"cloudflare_account_id"/);
      expect(content).toMatch(/type\s*=\s*string/);
    });

    it("d1_database_name 変数がデフォルト値 'rss-news-db' で定義されていること", () => {
      const varsPath = path.join(tfDir, "variables.tf");
      const content = fs.readFileSync(varsPath, "utf-8");

      expect(content).toMatch(/variable\s+"d1_database_name"/);
      expect(content).toMatch(/default\s*=\s*"rss-news-db"/);
      expect(content).toMatch(/type\s*=\s*string/);
    });

    it("不要になった Worker、Pages、R2 関連変数が定義されていないこと", () => {
      const varsPath = path.join(tfDir, "variables.tf");
      const content = fs.readFileSync(varsPath, "utf-8");

      expect(content).not.toMatch(/variable\s+"worker_name"/);
      expect(content).not.toMatch(/variable\s+"custom_domain"/);
      expect(content).not.toMatch(/variable\s+"pages_project_name"/);
      expect(content).not.toMatch(/variable\s+"r2_data_bucket_name"/);
    });
  });

  describe("outputs.tf の出力定義検証", () => {
    it("outputs.tf が存在すること", () => {
      const outputsPath = path.join(tfDir, "outputs.tf");
      expect(fs.existsSync(outputsPath)).toBe(true);
    });

    it("d1_database_id 出力が定義されていること", () => {
      const outputsPath = path.join(tfDir, "outputs.tf");
      const content = fs.readFileSync(outputsPath, "utf-8");

      expect(content).toMatch(/output\s+"d1_database_id"/);
      expect(content).toMatch(/value\s*=\s*cloudflare_d1_database\.news_db\.id/);
    });

    it("d1_database_name 出力が定義されていること", () => {
      const outputsPath = path.join(tfDir, "outputs.tf");
      const content = fs.readFileSync(outputsPath, "utf-8");

      expect(content).toMatch(/output\s+"d1_database_name"/);
      expect(content).toMatch(/value\s*=\s*cloudflare_d1_database\.news_db\.name/);
    });

    it("不要になった Worker、Pages、R2 関連出力が定義されていないこと", () => {
      const outputsPath = path.join(tfDir, "outputs.tf");
      const content = fs.readFileSync(outputsPath, "utf-8");

      expect(content).not.toMatch(/output\s+"worker_name"/);
      expect(content).not.toMatch(/output\s+"custom_domain"/);
      expect(content).not.toMatch(/output\s+"pages_project_name"/);
      expect(content).not.toMatch(/output\s+"r2_bucket_name"/);
    });
  });
});
