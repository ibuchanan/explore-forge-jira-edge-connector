import type { ProblemDetails, Result } from "forge-ahead";
import { err, StandardError } from "forge-ahead";

export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}

export function toErrorMessage(error: unknown): string {
  if (isProblemDetails(error)) {
    return error.detail;
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string" && error.length > 0) {
    return error;
  }

  return "An unexpected error occurred.";
}

export function isProblemDetails(error: unknown): error is ProblemDetails {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as Partial<ProblemDetails>;
  return (
    typeof candidate.type === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.status === "number" &&
    typeof candidate.detail === "string" &&
    typeof candidate.timestamp === "string"
  );
}

export function toProblemDetails(error: unknown, status = 500): ProblemDetails {
  if (isProblemDetails(error)) {
    return error;
  }

  const result = StandardError.getOrDefault(status).error(
    toErrorMessage(error),
  );

  if (result.isErr()) {
    return result.error;
  }

  throw new Error("Expected StandardError.error to return an error Result.");
}

export function problemResult<T = never>(
  error: unknown,
  status = 500,
): Result<T, ProblemDetails> {
  return err(toProblemDetails(error, status));
}
