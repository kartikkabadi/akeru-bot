import { SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Dialog, DialogFooter, DialogHeader, DialogPopup, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { BotAvatarView } from "./BotAvatarView";
import { filterRosterBots } from "./roster.logic";
import type { Bot } from "./types";

export function availableGroupBots(bots: readonly Bot[]): Bot[] {
  return bots.filter((bot) => bot.archivedAt === null && bot.groupId === null);
}

export function selectedGroupBotIds(
  bots: readonly Bot[],
  selectedIds: ReadonlySet<string>,
): string[] {
  return bots.filter((bot) => selectedIds.has(bot.id)).map((bot) => bot.id);
}

function NewGroupForm({
  bots,
  onCancel,
  onCreate,
}: {
  bots: readonly Bot[];
  onCancel: () => void;
  onCreate: (input: { name: string; botIds: readonly string[] }) => void;
}) {
  const availableBots = useMemo(() => availableGroupBots(bots), [bots]);
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const visibleBots = useMemo(() => filterRosterBots(availableBots, query), [availableBots, query]);
  const selectedBotIds = useMemo(
    () => selectedGroupBotIds(availableBots, selectedIds),
    [availableBots, selectedIds],
  );
  const trimmedName = name.trim();

  const toggleBot = (botId: string, checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(botId);
      else next.delete(botId);
      return next;
    });
  };

  return (
    <DialogPopup
      className="w-[min(38rem,calc(100vw-2rem))] max-w-none overflow-hidden p-0"
      bottomStickOnMobile={false}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!trimmedName || selectedBotIds.length === 0) return;
          onCreate({ name: trimmedName, botIds: selectedBotIds });
        }}
      >
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle className="text-base">New group</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 px-5 py-5">
          <label className="flex flex-col gap-2 text-sm font-medium text-foreground">
            Name
            <Input
              autoFocus
              data-testid="new-group-name-input"
              maxLength={80}
              placeholder="Project Falcon"
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
            />
          </label>

          <section aria-labelledby="new-group-bots-heading" className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <h3 id="new-group-bots-heading" className="text-sm font-medium text-foreground">
                Add bots
              </h3>
              {selectedBotIds.length > 0 ? (
                <span className="text-xs tabular-nums text-muted-foreground">
                  {selectedBotIds.length} selected
                </span>
              ) : null}
            </div>

            <div className="overflow-hidden rounded-lg border bg-background">
              <div className="relative border-b">
                <SearchIcon
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  aria-label="Search bots"
                  className="h-11 rounded-none border-0 bg-transparent pl-9 shadow-none focus-visible:ring-0"
                  placeholder="Search bots"
                  value={query}
                  onChange={(event) => setQuery(event.currentTarget.value)}
                />
              </div>

              <div className="max-h-72 min-h-48 overflow-y-auto p-1" role="group" aria-label="Bots">
                {visibleBots.map((bot) => {
                  const checked = selectedIds.has(bot.id);
                  return (
                    <label
                      key={bot.id}
                      className="flex min-h-12 cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 outline-none hover:bg-muted/70 has-focus-visible:bg-muted has-focus-visible:ring-2 has-focus-visible:ring-inset has-focus-visible:ring-ring"
                    >
                      <Checkbox
                        aria-label={`Add ${bot.name}`}
                        checked={checked}
                        onCheckedChange={(nextChecked) => toggleBot(bot.id, nextChecked)}
                      />
                      <BotAvatarView
                        avatar={bot.avatar}
                        name={bot.name}
                        className="size-8 shrink-0"
                      />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-medium text-foreground">
                          {bot.name}
                        </span>
                        {bot.title ? (
                          <span className="truncate text-xs text-muted-foreground">
                            {bot.title}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  );
                })}
                {availableBots.length === 0 ? (
                  <div className="flex min-h-48 items-center justify-center px-6 text-center text-sm text-muted-foreground">
                    Create a bot before you create a group.
                  </div>
                ) : visibleBots.length === 0 ? (
                  <div className="flex min-h-48 items-center justify-center px-6 text-center text-sm text-muted-foreground">
                    No bots match your search.
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        </div>

        <DialogFooter className="px-5">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={!trimmedName || selectedBotIds.length === 0}>
            Create group
          </Button>
        </DialogFooter>
      </form>
    </DialogPopup>
  );
}

export function NewGroupDialog({
  open,
  bots,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  bots: readonly Bot[];
  onOpenChange: (open: boolean) => void;
  onCreate: (input: { name: string; botIds: readonly string[] }) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <NewGroupForm bots={bots} onCancel={() => onOpenChange(false)} onCreate={onCreate} />
      ) : null}
    </Dialog>
  );
}
