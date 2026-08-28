import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";

import { usePrimarySettings } from "../../hooks/useSettings";
import { resolveAppModelSelectionState } from "../../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { primaryServerProvidersAtom } from "../../state/server";
import { useThreadActivities, useThreadShell } from "../../state/entities";
import { SidebarInset } from "../ui/sidebar";
import ChatMarkdown from "../ChatMarkdown";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { BotActivityStatus } from "./BotActivityStatus";
import { BotAvatarView } from "./BotAvatarView";
import { BotChoicePrompt } from "./BotChoicePrompt";
import { BotConversationScrollArea } from "./BotConversationScrollArea";
import {
  botAwaitsReply,
  latestTurnFailureDetail,
  visibleBotChatMessages,
} from "./botConversationPresentation";
import { resolveStickyBotEngine } from "./botEngineSelection";
import { BotPromptComposer } from "./BotPromptComposer";
import { useBotPresence } from "./botPresence";
import { useRosterStore } from "./rosterStore";
import { useBotThreadRuntime } from "./useBotThreadRuntime";
import { useRosterPendingUserInput } from "./useRosterPendingUserInput";

export function BotThreadLanding({ botId }: { readonly botId: string }) {
  const navigate = useNavigate();
  const settings = usePrimarySettings();
  const providers = useAtomValue(primaryServerProvidersAtom);
  const bot = useRosterStore((state) => state.bots.find((candidate) => candidate.id === botId));
  const configuredEngine = bot?.engine ?? null;
  const instanceEntries = useMemo(
    () =>
      sortProviderInstanceEntries(
        applyProviderInstanceSettings(deriveProviderInstanceEntries(providers), settings),
      ),
    [providers, settings],
  );
  const defaultSelection = useMemo(
    () => resolveAppModelSelectionState(settings, providers),
    [providers, settings],
  );
  const stickyEngine = useMemo(
    () =>
      resolveStickyBotEngine({
        engine: configuredEngine,
        instanceEntries,
        settings,
        providers,
        defaultSelection,
      }),
    [configuredEngine, defaultSelection, instanceEntries, providers, settings],
  );
  const effectiveModelSelection = stickyEngine;
  const runtime = useBotThreadRuntime(botId, effectiveModelSelection);
  const pendingInput = useRosterPendingUserInput(runtime.linkedThreadRef);
  const pendingUserInput = pendingInput.pendingUserInput;
  const presence = useBotPresence(botId);
  const threadShell = useThreadShell(runtime.linkedThreadRef);
  const threadActivities = useThreadActivities(runtime.linkedThreadRef);

  useEffect(() => {
    if (!bot || bot.archivedAt !== null) {
      void navigate({ to: "/", replace: true });
      return;
    }
    useRosterStore.getState().selectBot(bot.id);
  }, [bot, navigate]);

  if (!bot || bot.archivedAt !== null) return null;
  // The shimmer holds from send until the answer lands: an unanswered user
  // message keeps the bot working even while provider session states churn.
  const turnFailed =
    threadShell?.session?.status === "error" ||
    threadShell?.latestTurn?.state === "error" ||
    threadShell?.latestTurn?.state === "interrupted";
  const lastUserMessage = runtime.messages.findLast((message) => message.role === "user");
  const turnFailure = turnFailed
    ? latestTurnFailureDetail(threadActivities, lastUserMessage?.createdAt ?? null)
    : null;
  // Only a rendered choice card replaces the shimmer. Presence "needs-you"
  // is not trusted here: a stale pending-input flag from a dead turn must not
  // hide the working state while the bot owes an answer.
  const working =
    runtime.sending ||
    presence === "working" ||
    (pendingUserInput === null && botAwaitsReply(runtime.messages, { turnFailed }));
  const messages = visibleBotChatMessages(runtime.messages, working);
  const latestMessage = messages.at(-1);
  const followRevision = latestMessage?.role === "user" ? latestMessage.id : null;

  return (
    <SidebarInset
      aria-label={`${bot.name} thread`}
      className="h-dvh min-h-0 overflow-hidden bg-background text-foreground"
      data-testid="bot-thread-landing"
    >
      <div className="flex min-h-0 min-w-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <WorkspacePageHeader className="border-b border-border">
            <div className="flex min-w-0 items-center gap-2">
              <BotAvatarView avatar={bot.avatar} name={bot.name} className="size-6" />
              <span className="truncate text-sm font-medium">{bot.name}</span>
            </div>
          </WorkspacePageHeader>
          <BotConversationScrollArea followRevision={followRevision}>
            {messages.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 py-12">
                <BotAvatarView avatar={bot.avatar} name={bot.name} className="size-14" />
                <h1 className="text-lg font-medium">Message {bot.name}</h1>
              </div>
            ) : (
              messages.map((message) =>
                message.role === "assistant" ? (
                  <div key={message.id} data-testid="bot-provider-message">
                    <ChatMarkdown
                      className="max-w-[85%]"
                      cwd={runtime.defaultProject?.workspaceRoot}
                      text={message.text}
                      threadRef={runtime.linkedThreadRef ?? undefined}
                    />
                  </div>
                ) : (
                  <div key={message.id} className="flex justify-end" data-testid="bot-user-message">
                    <div className="max-w-[78%] rounded-2xl bg-foreground/10 px-3.5 py-2 text-sm leading-6">
                      <p className="whitespace-pre-wrap">{message.text}</p>
                      {message.attachments?.length ? (
                        <div className="mt-1.5 flex flex-wrap justify-end gap-1.5">
                          {message.attachments.map((attachment) => (
                            <span
                              key={attachment.id}
                              className="rounded-full bg-background/60 px-2 py-0.5 text-xs text-muted-foreground"
                            >
                              {attachment.name}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ),
              )
            )}
            {pendingUserInput ? (
              <BotChoicePrompt
                prompt={pendingUserInput}
                responding={pendingInput.responding}
                error={pendingInput.responseError}
                onAnswer={(answers) => pendingInput.respond(pendingUserInput.requestId, answers)}
              />
            ) : null}
            {working ? <BotActivityStatus avatar={bot.avatar} name={bot.name} /> : null}
            {runtime.error || turnFailure ? (
              <div
                role="alert"
                data-testid="bot-chat-error"
                className="rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive"
              >
                {runtime.error ?? turnFailure}
              </div>
            ) : null}
          </BotConversationScrollArea>
          <BotPromptComposer
            key={bot.id}
            botName={bot.name}
            draftKey={bot.id}
            disabled={
              runtime.sending ||
              pendingUserInput !== null ||
              effectiveModelSelection === null ||
              !runtime.botReady ||
              !runtime.bootstrapped ||
              runtime.defaultProject === null
            }
            onSubmit={runtime.send}
          />
          {effectiveModelSelection === null ? (
            <p className="px-4 pb-3 text-center text-xs text-muted-foreground">
              Enable a provider before you message this bot.
            </p>
          ) : !runtime.botReady ? (
            <p className="px-4 pb-3 text-center text-xs text-muted-foreground">Connecting bot…</p>
          ) : runtime.bootstrapped && runtime.defaultProject === null ? (
            <p className="px-4 pb-3 text-center text-xs text-muted-foreground">
              Add a project before you message a bot.
            </p>
          ) : null}
        </div>
      </div>
    </SidebarInset>
  );
}
