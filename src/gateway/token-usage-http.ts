import type { IncomingMessage, ServerResponse } from "node:http";
import { loadConfig } from "../config/config.js";

type ActivationUsageItem = {
  id?: number;
  user_id?: number;
  created_at?: number;
  type?: number;
  content?: string;
  username?: string;
  token_name?: string;
  model_name?: string;
  quota?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  use_time?: number;
  is_stream?: boolean;
  channel?: number;
  channel_name?: string;
  token_id?: number;
  group?: string;
  ip?: string;
  request_id?: string;
  other?: string;
};

type ActivationUsageResponse =
  | {
      success: true;
      message: string;
      data: ActivationUsageItem[];
    }
  | {
      success: false;
      message: string;
    };

type ActivationUsageSummaryResponse = {
  code: boolean;
  message: string;
  data?: {
    name?: string;
    total_available?: number;
    total_granted?: number;
    total_used?: number;
  };
};

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function resolveUsageUrlFromActivationBase(rawBase: string): string {
  try {
    const url = new URL(rawBase);
    // Prefer same origin + standard usage path
    return `${url.origin}/api/usage/token/`;
  } catch {
    // Fallback: assume complete URL provided
    return rawBase;
  }
}

function resolveActivatedProviderApiKey(): { providerId: string; apiKey: string } | null {
  const cfg = loadConfig();
  const explicitProvider = (
    process.env.OPENCLAW_ACTIVATION_MODEL_PROVIDER_NAME ??
    process.env.OPENCLAW_ACTIVATION_PROVIDER_ID
  )?.trim();
  if (explicitProvider) {
    const apiKey = cfg.models?.providers?.[explicitProvider]?.apiKey;
    if (typeof apiKey === "string" && apiKey.trim()) {
      return { providerId: explicitProvider, apiKey: apiKey.trim() };
    }
  }
  const providers = cfg.models?.providers ?? {};
  for (const [pid, p] of Object.entries(providers)) {
    const val = p?.apiKey;
    if (typeof val === "string" && val.trim()) {
      return { providerId: pid, apiKey: val.trim() };
    }
  }
  return null;
}

function isLegacyUsageArrayResponse(input: unknown): input is ActivationUsageResponse {
  if (!input || typeof input !== "object") {
    return false;
  }
  const value = input as Record<string, unknown>;
  if (typeof value.success !== "boolean" || typeof value.message !== "string") {
    return false;
  }
  if (value.success) {
    return Array.isArray(value.data);
  }
  return true;
}

function isSummaryUsageResponse(input: unknown): input is ActivationUsageSummaryResponse {
  if (!input || typeof input !== "object") {
    return false;
  }
  const value = input as Record<string, unknown>;
  if (typeof value.code !== "boolean" || typeof value.message !== "string") {
    return false;
  }
  if (value.data === undefined) {
    return true;
  }
  return typeof value.data === "object" && value.data !== null;
}

export async function handleTokenUsageHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== "/api/activation/token-usage") {
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
    const activated = resolveActivatedProviderApiKey();
    if (!activated) {
      sendJson(res, 400, { ok: false, error: "missing activated provider apiKey" });
      return true;
    }
    const activationBase =
      (
        process.env.OPENCLAW_ACTIVATION_USAGE_URL ?? process.env.OPENCLAW_ACTIVATION_SERVICE_URL
      )?.trim() || "http://127.0.0.1:18080/mock/activation";
    const usageUrl = resolveUsageUrlFromActivationBase(activationBase);
    const response = await fetch(usageUrl, {
      headers: { Authorization: `Bearer ${activated.apiKey}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      sendJson(res, 502, {
        ok: false,
        error: `activation usage upstream: HTTP ${response.status}`,
      });
      return true;
    }
    const parsed = (await response.json()) as unknown;
    let tokens: Array<{ tokenId: number; tokenName: string; quota: number; used: number }>;
    let totals: { quota: number; used: number };
    if (isSummaryUsageResponse(parsed)) {
      if (!parsed.code || !parsed.data) {
        sendJson(res, 502, {
          ok: false,
          error: parsed.message || "activation usage upstream failed",
        });
        return true;
      }
      const quota = typeof parsed.data.total_granted === "number" ? parsed.data.total_granted : 0;
      const used = typeof parsed.data.total_used === "number" ? parsed.data.total_used : 0;
      const tokenName = typeof parsed.data.name === "string" ? parsed.data.name : "";
      tokens = [{ tokenId: -1, tokenName, quota, used }];
      totals = { quota, used };
    } else if (isLegacyUsageArrayResponse(parsed)) {
      if (!parsed.success || !Array.isArray(parsed.data)) {
        sendJson(res, 502, {
          ok: false,
          error: parsed.message || "activation usage upstream failed",
        });
        return true;
      }
      const groups = new Map<
        number,
        { tokenId: number; tokenName: string; quota: number; used: number }
      >();
      for (const item of parsed.data) {
        const id = typeof item.token_id === "number" ? item.token_id : -1;
        const name = typeof item.token_name === "string" ? item.token_name : "";
        const quota = typeof item.quota === "number" ? item.quota : 0;
        const used =
          (typeof item.prompt_tokens === "number" ? item.prompt_tokens : 0) +
          (typeof item.completion_tokens === "number" ? item.completion_tokens : 0);
        const prev = groups.get(id);
        if (!prev) {
          groups.set(id, { tokenId: id, tokenName: name, quota, used });
        } else {
          prev.used += used;
          if (quota > prev.quota) {
            prev.quota = quota;
          }
        }
      }
      tokens = Array.from(groups.values());
      totals = tokens.reduce(
        (acc, t) => {
          acc.quota += t.quota;
          acc.used += t.used;
          return acc;
        },
        { quota: 0, used: 0 },
      );
    } else {
      sendJson(res, 502, { ok: false, error: "activation usage payload invalid" });
      return true;
    }
    const body = {
      ok: true,
      tokens: tokens.map((g) => ({
        tokenId: g.tokenId,
        tokenName: g.tokenName,
        quota: g.quota,
        used: g.used,
        remaining: Math.max(0, g.quota - g.used),
      })),
      totals: {
        quota: totals.quota,
        used: totals.used,
        remaining: Math.max(0, totals.quota - totals.used),
      },
      meta: { source: "activation-service", updatedAt: new Date().toISOString() },
    };
    sendJson(res, 200, body);
    return true;
  } catch (err) {
    sendJson(res, 500, { ok: false, error: String(err) });
    return true;
  }
}
