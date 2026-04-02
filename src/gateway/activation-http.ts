import fs from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

export async function handleActivationStatusHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== "/api/activation/status") {
    return false;
  }
  const method = (req.method ?? "GET").toUpperCase();
  if (method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Method Not Allowed");
    return true;
  }
  try {
    const markerPath = path.join(resolveStateDir(process.env), "system", "activation.json");
    const raw = await fs.readFile(markerPath, "utf8").catch(() => "");
    const parsed = raw ? (JSON.parse(raw) as { activated?: unknown }) : {};
    const activated = parsed.activated === true;
    sendJson(res, 200, { ok: true, activated });
  } catch {
    sendJson(res, 200, { ok: true, activated: false });
  }
  return true;
}
