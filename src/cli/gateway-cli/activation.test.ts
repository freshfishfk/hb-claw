import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";
import {
  applyActivationConfig,
  deriveProviderIdFromBaseUrl,
  expandActivationProviderAllowlist,
  isActivated,
  resolveActivationMarkerPath,
} from "./activation.js";

describe("gateway activation", () => {
  it("writes precise activated provider/model config and switches default model", () => {
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
      providerId: "custom-60-165-239-28-43000",
      providerBaseUrl: "https://mock-llm.example.com/v1",
      modelId: "qwen3-32b",
      availableModelIds: ["qwen3-32b", "gpt", "deepseek-llm-7b-chat"],
      apiKey: "sk-from-activation",
    });
    expect(next.models?.providers?.["custom-60-165-239-28-43000"]?.api).toBe("openai-completions");
    expect(next.models?.providers?.["custom-60-165-239-28-43000"]?.baseUrl).toBe(
      "https://mock-llm.example.com/v1",
    );
    expect(next.models?.providers?.["custom-60-165-239-28-43000"]?.apiKey).toBe(
      "sk-from-activation",
    );
    expect(next.models?.providers?.["custom-60-165-239-28-43000"]?.models).toEqual([
      {
        id: "qwen3-32b",
        name: "qwen3-32b",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 8192,
      },
      {
        id: "gpt",
        name: "gpt",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 8192,
      },
      {
        id: "deepseek-llm-7b-chat",
        name: "deepseek-llm-7b-chat",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 8192,
      },
    ]);
    expect(next.models?.providers?.anthropic?.apiKey).toBe("keep-me");
    expect(next.agents?.defaults?.model).toEqual({
      primary: "custom-60-165-239-28-43000/qwen3-32b",
      fallbacks: ["anthropic/claude-sonnet-4-0"],
    });
    expect(next.agents?.defaults?.models?.["custom-60-165-239-28-43000/qwen3-32b"]).toEqual({
      alias: "newapi",
    });
    expect(next.agents?.defaults?.models?.["custom-60-165-239-28-43000/gpt"]).toEqual({});
    expect(
      next.agents?.defaults?.models?.["custom-60-165-239-28-43000/deepseek-llm-7b-chat"],
    ).toEqual({});
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
      modelId: "claude-opus-4-6",
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

  it("derives provider id from model api base url", () => {
    expect(deriveProviderIdFromBaseUrl("http://60.165.239.28:43000/v1")).toBe(
      "custom-60-165-239-28-43000",
    );
  });

  it("expands activation model allowlist for existing activated config", () => {
    const cfg: OpenClawConfig = {
      agents: {
        defaults: {
          model: {
            primary: "hanlong-api/qwen3-32b",
          },
          models: {
            "hanlong-api/qwen3-32b": {
              alias: "newapi",
            },
          },
        },
      },
      models: {
        providers: {
          "hanlong-api": {
            baseUrl: "http://60.165.239.28:43000/v1",
            apiKey: "sk-test",
            models: [
              {
                id: "qwen3-32b",
                name: "qwen3-32b",
                reasoning: false,
                input: ["text"],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 128000,
                maxTokens: 8192,
              },
              {
                id: "gpt",
                name: "gpt",
                reasoning: false,
                input: ["text"],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 128000,
                maxTokens: 8192,
              },
            ],
          },
        },
      },
    };
    const expanded = expandActivationProviderAllowlist({ cfg });
    expect(expanded.changed).toBe(true);
    expect(expanded.cfg.agents?.defaults?.models?.["hanlong-api/qwen3-32b"]).toEqual({
      alias: "newapi",
    });
    expect(expanded.cfg.agents?.defaults?.models?.["hanlong-api/gpt"]).toEqual({});
  });
});
