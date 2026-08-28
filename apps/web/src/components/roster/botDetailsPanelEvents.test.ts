import { describe, expect, it } from "vite-plus/test";

import {
  requestBotDetailsPanelOpen,
  subscribeToBotDetailsPanelOpen,
} from "./botDetailsPanelEvents";

describe("bot details panel requests", () => {
  it("delivers requests before or after the matching panel subscribes", () => {
    const received: string[] = [];

    requestBotDetailsPanelOpen("bot-akeru");
    const unsubscribeAkeru = subscribeToBotDetailsPanelOpen("bot-akeru", () =>
      received.push("bot-akeru"),
    );
    requestBotDetailsPanelOpen("bot-akeru");
    unsubscribeAkeru();

    requestBotDetailsPanelOpen("bot-mori");
    const unsubscribeMori = subscribeToBotDetailsPanelOpen("bot-mori", () =>
      received.push("bot-mori"),
    );
    unsubscribeMori();

    expect(received).toEqual(["bot-akeru", "bot-akeru", "bot-mori"]);
  });
});
