import { useRef, useState } from "react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Switch } from "../ui/switch";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { downscaleAvatarImage, exceedsAvatarUploadLimit } from "./avatarUpload";
import { BotAvatarView } from "./BotAvatarView";
import {
  ditherSeedForName,
  rerollDitherSeed,
  resolveUploadAvatar,
  type UploadRendering,
} from "./dither.logic";
import { BLOB_COLORS, BLOB_SHAPES, resolveBlobRendering } from "./roster.logic";
import type { Bot, BotAvatar, BotBlobShape } from "./types";
import { useSaveBotAvatar } from "./useServerRoster";

type PickerTab = "bot" | "generate" | "upload";

const TAB_LABELS: Record<PickerTab, string> = {
  bot: "Blob",
  generate: "Generate",
  upload: "Upload",
};

/**
 * Avatar picker for one bot. The Blob tab picks a blob shape and color;
 * Generate seeds a Dither Kit identicon from the bot's name with a reroll;
 * Upload previews a local image, optionally dithered, and applies it as a
 * data URL until server assets exist.
 */
export function AvatarPickerDialog({
  bot,
  open,
  onOpenChange,
}: {
  bot: Bot;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const saveBotAvatar = useSaveBotAvatar();
  const initialBlob = resolveBlobRendering(bot.avatar);
  const [tab, setTab] = useState<PickerTab>("bot");
  const [shape, setShape] = useState<BotBlobShape>(initialBlob.shape);
  const [color, setColor] = useState(initialBlob.color);
  const [seed, setSeed] = useState(
    bot.avatar.kind === "dither" ? bot.avatar.seed : ditherSeedForName(bot.name),
  );
  const [upload, setUpload] = useState<UploadRendering | null>(null);
  const uploadSequence = useRef(0);
  const [ditherUpload, setDitherUpload] = useState(false);
  const [failure, setFailure] = useState<"save" | "upload" | "too-large" | null>(null);
  const [saving, setSaving] = useState(false);

  const draftAvatar: BotAvatar | null =
    tab === "bot"
      ? { kind: "blob", shape, color }
      : tab === "generate"
        ? { kind: "dither", seed }
        : resolveUploadAvatar(upload, ditherUpload);

  const handleUpload = (file: File | undefined) => {
    if (!file) return;
    const sequence = ++uploadSequence.current;
    // A new selection invalidates both the prior preview and its in-flight
    // decode. Save stays disabled until the latest selection finishes.
    setUpload(null);
    setFailure(null);
    if (exceedsAvatarUploadLimit(file)) {
      setFailure("too-large");
      return;
    }
    void downscaleAvatarImage(file).then(
      (rendering) => {
        if (sequence === uploadSequence.current) setUpload(rendering);
      },
      (error: unknown) => {
        if (sequence !== uploadSequence.current) return;
        console.error("Could not read avatar image.", error);
        setFailure("upload");
      },
    );
  };

  const handleSave = async () => {
    if (draftAvatar === null || saving) return;
    setSaving(true);
    const saved = await saveBotAvatar(bot.id, draftAvatar);
    setSaving(false);
    if (!saved) {
      setFailure("save");
      return;
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Avatar</DialogTitle>
        </DialogHeader>
        <DialogPanel className="flex flex-col gap-4">
          <ToggleGroup
            aria-label="Avatar source"
            variant="segmented"
            className="w-full *:flex-1"
            value={[tab]}
            onValueChange={(next) => {
              const value = next[0];
              if (value === "bot" || value === "generate" || value === "upload") {
                setFailure(null);
                setTab(value);
              }
            }}
          >
            {(["bot", "generate", "upload"] as const).map((option) => (
              <Toggle key={option} value={option}>
                {TAB_LABELS[option]}
              </Toggle>
            ))}
          </ToggleGroup>
          {tab === "bot" ? (
            <>
              <div className="flex justify-center">
                <BotAvatarView
                  avatar={{ kind: "blob", shape, color }}
                  name={bot.name}
                  className="size-20"
                />
              </div>
              <div className="grid grid-cols-4 gap-2">
                {BLOB_SHAPES.map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-label={option}
                    aria-pressed={shape === option}
                    data-bot-hover
                    onClick={() => setShape(option)}
                    className={cn(
                      "flex cursor-pointer items-center justify-center rounded-md p-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      shape === option ? "bg-accent" : "hover:bg-accent/50",
                    )}
                  >
                    <BotAvatarView
                      avatar={{ kind: "blob", shape: option, color }}
                      name=""
                      className="size-9"
                    />
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {BLOB_COLORS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-label={option}
                    aria-pressed={color === option}
                    onClick={() => setColor(option)}
                    style={{ backgroundColor: option }}
                    className={cn(
                      "size-7 cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      color === option && "ring-2 ring-ring ring-offset-2 ring-offset-background",
                    )}
                  />
                ))}
              </div>
            </>
          ) : tab === "generate" ? (
            <div className="flex h-40 flex-col items-center justify-center gap-3">
              <BotAvatarView
                avatar={{ kind: "dither", seed }}
                name={bot.name}
                className="size-20"
              />
              <Button variant="outline" onClick={() => setSeed(rerollDitherSeed(bot.name))}>
                Reroll
              </Button>
            </div>
          ) : (
            <div className="flex h-40 flex-col items-center justify-center gap-3">
              {upload !== null ? (
                <img
                  src={ditherUpload ? upload.ditheredUrl : upload.plainUrl}
                  alt="Avatar preview"
                  className="size-20 rounded-full object-cover"
                />
              ) : null}
              <label className="cursor-pointer text-sm font-medium text-foreground underline-offset-4 hover:underline">
                Choose image
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(event) => handleUpload(event.currentTarget.files?.[0])}
                />
              </label>
              {upload !== null ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Switch
                    id="dither-avatar-upload"
                    checked={ditherUpload}
                    onCheckedChange={setDitherUpload}
                  />
                  <label htmlFor="dither-avatar-upload" className="cursor-pointer">
                    Dither image
                  </label>
                </div>
              ) : null}
            </div>
          )}
        </DialogPanel>
        <DialogFooter>
          {failure !== null ? (
            <p role="alert" className="mr-auto self-center text-sm text-destructive">
              {failure === "save"
                ? "Could not save"
                : failure === "too-large"
                  ? "Image too large"
                  : "Could not read image"}
            </p>
          ) : null}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={draftAvatar === null || saving}>
            {saving ? "Saving" : "Save"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
