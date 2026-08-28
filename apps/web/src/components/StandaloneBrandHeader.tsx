import { APP_STAGE_LABEL } from "../branding";

/**
 * Top-left brand row for standalone full-screen pages (pairing, CLI
 * connect, plugin OAuth callback, root error view). Mirrors the in-app
 * sidebar wordmark: the serif "akeru" mark with a small stage label when
 * the build is not a plain release.
 */
export function StandaloneBrandHeader() {
  const stageLabel = APP_STAGE_LABEL.trim().toLowerCase() === "latest" ? null : APP_STAGE_LABEL;
  return (
    <header className="flex h-[var(--workspace-topbar-height)] shrink-0 items-center gap-2 pl-[var(--workspace-controls-left)] pr-[var(--workspace-controls-right)]">
      <span className="truncate text-xl leading-none tracking-tight [font-family:var(--font-brand-serif)]">
        akeru
      </span>
      {stageLabel ? (
        <span className="text-xs font-medium text-muted-foreground">{stageLabel}</span>
      ) : null}
    </header>
  );
}
