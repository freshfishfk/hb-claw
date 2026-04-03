import { DEFAULT_PROVIDER } from "../../agents/defaults.js";
import { hasAvailableAuthForProvider } from "../../agents/model-auth.js";
import { buildAllowedModelSet } from "../../agents/model-selection.js";
import { loadConfig } from "../../config/config.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateModelsListParams,
} from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

export const modelsHandlers: GatewayRequestHandlers = {
  "models.list": async ({ params, respond, context }) => {
    if (!validateModelsListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid models.list params: ${formatValidationErrors(validateModelsListParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const catalog = await context.loadGatewayModelCatalog();
      const cfg = loadConfig();
      const { allowedCatalog } = buildAllowedModelSet({
        cfg,
        catalog,
        defaultProvider: DEFAULT_PROVIDER,
      });
      const base = allowedCatalog.length > 0 ? allowedCatalog : catalog;
      const providers = Array.from(new Set(base.map((m) => m.provider))).filter(Boolean);
      const authMapEntries = await Promise.all(
        providers.map(
          async (p) => [p, await hasAvailableAuthForProvider({ provider: p, cfg })] as const,
        ),
      );
      const authMap = new Map(authMapEntries);
      const hasAnyAuth = Array.from(authMap.values()).some((v) => v);
      const models = hasAnyAuth ? base.filter((m) => authMap.get(m.provider) === true) : base;
      respond(true, { models }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
};
