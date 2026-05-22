/**
 * API Route Module
 *
 * Shared types and response-building helpers for Forge App REST API route handlers.
 *
 * @see {@link https://developer.atlassian.com/platform/forge/manifest-reference/modules/jira-api-route/|Jira API Route}
 */

import type { ProblemDetails } from "../../util/errors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ApiRouteRequest {
  body: string;
  headers: Record<string, string>;
  queryParameters: Record<string, string>;
  requestId: string;
}

export interface ApiRouteResponse {
  statusCode: number;
  body: string;
  headers: Record<string, string>;
}

export type ApiRouteFunction = (
  req: ApiRouteRequest,
) => Promise<ApiRouteResponse>;

// ---------------------------------------------------------------------------
// Response builders
// ---------------------------------------------------------------------------

/**
 * Build a JSON success response.
 *
 * @param body - The response body (will be JSON-serialised)
 * @param status - HTTP status code (default: 200)
 */
export function buildSuccessResponse(
  body: unknown = { message: "OK" },
  status = 200,
): ApiRouteResponse {
  return {
    statusCode: status,
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  };
}

/**
 * Build an RFC 7807 Problem Details error response.
 *
 * Accepts either a detail string or a pre-built ProblemDetails object.
 *
 * @param status - HTTP status code
 * @param detail - Error detail string or a ProblemDetails object
 */
export function buildErrorResponse(
  status: number,
  detail: string | ProblemDetails,
): ApiRouteResponse {
  const body: ProblemDetails =
    typeof detail === "string"
      ? {
          type: `https://httpstatuses.io/${status}`,
          title: "Error",
          status,
          detail,
          timestamp: new Date().toISOString(),
        }
      : detail;

  return {
    statusCode: status,
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/problem+json",
    },
  };
}

// ---------------------------------------------------------------------------
// Logging helpers
// ---------------------------------------------------------------------------

export interface Logger {
  info: (message: string, ...args: unknown[]) => void;
}

/**
 * Structured log of an incoming API route request.
 * Omits the body to avoid logging sensitive data.
 */
export function logApiRouteRequest(logger: Logger, req: ApiRouteRequest): void {
  logger.info("API route request", {
    requestId: req.requestId,
    queryParameters: req.queryParameters,
  });
}
