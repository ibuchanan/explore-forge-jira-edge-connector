/**
 * Logging Module
 *
 * This module provides utilities for safely logging Forge event data.
 * It helps prevent accidentally exposing sensitive information like tokens
 * and authorization headers in application logs.
 *
 * Key Features:
 * - Automatic truncation of contextToken values
 * - Masking of HTTP headers
 * - Recursive processing of nested objects and arrays
 * - Preserves original data structure
 *
 * @example
 * ```typescript
 * import { truncateEvents } from "./logging";
 *
 * export const handler = (request, context) => {
 *   // Safe logging - sensitive data is masked
 *   console.log("Request:", JSON.stringify(truncateEvents(request)));
 *
 *   // Process the request...
 * };
 * ```
 */

import type { Result } from "neverthrow";
import type { ProblemDetails } from "../util/errors";
import type { JSONValue } from "./types";

/**
 * Truncates sensitive information from event objects for safe logging
 *
 * This function recursively processes objects and arrays to mask sensitive data
 * while preserving the overall structure for debugging purposes. It's designed
 * to be used with Forge event objects (webtrigger events, lifecycle events, etc.)
 * before logging them.
 *
 * **What gets truncated:**
 * - `contextToken`: Shows only first 3 and last 3 characters (e.g., "abc...xyz")
 * - `headers`: Completely replaced with `{ "...": "..." }` placeholder
 *
 * **What gets preserved:**
 * - All other fields and values
 * - Object and array structure
 * - Nested objects and arrays (recursively processed)
 *
 * **Why truncate?**
 * - `contextToken` can be used to impersonate your app's installation
 * - `headers` may contain Authorization tokens, API keys, session cookies
 * - Logs may be stored in systems with different security levels
 * - Prevents accidental credential leaks in debugging output
 *
 * @param obj - A JSON-serializable object from a Forge event (request, context, etc.)
 * @returns A new object with the same structure but with sensitive data masked
 *
 * @example
 * ```typescript
 * // Basic usage with webtrigger event
 * export const webtriggerHandler: WebtriggerFunction = (request, context) => {
 *   console.debug("Request received:", JSON.stringify(truncateEvents(request)));
 *
 *   // Original request still has all data
 *   const token = request.contextToken; // Full token available
 *
 *   return buildSuccessResponse({ message: "OK" });
 * };
 * ```
 *
 * @example
 * ```typescript
 * // Before truncation:
 * const event = {
 *   method: "POST",
 *   contextToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
 *   headers: {
 *     "authorization": ["Bearer secret-token"],
 *     "user-agent": ["Mozilla/5.0..."]
 *   },
 *   body: '{"data": "public"}'
 * };
 *
 * // After truncation:
 * const safe = truncateEvents(event);
 * // {
 * //   method: "POST",
 * //   contextToken: "eyJ...VCJ9",
 * //   headers: { "...": "..." },
 * //   body: '{"data": "public"}'
 * // }
 * ```
 *
 * @see {@link https://developer.atlassian.com/platform/forge/runtime-reference/storage-api-security/ | Forge Security Best Practices}
 */
/**
 * Redact a single key-value entry from an event object.
 * Returns the redacted [key, value] pair, or undefined if the entry should be dropped.
 *
 * @internal
 */
function redactEntry(
  key: string,
  value: JSONValue,
): [string, JSONValue] | undefined {
  if (key === "contextToken") {
    if (typeof value === "string") {
      return [key, `${value.slice(0, 3)}...${value.slice(-3)}`];
    }
    return value !== undefined ? [key, value] : undefined;
  }
  if (key === "headers") {
    return [key, { "...": "..." }];
  }
  if (value !== undefined) {
    return [key, truncateEvents(value)];
  }
  return undefined;
}

export function truncateEvents(obj: JSONValue): JSONValue {
  // Primitive values are returned as-is
  if (typeof obj !== "object" || obj === null) {
    return obj;
  }

  // Arrays are recursively processed and returned as arrays
  if (Array.isArray(obj)) {
    return obj.map(truncateEvents);
  }

  // Objects: redact each entry and reassemble
  return Object.fromEntries(
    Object.entries(obj)
      .map(([k, v]) => redactEntry(k, v))
      .filter((entry): entry is [string, JSONValue] => entry !== undefined),
  );
}

