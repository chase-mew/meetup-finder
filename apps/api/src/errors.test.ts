import { describe, expect, it } from "vitest";
import {
  ApiError,
  ConfigError,
  NotFoundError,
  ProviderError,
  ValidationError,
  toApiError,
} from "./errors";

describe("ApiError subclasses", () => {
  it("carry the right status and code", () => {
    expect(new ValidationError("bad").status).toBe(400);
    expect(new ValidationError("bad").code).toBe("validation_error");
    expect(new NotFoundError("missing").status).toBe(404);
    expect(new ConfigError("no key").status).toBe(500);
    expect(new ProviderError("upstream").status).toBe(502);
  });

  it("exposes safe messages but hides config detail", () => {
    expect(new ValidationError("origins required").toBody()).toEqual({
      error: "origins required",
      code: "validation_error",
    });
    const config = new ConfigError("missing GOOGLE_MAPS_API_KEY").toBody();
    expect(config.code).toBe("config_error");
    expect(config.error).not.toContain("GOOGLE_MAPS_API_KEY");
  });
});

describe("toApiError", () => {
  it("passes API errors through unchanged", () => {
    const original = new ValidationError("bad");
    expect(toApiError(original)).toBe(original);
  });

  it("wraps unknown errors as provider errors and keeps the message", () => {
    const wrapped = toApiError(new Error("google exploded"));
    expect(wrapped).toBeInstanceOf(ProviderError);
    expect(wrapped.status).toBe(502);
    expect(wrapped.message).toBe("google exploded");
  });

  it("handles non Error throwables", () => {
    const wrapped = toApiError("weird");
    expect(wrapped).toBeInstanceOf(ApiError);
    expect(wrapped.message).toBe("Unexpected error");
  });
});
