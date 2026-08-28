import { AuthStorage } from "@mastra/code-sdk/auth/storage";
import { openaiCodexProvider } from "@mastra/code-sdk/providers/openai-codex";
import type { ToolsInput } from "@mastra/core/agent";
import {
  AgentController as MastraAgentController,
  type Session,
} from "@mastra/core/agent-controller";
import { createCodingAgent } from "@mastra/core/coding-agent";
import type { RequestContext } from "@mastra/core/request-context";
import { createWorkspaceTools, type Workspace } from "@mastra/core/workspace";

import { AKERU_AGENT_INSTRUCTIONS, AKERU_BOT_INSTRUCTIONS } from "./AkeruAgentInstructions.ts";

const DEFAULT_MODEL_ID = "openai/gpt-5.6-sol";

export interface AkeruMastraState {
  readonly projectPath?: string;
  readonly yolo?: boolean;
  readonly botConversation?: boolean;
}

export type AkeruMastraSession = Session<AkeruMastraState>;

export interface AkeruMastraHarnessOptions {
  readonly authStorage: AuthStorage;
  readonly getThreadTools: (threadId: string) => ToolsInput;
  readonly getThreadWorkspace: (threadId: string) => Workspace | undefined;
}

export interface AkeruMastraHarness {
  readonly controller: Pick<
    MastraAgentController<AkeruMastraState>,
    "init" | "createSession" | "deleteSession" | "destroy"
  >;
  readonly destroy: () => void;
}

function controllerContext(requestContext: RequestContext): Record<string, unknown> | undefined {
  const value = requestContext.getRaw("controller");
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function controllerModelId(requestContext: RequestContext): string {
  const value = controllerContext(requestContext);
  if (!value || !("session" in value)) return DEFAULT_MODEL_ID;
  const session = value.session;
  if (typeof session !== "object" || session === null || !("modelId" in session)) {
    return DEFAULT_MODEL_ID;
  }
  return typeof session.modelId === "string" ? session.modelId : DEFAULT_MODEL_ID;
}

function controllerResourceId(requestContext: RequestContext): string | undefined {
  const value = controllerContext(requestContext)?.resourceId;
  return typeof value === "string" ? value : undefined;
}

export function resolveAkeruInstructions(requestContext: RequestContext): string {
  const state = controllerContext(requestContext)?.state;
  return typeof state === "object" &&
    state !== null &&
    "botConversation" in state &&
    state.botConversation === true
    ? AKERU_BOT_INSTRUCTIONS
    : AKERU_AGENT_INSTRUCTIONS;
}

function codexModelName(modelId: string): string {
  return modelId.startsWith("openai/") ? modelId.slice("openai/".length) : modelId;
}

export async function resolveAkeruTools(
  requestContext: RequestContext,
  options: AkeruMastraHarnessOptions,
): Promise<ToolsInput> {
  const threadId = controllerResourceId(requestContext);
  if (!threadId) return {};
  const workspace = options.getThreadWorkspace(threadId);
  const workspaceTools = workspace
    ? await createWorkspaceTools(workspace, {
        requestContext: Object.fromEntries(requestContext.entries()),
        workspace,
      })
    : {};
  return { ...workspaceTools, ...options.getThreadTools(threadId) };
}

function toolCategory(toolName: string): "read" | "edit" | "execute" | "mcp" | "other" {
  if (/read|view|grep|search|find|list|stat/i.test(toolName)) return "read";
  if (/edit|write|delete|mkdir|move|rename/i.test(toolName)) return "edit";
  if (/execute|command|shell|process|terminal/i.test(toolName)) return "execute";
  if (/mcp/i.test(toolName)) return "mcp";
  return "other";
}

export async function createAkeruMastraHarness(
  options: AkeruMastraHarnessOptions,
): Promise<AkeruMastraHarness> {
  const agent = createCodingAgent({
    id: "akeru-agent",
    name: "Akeru",
    instructions: ({ requestContext }) => resolveAkeruInstructions(requestContext),
    model: ({ requestContext }) =>
      openaiCodexProvider(codexModelName(controllerModelId(requestContext)), {
        authStorage: options.authStorage,
      }),
    tools: ({ requestContext }) => resolveAkeruTools(requestContext, options),
    workspace: undefined,
  });

  const controller = new MastraAgentController<AkeruMastraState>({
    id: "akeru-codex",
    agent,
    modes: [
      { id: "build", name: "Build", defaultModelId: DEFAULT_MODEL_ID },
      {
        id: "plan",
        name: "Plan",
        defaultModelId: DEFAULT_MODEL_ID,
        instructions: "Inspect and explain. Do not change files or run mutating commands.",
      },
    ],
    defaultModeId: "build",
    disableBuiltinTools: [
      "submit_plan",
      "task_write",
      "task_update",
      "task_complete",
      "task_check",
      "subagent",
    ],
    toolCategoryResolver: toolCategory,
    intervalHandlers: [],
  });

  return {
    controller,
    destroy: () => undefined,
  };
}
