import { describe, expect, it, vi } from "vitest";
import { createLogger, redact, timed } from "./logger";

interface Captured {
  level: string;
  line: Record<string, unknown>;
}

function captureLogger(minLevel: "debug" | "info" = "debug") {
  const lines: Captured[] = [];
  const logger = createLogger(
    { requestId: "req-1" },
    {
      minLevel,
      now: () => 0,
      sink: (level, line) => lines.push({ level, line: JSON.parse(line) }),
    },
  );
  return { logger, lines };
}

describe("redact", () => {
  it("masks secret looking object keys", () => {
    expect(redact({ apiKey: "abc", nested: { token: "xyz", safe: 1 } })).toEqual({
      apiKey: "[redacted]",
      nested: { token: "[redacted]", safe: 1 },
    });
  });

  it("scrubs key query parameters in strings", () => {
    expect(redact("https://maps.googleapis.com/x?key=SECRET&foo=1")).toBe(
      "https://maps.googleapis.com/x?key=[redacted]&foo=1",
    );
  });
});

describe("createLogger", () => {
  it("emits structured JSON with merged base context", () => {
    const { logger, lines } = captureLogger();
    logger.info("hello", { stage: "search" });
    expect(lines).toHaveLength(1);
    expect(lines[0]!.level).toBe("info");
    expect(lines[0]!.line).toMatchObject({
      level: "info",
      msg: "hello",
      requestId: "req-1",
      stage: "search",
    });
  });

  it("redacts context before writing", () => {
    const { logger, lines } = captureLogger();
    logger.error("boom", { url: "https://x/y?key=SECRET" });
    expect(lines[0]!.line.url).toBe("https://x/y?key=[redacted]");
  });

  it("respects the minimum level", () => {
    const { logger, lines } = captureLogger("info");
    logger.debug("noisy");
    expect(lines).toHaveLength(0);
  });

  it("child loggers merge context", () => {
    const { logger, lines } = captureLogger();
    logger.child({ route: "/api/search" }).info("hit");
    expect(lines[0]!.line).toMatchObject({ requestId: "req-1", route: "/api/search" });
  });
});

describe("timed", () => {
  it("logs success with a duration and returns the value", async () => {
    const { logger, lines } = captureLogger();
    const value = await timed(logger, "places", async () => 42);
    expect(value).toBe(42);
    const ok = lines.find((l) => l.line.msg === "places ok");
    expect(ok?.line).toMatchObject({ stage: "places" });
    expect(typeof ok?.line.durationMs).toBe("number");
  });

  it("logs and rethrows on failure", async () => {
    const { logger, lines } = captureLogger();
    const failing = vi.fn(async () => {
      throw new Error("nope");
    });
    await expect(timed(logger, "travel", failing)).rejects.toThrow("nope");
    const failed = lines.find((l) => l.line.msg === "travel failed");
    expect(failed?.level).toBe("error");
    expect(failed?.line).toMatchObject({ stage: "travel", error: "nope" });
  });
});
