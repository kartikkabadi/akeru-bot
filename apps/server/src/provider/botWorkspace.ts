import { TOOL_NAME_OVERRIDES } from "@mastra/code-sdk/tool-names";
import { LocalFilesystem, LocalSandbox, Workspace } from "@mastra/core/workspace";
import type {
  CloudSandboxProvider,
  ProviderInstanceEnvironmentVariable,
  SandboxProvider,
  SandboxSettings,
} from "@t3tools/contracts";

export type RemoteBotSandbox = CloudSandboxProvider;

export function isRemoteBotSandbox(
  value: SandboxProvider | null | undefined,
): value is RemoteBotSandbox {
  return value === "e2b" || value === "daytona" || value === "vercel" || value === "upstash";
}

export type BotWorkspaceIdentity =
  | { readonly defaultProvider: "local" }
  | {
      readonly defaultProvider: RemoteBotSandbox;
      readonly environment: ReadonlyArray<{ readonly name: string; readonly value: string }>;
    };

export function sandboxSessionIdentity(settings: SandboxSettings): BotWorkspaceIdentity {
  const provider = settings.defaultProvider;
  if (!isRemoteBotSandbox(provider)) return { defaultProvider: "local" };
  return {
    defaultProvider: provider,
    environment: settings.providers[provider].environment.map(({ name, value }) => ({
      name,
      value,
    })),
  };
}

export interface CreateRemoteBotWorkspaceInput {
  readonly threadId: string;
  readonly sandbox: RemoteBotSandbox;
  readonly environment: ReadonlyArray<ProviderInstanceEnvironmentVariable>;
}

export interface CreateBotWorkspaceInput {
  readonly threadId: string;
  readonly cwd?: string;
  readonly settings: SandboxSettings;
  readonly makeRemoteWorkspace?: (input: CreateRemoteBotWorkspaceInput) => Promise<Workspace>;
}

export async function createBotWorkspace(
  input: CreateBotWorkspaceInput,
): Promise<Workspace | undefined> {
  const sandbox = input.settings.defaultProvider;
  if (isRemoteBotSandbox(sandbox)) {
    return await (input.makeRemoteWorkspace ?? createRemoteMastraWorkspace)({
      threadId: input.threadId,
      sandbox,
      environment: input.settings.providers[sandbox].environment,
    });
  }
  if (!input.cwd) return undefined;
  return new Workspace({
    id: `akeru-${input.threadId}`,
    name: `Akeru ${input.threadId}`,
    filesystem: new LocalFilesystem({ basePath: input.cwd }),
    sandbox: new LocalSandbox({ workingDirectory: input.cwd }),
    tools: TOOL_NAME_OVERRIDES,
  });
}

export async function createRemoteMastraWorkspace(
  input: CreateRemoteBotWorkspaceInput,
): Promise<Workspace> {
  const { createMastraWorkspace } = await import("@opencoredev/sandbox-sdk/mastra");
  return createMastraWorkspace({
    id: `akeru-${input.threadId}`,
    provider: await loadSandboxProvider(input.sandbox, input.environment),
    workspace: {
      id: `akeru-${input.threadId}`,
      name: `Akeru ${input.threadId}`,
      tools: TOOL_NAME_OVERRIDES,
    },
  });
}

export function sandboxProviderOptions(
  sandbox: RemoteBotSandbox,
  environment: ReadonlyArray<ProviderInstanceEnvironmentVariable>,
): Readonly<Record<string, string>> {
  const values = Object.fromEntries(environment.map((variable) => [variable.name, variable.value]));
  switch (sandbox) {
    case "e2b":
      return { apiKey: values.E2B_API_KEY ?? "" };
    case "daytona":
      return { apiKey: values.DAYTONA_API_KEY ?? "" };
    case "vercel":
      return {
        token: values.VERCEL_TOKEN ?? "",
        teamId: values.VERCEL_TEAM_ID ?? "",
        projectId: values.VERCEL_PROJECT_ID ?? "",
      };
    case "upstash":
      return { apiKey: values.UPSTASH_BOX_API_KEY ?? "" };
  }
}

async function loadSandboxProvider(
  sandbox: RemoteBotSandbox,
  environment: ReadonlyArray<ProviderInstanceEnvironmentVariable>,
) {
  const options = sandboxProviderOptions(sandbox, environment);
  if (sandbox === "vercel") {
    const { vercel } = await import("@opencoredev/sandbox-sdk/vercel");
    return vercel({
      token: options.token ?? "",
      teamId: options.teamId ?? "",
      projectId: options.projectId ?? "",
    });
  }
  if (sandbox === "upstash") {
    const { upstash } = await import("@opencoredev/sandbox-sdk/upstash");
    return upstash({ apiKey: options.apiKey ?? "" });
  }
  if (sandbox === "daytona") {
    const { daytona } = await import("@opencoredev/sandbox-sdk/daytona");
    return daytona({ apiKey: options.apiKey ?? "" });
  }
  const { e2b } = await import("@opencoredev/sandbox-sdk/e2b");
  return e2b({ apiKey: options.apiKey ?? "" });
}
