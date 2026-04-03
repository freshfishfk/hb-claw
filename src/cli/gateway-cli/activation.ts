import fs from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import {
  SELF_HOSTED_DEFAULT_CONTEXT_WINDOW,
  SELF_HOSTED_DEFAULT_COST,
  SELF_HOSTED_DEFAULT_MAX_TOKENS,
} from "../../agents/self-hosted-provider-defaults.js";
import type { OpenClawConfig } from "../../config/config.js";
import {
  resolveAgentModelFallbackValues,
  resolveAgentModelPrimaryValue,
} from "../../config/model-input.js";
import { loadOrCreateDeviceIdentity } from "../../infra/device-identity.js";

const ACTIVATION_MARKER_FILE = "activation.json";
const ACTIVATION_API_PATH = "/api/activation/activate";
const ACTIVATION_STATUS_PATH = "/api/activation/status";
const ACTIVATION_REQUEST_TIMEOUT_MS = 15_000;
const ACTIVATION_MAX_BODY_BYTES = 64 * 1024;

export type ActivationPayload = {
  companyName: string;
  businessLicense: string;
  adminName: string;
  phone: string;
  activationCode: string;
};

type ActivationForwardPayload = ActivationPayload & {
  deviceId: string;
};

type ActivationServiceSuccess = {
  success: true;
  message: string;
  data: {
    apiKey: string;
  };
};

type ActivationServiceFailure = {
  success: false;
  message: string;
  data?: Record<string, unknown>;
};

type ActivationServiceResponse = ActivationServiceSuccess | ActivationServiceFailure;

type ProviderModelsResponse = {
  success?: boolean;
  data?: Array<{
    id?: unknown;
  }>;
};

export function resolveActivationMarkerPath(stateDir: string): string {
  return path.join(stateDir, "system", ACTIVATION_MARKER_FILE);
}

export async function isActivated(markerPath: string): Promise<boolean> {
  try {
    const raw = await fs.readFile(markerPath, "utf8");
    const parsed = JSON.parse(raw) as { activated?: unknown };
    return parsed.activated === true;
  } catch {
    return false;
  }
}

