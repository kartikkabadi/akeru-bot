// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import {
  discoverLocalSubscriptionClis,
  resolveLocalCommand,
} from "./LocalSubscriptionCliDiscovery.ts";

describe("local subscription CLI discovery", () => {
  it("finds executable subscription CLIs on PATH", () => {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "akeru-cli-discovery-"));
    const codexPath = NodePath.join(directory, "codex");
    const cursorPath = NodePath.join(directory, "cursor-agent");
    NodeFS.writeFileSync(codexPath, "#!/bin/sh\n");
    NodeFS.writeFileSync(cursorPath, "#!/bin/sh\n");
    NodeFS.chmodSync(codexPath, 0o755);
    NodeFS.chmodSync(cursorPath, 0o755);

    try {
      const statuses = discoverLocalSubscriptionClis(directory, "darwin");
      expect(statuses.find((entry) => entry.id === "codex")).toMatchObject({
        state: "detected",
        command: "codex",
        resolvedPath: codexPath,
      });
      expect(statuses.find((entry) => entry.id === "cursor")).toMatchObject({
        state: "detected",
        command: "cursor-agent",
        resolvedPath: cursorPath,
      });
      expect(statuses.find((entry) => entry.id === "gemini")).toMatchObject({
        state: "missing",
        command: "gemini",
      });
    } finally {
      NodeFS.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("does not treat a non-executable file as an installed CLI", () => {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "akeru-cli-mode-"));
    const claudePath = NodePath.join(directory, "claude");
    NodeFS.writeFileSync(claudePath, "not executable");
    NodeFS.chmodSync(claudePath, 0o600);

    try {
      expect(
        resolveLocalCommand({ commands: ["claude"], pathValue: directory, platform: "darwin" }),
      ).toBeUndefined();
    } finally {
      NodeFS.rmSync(directory, { recursive: true, force: true });
    }
  });
});
