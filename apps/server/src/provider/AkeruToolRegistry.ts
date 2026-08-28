// @effect-diagnostics globalFetch:off globalTimers:off nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeDnsPromises from "node:dns/promises";
import * as NodeFSP from "node:fs/promises";
import * as NodeHttp from "node:http";
import * as NodeHttps from "node:https";
import * as NodeNet from "node:net";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";

import type { RuntimeMode, UserInputQuestion } from "@t3tools/contracts";

export type AkeruToolCategory = "read" | "edit" | "execute" | "ask" | "mcp" | "external";

export interface AkeruToolContext {
  readonly signal: AbortSignal;
  readonly askUser: (questions: readonly UserInputQuestion[]) => Promise<unknown>;
}

export interface AkeruToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly category: AkeruToolCategory;
  readonly execute: (input: unknown, context: AkeruToolContext) => Promise<unknown>;
}

export interface AkeruToolProvider {
  readonly tools: (signal?: AbortSignal) => Promise<readonly AkeruToolDefinition[]>;
  readonly close?: () => Promise<void>;
}

export type AkeruPermissionDecision = "allow" | "ask" | "deny";

export function decideAkeruToolPermission(input: {
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: "default" | "plan";
  readonly category: AkeruToolCategory;
  readonly sessionAllowed?: boolean;
}): AkeruPermissionDecision {
  if (
    input.interactionMode === "plan" &&
    (input.category === "edit" || input.category === "execute")
  ) {
    return "deny";
  }
  if (input.sessionAllowed) return "allow";
  if (input.runtimeMode === "full-access" || input.runtimeMode === "auto") return "allow";
  if (input.category === "read" || input.category === "ask") return "allow";
  if (input.runtimeMode === "auto-accept-edits" && input.category === "edit") return "allow";
  return "ask";
}

function recordInput(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Tool input must be an object.");
  }
  return input as Record<string, unknown>;
}

function requiredString(input: Record<string, unknown>, name: string): string {
  const value = input[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value;
}

export async function resolveAkeruWorkspacePath(
  root: string,
  requestedPath: string,
): Promise<string> {
  const canonicalRoot = await NodeFSP.realpath(root);
  const candidate = NodePath.resolve(canonicalRoot, requestedPath);
  const canonicalCandidate = await NodeFSP.realpath(candidate);
  if (
    canonicalCandidate !== canonicalRoot &&
    !canonicalCandidate.startsWith(`${canonicalRoot}${NodePath.sep}`)
  ) {
    throw new Error("Path is outside the active workspace.");
  }
  return canonicalCandidate;
}

const READ_MAX_BYTES = 50 * 1024;
const READ_DEFAULT_LINES = 2_000;

export function createReadTool(cwd: string): AkeruToolDefinition {
  return {
    name: "Read",
    description: "Read a bounded range of lines from one file in the active workspace.",
    category: "read",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["path"],
      properties: {
        path: { type: "string", description: "Workspace-relative file path." },
        offset: { type: "integer", minimum: 1, description: "First line, starting at 1." },
        limit: { type: "integer", minimum: 1, maximum: READ_DEFAULT_LINES },
      },
    },
    execute: async (rawInput) => {
      const input = recordInput(rawInput);
      const path = await resolveAkeruWorkspacePath(cwd, requiredString(input, "path"));
      const offset =
        typeof input.offset === "number" && Number.isInteger(input.offset) && input.offset > 0
          ? input.offset
          : 1;
      const limit =
        typeof input.limit === "number" && Number.isInteger(input.limit) && input.limit > 0
          ? Math.min(input.limit, READ_DEFAULT_LINES)
          : READ_DEFAULT_LINES;
      const file = await NodeFSP.readFile(path);
      if (file.includes(0)) throw new Error("Read supports text files only.");
      const lines = file.toString("utf8").split("\n");
      const selected = lines.slice(offset - 1, offset - 1 + limit).join("\n");
      const body =
        Buffer.byteLength(selected) > READ_MAX_BYTES
          ? Buffer.from(selected).subarray(0, READ_MAX_BYTES).toString("utf8")
          : selected;
      return {
        path,
        offset,
        content: body,
        truncated: body !== selected || offset - 1 + limit < lines.length,
        totalLines: lines.length,
      };
    },
  };
}