export function applyActivationConfig(params: {
  cfg: OpenClawConfig;
  providerId: string;
  providerBaseUrl?: string;
  modelId?: string;
  availableModelIds?: string[];
  apiKey: string;
}): OpenClawConfig {
  const providerId = params.providerId.trim();
  const providerBaseUrl = params.providerBaseUrl?.trim();
  const existingProvider = params.cfg.models?.providers?.[providerId];
  const providerModels = existingProvider?.models;
  const firstProviderModel =
    Array.isArray(providerModels) && providerModels.length > 0
      ? typeof providerModels[0]?.id === "string"
        ? providerModels[0].id.trim()
        : ""
      : "";
  const currentPrimaryRaw = resolveAgentModelPrimaryValue(params.cfg.agents?.defaults?.model) ?? "";
  const currentModelId =
    currentPrimaryRaw && currentPrimaryRaw.includes("/")
      ? currentPrimaryRaw.slice(currentPrimaryRaw.indexOf("/") + 1).trim()
      : currentPrimaryRaw.trim();
  const explicitModelId = params.modelId?.trim();
  const discoveredModelIds = (params.availableModelIds ?? [])
    .filter((id) => typeof id === "string")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  const existingModelIds = (existingProvider?.models ?? [])
    .map((model) => (typeof model?.id === "string" ? model.id.trim() : ""))
    .filter((id) => id.length > 0);
  const fallbackModelId = firstProviderModel || currentModelId;
  const mergedModelIds = Array.from(
    new Set([
      ...(explicitModelId ? [explicitModelId] : []),
      ...discoveredModelIds,
      ...existingModelIds,
      ...(discoveredModelIds.length === 0 && existingModelIds.length === 0 && fallbackModelId
        ? [fallbackModelId]
        : []),
    ]),
  );
  const activatedModelId = explicitModelId || mergedModelIds[0] || "";
  const nextPrimaryModelRef = activatedModelId ? `${providerId}/${activatedModelId}` : providerId;
  const nextFallbacks = resolveAgentModelFallbackValues(params.cfg.agents?.defaults?.model);
  const preciseModels =
    mergedModelIds.length > 0
      ? mergedModelIds.map((id) => ({
          id,
          name: id,
          reasoning: false,
          input: ["text"] as Array<"text" | "image">,
          cost: SELF_HOSTED_DEFAULT_COST,
          contextWindow: SELF_HOSTED_DEFAULT_CONTEXT_WINDOW,
          maxTokens: SELF_HOSTED_DEFAULT_MAX_TOKENS,
        }))
      : (existingProvider?.models ?? []);
  const nextProvider = {
    ...existingProvider,
    baseUrl: providerBaseUrl || existingProvider?.baseUrl || "https://api.openai.com/v1",
    api: existingProvider?.api ?? "openai-completions",
    apiKey: params.apiKey,
    models: preciseModels,
  };
  return {
    ...params.cfg,
    models: {
      ...params.cfg.models,
      mode: params.cfg.models?.mode ?? "merge",
      providers: {
        ...params.cfg.models?.providers,
        [providerId]: nextProvider,
      },
    },
    agents: {
      ...params.cfg.agents,
      defaults: {
        ...params.cfg.agents?.defaults,
        model: {
          primary: nextPrimaryModelRef,
          ...(nextFallbacks.length > 0 ? { fallbacks: nextFallbacks } : {}),
        },
        models: activatedModelId
          ? {
              ...params.cfg.agents?.defaults?.models,
              ...Object.fromEntries(
                mergedModelIds.map((modelId) => {
                  const key = `${providerId}/${modelId}`;
                  const existing = params.cfg.agents?.defaults?.models?.[key] ?? {};
                  if (key === nextPrimaryModelRef) {
                    return [
                      key,
                      {
                        ...existing,
                        alias:
                          params.cfg.agents?.defaults?.models?.[nextPrimaryModelRef]?.alias ??
                          "newapi",
                      },
                    ];
                  }
                  return [key, existing];
                }),
              ),
            }
          : params.cfg.agents?.defaults?.models,
      },
    },
  };
}

export function expandActivationProviderAllowlist(params: { cfg: OpenClawConfig }): {
  cfg: OpenClawConfig;
  changed: boolean;
} {
  const defaultsModels = params.cfg.agents?.defaults?.models ?? {};
  const defaultsModel = resolveAgentModelPrimaryValue(params.cfg.agents?.defaults?.model) ?? "";
  if (!defaultsModel.includes("/")) {
    return { cfg: params.cfg, changed: false };
  }
  const providerId = defaultsModel.slice(0, defaultsModel.indexOf("/")).trim();
  const primaryKey = defaultsModel.trim();
  if (!providerId || !primaryKey) {
    return { cfg: params.cfg, changed: false };
  }
  const primaryEntry = defaultsModels[primaryKey];
  if (primaryEntry?.alias !== "newapi") {
    return { cfg: params.cfg, changed: false };
  }
  const providerModelIds = (params.cfg.models?.providers?.[providerId]?.models ?? [])
    .map((model) => (typeof model?.id === "string" ? model.id.trim() : ""))
    .filter((id) => id.length > 0);
  if (providerModelIds.length <= 1) {
    return { cfg: params.cfg, changed: false };
  }
  const nextDefaultsModels: Record<string, { alias?: string; params?: Record<string, unknown> }> = {
    ...defaultsModels,
  };
  let changed = false;
  for (const modelId of providerModelIds) {
    const key = `${providerId}/${modelId}`;
    if (!(key in nextDefaultsModels)) {
      nextDefaultsModels[key] = {};
      changed = true;
    }
  }
  if (!changed) {
    return { cfg: params.cfg, changed: false };
  }
  return {
    cfg: {
      ...params.cfg,
      agents: {
        ...params.cfg.agents,
        defaults: {
          ...params.cfg.agents?.defaults,
          models: nextDefaultsModels,
        },
      },
    },
    changed: true,
  };
}

