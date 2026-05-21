/**
 * API Route helper tests
 *
 * Specifies the behavior of buildSuccessResponse, buildErrorResponse,
 * and logApiRouteRequest for Forge App REST API route handlers.
 *
 * @see {@link https://developer.atlassian.com/platform/forge/manifest-reference/modules/jira-api-route/|Jira API Route}
 */

import { describe, expect, it, vi } from "vitest";
import type { ApiRouteRequest, Logger } from "../../src/api/apiRoute";
import {
  buildErrorResponse,
  buildSuccessResponse,
  logApiRouteRequest,
} from "../../src/api/apiRoute";
import { StandardError } from "../../src/util/errors";

const sampleRequest: ApiRouteRequest = {
  body: '{"name":"test"}',
  headers: { "content-type": "application/json" },
  queryParameters: { projectKey: "TEST" },
  requestId: "req-abc-123",
};

describe("buildSuccessResponse", () => {
  it("returns status 200 with a JSON body by default", () => {
    const response = buildSuccessResponse();

    expect(response.statusCode).toBe(200);
    expect(response.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(response.body)).toEqual({ message: "OK" });
  });

  it("serialises a custom body object", () => {
    const data = { id: 42, name: "widget" };
    const response = buildSuccessResponse(data);

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual(data);
  });

  it("accepts a custom status code", () => {
    const response = buildSuccessResponse({ created: true }, 201);

    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.body)).toEqual({ created: true });
  });

  it("always sets Content-Type to application/json", () => {
    const response = buildSuccessResponse({ ok: true }, 204);

    expect(response.headers["Content-Type"]).toBe("application/json");
  });
});

describe("buildErrorResponse", () => {
  it("builds an error response from a detail string", () => {
    const response = buildErrorResponse(404, "Resource not found");

    expect(response.statusCode).toBe(404);
    expect(response.headers["Content-Type"]).toBe("application/problem+json");

    const body = JSON.parse(response.body);
    expect(body.status).toBe(404);
    expect(body.detail).toBe("Resource not found");
    expect(body.type).toBe("https://httpstatuses.io/404");
  });

  it("builds an error response from a pre-built ProblemDetails object", () => {
    const problemDetails = StandardError.getOrDefault(422).error(
      "Invalid field value",
      "2024-05-01T00:00:00.000Z",
    );

    expect(problemDetails.isErr()).toBe(true);
    const response = buildErrorResponse(422, problemDetails.error);

    expect(response.statusCode).toBe(422);
    const body = JSON.parse(response.body);
    expect(body.detail).toBe("Invalid field value");
    expect(body.timestamp).toBe("2024-05-01T00:00:00.000Z");
  });

  it("sets Content-Type to application/problem+json", () => {
    const response = buildErrorResponse(500, "Internal error");

    expect(response.headers["Content-Type"]).toBe("application/problem+json");
  });

  it("includes a timestamp in the body when given a string detail", () => {
    const response = buildErrorResponse(400, "Bad input");
    const body = JSON.parse(response.body);

    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("logApiRouteRequest", () => {
  it("logs the requestId and queryParameters", () => {
    const logger: Logger = { info: vi.fn() };

    logApiRouteRequest(logger, sampleRequest);

    expect(logger.info).toHaveBeenCalledWith("API route request", {
      requestId: "req-abc-123",
      queryParameters: { projectKey: "TEST" },
    });
  });

  it("does not log the request body", () => {
    const logger: Logger = { info: vi.fn() };

    logApiRouteRequest(logger, sampleRequest);

    const [, meta] = vi.mocked(logger.info).mock.calls[0] ?? [];
    expect(JSON.stringify(meta)).not.toContain("name");
    expect(JSON.stringify(meta)).not.toContain("test");
  });
});
