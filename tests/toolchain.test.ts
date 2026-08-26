import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("ツールチェーンおよびワークスペース初期設定の検証", () => {
  const rootDir = path.resolve(__dirname, "..");

  it("mise.toml が正しく設定されていること", () => {
    const misePath = path.join(rootDir, "mise.toml");
    expect(fs.existsSync(misePath)).toBe(true);
    const content = fs.readFileSync(misePath, "utf-8");
    expect(content).toContain('node = "24.19.0"');
    expect(content).toContain('pnpm = "11.22.0"');
    expect(content).toContain('terraform = "1.15.8"');
    expect(content).toContain('"github:suzuki-shunsuke/pinact" = "4.0.0"');
  });

  it("pnpm-workspace.yaml に 7日間のリリース待機設定が定義されていること", () => {
    const wsPath = path.join(rootDir, "pnpm-workspace.yaml");
    expect(fs.existsSync(wsPath)).toBe(true);
    const content = fs.readFileSync(wsPath, "utf-8");
    expect(content).toContain("minimumReleaseAge: 10080");
    expect(content).toContain("minimumReleaseAgeStrict: true");
  });

  it("package.json に必要なスクリプトおよび依存パッケージが定義されていること", () => {
    const pkgPath = path.join(rootDir, "package.json");
    expect(fs.existsSync(pkgPath)).toBe(true);
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));

    expect(pkg.name).toBe("rss-news-site");
    expect(pkg.private).toBe(true);
    expect(pkg.type).toBe("module");

    // スクリプト検証
    expect(pkg.scripts.dev).toBeDefined();
    expect(pkg.scripts.build).toBeDefined();
    expect(pkg.scripts.test).toBe("vitest run");
    expect(pkg.scripts["test:coverage"]).toBe("vitest run --coverage");
    expect(pkg.scripts.pipeline).toBeDefined();
    expect(pkg.scripts.typecheck).toBe("tsc --noEmit");
    expect(pkg.scripts.pinact).toBeDefined();

    // 依存関係検証
    const deps = pkg.dependencies;
    expect(deps["@aws-sdk/client-s3"]).toBeUndefined();
    expect(deps["@huggingface/transformers"]).toBeDefined();
    expect(deps["better-sqlite3"]).toBeDefined();
    expect(deps["react"]).toBeDefined();
    expect(deps["hono"]).toBeDefined();

    // 開発依存関係検証
    const devDeps = pkg.devDependencies;
    expect(devDeps["vitest"]).toBeDefined();
    expect(devDeps["@vitest/coverage-v8"]).toBeDefined();
    expect(devDeps["typescript"]).toBeDefined();
    expect(devDeps["vite"]).toBeDefined();
  });

  it("better-sqlite3 が Node-API 移行済みの v13 以降に固定されていること", () => {
    // better-sqlite3 v12 以前は生の V8 API (node::ObjectWrap) を利用しており、
    // C++ オブジェクトの破棄時に node::RemoveEnvironmentCleanupHook() を呼び出す。
    // この関数は v8::Context に入っていない状態で GC が走ると
    // 「Assertion failed: (env) != nullptr」で abort (exit code 134) するため、
    // Node-API (Napi::ObjectWrap) へ移行した v13 以降を必須とする。
    const pkgPath = path.join(rootDir, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));

    const range: string = pkg.dependencies["better-sqlite3"];
    expect(range).toBeDefined();

    const major = Number(range.replace(/^[^0-9]*/, "").split(".")[0]);
    expect(Number.isNaN(major)).toBe(false);
    expect(major).toBeGreaterThanOrEqual(13);
  });

  it("tsconfig.json のエイリアス設定および設定値が正しいこと", () => {
    const tsconfigPath = path.join(rootDir, "tsconfig.json");
    expect(fs.existsSync(tsconfigPath)).toBe(true);
    const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, "utf-8"));

    expect(tsconfig.compilerOptions.paths["@/*"]).toEqual(["./src/*"]);
    expect(tsconfig.compilerOptions.moduleResolution).toBe("bundler");
    expect(tsconfig.compilerOptions.strict).toBe(true);
  });

  it("Vite、Vitest、Tailwind CSS の設定ファイルが存在すること", () => {
    expect(fs.existsSync(path.join(rootDir, "vite.config.ts"))).toBe(true);
    expect(fs.existsSync(path.join(rootDir, "vitest.config.ts"))).toBe(true);
    expect(fs.existsSync(path.join(rootDir, "postcss.config.js"))).toBe(true);
    expect(fs.existsSync(path.join(rootDir, "tailwind.config.js"))).toBe(true);
  });
});