const SHELL_MAX_OUTPUT_BYTES = 50 * 1024;
const SHELL_DEFAULT_TIMEOUT_MS = 120_000;

export function createShellTool(cwd: string, platform: NodeJS.Platform): AkeruToolDefinition {
  return {
    name: "Shell",
    description: "Run one shell command in the active workspace and return bounded output.",
    category: "execute",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["command"],
      properties: {
        command: { type: "string" },
        timeoutMs: { type: "integer", minimum: 1, maximum: SHELL_DEFAULT_TIMEOUT_MS },
      },
    },
    execute: async (rawInput, context) => {
      if (context.signal.aborted) {
        throw context.signal.reason ?? new Error("Command interrupted.");
      }
      const input = recordInput(rawInput);
      const command = requiredString(input, "command");
      const timeoutMs =
        typeof input.timeoutMs === "number" && Number.isInteger(input.timeoutMs)
          ? Math.min(Math.max(1, input.timeoutMs), SHELL_DEFAULT_TIMEOUT_MS)
          : SHELL_DEFAULT_TIMEOUT_MS;
      return await new Promise((resolve, reject) => {
        const detached = platform !== "win32";
        const child = NodeChildProcess.spawn(command, {
          cwd,
          shell: true,
          stdio: ["ignore", "pipe", "pipe"],
          detached,
        });
        let stdout = Buffer.alloc(0);
        let stderr = Buffer.alloc(0);
        let timedOut = false;
        let killTimer: NodeJS.Timeout | undefined;
        const append = (current: Buffer, chunk: Buffer) =>
          Buffer.concat([current, chunk]).subarray(0, SHELL_MAX_OUTPUT_BYTES);
        child.stdout.on("data", (chunk: Buffer) => {
          stdout = append(stdout, chunk);
        });
        child.stderr.on("data", (chunk: Buffer) => {
          stderr = append(stderr, chunk);
        });
        const kill = (signal: NodeJS.Signals) => {
          if (child.pid && detached) {
            try {
              NodeProcess.kill(-child.pid, signal);
            } catch {
              // The process group already exited.
            }
          } else {
            child.kill(signal);
          }
        };
        const terminate = () => {
          kill("SIGTERM");
          killTimer ??= setTimeout(() => kill("SIGKILL"), 1_000);
        };
        const timer = setTimeout(() => {
          timedOut = true;
          terminate();
        }, timeoutMs);
        const abort = () => terminate();
        context.signal.addEventListener("abort", abort, { once: true });
        child.once("error", (error) => {
          clearTimeout(timer);
          if (killTimer) clearTimeout(killTimer);
          context.signal.removeEventListener("abort", abort);
          reject(error);
        });
        child.once("close", (exitCode, signal) => {
          clearTimeout(timer);
          if (killTimer) clearTimeout(killTimer);
          context.signal.removeEventListener("abort", abort);
          if (context.signal.aborted) {
            reject(context.signal.reason ?? new Error("Command interrupted."));
            return;
          }
          resolve({
            command,
            exitCode,
            signal,
            timedOut,
            stdout: stdout.toString("utf8"),
            stderr: stderr.toString("utf8"),
            truncated:
              stdout.byteLength >= SHELL_MAX_OUTPUT_BYTES ||
              stderr.byteLength >= SHELL_MAX_OUTPUT_BYTES,
          });
        });
      });
    },
  };
}

function privateIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) return true;
  return (
    octets[0] === 0 ||
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && (octets[1] ?? 0) >= 16 && (octets[1] ?? 0) <= 31) ||
    (octets[0] === 192 && octets[1] === 168) ||
    (octets[0] ?? 0) >= 224
  );
}

function privateIp(address: string): boolean {
  if (NodeNet.isIPv4(address)) return privateIpv4(address);
  const normalized = address.toLowerCase();
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    (normalized.startsWith("::ffff:") && privateIpv4(normalized.slice("::ffff:".length)))
  );
}

