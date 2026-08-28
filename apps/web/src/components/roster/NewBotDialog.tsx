import { useState } from "react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Dialog, DialogFooter, DialogHeader, DialogPopup, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { downscaleAvatarImage, exceedsAvatarUploadLimit } from "./avatarUpload";
import { BotAvatarView } from "./BotAvatarView";
import { BLOB_COLORS, BLOB_SHAPES, randomBotAvatar } from "./roster.logic";
import type { BotAvatar } from "./types";

const BLOB_COLOR_NAMES: Readonly<Record<string, string>> = {
  "#FFFFFF": "White",
  "#E0645C": "Coral",
  "#E8883A": "Orange",
  "#D9A833": "Gold",
  "#5BA97B": "Green",
  "#4E9BB8": "Blue",
  "#5B7FD4": "Indigo",
  "#8B6FC9": "Purple",
  "#C96FA8": "Pink",
  "#7A8699": "Slate",
};

function NewBotForm({
  onCancel,
  onCreate,
}: {
  onCancel: () => void;
  onCreate: (input: { name: string; avatar: BotAvatar }) => void;
}) {
  const [name, setName] = useState("");
  const [blobAvatar, setBlobAvatar] = useState(() => randomBotAvatar());
  const [avatar, setAvatar] = useState<BotAvatar>(() => blobAvatar);
  const [uploadError, setUploadError] = useState<"too-large" | "read" | null>(null);
  const trimmedName = name.trim();

  const updateBlobAvatar = (next: typeof blobAvatar) => {
    setBlobAvatar(next);
    setAvatar(next);
    setUploadError(null);
  };

  const handleUpload = (file: File | undefined) => {
    if (!file) return;
    setUploadError(null);
    if (exceedsAvatarUploadLimit(file)) {
      setUploadError("too-large");
      return;
    }
    void downscaleAvatarImage(file).then(
      ({ plainUrl }) => setAvatar({ kind: "image", assetPath: plainUrl, dithered: false }),
      (error: unknown) => {
        console.error("Could not read avatar image.", error);
        setUploadError("read");
      },
    );
  };

  return (
    <DialogPopup
      className="w-[min(46rem,calc(100vw-2rem))] max-w-none overflow-hidden p-0"
      bottomStickOnMobile={false}
    >
      <form
        className="flex max-h-[min(42rem,calc(100dvh-2rem))] flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          if (!trimmedName) return;
          onCreate({ name: trimmedName, avatar });
        }}
      >
        <DialogHeader className="shrink-0 border-b px-5 py-4">
          <DialogTitle className="text-base">New bot</DialogTitle>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 overflow-y-auto sm:grid-cols-[15rem_minmax(0,1fr)] sm:overflow-hidden">
          <aside className="flex shrink-0 items-center gap-4 border-b bg-muted/35 px-5 py-5 sm:flex-col sm:justify-center sm:border-b-0 sm:border-r sm:px-6 sm:text-center">
            <BotAvatarView
              avatar={avatar}
              name={trimmedName || "New bot"}
              className="size-20 shrink-0 sm:size-28"
            />
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-foreground">
                {trimmedName || "New bot"}
              </p>
              <p className="text-sm text-muted-foreground">Assistant</p>
            </div>
          </aside>

          <div className="space-y-6 px-5 py-5 sm:overflow-y-auto sm:px-6">
            <label className="flex flex-col gap-2 text-sm font-medium text-foreground">
              Name
              <Input
                autoFocus
                data-testid="new-bot-name-input"
                maxLength={80}
                placeholder="Research assistant"
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
              />
            </label>

            <fieldset className="space-y-3">
              <legend className="text-sm font-medium text-foreground">Shape</legend>
              <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Shape">
                {BLOB_SHAPES.map((shape) => {
                  const selected = avatar.kind === "blob" && blobAvatar.shape === shape;
                  return (
                    <label key={shape} className="cursor-pointer">
                      <input
                        type="radio"
                        name="bot-shape"
                        value={shape}
                        checked={selected}
                        onChange={() => updateBlobAvatar({ ...blobAvatar, shape })}
                        className="peer sr-only"
                      />
                      <span
                        className={cn(
                          "flex aspect-square items-center justify-center rounded-lg border border-transparent outline-none transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring",
                          selected ? "border-border bg-accent" : "hover:bg-accent/60",
                        )}
                      >
                        <BotAvatarView
                          avatar={{ ...blobAvatar, shape }}
                          name=""
                          className="size-10"
                        />
                        <span className="sr-only">{shape}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="text-sm font-medium text-foreground">Color</legend>
              <div className="flex flex-wrap gap-3" role="radiogroup" aria-label="Color">
                {BLOB_COLORS.map((color) => {
                  const selected = avatar.kind === "blob" && blobAvatar.color === color;
                  return (
                    <label key={color} className="cursor-pointer rounded-full">
                      <input
                        type="radio"
                        name="bot-color"
                        value={color}
                        checked={selected}
                        onChange={() => updateBlobAvatar({ ...blobAvatar, color })}
                        className="peer sr-only"
                      />
                      <span
                        aria-hidden="true"
                        style={{ backgroundColor: color }}
                        className={cn(
                          "block size-8 rounded-full border border-foreground/15 outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background",
                          selected && "ring-2 ring-ring ring-offset-2 ring-offset-background",
                        )}
                      />
                      <span className="sr-only">{BLOB_COLOR_NAMES[color] ?? color}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <div className="space-y-2 border-t pt-5">
              <div className="flex flex-wrap items-center gap-2">
                <label className="cursor-pointer rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium text-foreground shadow-xs/5 outline-none transition-colors hover:bg-accent focus-within:ring-2 focus-within:ring-ring">
                  {avatar.kind === "image" ? "Replace image" : "Upload image"}
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={(event) => handleUpload(event.currentTarget.files?.[0])}
                  />
                </label>
                {avatar.kind === "image" ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => updateBlobAvatar(blobAvatar)}
                  >
                    Remove image
                  </Button>
                ) : null}
              </div>
              {uploadError !== null ? (
                <p role="alert" className="text-sm text-destructive">
                  {uploadError === "too-large"
                    ? "Choose an image smaller than 8 MB."
                    : "Could not read that image."}
                </p>
              ) : null}
            </div>
          </div>
        </div>

        <DialogFooter className="shrink-0 px-5">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={!trimmedName}>
            Create bot
          </Button>
        </DialogFooter>
      </form>
    </DialogPopup>
  );
}

export function NewBotDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: { name: string; avatar: BotAvatar }) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? <NewBotForm onCancel={() => onOpenChange(false)} onCreate={onCreate} /> : null}
    </Dialog>
  );
}
