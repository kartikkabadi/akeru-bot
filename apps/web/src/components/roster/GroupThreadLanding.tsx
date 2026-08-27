import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { SidebarInset } from "../ui/sidebar";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { BotActivityStatus } from "./BotActivityStatus";
import { BotAvatarView } from "./BotAvatarView";
import { BotConversationScrollArea } from "./BotConversationScrollArea";
import { BotMessageMarkdown } from "./BotMessageMarkdown";
import { visibleBotChatMessages } from "./botConversationPresentation";
import { BotPromptComposer } from "./BotPromptComposer";
import { useGroupPresence } from "./botPresence";
import { useRosterStore } from "./rosterStore";
import { useGroupThreadRuntime } from "./useGroupThreadRuntime";

export function GroupThreadLanding({ groupId }: { readonly groupId: string }) {
  const navigate = useNavigate();
  const group = useRosterStore((state) =>
    state.groups.find((candidate) => candidate.id === groupId),
  );
  const bots = useRosterStore((state) => state.bots);
  const runtime = useGroupThreadRuntime(groupId);
  const presence = useGroupPresence(groupId);

  useEffect(() => {
    if (!group) void navigate({ to: "/", replace: true });
  }, [group, navigate]);

  if (!group) return null;
  const members = bots.filter((bot) => bot.groupId === group.id && bot.archivedAt === null);
  const boss = members.find((bot) => bot.id === group.bossBotId) ?? members[0];
  if (!boss) return null;
  const working = runtime.sending || presence === "working";
  const messages = visibleBotChatMessages(runtime.messages, working);
  const activeBot = members.find((bot) => bot.id === runtime.respondingBotId) ?? boss;

  return (
    <SidebarInset
      aria-label={`${group.name} group thread`}
      className="h-dvh min-h-0 overflow-hidden bg-background text-foreground"
      data-testid="group-thread-landing"
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <WorkspacePageHeader className="border-b border-border">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex -space-x-1.5">
              {members.slice(0, 3).map((bot) => (
                <BotAvatarView
                  key={bot.id}
                  avatar={bot.avatar}
                  name={bot.name}
                  className="size-6 ring-2 ring-background"
                />
              ))}
            </div>
            <span className="truncate text-sm font-medium">{group.name}</span>
          </div>
        </WorkspacePageHeader>
        <BotConversationScrollArea>
          {messages.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 py-12">
              <div className="flex -space-x-3">
                {members.slice(0, 3).map((bot) => (
                  <BotAvatarView
                    key={bot.id}
                    avatar={bot.avatar}
                    name={bot.name}
                    className="size-14 ring-4 ring-background"
                  />
                ))}
              </div>
              <h1 className="text-lg font-medium">Message {group.name}</h1>
            </div>
          ) : (
            messages.map((message) => {
              if (message.role === "assistant") {
                const respondingBot =
                  members.find((bot) => bot.id === message.respondingBotId) ?? boss;
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
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{respondingBot.name}</div>
                      <BotMessageMarkdown
                        cwd={runtime.defaultProject?.workspaceRoot}
                        text={message.text}
                        threadRef={runtime.linkedThreadRef ?? undefined}
                      />
                    </div>
                  </div>
                );
              }
              return (
                <div key={message.id} className="flex justify-end" data-testid="group-user-message">
                  <div className="max-w-[78%] rounded-2xl bg-foreground/10 px-3.5 py-2 text-sm leading-6">
                    <p className="whitespace-pre-wrap">{message.text}</p>
                  </div>
                </div>
              );
            })
          )}
          {working ? <BotActivityStatus avatar={activeBot.avatar} name={activeBot.name} /> : null}
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
          botName={group.name}
          draftKey={`group:${group.id}`}
          disabled={
            runtime.sending ||
            !runtime.groupReady ||
            !runtime.bootstrapped ||
            runtime.defaultProject === null
          }
          mentionBots={members.map((bot) => ({ id: bot.id, name: bot.name }))}
          modelPicker={null}
          onSubmit={runtime.send}
        />
      </div>
    </SidebarInset>
  );
}
