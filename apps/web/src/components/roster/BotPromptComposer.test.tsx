import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  BotPromptComposer,
  botVoiceErrorMessage,
  canSubmitBotPrompt,
  filterBotImageFiles,
  findMentionedBotId,
  formatBotVoiceDuration,
  isBotPromptExpanded,
  mergeBotImageFiles,
  shouldClearSubmittedBotDraft,
  shouldFocusBotPromptForKey,
} from "./BotPromptComposer";

describe("bot prompt composer", () => {
  it("expands as soon as the prompt has text", () => {
    expect(isBotPromptExpanded("")).toBe(false);
    expect(isBotPromptExpanded("x")).toBe(true);
    expect(isBotPromptExpanded("Line one\nLine two")).toBe(true);
  });

  it("formats voice input state and microphone errors", () => {
    expect(formatBotVoiceDuration(0)).toBe("0:00");
    expect(formatBotVoiceDuration(65)).toBe("1:05");
    expect(botVoiceErrorMessage({ name: "NotAllowedError" })).toBe(
      "Microphone access denied. Enable microphone access in system settings.",
    );
    expect(botVoiceErrorMessage({ name: "NotFoundError" })).toBe("No microphone was found.");
  });

  it("keeps image uploads and rejects other files", () => {
    const image = new File(["image"], "photo.png", { type: "image/png" });
    const text = new File(["text"], "notes.txt", { type: "text/plain" });
    expect(filterBotImageFiles([image, text])).toEqual([image]);
  });

  it("deduplicates the same file object but preserves distinct metadata collisions", () => {
    const first = new File(["first"], "photo.png", {
      type: "image/png",
      lastModified: 1,
    });
    const collision = new File(["other"], "photo.png", {
      type: "image/png",
      lastModified: 1,
    });
    expect(mergeBotImageFiles([], [first, first, collision])).toEqual([first, collision]);
  });

  it("blocks disabled and empty submissions", () => {
    expect(canSubmitBotPrompt({ disabled: true, fileCount: 0, prompt: "hello" })).toBe(false);
    expect(canSubmitBotPrompt({ disabled: false, fileCount: 0, prompt: "   " })).toBe(false);
    expect(canSubmitBotPrompt({ disabled: false, fileCount: 1, prompt: "" })).toBe(true);
  });

  it("preserves edits and conversation changes made during submission", () => {
    expect(
      shouldClearSubmittedBotDraft({
        currentDraft: "new text",
        currentDraftKey: "bot-1",
        currentRevision: 1,
        submittedDraft: "old text",
        submittedDraftKey: "bot-1",
        submittedRevision: 1,
      }),
    ).toBe(false);
    expect(
      shouldClearSubmittedBotDraft({
        currentDraft: "old text",
        currentDraftKey: "bot-2",
        currentRevision: 1,
        submittedDraft: "old text",
        submittedDraftKey: "bot-1",
        submittedRevision: 1,
      }),
    ).toBe(false);
    expect(
      shouldClearSubmittedBotDraft({
        currentDraft: "old text",
        currentDraftKey: "bot-1",
        currentRevision: 2,
        submittedDraft: "old text",
        submittedDraftKey: "bot-1",
        submittedRevision: 1,
      }),
    ).toBe(false);
    expect(
      shouldClearSubmittedBotDraft({
        currentDraft: "old text",
        currentDraftKey: "bot-1",
        currentRevision: 1,
        submittedDraft: "old text",
        submittedDraftKey: "bot-1",
        submittedRevision: 1,
      }),
    ).toBe(true);
  });

  it("routes the latest complete group mention to its bot", () => {
    expect(
      findMentionedBotId("Ask @Mori then @Path Finder ", [
        { id: "mori", name: "Mori" },
        { id: "pathfinder", name: "Path Finder" },
      ]),
    ).toBe("pathfinder");
    expect(findMentionedBotId("Email a@Mori.com", [{ id: "mori", name: "Mori" }])).toBeUndefined();
  });

  it("focuses the prompt for unmodified printable typing outside an editor", () => {
    const baseInput = {
      altKey: false,
      ctrlKey: false,
      defaultPrevented: false,
      editableTarget: false,
      isComposing: false,
      key: "a",
      metaKey: false,
    };

    expect(shouldFocusBotPromptForKey(baseInput)).toBe(true);
    expect(shouldFocusBotPromptForKey({ ...baseInput, key: "Enter" })).toBe(false);
    expect(shouldFocusBotPromptForKey({ ...baseInput, metaKey: true })).toBe(false);
    expect(shouldFocusBotPromptForKey({ ...baseInput, editableTarget: true })).toBe(false);
    expect(shouldFocusBotPromptForKey({ ...baseInput, isComposing: true })).toBe(false);
  });

  it("uses the available chat width", () => {
    const markup = renderToStaticMarkup(
      <BotPromptComposer botName="Akeru" disabled={false} onSubmit={vi.fn(async () => true)} />,
    );

    expect(markup).toContain('<form class="w-full ');
    expect(markup).toContain('aria-label="Start voice input"');
    expect(markup).toContain('data-testid="bot-prompt-composer"');
    expect(markup).toContain("overflow-visible");
    expect(markup).not.toContain("overflow-hidden rounded-[1.65rem]");
    expect(markup).not.toContain("max-w-4xl");
  });

  it("keeps model selection out of the prompt input", () => {
    const markup = renderToStaticMarkup(
      <BotPromptComposer botName="Akeru" disabled={false} onSubmit={vi.fn(async () => true)} />,
    );

    expect(markup).not.toContain('aria-label="Change model"');
    expect(markup).not.toContain("data-chat-provider-model-picker");
  });
});
