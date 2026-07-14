import { AiError } from '@/lib/ai/shared/result';
import type { ProviderErrorCode } from '@/lib/ai/providers/errors';

/** Stable router error codes — safe to branch on and to surface to API clients. */
export const ROUTER_ERROR_CODES = {
  unsupportedAction: 'unsupported_action',
  unknownModel: 'unknown_model',
  unknownProvider: 'unknown_provider',
  providerNotEnabledForOrganization: 'provider_not_enabled_for_organization',
  noEligibleRoute: 'no_eligible_route',
  providerExecutionFailed: 'provider_execution_failed',
  routeValidationFailed: 'route_validation_failed',
} as const;

export class UnsupportedActionError extends AiError {
  constructor(actionId: string) {
    super(ROUTER_ERROR_CODES.unsupportedAction, `Unsupported action: ${actionId}`);
  }
}

export class UnknownModelError extends AiError {
  constructor(modelId: string) {
    super(ROUTER_ERROR_CODES.unknownModel, `Unknown model: ${modelId}`);
  }
}

export class UnknownProviderError extends AiError {
  constructor(providerId: string) {
    super(ROUTER_ERROR_CODES.unknownProvider, `Unknown provider: ${providerId}`);
  }
}

export class ProviderNotEnabledForOrganizationError extends AiError {
  constructor(organizationId: string, providerId: string) {
    super(
      ROUTER_ERROR_CODES.providerNotEnabledForOrganization,
      `Provider ${providerId} is not enabled for organization ${organizationId}`,
    );
  }
}

export class NoEligibleRouteError extends AiError {
  constructor(actionId: string, detail: string) {
    super(ROUTER_ERROR_CODES.noEligibleRoute, `No eligible route for action ${actionId}: ${detail}`);
  }
}

/** One failed execution attempt — codes and route identifiers only, never payloads or secrets. */
export interface RouteAttemptFailure {
  modelId: string;
  providerId: string;
  externalModelId: string;
  code: ProviderErrorCode | 'adapter_unavailable';
  message: string;
}

export class ProviderExecutionError extends AiError {
  readonly attempts: readonly RouteAttemptFailure[];

  constructor(actionId: string, attempts: readonly RouteAttemptFailure[], options?: { cause?: unknown }) {
    super(
      ROUTER_ERROR_CODES.providerExecutionFailed,
      `Every route for action ${actionId} failed (${attempts.length} attempt${attempts.length === 1 ? '' : 's'})`,
      { cause: options?.cause },
    );
    this.attempts = attempts;
  }
}

export class RouteValidationError extends AiError {
  constructor(detail: string) {
    super(ROUTER_ERROR_CODES.routeValidationFailed, `Invalid route request: ${detail}`);
  }
}
