import { beforeEach, describe, expect, it, vi } from "vitest";

const TELEGRAM_CHANNEL = {
  id: "telegram",
  label: "Telegram",
  aliases: ["tg"],
  blurb: "Telegram channel",
};

describe("chat-meta", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("does not throw when bundled chat metadata is partial", async () => {
    vi.doMock("../plugins/bundled-plugin-metadata.js", () => ({
      listBundledPluginMetadata: () => [
        {
          packageManifest: {
            channel: TELEGRAM_CHANNEL,
          },
        },
      ],
    }));

    const mod = await import("./chat-meta.js");
    expect(mod.listChatChannels().map((entry) => entry.id)).toEqual(["telegram"]);
    expect(mod.normalizeChatChannelId("tg")).toBe("telegram");
    expect(mod.normalizeChatChannelId("discord")).toBeNull();
    expect(() => mod.getChatChannelMeta("discord")).toThrow(
      "Missing bundled chat channel metadata for: discord",
    );
  });
});
