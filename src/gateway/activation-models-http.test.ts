import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { handleActivationModelsHttpRequest } from "./activation-models-http.js";

function makeReq(pathname: string): IncomingMessage {
  return { method: "GET", url: pathname } as IncomingMessage;
}

function makeRes() {
  let body = "";
  const res = {
    statusCode: 200,
    setHeader: () => {},
    end: (chunk?: string) => {
      body = chunk ?? "";
    },
  } as unknown as ServerResponse;
  return { res, getBody: () => body };
}

describe("activation models http", () => {
  it("returns all supported model ids from upstream", async () => {
    const prevConfig = process.env.OPENCLAW_CONFIG_PATH;
    const prevProviderName = process.env.OPENCLAW_ACTIVATION_MODEL_PROVIDER_NAME;
    const dir = await mkdtemp(path.join(os.tmpdir(), "openclaw-activation-models-"));
    try {
      const cfgPath = path.join(dir, "openclaw.json");
      await writeFile(
        cfgPath,
        JSON.stringify(
          {
            agents: {
              defaults: {
                model: { primary: "custom-llm/qwen3-32b" },
              },
            },
            models: {
              providers: {
                "custom-llm": {
                  baseUrl: "http://model.example.com/v1",
                  apiKey: "sk-test-123",
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
                  ],
                },
              },
            },
          },
          null,
          2,
        ),
        "utf8",
      );
      process.env.OPENCLAW_CONFIG_PATH = cfgPath;
      process.env.OPENCLAW_ACTIVATION_MODEL_PROVIDER_NAME = "custom-llm";
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            success: true,
            data: [{ id: "qwen3-32b" }, { id: "gpt" }, { id: "deepseek-llm-7b-chat" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )) as unknown as typeof fetch;
      try {
        const res = makeRes();
        await handleActivationModelsHttpRequest(makeReq("/api/activation/models"), res.res);
        expect(res.res.statusCode).toBe(200);
        const parsed = JSON.parse(res.getBody());
        expect(parsed.ok).toBe(true);
        expect(parsed.providerId).toBe("custom-llm");
        expect(parsed.primaryModel).toBe("qwen3-32b");
        expect(parsed.models.map((item: { id: string }) => item.id)).toEqual([
          "qwen3-32b",
          "gpt",
          "deepseek-llm-7b-chat",
        ]);
      } finally {
        globalThis.fetch = originalFetch;
      }
    } finally {
      if (prevConfig === undefined) {
        delete process.env.OPENCLAW_CONFIG_PATH;
      } else {
        process.env.OPENCLAW_CONFIG_PATH = prevConfig;
      }
      if (prevProviderName === undefined) {
        delete process.env.OPENCLAW_ACTIVATION_MODEL_PROVIDER_NAME;
      } else {
        process.env.OPENCLAW_ACTIVATION_MODEL_PROVIDER_NAME = prevProviderName;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("falls back to configured models when upstream request fails", async () => {
    const prevConfig = process.env.OPENCLAW_CONFIG_PATH;
    const prevProviderName = process.env.OPENCLAW_ACTIVATION_MODEL_PROVIDER_NAME;
    const dir = await mkdtemp(path.join(os.tmpdir(), "openclaw-activation-models-fallback-"));
    try {
      const cfgPath = path.join(dir, "openclaw.json");
      await writeFile(
        cfgPath,
        JSON.stringify(
          {
            agents: {
              defaults: {
                model: { primary: "custom-llm/qwen3-32b" },
              },
            },
            models: {
              providers: {
                "custom-llm": {
                  baseUrl: "http://model.example.com/v1",
                  apiKey: "sk-test-456",
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
          },
          null,
          2,
        ),
        "utf8",
      );
      process.env.OPENCLAW_CONFIG_PATH = cfgPath;
      process.env.OPENCLAW_ACTIVATION_MODEL_PROVIDER_NAME = "custom-llm";
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async () =>
        new Response("boom", { status: 502 })) as unknown as typeof fetch;
      try {
        const res = makeRes();
        await handleActivationModelsHttpRequest(makeReq("/api/activation/models"), res.res);
        expect(res.res.statusCode).toBe(200);
        const parsed = JSON.parse(res.getBody());
        expect(parsed.ok).toBe(true);
        expect(parsed.meta.source).toBe("config-fallback");
        expect(parsed.models.map((item: { id: string }) => item.id)).toContain("qwen3-32b");
      } finally {
        globalThis.fetch = originalFetch;
      }
    } finally {
      if (prevConfig === undefined) {
        delete process.env.OPENCLAW_CONFIG_PATH;
      } else {
        process.env.OPENCLAW_CONFIG_PATH = prevConfig;
      }
      if (prevProviderName === undefined) {
        delete process.env.OPENCLAW_ACTIVATION_MODEL_PROVIDER_NAME;
      } else {
        process.env.OPENCLAW_ACTIVATION_MODEL_PROVIDER_NAME = prevProviderName;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });
});