export async function validateAkeruPublicUrl(value: string): Promise<URL> {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("WebFetch supports HTTP and HTTPS URLs only.");
  }
  if (url.username || url.password) throw new Error("WebFetch URLs cannot contain credentials.");
  if (url.hostname === "localhost" || url.hostname.endsWith(".localhost")) {
    throw new Error("WebFetch cannot access local network addresses.");
  }
  const addresses = NodeNet.isIP(url.hostname)
    ? [{ address: url.hostname }]
    : await NodeDnsPromises.lookup(url.hostname, { all: true });
  if (addresses.length === 0 || addresses.some(({ address }) => privateIp(address))) {
    throw new Error("WebFetch cannot access local network addresses.");
  }
  return url;
}

const WEB_FETCH_MAX_BYTES = 100 * 1024;

async function fetchPinnedPublicUrl(url: URL, signal: AbortSignal): Promise<Response> {
  if (signal.aborted) throw signal.reason ?? new Error("WebFetch interrupted.");
  const addresses = NodeNet.isIP(url.hostname)
    ? [{ address: url.hostname, family: NodeNet.isIPv4(url.hostname) ? 4 : 6 }]
    : await NodeDnsPromises.lookup(url.hostname, { all: true });
  if (addresses.length === 0 || addresses.some(({ address }) => privateIp(address))) {
    throw new Error("WebFetch cannot access local network addresses.");
  }
  const target = addresses[0];
  if (!target) throw new Error("WebFetch could not resolve the requested host.");

  return new Promise<Response>((resolve, reject) => {
    const transport = url.protocol === "https:" ? NodeHttps : NodeHttp;
    const request = transport.request(
      url,
      {
        method: "GET",
        headers: { Accept: "text/plain, text/markdown, text/html, application/json" },
        lookup: (_hostname, _options, callback) =>
          callback(null, target.address, target.family as 4 | 6),
      },
      (response) => {
        const chunks: Uint8Array[] = [];
        let byteLength = 0;
        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          const body = Buffer.concat(chunks, byteLength);
          const headers = new Headers();
          for (const [name, value] of Object.entries(response.headers)) {
            if (Array.isArray(value)) for (const item of value) headers.append(name, item);
            else if (value !== undefined) headers.set(name, String(value));
          }
          const status = response.statusCode ?? 500;
          resolve(
            new Response(status === 204 || status === 205 || status === 304 ? null : body, {
              status,
              ...(response.statusMessage ? { statusText: response.statusMessage } : {}),
              headers,
            }),
          );
        };
        response.on("data", (value: Buffer) => {
          const remaining = WEB_FETCH_MAX_BYTES + 1 - byteLength;
          if (remaining <= 0) return;
          const chunk = value.subarray(0, remaining);
          chunks.push(chunk);
          byteLength += chunk.byteLength;
          if (byteLength > WEB_FETCH_MAX_BYTES) {
            finish();
            response.destroy();
          }
        });
        response.once("error", (cause) => {
          if (!finished) reject(cause);
        });
        response.once("aborted", () => {
          if (!finished) reject(new Error("WebFetch response ended early."));
        });
        response.once("end", finish);
      },
    );
    const timeout = setTimeout(() => request.destroy(new Error("WebFetch timed out.")), 30_000);
    const abort = () => request.destroy(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    request.once("close", () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    });
    request.once("error", reject);
    request.end();
  });
}

