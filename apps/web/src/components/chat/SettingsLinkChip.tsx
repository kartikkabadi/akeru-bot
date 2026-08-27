import { Settings02Icon } from "@hugeicons/core-free-icons";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";

import {
  CHAT_INLINE_CHIP_CLASS_NAME,
  CHAT_INLINE_CHIP_LABEL_CLASS_NAME,
  COMPOSER_INLINE_CHIP_ICON_CLASS_NAME,
} from "../composerInlineChip";
import { AppIcon } from "../ui/app-icon";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { cn } from "../../lib/utils";
import { openSettings } from "../../settingsDialogStore";
import type { SettingsDeepLinkDestination } from "../../settingsDeepLink";

export function SettingsLinkChip(props: {
  readonly href: string;
  readonly label: string;
  readonly children: ReactNode;
  readonly destination: SettingsDeepLinkDestination;
  readonly className?: string | undefined;
}) {
  const handleClick = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    event.stopPropagation();
    openSettings(props.destination.section, props.destination.targetId);
  };

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <a
            href={props.href}
            aria-label={props.destination.tooltip}
            className={cn(
              CHAT_INLINE_CHIP_CLASS_NAME,
              "chat-markdown-settings-link cursor-pointer transition-colors hover:bg-accent/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70",
              props.className,
            )}
            data-markdown-copy={`[${props.label}](${props.href})`}
            onClick={handleClick}
          >
            <AppIcon icon={Settings02Icon} className={COMPOSER_INLINE_CHIP_ICON_CLASS_NAME} />
            <span className={CHAT_INLINE_CHIP_LABEL_CLASS_NAME}>{props.children}</span>
          </a>
        }
      />
      <TooltipPopup side="top">{props.destination.tooltip}</TooltipPopup>
    </Tooltip>
  );
}
