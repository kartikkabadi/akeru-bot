import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";

import { environmentMcpServersAtom } from "../../state/mcpServers";
import { usePrimaryEnvironmentId } from "../../state/environments";

import { SidebarInset } from "../ui/sidebar";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { BotActivityStatus } from "./BotActivityStatus";
import { BotAvatarView } from "./BotAvatarView";
import { BotChoicePrompt } from "./BotChoicePrompt";
import { BotConversationScrollArea } from "./BotConversationScrollArea";
import { BotPromptComposer } from "./BotPromptComposer";
import { splitMentionSegments } from "./groupFanout";
import { useRosterStore } from "./rosterStore";
import { buildBotToolItems } from "./BotToolsSheet";
import { useGroupThreadRuntime } from "./useGroupThreadRuntime";
import { useRosterPendingUserInput } from "./useRosterPendingUserInput";

const NO_ENVIRONMENT = "" as import("@t3tools/contracts").EnvironmentId;

export function GroupThreadLanding({ groupId }: { readonly groupId: string }) {
  const navigate = useNavigate();
  const environmentId = usePrimaryEnvironmentId();
  const mcpServers = useAtomValue(environmentMcpServersAtom(environmentId ?? NO_ENVIRONMENT));
  const mentionPlugins = useMemo(
    () =>
      buildBotToolItems(mcpServers)
        .filter((item) => item.workspaceEnabled)
        .map((item) => ({ id: String(item.id), name: item.name })),
    [mcpServers],
  );
  const group = useRosterStore((state) =>
    state.groups.find((candidate) => candidate.id === groupId),
  );
  const bots = useRosterStore((state) => state.bots);
  const runtime = useGroupThreadRuntime(groupId);
  const pendingInput = useRosterPendingUserInput(runtime.pendingInputRef);
  const pendingUserInput = pendingInput.pendingUserInput;

  useEffect(() => {
    if (!group) void navigate({ to: "/", replace: true });
  }, [group, navigate]);

  if (!group) return null;
  const members = bots.filter((bot) => bot.groupId === group.id && bot.archivedAt === null);
  const boss = members.find((bot) => bot.id === group.bossBotId) ?? members[0];
  if (!boss) return null;
  const messages = runtime.messages;
  const workingMembers = members.filter((bot) => runtime.workingBotIds.includes(bot.id));
  const latestMessage = messages.at(-1);
  const followRevision = latestMessage?.message.role === "user" ? latestMessage.message.id : null;
  const mentionNames = [...members.map((bot) => bot.name), ...mentionPlugins.map((p) => p.name)];

  return (
    <SidebarInset
      aria-label={`${group.name} group thread`}
      className="h-dvh min-h-0 overflow-hidden bg-background text-foreground"
      data-testid="group-thread-landing"
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <WorkspacePageHeader className="border-b border-border">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex -space-x-1">
              {members.slice(0, 3).map((bot) => (
                <BotAvatarView
                  key={bot.id}
                  avatar={bot.avatar}
                  name={bot.name}
                  className="size-6"
                />
              ))}
            </div>
            <span className="truncate text-sm font-medium">{group.name}</span>
          </div>
        </WorkspacePageHeader>
        <BotConversationScrollArea followRevision={followRevision}>
          {messages.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 py-12">
              <div className="flex -space-x-2">
                {members.slice(0, 3).map((bot) => (
                  <BotAvatarView
                    key={bot.id}
                    avatar={bot.avatar}
                    name={bot.name}
                    className="size-14"
                  />
                ))}
              </div>
              <h1 className="text-lg font-medium">Message {group.name}</h1>
            </div>
          ) : (
            messages.map((entry) => {
              const message = entry.message;
              if (message.role === "assistant") {
                // Attribute by the member thread the reply arrived on; the
                // message payload itself does not carry the responder.
                const respondingBot = members.find((bot) => bot.id === entry.botId) ?? boss;
                return (
                  <div
                    key={message.id}
                    className="flex items-start gap-3"
                    data-testid="group-provider-message"
                  >
                    <BotAvatarView
                      avatar={respondingBot.avatar}
                      name={respondingBot.name}
                      className="mt-0.5 size-7 shrink-0"
                    />
                    <div className="min-w-0 max-w-[85%]">
                      <div className="text-sm font-medium">{respondingBot.name}</div>
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-foreground/90">
                        {message.text}
                      </p>
                    </div>
                  </div>
                );
              }
              return (
                <div key={message.id} className="flex justify-end" data-testid="group-user-message">
                  <div className="max-w-[78%] rounded-2xl bg-foreground/10 px-3.5 py-2 text-sm leading-6">
                    <p className="whitespace-pre-wrap">
                      {splitMentionSegments(message.text, mentionNames).map((segment) =>
                        segment.type === "mention" ? (
                          <span
                            key={segment.start}
                            className="rounded bg-primary/20 px-1 font-medium text-primary"
                          >
                            {segment.text}
                          </span>
                        ) : (
                          <span key={segment.start}>{segment.text}</span>
                        ),
                      )}
                    </p>
                  </div>
                </div>
              );
            })
          )}
          {pendingUserInput ? (
            <BotChoicePrompt
              prompt={pendingUserInput}
              responding={pendingInput.responding}
              error={pendingInput.responseError}
              onAnswer={(answers) => pendingInput.respond(pendingUserInput.requestId, answers)}
            />
          ) : null}
          {workingMembers.map((bot) => (
            <BotActivityStatus key={bot.id} avatar={bot.avatar} name={bot.name} />
          ))}
          {runtime.error ? (
            <div
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive"
            >
              {runtime.error}
            </div>
          ) : null}
        </BotConversationScrollArea>
        <BotPromptComposer
          key={group.id}
          botName={group.name}
          draftKey={`group:${group.id}`}
          disabled={
            runtime.sending ||
            pendingUserInput !== null ||
            !runtime.groupReady ||
            !runtime.bootstrapped ||
            runtime.defaultProject === null
          }
          mentionBots={members.map((bot) => ({ id: bot.id, name: bot.name, avatar: bot.avatar }))}
          mentionPlugins={mentionPlugins}
          onSubmit={runtime.send}
        />
      </div>
    </SidebarInset>
  );
}
