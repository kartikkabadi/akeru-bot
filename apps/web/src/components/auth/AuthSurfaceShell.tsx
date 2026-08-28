import type { ReactNode } from "react";

import { StandaloneBrandHeader } from "../StandaloneBrandHeader";

/**
 * Full-screen shell for standalone auth pages, mirroring the root error
 * view's treatment: plain background with the serif brand wordmark up
 * top. Used by the pairing, CLI-connect, and plugin OAuth surfaces.
 */
export function AuthSurfaceShell({ children }: { readonly children: ReactNode }) {
  return (
    <main className="flex min-h-svh flex-col bg-background text-foreground">
      <StandaloneBrandHeader />

      <section className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 py-12">
        <div className="flex w-full max-w-md flex-col items-center text-center">{children}</div>
      </section>
    </main>
  );
}
