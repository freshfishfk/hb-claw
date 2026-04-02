import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";
import { applyActivationConfig, isActivated, resolveActivationMarkerPath } from "./activation.js";

describe("gateway activation", () => {
  it("writes provider apiKey and baseUrl into models.providers and switches default model", () => {
    const cfg: OpenClawConfig = {
      agents: {
        defaults: {
          model: {
            primary: "anthropic/claude-opus-4-6",
            fallbacks: ["anthropic/claude-sonnet-4-0"],
          },
        },
      },
      models: {
        mode: "merge",
        providers: {
          anthropic: {
            baseUrl: "https://api.anthropic.com",
            apiKey: "keep-me",
            models: [
              {
                id: "claude-opus-4-6",
                name: "claude-opus-4-6",
                reasoning: true,
                input: ["text"],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 200000,
                maxTokens: 4096,
              },
            ],
          },
          openai: {
            api: "openai-responses",
            baseUrl: "https://api.openai.com/v1",
            models: [
              {
                id: "gpt-4o-mini",
                name: "gpt-4o-mini",
                reasoning: false,
                input: ["text"],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 200000,
                maxTokens: 4096,
              },
            ],
          },
        },
      },
    };
    const next = applyActivationConfig({
      cfg,
      providerId: "openai",
      providerBaseUrl: "https://mock-llm.example.com/v1",
      apiKey: "sk-from-activation",
    });
    expect(next.models?.providers?.openai?.api).toBe("openai-responses");
    expect(next.models?.providers?.openai?.baseUrl).toBe("https://mock-llm.example.com/v1");
    expect(next.models?.providers?.openai?.apiKey).toBe("sk-from-activation");
    expect(next.models?.providers?.anthropic?.apiKey).toBe("keep-me");
    expect(next.agents?.defaults?.model).toEqual({
      primary: "openai/gpt-4o-mini",
      fallbacks: ["anthropic/claude-sonnet-4-0"],
    });
  });

  it("switches default model provider by rewriting current primary model ref", () => {
    const cfg: OpenClawConfig = {
      agents: {
        defaults: {
          model: "anthropic/claude-opus-4-6",
        },
      },
      models: {
        providers: {
          openai: {
            api: "openai-responses",
            baseUrl: "https://api.openai.com/v1",
            models: [
              {
                id: "claude-opus-4-6",
                name: "claude-opus-4-6",
                reasoning: true,
                input: ["text"],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 200000,
                maxTokens: 4096,
              },
            ],
          },
        },
      },
    };
    const next = applyActivationConfig({
      cfg,
      providerId: "openai",
      apiKey: "sk-from-activation",
    });
    expect(next.agents?.defaults?.model).toEqual({
      primary: "openai/claude-opus-4-6",
    });
  });

  it("detects activation marker state", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-activation-"));
    const markerPath = resolveActivationMarkerPath(tempDir);
    await expect(isActivated(markerPath)).resolves.toBe(false);
    await fs.mkdir(path.dirname(markerPath), { recursive: true });
    await fs.writeFile(markerPath, JSON.stringify({ activated: true }), "utf8");
    await expect(isActivated(markerPath)).resolves.toBe(true);
  });
});
