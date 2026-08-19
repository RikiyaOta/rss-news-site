import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("Terraform による Cloudflare R2 & Pages インフラ定義の検証", () => {
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

    it("terraform および cloudflare プロバイダーの設定が正しく定義されていること", () => {
      const mainPath = path.join(tfDir, "main.tf");
      const content = fs.readFileSync(mainPath, "utf-8");

      expect(content).toMatch(/source\s*=\s*"cloudflare\/cloudflare"/);
      expect(content).toMatch(/version\s*=\s*"(~>|>=|>|=)?\s*4\./);
      expect(content).toMatch(/provider\s+"cloudflare"/);
    });

    it("Cloudflare R2 バケットリソース (cloudflare_r2_bucket.data) が正しく定義されていること", () => {
      const mainPath = path.join(tfDir, "main.tf");
      const content = fs.readFileSync(mainPath, "utf-8");

      expect(content).toMatch(/resource\s+"cloudflare_r2_bucket"\s+"data"/);
      expect(content).toMatch(/account_id\s*=\s*var\.cloudflare_account_id/);
      expect(content).toMatch(/name\s*=\s*var\.r2_data_bucket_name/);
      expect(content).toMatch(/location\s*=\s*"(apac|APAC|auto)"/i);
    });

    it("Cloudflare Pages プロジェクトリソース (cloudflare_pages_project.site) が正しく定義されていること", () => {
      const mainPath = path.join(tfDir, "main.tf");
      const content = fs.readFileSync(mainPath, "utf-8");

      expect(content).toMatch(/resource\s+"cloudflare_pages_project"\s+"site"/);
      expect(content).toMatch(/account_id\s*=\s*var\.cloudflare_account_id/);
      expect(content).toMatch(/name\s*=\s*var\.pages_project_name/);
      expect(content).toMatch(/production_branch\s*=\s*var\.production_branch/);
      expect(content).toMatch(/build_command\s*=\s*"pnpm build"/);
      expect(content).toMatch(/destination_dir\s*=\s*"dist"/);
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

    it("r2_data_bucket_name 変数がデフォルト値 'rss-news-site-data' で定義されていること", () => {
      const varsPath = path.join(tfDir, "variables.tf");
      const content = fs.readFileSync(varsPath, "utf-8");

      expect(content).toMatch(/variable\s+"r2_data_bucket_name"/);
      expect(content).toMatch(/default\s*=\s*"rss-news-site-data"/);
    });

    it("pages_project_name 変数がデフォルト値 'rss-news-site' で定義されていること", () => {
      const varsPath = path.join(tfDir, "variables.tf");
      const content = fs.readFileSync(varsPath, "utf-8");

      expect(content).toMatch(/variable\s+"pages_project_name"/);
      expect(content).toMatch(/default\s*=\s*"rss-news-site"/);
    });

    it("production_branch 変数がデフォルト値 'main' で定義されていること", () => {
      const varsPath = path.join(tfDir, "variables.tf");
      const content = fs.readFileSync(varsPath, "utf-8");

      expect(content).toMatch(/variable\s+"production_branch"/);
      expect(content).toMatch(/default\s*=\s*"main"/);
    });

    it("r2_cors_allowed_origins 変数が 'https://rss-news.rikiyaota.kyoto' を含むリストとして定義されていること", () => {
      const varsPath = path.join(tfDir, "variables.tf");
      const content = fs.readFileSync(varsPath, "utf-8");

      expect(content).toMatch(/variable\s+"r2_cors_allowed_origins"/);
      expect(content).toMatch(/https:\/\/rss-news\.rikiyaota\.kyoto/);
    });
  });

  describe("outputs.tf の出力定義検証", () => {
    it("outputs.tf が存在すること", () => {
      const outputsPath = path.join(tfDir, "outputs.tf");
      expect(fs.existsSync(outputsPath)).toBe(true);
    });

    it("r2_bucket_name 出力が定義されていること", () => {
      const outputsPath = path.join(tfDir, "outputs.tf");
      const content = fs.readFileSync(outputsPath, "utf-8");

      expect(content).toMatch(/output\s+"r2_bucket_name"/);
      expect(content).toMatch(/value\s*=\s*cloudflare_r2_bucket\.data\.(name|id)/);
    });

    it("pages_project_name 出力が定義されていること", () => {
      const outputsPath = path.join(tfDir, "outputs.tf");
      const content = fs.readFileSync(outputsPath, "utf-8");

      expect(content).toMatch(/output\s+"pages_project_name"/);
      expect(content).toMatch(/value\s*=\s*cloudflare_pages_project\.site\.name/);
    });

    it("pages_subdomain 出力が定義されていること", () => {
      const outputsPath = path.join(tfDir, "outputs.tf");
      const content = fs.readFileSync(outputsPath, "utf-8");

      expect(content).toMatch(/output\s+"pages_subdomain"/);
      expect(content).toMatch(/value\s*=\s*cloudflare_pages_project\.site\.subdomain/);
    });
  });
});
