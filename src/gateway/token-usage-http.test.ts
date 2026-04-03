import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { handleTokenUsageHttpRequest } from "./token-usage-http.js";

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

describe("token usage http", () => {
  it("aggregates quota and usage from activation service response", async () => {
    const prevConfig = process.env.OPENCLAW_CONFIG_PATH;
    const prevService = process.env.OPENCLAW_ACTIVATION_SERVICE_URL;
    const dir = await mkdtemp(path.join(os.tmpdir(), "openclaw-token-usage-"));
    try {
      const cfgPath = path.join(dir, "openclaw.json");
      await writeFile(
        cfgPath,
        JSON.stringify(
          {
            models: {
              providers: {
                openai: {
                  baseUrl: "https://api.openai.com/v1",
                  apiKey: "sk-test-123",
                  models: [],
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
      process.env.OPENCLAW_ACTIVATION_SERVICE_URL = "http://mock.example.com/mock/activation";

      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            success: true,
            message: "",
            data: [
              {
                token_id: 5,
                token_name: "My Token",
                quota: 150,
                prompt_tokens: 100,
                completion_tokens: 50,
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )) as unknown as typeof fetch;

      try {
        const res = makeRes();
        await handleTokenUsageHttpRequest(makeReq("/api/activation/token-usage"), res.res);
        expect(res.res.statusCode).toBe(200);
        const parsed = JSON.parse(res.getBody());
        expect(parsed.ok).toBe(true);
        expect(parsed.totals).toEqual({ quota: 150, used: 150, remaining: 0 });
        expect(parsed.tokens[0]).toMatchObject({
          tokenId: 5,
          tokenName: "My Token",
          quota: 150,
          used: 150,
          remaining: 0,
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
    } finally {
      if (prevConfig === undefined) {
        delete process.env.OPENCLAW_CONFIG_PATH;
      } else {
        process.env.OPENCLAW_CONFIG_PATH = prevConfig;
      }
      if (prevService === undefined) {
        delete process.env.OPENCLAW_ACTIVATION_SERVICE_URL;
      } else {
        process.env.OPENCLAW_ACTIVATION_SERVICE_URL = prevService;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });
});
