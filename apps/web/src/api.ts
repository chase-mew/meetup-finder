import type { SearchRequestBody, SearchResponseBody } from "@meetup/core";

export interface GeocodeResponse {
  location: { lat: number; lng: number };
  formattedAddress: string;
}

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

async function parseError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    if (body?.error) {
      return body.error;
    }
  } catch {
    // ignore
  }
  if (response.status === 429) {
    return "Too many requests. Please slow down and try again in a moment.";
  }
  return `Request failed (${response.status})`;
}

export async function geocode(query: string): Promise<GeocodeResponse | null> {
  const response = await fetch(`${API_BASE}/api/geocode?q=${encodeURIComponent(query)}`);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return (await response.json()) as GeocodeResponse;
}

export async function search(body: SearchRequestBody): Promise<SearchResponseBody> {
  const response = await fetch(`${API_BASE}/api/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return (await response.json()) as SearchResponseBody;
}

export function photoUrl(ref: string, maxWidth = 600): string {
  return `${API_BASE}/api/photo?ref=${encodeURIComponent(ref)}&maxWidth=${maxWidth}`;
}
