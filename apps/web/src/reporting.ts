import { type ErrorReporter, type ReportContext, createReporter } from "@meetup/core";

/**
 * The app wide error reporter. It reports to Sentry when `VITE_SENTRY_DSN` is
 * configured at build time, and is a silent no op otherwise, so development and
 * unconfigured deployments are unaffected.
 */
export const reporter: ErrorReporter = createReporter({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
  release: import.meta.env.VITE_RELEASE,
  component: "web",
  platform: "javascript",
});

/** Report a handled error with context. Never throws. */
export function reportError(error: unknown, context?: ReportContext): void {
  try {
    void reporter.captureException(error, context);
  } catch {
    // Reporting is best effort.
  }
}

/**
 * Install global handlers so uncaught errors and unhandled promise rejections
 * are reported. Safe to call once at startup.
 */
export function installGlobalErrorReporting(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.addEventListener("error", (event) => {
    reportError(event.error ?? event.message, { stage: "window.onerror", level: "error" });
  });
  window.addEventListener("unhandledrejection", (event) => {
    reportError(event.reason, { stage: "unhandledrejection", level: "error" });
  });
}
