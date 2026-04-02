import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { handleActivationStatusHttpRequest } from "./activation-http.js";

describe("gateway activation status endpoint", () => {
  async function request(pathname: string) {
    let body = "";
    const req = {
      method: "GET",
      url: pathname,
    } as IncomingMessage;
    const res = {
      statusCode: 200,
      setHeader: () => {},
      end: (chunk?: string) => {
        body = chunk ?? "";
      },
    } as unknown as ServerResponse;
    await handleActivationStatusHttpRequest(req, res);
    return { statusCode: res.statusCode, body };
  }

  it("returns activated=false when marker file is missing", async () => {
    const prevStateDir = process.env.OPENCLAW_STATE_DIR;
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclaw-activation-status-"));
    process.env.OPENCLAW_STATE_DIR = tempDir;
    try {
      const result = await request("/api/activation/status");
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual({ ok: true, activated: false });
    } finally {
      if (prevStateDir === undefined) {
        delete process.env.OPENCLAW_STATE_DIR;
      } else {
        process.env.OPENCLAW_STATE_DIR = prevStateDir;
      }
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("returns activated=true when marker file is present", async () => {
    const prevStateDir = process.env.OPENCLAW_STATE_DIR;
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclaw-activation-status-"));
    process.env.OPENCLAW_STATE_DIR = tempDir;
    try {
      await mkdir(path.join(tempDir, "system"), { recursive: true });
      await writeFile(
        path.join(tempDir, "system", "activation.json"),
        JSON.stringify({ activated: true }),
        "utf8",
      );
      const result = await request("/api/activation/status");
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual({ ok: true, activated: true });
    } finally {
      if (prevStateDir === undefined) {
        delete process.env.OPENCLAW_STATE_DIR;
      } else {
        process.env.OPENCLAW_STATE_DIR = prevStateDir;
      }
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
