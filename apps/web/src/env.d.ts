/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  /** Sentry DSN for the web app. Errors are reported only when this is set. */
  readonly VITE_SENTRY_DSN?: string;
  /** Optional release identifier passed to Sentry, e.g. a git sha. */
  readonly VITE_RELEASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
