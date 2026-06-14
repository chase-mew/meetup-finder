import type { SearchRequestBody, SearchResponseBody } from "@meetup/core";

export interface GeocodeResponse {
  location: { lat: number; lng: number };
  formattedAddress: string;
}

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

/** Stable error codes mirrored from the API, used to pick a client message. */
export type ApiErrorCode =
  | "validation_error"
  | "not_found"
  | "config_error"
  | "provider_error"
  | "internal_error"
  | "rate_limited"
  | "network_error";

function codeForStatus(status: number): ApiErrorCode {
  if (status === 429) {
    return "rate_limited";
  }
  return status >= 500 ? "provider_error" : "validation_error";
}

/** An error from an API call, carrying the HTTP status and machine code. */
export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: ApiErrorCode,
  ) {
    super(message);
    this.name = "ApiClientError";
  }

  /** True when the failure is on the server side rather than the request. */
  get isServerError(): boolean {
    return this.status >= 500;
  }
}

async function parseError(response: Response): Promise<{ message: string; code: ApiErrorCode }> {
  try {
    const body = (await response.json()) as { error?: string; code?: ApiErrorCode };
    if (body?.error) {
      return { message: body.error, code: body.code ?? codeForStatus(response.status) };
    }
  } catch {
    // ignore
  }
  if (response.status === 429) {
    return {
      message: "Too many requests. Please slow down and try again in a moment.",
      code: "rate_limited",
    };
  }
  return { message: `Request failed (${response.status})`, code: codeForStatus(response.status) };
}

async function requestJson(input: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch {
    throw new ApiClientError(
      "Could not reach the server. Check your connection and try again.",
      0,
      "network_error",
    );
  }
}

export async function geocode(query: string): Promise<GeocodeResponse | null> {
  const response = await requestJson(`${API_BASE}/api/geocode?q=${encodeURIComponent(query)}`);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    const { message, code } = await parseError(response);
    throw new ApiClientError(message, response.status, code);
  }
  return (await response.json()) as GeocodeResponse;
}

export async function reverseGeocode(lat: number, lng: number): Promise<GeocodeResponse | null> {
  const query = `lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`;
  const response = await requestJson(`${API_BASE}/api/reverse-geocode?${query}`);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    const { message, code } = await parseError(response);
    throw new ApiClientError(message, response.status, code);
  }
  return (await response.json()) as GeocodeResponse;
}

export async function search(body: SearchRequestBody): Promise<SearchResponseBody> {
  const response = await requestJson(`${API_BASE}/api/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const { message, code } = await parseError(response);
    throw new ApiClientError(message, response.status, code);
  }
  return (await response.json()) as SearchResponseBody;
}

export function photoUrl(ref: string, maxWidth = 600): string {
  return `${API_BASE}/api/photo?ref=${encodeURIComponent(ref)}&maxWidth=${maxWidth}`;
}
