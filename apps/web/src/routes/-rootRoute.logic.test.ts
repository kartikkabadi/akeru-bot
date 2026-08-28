import { describe, expect, it } from "vite-plus/test";

import { isStandaloneRootPath } from "./-rootRoute.logic";

describe("standalone root routes", () => {
  it("keeps the MCP OAuth callback outside the connected app shell", () => {
    expect(isStandaloneRootPath("/plugins/oauth/callback")).toBe(true);
  });

  it("keeps normal bot routes inside the app shell", () => {
    expect(isStandaloneRootPath("/bots/bot-1")).toBe(false);
  });
});
