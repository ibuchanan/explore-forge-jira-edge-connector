/**
 * HTTP primitives type tests
 *
 * Verifies that the HttpMethod, HttpRequest, and HttpResponse types
 * are structurally correct and usable as documented.
 */

import { describe, expect, it } from "vitest";
import type {
  HttpMethod,
  HttpRequest,
  HttpResponse,
} from "../../src/util/http";

describe("HttpMethod", () => {
  it("accepts all standard HTTP methods", () => {
    const methods: HttpMethod[] = [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "HEAD",
      "OPTIONS",
    ];

    expect(methods).toHaveLength(7);
    for (const m of methods) {
      expect(typeof m).toBe("string");
    }
  });
});

describe("HttpRequest", () => {
  it("constructs a valid HttpRequest object", () => {
    const req: HttpRequest = {
      method: "POST",
      headers: { "content-type": "application/json" },
      queryParameters: { page: "1" },
      body: '{"hello":"world"}',
    };

    expect(req.method).toBe("POST");
    expect(req.headers["content-type"]).toBe("application/json");
    expect(req.queryParameters["page"]).toBe("1");
    expect(req.body).toBe('{"hello":"world"}');
  });
});

describe("HttpResponse", () => {
  it("constructs a valid HttpResponse object", () => {
    const res: HttpResponse = {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: '{"ok":true}',
    };

    expect(res.statusCode).toBe(200);
    expect(res.headers["Content-Type"]).toBe("application/json");
    expect(res.body).toBe('{"ok":true}');
  });
});
