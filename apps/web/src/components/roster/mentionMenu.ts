import type { BotAvatar } from "./types";

export interface MentionMenuBot {
  readonly id: string;
  readonly name: string;
  readonly avatar?: BotAvatar;
}

export interface MentionMenuPlugin {
  readonly id: string;
  readonly name: string;
}

export type MentionMenuItem =
  | { readonly kind: "everyone"; readonly id: "everyone"; readonly label: "everyone" }
  | {
      readonly kind: "bot";
      readonly id: string;
      readonly label: string;
      readonly avatar?: BotAvatar | undefined;
    }
  | { readonly kind: "plugin"; readonly id: string; readonly label: string };

/** Text inserted into the draft when a mention item is picked. */
export function mentionInsertText(item: MentionMenuItem): string {
  return `@${item.label} `;
}

/**
 * Grok-style @ menu contents: everyone, member bots, then connected plugins,
 * all filtered by the query typed after the @.
 */
export function buildMentionMenuItems(
  query: string,
  bots: ReadonlyArray<MentionMenuBot>,
  plugins: ReadonlyArray<MentionMenuPlugin> = [],
): MentionMenuItem[] {
  const needle = query.trim().toLowerCase();
  const matches = (name: string) => needle.length === 0 || name.toLowerCase().includes(needle);
  return [
    ...(matches("everyone")
      ? [{ kind: "everyone", id: "everyone", label: "everyone" } as const]
      : []),
    ...bots
      .filter((bot) => matches(bot.name))
      .map((bot) => ({ kind: "bot", id: bot.id, label: bot.name, avatar: bot.avatar }) as const),
    ...plugins
      .filter((plugin) => matches(plugin.name))
      .map((plugin) => ({ kind: "plugin", id: plugin.id, label: plugin.name }) as const),
  ];
}

export function nextMentionIndex(current: number, count: number, step: 1 | -1): number {
  if (count === 0) return 0;
  return (current + step + count) % count;
}
