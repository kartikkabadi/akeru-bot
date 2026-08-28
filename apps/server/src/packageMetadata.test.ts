// @effect-diagnostics nodeBuiltinImport:off - package metadata guard reads repository files.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { assert, it } from "@effect/vitest";

import packageJson from "../package.json" with { type: "json" };

const repoRoot = NodePath.resolve(import.meta.dirname, "../../..");

const packageCallerFiles = [
  ".github/ISSUE_TEMPLATE/via-triage.yml",
  ".github/workflows/ci.yml",
  ".github/workflows/desktop-macos-preview.yml",
  ".github/workflows/mobile-showcase-screenshots.yml",
  ".github/workflows/release.yml",
  ".github/workflows/web-preview.yml",
  "package.json",
  "scripts/dev-runner.ts",
  "apps/server/scripts/cli.ts",
  "apps/server/src/bin.test.ts",
  "apps/server/src/serviceLauncher.ts",
  "apps/server/src/cloud/pinnedRuntime.ts",
  "apps/server/src/cloud/selfUpdate.ts",
  "apps/server/src/cloud/bootService.ts",
  "apps/server/src/cloud/serviceLauncherClient.ts",
  "apps/server/src/cli/pair.ts",
  "apps/server/src/cli/triage.ts",
  "apps/server/src/cli/triagePrompt.ts",
  "apps/server/src/cli/project.ts",
  "apps/server/src/terminal/BunPtyAdapter.ts",
  "packages/ssh/src/command.ts",
  "packages/ssh/src/tunnel.ts",
  "packages/client-runtime/src/state/server.ts",
  "apps/web/src/versionSkew.ts",
  "apps/web/src/components/ServerUpdateAction.tsx",
  "docs/internals/scripts.md",
  "docs/internals/server-updates.md",
  "docs/internals/workspace-layout.md",
  "docs/operations/observability.md",
  "docs/operations/release.md",
  "docs/user/background-service.md",
  "docs/user/install.md",
  "docs/user/remote-access.md",
  "docs/user/updating.md",
] as const;

const stalePackageCallerPatterns = [
  /--filter(?:=|\s+)["']?!?t3(?:\.\.\.)?(?=["'\s]|$)/,
  /\bt3@(?:<|\$\{|latest|nightly|\d)/,
  /\bnpx t3\b/,
  /["']node_modules["']\s*,\s*["']t3["']/,
  /\b(?:exec|command -v) t3\b/,
  /\bt3 (?:auth|pair|project cli|service|serve|triage)\b/,
  /npm package `t3`/,
  /\bt3 (?:build task|version)\b/,
  /\bkill `t3` processes\b/,
] as const;

const listTypeScriptFiles = (directory: string): ReadonlyArray<string> =>
  NodeFS.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = NodePath.join(directory, entry.name);
    if (entry.isDirectory()) return listTypeScriptFiles(path);
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  });

it("publishes the Akeru Bot package with only the akeru bin", () => {
  assert.equal(packageJson.name, "akeru-bot");
  assert.deepEqual(packageJson.bin, { akeru: "./dist/bin.mjs" });
  assert.deepEqual(packageJson.repository, {
    type: "git",
    url: "https://github.com/opencoredev/akeru-bot",
    directory: "apps/server",
  });
});

it("has no stale t3 package, workspace, runtime, or CLI callers", () => {
  const violations = packageCallerFiles.flatMap((relativePath) => {
    const contents = NodeFS.readFileSync(NodePath.join(repoRoot, relativePath), "utf8").replaceAll(
      "npx t3 connect",
      "",
    );
    return stalePackageCallerPatterns
      .filter((pattern) => pattern.test(contents))
      .map((pattern) => `${relativePath}: ${String(pattern)}`);
  });

  assert.deepEqual(violations, []);
});

it("uses the akeru-bot deterministic Effect key root across the server package", () => {
  const stalePrefix = '"t3/';
  const currentTest = NodePath.resolve(import.meta.dirname, "packageMetadata.test.ts");
  const violations = listTypeScriptFiles(NodePath.join(repoRoot, "apps/server"))
    .filter((path) => path !== currentTest)
    .filter((path) => NodeFS.readFileSync(path, "utf8").includes(stalePrefix))
    .map((path) => NodePath.relative(repoRoot, path));

  assert.deepEqual(violations, []);
});
