import { Analytics01Icon, PlugSocketIcon, Settings02Icon } from "@hugeicons/core-free-icons";
import { Link } from "@tanstack/react-router";
import type { ComponentProps } from "react";
import { memo, useCallback } from "react";
import { useEnvironmentIdentificationMode } from "../../hooks/useSettings";
import { openSettings } from "../../settingsDialogStore";
import { openPlugins } from "../../pluginsDialogStore";
import { openUsage } from "../../usageDialogStore";
import { cn } from "../../lib/utils";
import {
  resolveEnvironmentIdentificationPillLabel,
  resolveSidebarStageBackdropVariant,
  resolveSidebarStageFocusRingOffsetClass,
  SidebarStageBackdrop,
  useEnvironmentStageLabel,
} from "../SidebarStageBackdrop";
import { Badge } from "../ui/badge";
import { AppIcon } from "../ui/app-icon";
import {
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SidebarProviderUpdatePill } from "./SidebarProviderUpdatePill";
import { SidebarUpdateArchitectureWarning, SidebarUpdatePill } from "./SidebarUpdatePill";

export const SidebarChromeHeader = memo(function SidebarChromeHeader({
  isElectron,
}: {
  isElectron: boolean;
}) {
  const stageLabel = useEnvironmentStageLabel();
  const environmentIdentificationMode = useEnvironmentIdentificationMode();
  const backdropVariant = resolveSidebarStageBackdropVariant(
    stageLabel,
    environmentIdentificationMode === "artwork",
  );
  const pillLabel =
    environmentIdentificationMode === "pill"
      ? resolveEnvironmentIdentificationPillLabel(stageLabel)
      : null;

  return (
    <SidebarHeader
      className={cn(
        "@container/sidebar-header relative h-[var(--workspace-topbar-height)] shrink-0 flex-row items-center px-3 py-0 md:px-0",
        isElectron && "drag-region",
      )}
    >
      {backdropVariant ? <SidebarStageBackdrop variant={backdropVariant} /> : null}
      <SidebarTrigger
        className={cn(
          "relative z-10 md:hidden",
          backdropVariant &&
            "focus-visible:ring-white/90 [&_svg]:stroke-white/90! [&_svg]:opacity-100! [&_svg]:hover:stroke-white! [:hover,[data-pressed]]:bg-white/15",
          backdropVariant && resolveSidebarStageFocusRingOffsetClass(backdropVariant),
        )}
      />
      <SidebarBrand onBackdrop={backdropVariant !== null} />
      {pillLabel ? (
        <Badge
          className="relative z-10 ml-1 rounded-full px-1.5 text-muted-foreground"
          data-environment-identification="pill"
          size="sm"
          variant="secondary"
        >
          {pillLabel}
        </Badge>
      ) : null}
    </SidebarHeader>
  );
});

function SidebarBrand({ onBackdrop }: { onBackdrop: boolean }) {
  return (
    <Link
      aria-label="Go to threads"
      className={cn(
        "relative z-10 ml-[var(--workspace-titlebar-content-left)] hidden h-7 w-fit min-w-0 shrink-0 items-center gap-1 overflow-hidden rounded-md outline-hidden ring-ring focus-visible:ring-2 md:flex",
        onBackdrop ? "text-white" : "text-foreground",
      )}
      to="/"
    >
      <span className="truncate text-xl leading-none tracking-tight [font-family:var(--font-brand-serif)]">
        akeru
      </span>
    </Link>
  );
}

/** One footer row: icon plus label, same shape for every entry. */
function SidebarUtilityItem({
  icon,
  label,
  onClick,
}: {
  icon: ComponentProps<typeof AppIcon>["icon"];
  label: string;
  onClick: () => void;
}) {
  return (
    <SidebarMenuItem className="min-w-0 flex-1 group-data-[collapsible=icon]:flex-none">
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarMenuButton
              aria-label={label}
              className="h-10 gap-2 rounded-xl px-2 group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0!"
              onClick={onClick}
            >
              <AppIcon className="size-[18px] shrink-0" icon={icon} />
              <span className="truncate text-sm font-medium group-data-[collapsible=icon]:hidden">
                {label}
              </span>
            </SidebarMenuButton>
          }
        />
        <TooltipPopup side="right">{label}</TooltipPopup>
      </Tooltip>
    </SidebarMenuItem>
  );
}

export const SidebarChromeFooter = memo(function SidebarChromeFooter() {
  const { isMobile, setOpenMobile } = useSidebar();
  const closeMobileSidebar = useCallback(() => {
    if (isMobile) setOpenMobile(false);
  }, [isMobile, setOpenMobile]);
  const handlePluginsClick = useCallback(() => {
    closeMobileSidebar();
    openPlugins();
  }, [closeMobileSidebar]);
  const handleSettingsClick = useCallback(() => {
    closeMobileSidebar();
    openSettings();
  }, [closeMobileSidebar]);
  const handleUsageClick = useCallback(() => {
    closeMobileSidebar();
    openUsage();
  }, [closeMobileSidebar]);

  return (
    <SidebarFooter className="max-h-[min(45dvh,22rem)] shrink-0 gap-1 overflow-y-auto overscroll-contain p-[var(--sidebar-content-inset)]">
      <div className="flex flex-col gap-2 empty:hidden group-data-[collapsible=icon]:hidden">
        <SidebarProviderUpdatePill />
        <SidebarUpdateArchitectureWarning />
      </div>
      <SidebarMenu>
        <SidebarUtilityItem icon={PlugSocketIcon} label="Plugins" onClick={handlePluginsClick} />
        <SidebarUtilityItem icon={Analytics01Icon} label="Usage" onClick={handleUsageClick} />
      </SidebarMenu>
      <SidebarMenu className="flex-row items-center gap-1 group-data-[collapsible=icon]:flex-col">
        <SidebarUtilityItem icon={Settings02Icon} label="Settings" onClick={handleSettingsClick} />
        <SidebarUpdatePill />
      </SidebarMenu>
    </SidebarFooter>
  );
});
