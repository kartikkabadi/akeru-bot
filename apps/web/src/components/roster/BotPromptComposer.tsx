import {
  ArrowUpIcon,
  AtSignIcon,
  MicIcon,
  PaperclipIcon,
  PlugIcon,
  PlusIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { detectComposerTrigger, replaceTextRange } from "../../composer-logic";
import { cn, randomUUID } from "../../lib/utils";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { BotAvatarView } from "./BotAvatarView";
import { readBotDraft, readBotDraftRevision, writeBotDraft } from "./botDraftStore";
import { formatBotVoiceDuration, useBotVoiceInput } from "./useBotVoiceInput";
import {
  buildMentionMenuItems,
  mentionInsertText,
  nextMentionIndex,
  type MentionMenuPlugin,
} from "./mentionMenu";

export { botVoiceErrorMessage, formatBotVoiceDuration } from "./useBotVoiceInput";

const useBrowserLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function isBotPromptExpanded(prompt: string): boolean {
  return prompt.length > 0;
}

export function filterBotImageFiles(files: readonly File[]): File[] {
  return files.filter((file) => file.type.startsWith("image/"));
}

export function mergeBotImageFiles(current: readonly File[], incoming: readonly File[]): File[] {
  const seen = new Set(current);
  const added: File[] = [];
  for (const file of incoming) {
    if (seen.has(file)) continue;
    seen.add(file);
    added.push(file);
  }
  return added.length > 0 ? [...current, ...added] : [...current];
}

export function canSubmitBotPrompt(input: {
  readonly disabled: boolean;
  readonly fileCount: number;
  readonly prompt: string;
}): boolean {
  return !input.disabled && (input.prompt.trim().length > 0 || input.fileCount > 0);
}

export function shouldClearSubmittedBotDraft(input: {
  readonly currentDraft: string;
  readonly currentDraftKey: string | undefined;
  readonly currentRevision: number;
  readonly submittedDraft: string;
  readonly submittedDraftKey: string | undefined;
  readonly submittedRevision: number;
}): boolean {
  return (
    input.currentDraftKey === input.submittedDraftKey &&
    input.currentDraft === input.submittedDraft &&
    input.currentRevision === input.submittedRevision
  );
}

const botImageFileIds = new WeakMap<File, string>();

function botImageFileKey(file: File): string {
  const existing = botImageFileIds.get(file);
  if (existing) return existing;
  const id = randomUUID();
  botImageFileIds.set(file, id);
  return id;
}

export function shouldFocusBotPromptForKey(input: {
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly defaultPrevented: boolean;
  readonly editableTarget: boolean;
  readonly isComposing: boolean;
  readonly key: string;
  readonly metaKey: boolean;
}): boolean {
  return (
    !input.altKey &&
    !input.ctrlKey &&
    !input.defaultPrevented &&
    !input.editableTarget &&
    !input.isComposing &&
    !input.metaKey &&
    input.key.length === 1
  );
}

export interface MentionBot {
  readonly id: string;
  readonly name: string;
  readonly avatar?: import("./types").BotAvatar;
}

const EMPTY_MENTION_BOTS: ReadonlyArray<MentionBot> = [];
const EMPTY_MENTION_PLUGINS: ReadonlyArray<MentionMenuPlugin> = [];

function BotImageAttachmentPreview({
  file,
  onRemove,
}: {
  readonly file: File;
  readonly onRemove: () => void;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <div className="group/image relative h-20 w-28 overflow-hidden rounded-xl border border-border/80 bg-background/45 shadow-sm">
      {previewUrl ? (
        <img src={previewUrl} alt="" className="size-full object-cover" />
      ) : (
        <div className="flex size-full items-center justify-center text-muted-foreground">
          <PaperclipIcon className="size-4" />
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-2 pb-1.5 pt-5 text-[11px] text-white">
        <span className="block truncate">{file.name}</span>
      </div>
      <button
        type="button"
        aria-label={`Remove ${file.name}`}
        onClick={onRemove}
        className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-full bg-black/70 text-white opacity-0 shadow-sm transition-[opacity,transform,background-color] duration-150 hover:bg-black/85 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white group-hover/image:opacity-100 active:scale-95 motion-reduce:transform-none motion-reduce:transition-opacity"
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
}

export function findMentionedBotId(
  prompt: string,
  bots: ReadonlyArray<MentionBot>,
): string | undefined {
  const mentions = bots.flatMap((bot) => {
    const token = `@${bot.name}`;
    const index = prompt.lastIndexOf(token);
    if (index < 0) return [];
    const before = prompt[index - 1];
    const after = prompt[index + token.length];
    return (before === undefined || /\s/.test(before)) && (after === undefined || /\s/.test(after))
      ? [{ id: bot.id, index }]
      : [];
  });
  return mentions.toSorted((left, right) => right.index - left.index)[0]?.id;
}

export function BotPromptComposer({
  botName,
  draftKey,
  disabled,
  mentionBots = EMPTY_MENTION_BOTS,
  mentionPlugins = EMPTY_MENTION_PLUGINS,
  onSubmit,
}: {
  botName: string;
  draftKey?: string;
  disabled: boolean;
  mentionBots?: ReadonlyArray<MentionBot>;
  mentionPlugins?: ReadonlyArray<MentionMenuPlugin>;
  onSubmit: (prompt: string, files: readonly File[], respondingBotId?: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(() => (draftKey ? readBotDraft(draftKey) : ""));
  const [mentionRange, setMentionRange] = useState<{ start: number; end: number } | null>(null);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const promptInputRef = useRef<HTMLTextAreaElement>(null);
  const draftRef = useRef(draft);
  const draftKeyRef = useRef(draftKey);
  const draftRevisionRef = useRef(0);
  const filesRevisionRef = useRef(0);
  draftRef.current = draft;
  draftKeyRef.current = draftKey;
  const persistDraft = (next: string) => {
    draftRevisionRef.current += 1;
    setDraft(next);
    if (draftKey) writeBotDraft(draftKey, next);
  };
  const persistDraftRef = useRef(persistDraft);
  persistDraftRef.current = persistDraft;
  const {
    state: voiceState,
    seconds: voiceSeconds,
    error: voiceError,
    start: startVoiceInput,
    stop: stopVoiceInput,
    cancel: cancelVoiceInput,
  } = useBotVoiceInput({ draft, resetKey: draftKey, onDraftChange: persistDraft });

  useBrowserLayoutEffect(() => {
    draftRevisionRef.current = draftKey ? readBotDraftRevision(draftKey) : 0;
    filesRevisionRef.current += 1;
    setFiles([]);
    setDraft(draftKey ? readBotDraft(draftKey) : "");
  }, [draftKey]);

  const mentionEnabled = mentionBots.length > 0;
  const mentionItems =
    mentionEnabled && mentionRange !== null
      ? buildMentionMenuItems(mentionQuery, mentionBots, mentionPlugins)
      : [];
  const mentionMenuOpen = mentionItems.length > 0;

  const syncMentionTrigger = (text: string, cursor: number) => {
    if (!mentionEnabled) return;
    const trigger = detectComposerTrigger(text, cursor);
    if (trigger?.kind !== "path") {
      setMentionRange(null);
      setMentionQuery("");
      return;
    }
    setMentionRange((current) =>
      current?.start === trigger.rangeStart && current.end === trigger.rangeEnd
        ? current
        : { start: trigger.rangeStart, end: trigger.rangeEnd },
    );
    setMentionQuery(trigger.query);
    setMentionIndex(0);
  };

  const applyMention = (item: (typeof mentionItems)[number]) => {
    if (!mentionRange) return;
    const replacement = mentionInsertText(item);
    const next = replaceTextRange(draft, mentionRange.start, mentionRange.end, replacement);
    persistDraft(next.text);
    setMentionRange(null);
    setMentionQuery("");
    window.requestAnimationFrame(() => {
      const input = promptInputRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(next.cursor, next.cursor);
    });
  };

  const expanded =
    files.length > 0 || voiceState !== "idle" || voiceError !== null || isBotPromptExpanded(draft);
  const addFiles = (next: FileList | readonly File[]) => {
    const images = filterBotImageFiles(Array.from(next));
    if (images.length === 0) return;
    setFiles((current) => {
      const merged = mergeBotImageFiles(current, images);
      if (merged.length === current.length) return current;
      filesRevisionRef.current += 1;
      return merged;
    });
  };

  const canSubmit = canSubmitBotPrompt({ disabled, fileCount: files.length, prompt: draft });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const editableTarget =
        target instanceof Element &&
        target.closest(
          'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"]',
        ) !== null;

      if (
        !shouldFocusBotPromptForKey({
          altKey: event.altKey,
          ctrlKey: event.ctrlKey,
          defaultPrevented: event.defaultPrevented,
          editableTarget,
          isComposing: event.isComposing,
          key: event.key,
          metaKey: event.metaKey,
        })
      ) {
        return;
      }

      event.preventDefault();
      if (voiceState !== "idle") cancelVoiceInput();
      persistDraftRef.current(`${promptInputRef.current?.value ?? ""}${event.key}`);
      promptInputRef.current?.focus();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [voiceState]);

  return (
    <form
      className="w-full px-4 pb-4 pt-2 sm:px-6 sm:pb-6"
      onSubmit={(event) => {
        event.preventDefault();
        if (voiceState !== "idle") {
          stopVoiceInput();
          return;
        }
        if (!canSubmit) return;
        const submittedDraft = draft;
        const submittedDraftKey = draftKey;
        const submittedRevision = submittedDraftKey
          ? readBotDraftRevision(submittedDraftKey)
          : draftRevisionRef.current;
        const prompt = submittedDraft.trim();
        const submittedFiles = [...files];
        const submittedFilesRevision = filesRevisionRef.current;
        void onSubmit(prompt, submittedFiles, findMentionedBotId(prompt, mentionBots)).then(
          (sent) => {
            if (!sent || draftKeyRef.current !== submittedDraftKey) return;
            if (
              shouldClearSubmittedBotDraft({
                currentDraft: draftRef.current,
                currentDraftKey: draftKeyRef.current,
                currentRevision: submittedDraftKey
                  ? readBotDraftRevision(submittedDraftKey)
                  : draftRevisionRef.current,
                submittedDraft,
                submittedDraftKey,
                submittedRevision,
              })
            ) {
              persistDraftRef.current("");
            }
            if (filesRevisionRef.current === submittedFilesRevision) {
              filesRevisionRef.current += 1;
              setFiles((current) => current.filter((file) => !submittedFiles.includes(file)));
            }
          },
        );
      }}
    >
      <div
        data-testid="bot-prompt-composer"
        data-expanded={expanded || undefined}
        className={cn(
          "relative flex min-h-13 flex-col overflow-visible rounded-[1.65rem] border border-border/80 bg-muted/75 shadow-[0_10px_36px_-28px_rgb(0_0_0/80%)] transition-[min-height,border-radius,background-color,box-shadow] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
          expanded &&
            "min-h-28 rounded-[1.4rem] bg-muted/85 shadow-[0_16px_42px_-28px_rgb(0_0_0/90%)]",
        )}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("Files")) event.preventDefault();
        }}
        onDrop={(event) => {
          if (event.dataTransfer.files.length === 0) return;
          event.preventDefault();
          addFiles(event.dataTransfer.files);
        }}
      >
        {mentionMenuOpen ? (
          <div
            role="listbox"
            aria-label="Mention"
            data-testid="bot-mention-menu"
            className="absolute bottom-full left-2 z-50 mb-2 w-80 overflow-hidden rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg"
          >
            {mentionItems.map((item, index) => (
              <button
                key={`${item.kind}:${item.id}`}
                type="button"
                role="option"
                aria-selected={index === mentionIndex}
                data-testid="bot-mention-option"
                onMouseDown={(event) => event.preventDefault()}
                onMouseMove={() => setMentionIndex(index)}
                onClick={() => applyMention(item)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm",
                  index === mentionIndex && "bg-accent text-accent-foreground",
                )}
              >
                {item.kind === "bot" && item.avatar ? (
                  <BotAvatarView avatar={item.avatar} name={item.label} className="size-5" />
                ) : (
                  <span className="flex size-5 items-center justify-center text-muted-foreground">
                    {item.kind === "plugin" ? (
                      <PlugIcon aria-hidden="true" className="size-4" />
                    ) : (
                      <AtSignIcon aria-hidden="true" className="size-4" />
                    )}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate font-medium">{item.label}</span>
                {item.kind === "plugin" ? (
                  <span className="text-xs text-muted-foreground">connected</span>
                ) : null}
                <span className="text-xs text-muted-foreground">
                  {item.kind === "plugin" ? "Plugin" : "Bot"}
                </span>
              </button>
            ))}
          </div>
        ) : null}
        {voiceError ? (
          <div
            role="alert"
            className="px-4 pt-3 text-xs font-medium text-destructive"
            data-testid="bot-voice-error"
          >
            {voiceError}
          </div>
        ) : null}
        {files.length > 0 ? (
          <div className="flex flex-wrap gap-2 px-3 pt-3" data-testid="bot-image-previews">
            {files.map((file, index) => (
              <BotImageAttachmentPreview
                key={botImageFileKey(file)}
                file={file}
                onRemove={() =>
                  setFiles((current) => {
                    filesRevisionRef.current += 1;
                    return current.filter((_, item) => item !== index);
                  })
                }
              />
            ))}
          </div>
        ) : null}
        <textarea
          ref={promptInputRef}
          aria-label={`Message ${botName}`}
          data-testid="bot-prompt-input"
          placeholder={`Message ${botName}`}
          rows={1}
          value={draft}
          className={cn(
            "field-sizing-content max-h-56 w-full resize-none bg-transparent text-[15px] leading-6 outline-none placeholder:text-muted-foreground/70 transition-[min-height,padding] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
            expanded ? "min-h-16 px-4 pb-2 pt-3" : "min-h-13 px-14 py-[0.9rem]",
          )}
          onChange={(event) => {
            if (voiceState !== "idle") cancelVoiceInput();
            persistDraft(event.currentTarget.value);
            syncMentionTrigger(
              event.currentTarget.value,
              event.currentTarget.selectionStart ?? event.currentTarget.value.length,
            );
          }}
          onSelect={(event) => {
            syncMentionTrigger(
              event.currentTarget.value,
              event.currentTarget.selectionStart ?? event.currentTarget.value.length,
            );
          }}
          onBlur={() => {
            // Let a mention row click land before the menu unmounts.
            window.setTimeout(() => setMentionRange(null), 120);
          }}
          onKeyDown={(event) => {
            if (mentionMenuOpen && !event.nativeEvent.isComposing) {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setMentionIndex((current) =>
                  nextMentionIndex(
                    current,
                    mentionItems.length,
                    event.key === "ArrowDown" ? 1 : -1,
                  ),
                );
                return;
              }
              if (event.key === "Enter" || event.key === "Tab") {
                event.preventDefault();
                const item = mentionItems[mentionIndex] ?? mentionItems[0];
                if (item) applyMention(item);
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setMentionRange(null);
                return;
              }
            }
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            if (voiceState !== "idle") {
              stopVoiceInput();
              return;
            }
            if (canSubmit) event.currentTarget.form?.requestSubmit();
          }}
          onPaste={(event) => {
            if (event.clipboardData.files.length > 0) addFiles(event.clipboardData.files);
          }}
        />
        <div
          data-testid="bot-prompt-controls"
          className={cn(
            "pointer-events-none flex items-center justify-between",
            expanded ? "px-2 pb-2" : "absolute inset-x-2 bottom-2",
          )}
        >
          <div className="pointer-events-auto flex min-w-0 items-center gap-1">
            <Menu>
              <MenuTrigger
                render={
                  <button
                    type="button"
                    aria-label="Add to prompt"
                    className="flex size-9 shrink-0 items-center justify-center rounded-full bg-foreground/8"
                  />
                }
              >
                <PlusIcon className="size-5" />
              </MenuTrigger>
              <MenuPopup align="start" side="top" sideOffset={8}>
                <MenuItem onClick={() => fileInputRef.current?.click()}>
                  <PaperclipIcon />
                  Attach image
                </MenuItem>
                {mentionBots.map((bot) => (
                  <MenuItem
                    key={bot.id}
                    onClick={() => {
                      if (voiceState !== "idle") cancelVoiceInput();
                      persistDraft(
                        `${draft}${draft && !/\s$/.test(draft) ? " " : ""}@${bot.name} `,
                      );
                    }}
                  >
                    <AtSignIcon />
                    Mention {bot.name}
                  </MenuItem>
                ))}
              </MenuPopup>
            </Menu>
          </div>
          <div className="pointer-events-auto flex items-center gap-1.5">
            {voiceState === "idle" ? (
              <button
                type="button"
                aria-label="Start voice input"
                disabled={disabled}
                onClick={() => void startVoiceInput()}
                className="flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/8 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-35"
              >
                <MicIcon className="size-4.5" />
              </button>
            ) : (
              <div
                className="flex h-9 items-center gap-2 rounded-full bg-background/55 px-2.5 text-sm tabular-nums"
                aria-live="polite"
              >
                <button
                  type="button"
                  aria-label="Stop voice input"
                  onClick={stopVoiceInput}
                  className="flex size-5 items-center justify-center rounded-full text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <SquareIcon className="size-2.5 fill-current" />
                </button>
                <span>
                  {voiceState === "starting" ? "Starting" : formatBotVoiceDuration(voiceSeconds)}
                </span>
                <span aria-hidden="true" className="flex items-end gap-0.5 text-muted-foreground">
                  <span className="h-1 w-0.5 rounded-full bg-current" />
                  <span className="h-2 w-0.5 rounded-full bg-current" />
                  <span className="h-1.5 w-0.5 rounded-full bg-current" />
                  <span className="h-2.5 w-0.5 rounded-full bg-current" />
                </span>
              </div>
            )}
            <button
              type="submit"
              aria-label="Send message"
              disabled={!canSubmit}
              className="flex size-9 items-center justify-center rounded-full bg-foreground text-background transition-[opacity,transform] duration-150 ease-out hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-95 disabled:opacity-25 disabled:hover:scale-100 motion-reduce:transform-none motion-reduce:transition-none"
            >
              <ArrowUpIcon className="size-5" />
            </button>
          </div>
        </div>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        onChange={(event) => {
          if (event.currentTarget.files) addFiles(event.currentTarget.files);
          event.currentTarget.value = "";
        }}
      />
    </form>
  );
}
