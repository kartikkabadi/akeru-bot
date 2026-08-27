import type { SandboxProvider } from "@t3tools/contracts";
import { CloudIcon, LaptopIcon } from "lucide-react";
import { useState } from "react";

import { usePrimarySettings, useUpdatePrimarySettings } from "../../hooks/useSettings";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import {
  canSaveSandboxProviderConnection,
  type CloudSandboxProvider,
  disconnectSandboxProvider,
  isSandboxProviderConnected,
  SANDBOX_PROVIDER_DEFINITIONS,
  sandboxConnectionDraft,
  sandboxProviderDefinition,
  saveSandboxProviderConnection,
  selectableSandboxProviders,
} from "./SandboxSettingsPanel.logic";

const SANDBOX_PROVIDER_LABELS: Readonly<Record<SandboxProvider, string>> = {
  local: "Local",
  e2b: "E2B",
  daytona: "Daytona",
  vercel: "Vercel Sandbox",
  upstash: "Upstash Box",
};

export function SandboxSettingsPanel() {
  const sandbox = usePrimarySettings((settings) => settings.sandbox);
  const updateSettings = useUpdatePrimarySettings();
  const [editingProvider, setEditingProvider] = useState<CloudSandboxProvider | null>(null);
  const [draft, setDraft] = useState<Readonly<Record<string, string>>>({});

  const openConnection = (provider: CloudSandboxProvider) => {
    setEditingProvider(provider);
    setDraft(sandboxConnectionDraft(sandbox, provider));
  };

  const closeConnection = () => {
    setEditingProvider(null);
    setDraft({});
  };

  const saveConnection = () => {
    if (editingProvider === null) return;
    const next = saveSandboxProviderConnection({
      settings: sandbox,
      provider: editingProvider,
      draft,
    });
    updateSettings({ sandbox: next });
    closeConnection();
  };

  const editingDefinition =
    editingProvider === null ? null : sandboxProviderDefinition(editingProvider);
  const canSave =
    editingProvider !== null &&
    canSaveSandboxProviderConnection({ settings: sandbox, provider: editingProvider, draft });

  return (
    <>
      <SettingsPageContainer>
        <SettingsSection {...searchableSetting("sandbox")}>
          <SettingsRow
            {...searchableSetting("default-sandbox")}
            description="Every bot uses this computer unless you select a connected cloud provider."
            control={
              <Select
                value={sandbox.defaultProvider}
                onValueChange={(value) => {
                  if (value === null) return;
                  const provider = value as SandboxProvider;
                  if (!selectableSandboxProviders(sandbox).includes(provider)) return;
                  updateSettings({ sandbox: { ...sandbox, defaultProvider: provider } });
                }}
              >
                <SelectTrigger className="w-44" aria-label="Default sandbox">
                  <SelectValue>{SANDBOX_PROVIDER_LABELS[sandbox.defaultProvider]}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {selectableSandboxProviders(sandbox).map((provider) => (
                    <SelectItem key={provider} value={provider}>
                      {SANDBOX_PROVIDER_LABELS[provider]}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            }
          />
          <SettingsRow
            {...searchableSetting("sandbox-auto-idle")}
            description="Akeru pauses the sandbox when the bot is idle."
            control={<Switch checked disabled aria-label="Auto-idle" />}
          />
        </SettingsSection>

        <SettingsSection title="Computers">
          <SettingsRow
            title={
              <span className="flex items-center gap-2">
                <LaptopIcon className="size-4" />
                Local
                <Badge variant="success" className="h-4 px-1.5 text-[10px]">
                  Available
                </Badge>
              </span>
            }
            description="This computer. No key required."
            control={
              sandbox.defaultProvider === "local" ? (
                <Badge variant="secondary">Default</Badge>
              ) : (
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() =>
                    updateSettings({ sandbox: { ...sandbox, defaultProvider: "local" } })
                  }
                >
                  Make default
                </Button>
              )
            }
          />

          {SANDBOX_PROVIDER_DEFINITIONS.map((definition) => {
            const connected = isSandboxProviderConnected(sandbox, definition.id);
            const isDefault = sandbox.defaultProvider === definition.id;
            return (
              <SettingsRow
                key={definition.id}
                title={
                  <span className="flex items-center gap-2">
                    <CloudIcon className="size-4" />
                    {definition.label}
                    {connected ? (
                      <Badge variant="success" className="h-4 px-1.5 text-[10px]">
                        Connected
                      </Badge>
                    ) : null}
                  </span>
                }
                description={definition.description}
                control={
                  <div className="flex items-center gap-2">
                    {isDefault ? <Badge variant="secondary">Default</Badge> : null}
                    {connected && !isDefault ? (
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() =>
                          updateSettings({
                            sandbox: { ...sandbox, defaultProvider: definition.id },
                          })
                        }
                      >
                        Make default
                      </Button>
                    ) : null}
                    <Button
                      size="xs"
                      variant={connected ? "ghost-muted" : "outline"}
                      onClick={() => openConnection(definition.id)}
                    >
                      {connected ? "Edit" : "Connect"}
                    </Button>
                    {connected ? (
                      <Button
                        size="xs"
                        variant="ghost-muted"
                        onClick={() =>
                          updateSettings({
                            sandbox: disconnectSandboxProvider(sandbox, definition.id),
                          })
                        }
                      >
                        Disconnect
                      </Button>
                    ) : null}
                  </div>
                }
              />
            );
          })}
        </SettingsSection>
      </SettingsPageContainer>

      <Dialog
        open={editingProvider !== null}
        onOpenChange={(open) => {
          if (!open) closeConnection();
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>
              {editingDefinition ? `Connect ${editingDefinition.label}` : "Connect sandbox"}
            </DialogTitle>
            <DialogDescription>
              Akeru stores these credentials on this Akeru server.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            {editingDefinition?.fields.map((field) => (
              <label key={field.name} className="grid gap-1.5 text-sm font-medium">
                {field.label}
                <Input
                  type={field.secret ? "password" : undefined}
                  autoComplete="off"
                  value={draft[field.name] ?? ""}
                  placeholder={field.secret ? "Leave blank to keep the saved value" : undefined}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      [field.name]: event.currentTarget.value,
                    }))
                  }
                />
              </label>
            ))}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeConnection}>
              Cancel
            </Button>
            <Button disabled={!canSave} onClick={saveConnection}>
              Connect
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}