/**
 * Log the result of a void-returning Forge function
 *
 * For functions that return void (lifecycle events, scheduled triggers, etc.),
 * this helper automatically logs the outcome of async operations using the
 * neverthrow Result type. It handles both success and error cases with
 * appropriate logging levels.
 *
 * **Logging Behavior:**
 * - **Success case** - Logs at info level with optional label
 * - **Error case** - Logs at error level with full ProblemDetails (type, title, status, detail, timestamp)
 *
 * **Why Use This?**
 * - Consistent logging across all void-returning handlers
 * - Automatic formatting of error details (RFC 9457 ProblemDetails)
 * - Avoids forgetting to log results in void functions
 * - Simple single-line result handling
 *
 * **Common Use Cases:**
 * - Lifecycle events (install, upgrade, uninstall)
 * - Scheduled triggers (cron jobs, background tasks)
 * - Product triggers (Jira events, Confluence events)
 * - Any async handler that returns void
 *
 * @param result - The Result<T, ProblemDetails> from an async operation
 * @param label - Optional label to prefix the success message
 *
 * @example
 * ```typescript
 * // Basic usage with lifecycle event
 * export const install: LifecycleFunction = async (request, context) => {
 *   const result = await setupAppForInstallation(request);
 *   logResult(result);
 *   // Success: Operation completed successfully
 *   // Error: { type, title, status, detail, timestamp }
 * };
 * ```
 *
 * @example
 * ```typescript
 * // With label for context
 * export const install: LifecycleFunction = async (request, context) => {
 *   const result = await setupAppForInstallation(request);
 *   logResult(result, "Installation");
 *   // Success: Installation completed successfully
 * };
 * ```
 *
 * @see {@link https://developer.atlassian.com/platform/forge/events-reference/life-cycle/ | Lifecycle Events}
 * @see {@link https://developer.atlassian.com/platform/forge/events-reference/scheduled-trigger/ | Scheduled Triggers}
 */
export function logResult<T>(
  result: Result<T, ProblemDetails>,
  label?: string,
): void {
  result.match(
    (_value) => {
      // Success case
      const prefix = label ? `${label} result` : "Result";
      console.info(`${prefix}: Success`);
    },
    (error) => {
      // Error case - log the full ProblemDetails for debugging
      const prefix = label ? `${label} result` : "Result";
      console.error(`${prefix}:`, error);
    },
  );
}

/**
 * Log Forge event context information for debugging
 *
 * Safely logs event context with automatic truncation of sensitive data
 * (contextToken, headers). Useful for debugging trigger handlers, tracking
 * which module/cloud is being invoked, and troubleshooting event routing.
 *
 * **What Gets Logged:**
 * - `cloudId` - Which Atlassian site triggered the event
 * - `moduleKey` - Which module in your app was invoked
 * - `userAccess` - Whether user context is available
 * - `contextToken` - Truncated for security (first 3 + last 3 chars)
 * - Other context fields - As provided by the platform
 *
 * **Why Use This?**
 * - Consistent context logging across all handlers
 * - Automatic sensitive data truncation (contextToken, headers)
 * - Clear pattern for troubleshooting event routing
 * - Simple single-line debugging
 *
 * **Common Use Cases:**
 * - Debugging which module is being called
 * - Tracking installations across different sites
 * - Understanding user context availability
 * - Troubleshooting event routing issues
 *
 * @param context - The InstallContext or EventContext from the handler
 * @param label - Optional label to prefix the log message
 *
 * @example
 * ```typescript
 * // Basic usage in any handler
 * export const handler = async (event, context) => {
 *   logContext(context);
 *   // Debug: Context: {"cloudId":"...", "moduleKey":"my-trigger"}
 *
 *   // Your handler logic...
 * };
 * ```
 *
 * @example
 * ```typescript
 * // Lifecycle event with label
 * export const install: LifecycleFunction = async (request, context) => {
 *   logContext(context, "Installation");
 *   // Debug: Installation context: {...}
 *
 *   await setupApp();
 * };
 * ```
 *
 * @see {@link https://developer.atlassian.com/platform/forge/runtime-reference/fetch-api/#context | Forge Context}
 */
export function logContext(context: JSONValue, label?: string): void {
  const prefix = label ? `${label} context` : "Context";
  const truncated = truncateEvents(context);
  console.debug(`${prefix}:`, JSON.stringify(truncated));
}