export function deriveProviderIdFromBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return "custom-model-provider";
  }
  try {
    const url = new URL(trimmed);
    const hostPart = (url.hostname || "custom").replaceAll(/\./g, "-");
    const portPart = url.port ? `-${url.port}` : "";
    return `custom-${hostPart}${portPart}`;
  } catch {
    const safe = trimmed.replace(/[^\w-]+/g, "-");
    return `custom-${safe}`.replace(/-+/g, "-");
  }
}

function resolveListenHost(
  bind: "loopback" | "lan" | "tailnet" | "auto" | "custom",
  customHost?: string,
) {
  if (bind === "loopback") {
    return "127.0.0.1";
  }
  if (bind === "custom") {
    const host = customHost?.trim();
    return host || "0.0.0.0";
  }
  return undefined;
}

function validateActivationPayload(input: unknown): ActivationPayload | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const obj = input as Record<string, unknown>;
  const companyName = typeof obj.companyName === "string" ? obj.companyName.trim() : "";
  const businessLicense = typeof obj.businessLicense === "string" ? obj.businessLicense.trim() : "";
  const adminName = typeof obj.adminName === "string" ? obj.adminName.trim() : "";
  const phone = typeof obj.phone === "string" ? obj.phone.trim() : "";
  const activationCode = typeof obj.activationCode === "string" ? obj.activationCode.trim() : "";
  if (!companyName || !adminName || !phone || !activationCode) {
    return null;
  }
  return { companyName, businessLicense, adminName, phone, activationCode };
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    let total = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => {
      const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      total += piece.length;
      if (total > ACTIVATION_MAX_BODY_BYTES) {
        reject(new Error("payload too large"));
        return;
      }
      chunks.push(piece);
    });
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8").trim();
        resolve(raw ? (JSON.parse(raw) as unknown) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function isActivationServiceResponse(input: unknown): input is ActivationServiceResponse {
  if (!input || typeof input !== "object") {
    return false;
  }
  const response = input as Record<string, unknown>;
  if (typeof response.success !== "boolean") {
    return false;
  }
  if (typeof response.message !== "string") {
    return false;
  }
  if (response.success) {
    const data = response.data;
    const dataRecord = data as Record<string, unknown>;
    return (
      !!data &&
      typeof data === "object" &&
      typeof dataRecord.apiKey === "string" &&
      dataRecord.apiKey.trim().length > 0
    );
  }
  return true;
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

async function requestProviderModelIds(params: {
  providerBaseUrl?: string;
  apiKey: string;
}): Promise<string[]> {
  const url = resolveProviderModelsUrl(params.providerBaseUrl ?? "https://api.openai.com/v1");
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
    },
    signal: AbortSignal.timeout(ACTIVATION_REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`模型列表请求失败: HTTP ${response.status}`);
  }
  const parsed = (await response.json()) as ProviderModelsResponse;
  const okFlag = parsed?.success;
  if (okFlag === false) {
    throw new Error("模型服务返回失败");
  }
  if (!parsed || !Array.isArray(parsed.data)) {
    throw new Error("模型服务返回格式无效");
  }
  return Array.from(
    new Set(
      parsed.data
        .map((item) => (typeof item?.id === "string" ? item.id.trim() : ""))
        .filter((id) => id.length > 0),
    ),
  );
}

async function requestActivationService(params: {
  url: string;
  payload: ActivationForwardPayload;
}): Promise<ActivationServiceResponse> {
  const response = await fetch(params.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params.payload),
    signal: AbortSignal.timeout(ACTIVATION_REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    return {
      success: false,
      message: `激活服务请求失败: HTTP ${response.status}`,
    };
  }
  const parsed = (await response.json()) as unknown;
  if (!isActivationServiceResponse(parsed)) {
    return {
      success: false,
      message: "激活服务返回格式无效",
    };
  }
  return parsed;
}

async function writeActivationMarker(params: {
  markerPath: string;
  payload: ActivationForwardPayload;
  providerId: string;
}) {
  await fs.mkdir(path.dirname(params.markerPath), { recursive: true });
  const marker = {
    activated: true,
    activatedAt: new Date().toISOString(),
    companyName: params.payload.companyName,
    deviceId: params.payload.deviceId,
    providerId: params.providerId,
  };
  await fs.writeFile(params.markerPath, JSON.stringify(marker, null, 2), "utf8");
}

