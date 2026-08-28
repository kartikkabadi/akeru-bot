import { AKERU_HOME_DIRNAME } from "@t3tools/shared/devHome";
import * as Option from "effect/Option";

export type JoinPath = (first: string, ...segments: string[]) => string;

function normalizeConfiguredBaseDir(akeruHome: Option.Option<string>): Option.Option<string> {
  if (Option.isNone(akeruHome)) {
    return Option.none();
  }
  const trimmed = akeruHome.value.trim();
  return trimmed.length > 0 ? Option.some(trimmed) : Option.none();
}

export function resolveDesktopBaseDir(input: {
  readonly homeDirectory: string;
  readonly joinPath: JoinPath;
  readonly akeruHome: Option.Option<string>;
}): string {
  return Option.getOrElse(normalizeConfiguredBaseDir(input.akeruHome), () =>
    input.joinPath(input.homeDirectory, AKERU_HOME_DIRNAME),
  );
}

export function resolveDesktopStateDir(input: {
  readonly baseDir: string;
  readonly isDevelopment: boolean;
  readonly joinPath: JoinPath;
  readonly akeruHome: Option.Option<string>;
}): string {
  const useDevSubdir =
    input.isDevelopment && Option.isNone(normalizeConfiguredBaseDir(input.akeruHome));
  return input.joinPath(input.baseDir, useDevSubdir ? "dev" : "userdata");
}
