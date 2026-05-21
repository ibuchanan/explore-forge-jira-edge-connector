/**
 * Shared HTTP Primitives
 *
 * Core HTTP types used across API route handlers and webtrigger modules.
 * These are kept separate so both modules can share definitions without
 * circular dependencies.
 */

export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS";

export interface HttpHeaders {
  [key: string]: string;
}

export interface QueryParameters {
  [key: string]: string;
}

export interface HttpRequest {
  method: HttpMethod;
  headers: HttpHeaders;
  queryParameters: QueryParameters;
  body: string;
}

export interface HttpResponse {
  statusCode: number;
  headers: HttpHeaders;
  body: string;
}