export function createWebFetchTool(fetchImpl?: typeof fetch): AkeruToolDefinition {
  return {
    name: "WebFetch",
    description: "Fetch bounded text content from a public HTTP or HTTPS URL.",
    category: "external",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["url"],
      properties: { url: { type: "string", format: "uri" } },
    },
    execute: async (rawInput, context) => {
      if (context.signal.aborted) {
        throw context.signal.reason ?? new Error("WebFetch interrupted.");
      }
      const input = recordInput(rawInput);
      let url = await validateAkeruPublicUrl(requiredString(input, "url"));
      for (let redirect = 0; redirect <= 5; redirect += 1) {
        const response = fetchImpl
          ? await fetchImpl(url, {
              redirect: "manual",
              signal: context.signal,
              headers: { Accept: "text/plain, text/markdown, text/html, application/json" },
            })
          : await fetchPinnedPublicUrl(url, context.signal);
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          if (!location) throw new Error("WebFetch received a redirect without a location.");
          url = await validateAkeruPublicUrl(new URL(location, url).toString());
          continue;
        }
        const contentType = response.headers.get("content-type") ?? "";
        if (!/(?:text\/|application\/(?:json|xml|xhtml\+xml))/i.test(contentType)) {
          throw new Error(`WebFetch does not support content type '${contentType || "unknown"}'.`);
        }
        const reader = response.body?.getReader();
        const chunks: Uint8Array[] = [];
        let byteLength = 0;
        let wasTruncated = false;
        if (reader) {
          while (byteLength <= WEB_FETCH_MAX_BYTES) {
            const next = await reader.read();
            if (next.done) break;
            const remaining = WEB_FETCH_MAX_BYTES + 1 - byteLength;
            const chunk = next.value.subarray(0, remaining);
            chunks.push(chunk);
            byteLength += chunk.byteLength;
            if (chunk.byteLength < next.value.byteLength || byteLength > WEB_FETCH_MAX_BYTES) {
              wasTruncated = true;
              await reader.cancel();
              break;
            }
          }
        }
        const bytes = new Uint8Array(byteLength);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        const bounded = bytes.subarray(0, WEB_FETCH_MAX_BYTES);
        return {
          url: url.toString(),
          status: response.status,
          contentType,
          content: new TextDecoder().decode(bounded),
          truncated: wasTruncated,
        };
      }
      throw new Error("WebFetch followed too many redirects.");
    },
  };
}

export function createAskUserTool(): AkeruToolDefinition {
  return {
    name: "AskUser",
    description: "Ask the user one structured question and wait for the answer.",
    category: "ask",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["question"],
      properties: {
        question: { type: "string" },
        header: { type: "string" },
        options: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["label"],
            properties: {
              label: { type: "string" },
              description: { type: "string" },
            },
          },
        },
        multiSelect: { type: "boolean" },
      },
    },
    execute: async (rawInput, context) => {
      const input = recordInput(rawInput);
      const question = requiredString(input, "question");
      const options = Array.isArray(input.options)
        ? input.options.flatMap((candidate) => {
            if (typeof candidate !== "object" || candidate === null) return [];
            const option = candidate as Record<string, unknown>;
            if (typeof option.label !== "string" || option.label.trim().length === 0) return [];
            return [
              {
                label: option.label.trim(),
                description:
                  typeof option.description === "string" && option.description.trim().length > 0
                    ? option.description.trim()
                    : option.label.trim(),
              },
            ];
          })
        : [];
      return context.askUser([
        {
          id: "question",
          header:
            typeof input.header === "string" && input.header.trim().length > 0
              ? input.header.trim()
              : "Question",
          question,
          options,
          multiSelect: input.multiSelect === true,
        },
      ]);
    },
  };
}

export async function createAkeruToolRegistry(input: {
  readonly platform: NodeJS.Platform;
  readonly cwd?: string;
  readonly providers?: readonly AkeruToolProvider[];
  readonly fetch?: typeof fetch;
  readonly signal?: AbortSignal;
}): Promise<{
  readonly tools: ReadonlyMap<string, AkeruToolDefinition>;
  readonly close: () => Promise<void>;
}> {
  const definitions = [
    ...(input.cwd ? [createReadTool(input.cwd), createShellTool(input.cwd, input.platform)] : []),
    createWebFetchTool(input.fetch),
    createAskUserTool(),
  ];
  try {
    for (const provider of input.providers ?? []) {
      definitions.push(...(await provider.tools(input.signal)));
    }
  } catch (cause) {
    await Promise.allSettled((input.providers ?? []).map((provider) => provider.close?.()));
    throw cause;
  }
  const tools = new Map<string, AkeruToolDefinition>();
  for (const definition of definitions) {
    if (tools.has(definition.name)) {
      await Promise.allSettled((input.providers ?? []).map((provider) => provider.close?.()));
      throw new Error(`Duplicate Akeru tool '${definition.name}'.`);
    }
    tools.set(definition.name, definition);
  }
  return {
    tools,
    close: async () => {
      await Promise.all((input.providers ?? []).map((provider) => provider.close?.()));
    },
  };
}
