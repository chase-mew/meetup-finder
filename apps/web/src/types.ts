import type { LatLng } from "@meetup/core";

export type GeoStatus = "idle" | "loading" | "locating" | "ok" | "error";

export interface Person {
  id: string;
  label: string;
  address: string;
  location?: LatLng;
  resolvedAddress?: string;
  status: GeoStatus;
  error?: string;
}
