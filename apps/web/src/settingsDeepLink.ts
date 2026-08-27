import {
  settingsSearchItemById,
  SETTINGS_SECTION_LABELS,
  type SettingsPath,
} from "./components/settings/settingsSearch";
import type { SettingsSection } from "./settingsDialogStore";

const SETTINGS_SECTION_BY_PATH: Partial<Record<SettingsPath, SettingsSection>> = {
  "/settings/general": "general",
  "/settings/appearance": "appearance",
  "/settings/keybindings": "keybindings",
  "/settings/providers": "providers",
  "/settings/source-control": "source-control",
  "/settings/connections": "connections",
};

const SETTINGS_SECTION_DESTINATIONS: Readonly<
  Record<string, { readonly section: SettingsSection; readonly label: string }>
> = {
  general: { section: "general", label: "General" },
  appearance: { section: "appearance", label: "Appearance" },
  providers: { section: "providers", label: "Providers" },
  connections: { section: "connections", label: "Connections" },
  keybindings: { section: "keybindings", label: "Keybindings" },
  "source-control": { section: "source-control", label: "Source control" },
  diagnostics: { section: "diagnostics", label: "Diagnostics" },
};

const SETTINGS_DEEP_LINK_ALIASES: Readonly<
  Record<
    string,
    {
      readonly section: SettingsSection;
      readonly sectionLabel: string;
      readonly targetId: string;
      readonly targetLabel: string;
    }
  >
> = {
  "local-execution": {
    section: "general",
    sectionLabel: "General",
    targetId: "local-execution",
    targetLabel: "Local execution",
  },
};

export interface SettingsDeepLinkDestination {
  readonly section: SettingsSection;
  readonly sectionLabel: string;
  readonly targetId: string | null;
  readonly targetLabel: string | null;
  readonly tooltip: string;
}

function settingsDestination(id: string | null): Omit<SettingsDeepLinkDestination, "tooltip"> {
  if (id) {
    const alias = SETTINGS_DEEP_LINK_ALIASES[id];
    if (alias) return alias;

    const item = settingsSearchItemById(id);
    const section = item ? SETTINGS_SECTION_BY_PATH[item.to] : undefined;
    if (item && section) {
      return {
        section,
        sectionLabel: SETTINGS_SECTION_LABELS[item.to],
        targetId: item.targetId ?? item.id,
        targetLabel: item.title,
      };
    }

    const sectionDestination = SETTINGS_SECTION_DESTINATIONS[id];
    if (sectionDestination) {
      return {
        section: sectionDestination.section,
        sectionLabel: sectionDestination.label,
        targetId: null,
        targetLabel: null,
      };
    }
  }

  return {
    section: "general",
    sectionLabel: "General",
    targetId: null,
    targetLabel: null,
  };
}

export function parseSettingsDeepLink(
  href: string | undefined,
): SettingsDeepLinkDestination | null {
  if (!href) return null;

  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }

  const queryKeys = [...url.searchParams.keys()];
  if (
    url.protocol !== "grokbot:" ||
    url.hostname !== "app" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/v1/settings" ||
    url.hash !== "" ||
    queryKeys.some((key) => key !== "id") ||
    url.searchParams.getAll("id").length > 1
  ) {
    return null;
  }

  const rawId = url.searchParams.get("id")?.trim() ?? "";
  const destination = settingsDestination(rawId || null);
  const path = ["Settings", destination.sectionLabel, destination.targetLabel]
    .filter((part): part is string => Boolean(part))
    .join(" > ");

  return {
    ...destination,
    tooltip: `Open ${path}`,
  };
}
