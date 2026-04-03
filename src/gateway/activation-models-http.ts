import type { IncomingMessage, ServerResponse } from "node:http";
import { loadConfig } from "../config/config.js";
import { resolveAgentModelPrimaryValue } from "../config/model-input.js";

type ProviderModelsResponse = {
  success?: boolean;
  data?: Array<{
    id?: unknown;
  }>;
};

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function resolveProviderModelsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return "https://api.openai.com/v1/models";
  }
  try {
    const url = new URL(trimmed);
    const pathname = url.pathname.replace(/\/+$/g, "");
    if (pathname.endsWith("/v1/models")) {
      return `${url.origin}${pathname}`;
    }
    if (pathname.endsWith("/v1")) {
      return `${url.origin}${pathname}/models`;
    }
    return `${url.origin}/v1/models`;
  } catch {
    return trimmed;
  }
}

function resolveActivatedProvider() {
  const cfg = loadConfig();
  const providers = cfg.models?.providers ?? {};
  const explicitProvider = (
    process.env.OPENCLAW_ACTIVATION_MODEL_PROVIDER_NAME ??
    process.env.OPENCLAW_ACTIVATION_PROVIDER_ID
  )?.trim();
  const currentPrimaryRaw = resolveAgentModelPrimaryValue(cfg.agents?.defaults?.model) ?? "";
  const primaryProviderId =
    currentPrimaryRaw && currentPrimaryRaw.includes("/")
      ? currentPrimaryRaw.slice(0, currentPrimaryRaw.indexOf("/")).trim()
      : "";
  const primaryModelId =
    currentPrimaryRaw && currentPrimaryRaw.includes("/")
      ? currentPrimaryRaw.slice(currentPrimaryRaw.indexOf("/") + 1).trim()
      : currentPrimaryRaw.trim();
  const providerId = explicitProvider || primaryProviderId;
  const resolvedProvider =
    (providerId ? providers[providerId] : undefined) ??
    Object.entries(providers).find(
      ([, p]) => typeof p?.apiKey === "string" && p.apiKey.trim(),
    )?.[1];
  const resolvedProviderId =
    providerId || Object.entries(providers).find(([, p]) => p === resolvedProvider)?.[0] || "";
  if (!resolvedProvider || !resolvedProviderId) {
    return null;
  }
  const apiKey = typeof resolvedProvider.apiKey === "string" ? resolvedProvider.apiKey.trim() : "";
  const baseUrl =
    typeof resolvedProvider.baseUrl === "string" ? resolvedProvider.baseUrl.trim() : "";
  const configuredModelIds = (resolvedProvider.models ?? [])
    .map((model) => (typeof model?.id === "string" ? model.id.trim() : ""))
    .filter((id) => id.length > 0);
  if (!apiKey || !baseUrl) {
    return null;
  }
  return { providerId: resolvedProviderId, apiKey, baseUrl, primaryModelId, configuredModelIds };
}

async function requestProviderModelIds(baseUrl: string, apiKey: string): Promise<string[]> {
  const response = await fetch(resolveProviderModelsUrl(baseUrl), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const parsed = (await response.json()) as ProviderModelsResponse;
  if (parsed?.success === false) {
    throw new Error("upstream success=false");
  }
  if (!parsed || !Array.isArray(parsed.data)) {
    throw new Error("upstream payload invalid");
  }
  return Array.from(
    new Set(
      parsed.data
        .map((item) => (typeof item?.id === "string" ? item.id.trim() : ""))
        .filter((id) => id.length > 0),
    ),
  );
}

export async function handleActivationModelsHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== "/api/activation/models") {
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
  const activated = resolveActivatedProvider();
  if (!activated) {
    sendJson(res, 400, { ok: false, error: "missing activated provider config" });
    return true;
  }
  try {
    const modelIds = await requestProviderModelIds(activated.baseUrl, activated.apiKey);
    const mergedIds = Array.from(
      new Set([...(activated.primaryModelId ? [activated.primaryModelId] : []), ...modelIds]),
    );
    sendJson(res, 200, {
      ok: true,
      providerId: activated.providerId,
      primaryModel: activated.primaryModelId || mergedIds[0] || "",
      models: mergedIds.map((id) => ({ id, selected: id === activated.primaryModelId })),
      meta: { source: "upstream", updatedAt: new Date().toISOString() },
    });
    return true;
  } catch (err) {
    if (activated.configuredModelIds.length === 0) {
      sendJson(res, 502, { ok: false, error: `activation models upstream: ${String(err)}` });
      return true;
    }
    const mergedIds = Array.from(
      new Set([
        ...(activated.primaryModelId ? [activated.primaryModelId] : []),
        ...activated.configuredModelIds,
      ]),
    );
    sendJson(res, 200, {
      ok: true,
      providerId: activated.providerId,
      primaryModel: activated.primaryModelId || mergedIds[0] || "",
      models: mergedIds.map((id) => ({ id, selected: id === activated.primaryModelId })),
      meta: {
        source: "config-fallback",
        warning: String(err),
        updatedAt: new Date().toISOString(),
      },
    });
    return true;
  }
}
