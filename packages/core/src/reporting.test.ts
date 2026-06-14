import { describe, expect, it, vi } from "vitest";
import {
  type ReportContext,
  SentryReporter,
  createReporter,
  noopReporter,
  parseDsn,
} from "./reporting";

describe("parseDsn", () => {
  it("parses a standard ingest DSN", () => {
    const parsed = parseDsn("https://abc123@o42.ingest.sentry.io/567");
    expect(parsed).not.toBeNull();
    expect(parsed?.publicKey).toBe("abc123");
    expect(parsed?.host).toBe("o42.ingest.sentry.io");
    expect(parsed?.projectId).toBe("567");
    expect(parsed?.envelopeUrl).toBe(
      "https://o42.ingest.sentry.io/api/567/envelope/?sentry_key=abc123&sentry_version=7",
    );
  });

  it("supports a path prefix before the project id", () => {
    const parsed = parseDsn("https://key@sentry.example.com/base/path/9");
    expect(parsed?.projectId).toBe("9");
    expect(parsed?.envelopeUrl).toBe(
      "https://sentry.example.com/base/path/api/9/envelope/?sentry_key=key&sentry_version=7",
    );
  });

  it("returns null for invalid or incomplete DSNs", () => {
    expect(parseDsn("not a url")).toBeNull();
    expect(parseDsn("https://sentry.io/123")).toBeNull(); // no public key
    expect(parseDsn("https://key@sentry.io/")).toBeNull(); // no project id
  });
});

describe("createReporter", () => {
  it("falls back to a no op reporter without a DSN", () => {
    expect(createReporter({})).toBe(noopReporter);
    expect(createReporter({ dsn: "garbage" })).toBe(noopReporter);
  });

  it("returns a Sentry reporter for a valid DSN", () => {
    const reporter = createReporter({
      dsn: "https://key@o1.ingest.sentry.io/2",
      fetchImpl: vi.fn(),
    });
    expect(reporter).toBeInstanceOf(SentryReporter);
  });
});

describe("SentryReporter", () => {
  const dsn = "https://pub@o1.ingest.sentry.io/2";

  function lastBody(fetchImpl: ReturnType<typeof vi.fn>) {
    const call = fetchImpl.mock.calls.at(-1)!;
    const init = call[1] as RequestInit;
    const text = init.body as string;
    const [header, itemHeader, payload] = text.split("\n");
    return {
      url: call[0] as string,
      header: JSON.parse(header!),
      itemHeader: JSON.parse(itemHeader!),
      event: JSON.parse(payload!),
    };
  }

  it("posts an envelope to the ingest URL with the error details", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    const reporter = new SentryReporter({
      dsn,
      environment: "test",
      release: "1.2.3",
      component: "api",
      platform: "node",
      fetchImpl,
    });

    const context: ReportContext = {
      stage: "search",
      tags: { mode: "transit" },
      extra: { originCount: 3 },
    };
    await reporter.captureException(new Error("boom"), context);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const { url, itemHeader, event } = lastBody(fetchImpl);
    expect(url).toContain("/api/2/envelope/");
    expect(itemHeader).toEqual({ type: "event" });
    expect(event.platform).toBe("node");
    expect(event.environment).toBe("test");
    expect(event.release).toBe("1.2.3");
    expect(event.level).toBe("error");
    expect(event.tags).toMatchObject({ component: "api", stage: "search", mode: "transit" });
    expect(event.extra).toEqual({ originCount: 3 });
    expect(event.exception.values[0]).toMatchObject({ type: "Error", value: "boom" });
  });

  it("normalises non Error values", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    const reporter = new SentryReporter({ dsn, fetchImpl });
    await reporter.captureException("plain failure");
    const { event } = lastBody(fetchImpl);
    expect(event.exception.values[0]).toMatchObject({ type: "Error", value: "plain failure" });
  });

  it("never rejects when the transport fails", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });
    const reporter = new SentryReporter({ dsn, fetchImpl });
    await expect(reporter.captureException(new Error("boom"))).resolves.toBeUndefined();
  });

  it("throws on construction with an invalid DSN", () => {
    expect(() => new SentryReporter({ dsn: "nope", fetchImpl: vi.fn() })).toThrow();
  });
});