export async function waitForActivation(params: {
  markerPath: string;
  cfg: OpenClawConfig;
  bind: "loopback" | "lan" | "tailnet" | "auto" | "custom";
  customBindHost?: string;
  port: number;
  activationServiceUrl: string;
  providerId: string;
  providerBaseUrl?: string;
  modelId?: string;
  persistConfig: (next: OpenClawConfig) => Promise<void>;
  log: { info: (msg: string) => void; warn: (msg: string) => void };
}): Promise<OpenClawConfig> {
  const host = resolveListenHost(params.bind, params.customBindHost);
  const activationServiceUrl = params.activationServiceUrl.trim();
  const providerId =
    params.providerId.trim() || deriveProviderIdFromBaseUrl(params.providerBaseUrl ?? "");
  let nextConfig = params.cfg;
  const server = createServer((req, res) => {
    void (async () => {
      const method = (req.method ?? "GET").toUpperCase();
      const requestPath = new URL(req.url ?? "/", "http://localhost").pathname;
      if (requestPath === ACTIVATION_STATUS_PATH) {
        if (method !== "GET") {
          sendJson(res, 405, { success: false, message: "Method Not Allowed" });
          return;
        }
        sendJson(res, 200, { ok: true, activated: false });
        return;
      }
      if (requestPath !== ACTIVATION_API_PATH) {
        sendJson(res, 404, { success: false, message: "Not Found" });
        return;
      }
      if (method !== "POST") {
        sendJson(res, 405, { success: false, message: "Method Not Allowed" });
        return;
      }
      let payloadRaw: unknown;
      try {
        payloadRaw = await readJsonBody(req);
      } catch (err) {
        const detail = String(err);
        sendJson(res, detail.includes("payload too large") ? 413 : 400, {
          success: false,
          message: "激活参数无效",
        });
        return;
      }
      const payload = validateActivationPayload(payloadRaw);
      if (!payload) {
        sendJson(res, 400, { success: false, message: "激活参数缺失或格式不正确" });
        return;
      }
      const identity = loadOrCreateDeviceIdentity();
      const payloadForService: ActivationForwardPayload = {
        ...payload,
        deviceId: identity.deviceId,
      };
      const activationResponse = await requestActivationService({
        url: activationServiceUrl,
        payload: payloadForService,
      });
      if (!activationResponse.success) {
        sendJson(res, 400, activationResponse);
        return;
      }
      try {
        let providerModelIds: string[] = [];
        try {
          providerModelIds = await requestProviderModelIds({
            providerBaseUrl: params.providerBaseUrl,
            apiKey: activationResponse.data.apiKey,
          });
        } catch (err) {
          params.log.warn(`load provider models failed: ${String(err)}`);
        }
        nextConfig = applyActivationConfig({
          cfg: nextConfig,
          providerId,
          providerBaseUrl: params.providerBaseUrl,
          modelId: params.modelId,
          availableModelIds: providerModelIds,
          apiKey: activationResponse.data.apiKey,
        });
        await params.persistConfig(nextConfig);
        await writeActivationMarker({
          markerPath: params.markerPath,
          payload: payloadForService,
          providerId,
        });
      } catch (err) {
        sendJson(res, 500, {
          success: false,
          message: `激活落盘失败: ${String(err)}`,
        });
        return;
      }
      sendJson(res, 200, activationResponse);
      void new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    })().catch((err) => {
      params.log.warn(`activation request failed: ${String(err)}`);
      if (!res.headersSent) {
        sendJson(res, 500, { success: false, message: "激活请求处理失败" });
      }
    });
  });

  const listenTarget = host ?? "0.0.0.0";
  params.log.info(
    `gateway activation required; waiting on http://${listenTarget}:${params.port}${ACTIVATION_API_PATH}`,
  );
  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      server.removeAllListeners("error");
      resolve();
    };
    server.on("error", (err) => reject(err));
    server.listen(params.port, host, () => {
      server.on("close", finish);
    });
  });
  return nextConfig;
}
