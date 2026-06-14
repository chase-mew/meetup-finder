/**
 * Typed errors for the Worker. Each carries the HTTP status and a stable
 * machine readable `code`, so clients can distinguish a validation problem
 * (their fault, 4xx) from a provider or server problem (our fault, 5xx) and
 * show the right message. The `expose` flag marks whether the message is safe
 * to return to the client verbatim.
 */

/** Stable error codes returned to clients in the response body. */
export type ApiErrorCode =
  | "validation_error"
  | "not_found"
  | "config_error"
  | "provider_error"
  | "internal_error";

/** Shape of every JSON error body the API returns. */
export interface ApiErrorBody {
  error: string;
  code: ApiErrorCode;
}

/** Base class for all errors the Worker deliberately produces. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  /** Whether {@link message} is safe to send to the client. */
  readonly expose: boolean;

  constructor(
    message: string,
    options: { status: number; code: ApiErrorCode; expose?: boolean; cause?: unknown },
  ) {
    super(message);
    this.name = new.target.name;
    this.status = options.status;
    this.code = options.code;
    this.expose = options.expose ?? true;
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }

  /** The body returned to the client, with non exposable messages hidden. */
  toBody(): ApiErrorBody {
    return {
      error: this.expose ? this.message : "Something went wrong on our side.",
      code: this.code,
    };
  }
}

/** The request was malformed or failed validation. */
export class ValidationError extends ApiError {
  constructor(message: string) {
    super(message, { status: 400, code: "validation_error" });
  }
}

/** A lookup found nothing. */
export class NotFoundError extends ApiError {
  constructor(message: string) {
    super(message, { status: 404, code: "not_found" });
  }
}

/** The server is missing required configuration, e.g. an API key. */
export class ConfigError extends ApiError {
  constructor(message: string) {
    // The detail is operator facing, so it is not exposed to clients.
    super(message, { status: 500, code: "config_error", expose: false });
  }
}

/** An upstream provider (Google) failed. */
export class ProviderError extends ApiError {
  constructor(message: string, cause?: unknown) {
    super(message, { status: 502, code: "provider_error", expose: true, cause });
  }
}

/**
 * Coerce an unknown thrown value into an {@link ApiError}. Known API errors
 * pass through; everything else is treated as a provider failure, since the
 * search pipeline's outward calls are all to upstream providers, and wrapped so
 * the original message is preserved for logs while the client gets a 502.
 */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }
  const message = error instanceof Error ? error.message : "Unexpected error";
  return new ProviderError(message, error);
}
