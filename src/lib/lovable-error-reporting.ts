// Lovable-specific error reporting removed.
// Errors are logged to the console and can be wired into a real
// error-tracking service (e.g. Sentry) here in the future.
export function reportLovableError(error: unknown, context?: Record<string, unknown>): void {
  console.error("[error-reporter]", error, context);
}
